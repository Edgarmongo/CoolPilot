import { describe, expect, it } from "vitest";

/**
 * CI-P7-03: "what would this call cost, and does my budget allow it?", over HTTP.
 *
 * This endpoint exists so the 预算与预估 tab does not implement a second estimator in the browser that
 * could disagree with the gate that actually refuses calls. What this file pins is therefore the
 * contract the page depends on: the answer comes from the server's catalog and settings, "nothing to
 * price it with" is answered as `unpriced` rather than 0, a per-unit call with no quantity is `unknown`
 * rather than a price for an unknown number of units, the request text is measured and dropped, and
 * asking takes no hold and writes no ledger row.
 *
 * The harness pins the temp database before anything that reads it loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
const { jsonRequest } = await import("@/test/route-harness");

const { POST } = await import("./route");
const { createAiModelPrice, listAiUsageLedgerEntries } = await import("@/db/repositories/ai-usage-ledger");
const { updateAiBudgetSettings } = await import("@/db/repositories/settings");
const { inFlightAiBudgetReservations } = await import("@/lib/ai-budget-guard");
const { estimateTokensFromText } = await import("@/lib/ai-budget");

type EstimatePayload = {
  ok: boolean;
  code?: string;
  data?: {
    purpose: string;
    estimate: {
      kind: string;
      currency?: string;
      amountMin?: number;
      amountMax?: number | null;
      inputTokensMin?: number;
      notes: string[];
    };
    decision: {
      status: string;
      reasons: string[];
      estimateCounted: boolean;
      projectedMax: number | null;
    };
    target: { providerId: string; modelId: string; routeResolved: boolean };
  };
};

async function estimate(body: unknown) {
  const response = await POST(jsonRequest("http://localhost/api/ai-cost-center/estimate", body));
  return { status: response.status, body: (await response.json()) as EstimatePayload };
}

/** One CNY per token, in and out, so every amount below reads as the token count it came from. */
const pricePerToken = 1_000_000;

describe("/api/ai-cost-center/estimate", () => {
  it("prices a named model from the catalog as a range, and says who it priced", async () => {
    await createAiModelPrice({
      providerId: "est-priced",
      currency: "CNY",
      inputPerMillion: pricePerToken,
      outputPerMillion: pricePerToken,
      priceVersion: "2026-10",
      effectiveFrom: 1_700_000_000_000,
    });

    const answer = await estimate({
      providerId: "est-priced",
      modelId: "any-model",
      inputTokens: 2,
      maxOutputTokens: 3,
    });

    expect(answer.status).toBe(200);
    expect(answer.body.data?.purpose).toBe("estimate-preview");
    // A wildcard row prices the model it does not name - the catalog's rule, answered by the catalog.
    expect(answer.body.data?.target).toMatchObject({
      providerId: "est-priced",
      modelId: "any-model",
      routeResolved: false,
    });
    expect(answer.body.data?.estimate).toMatchObject({
      kind: "estimate",
      currency: "CNY",
      amountMin: 2,
      amountMax: 5,
    });
    // With the gate off nothing is decided, but the numbers are still reported.
    expect(answer.body.data?.decision.status).toBe("off");
    expect(answer.body.data?.decision.estimateCounted).toBe(false);
  });

  it("measures the text it is given, and never carries it back or leaves a trace of it", async () => {
    await updateAiBudgetSettings({ policy: "warn", monthlyLimit: 100, currency: "CNY", unknownCostPolicy: "allow" });
    const text = "abcd-zzzz-secret-body";
    const rowsBefore = (await listAiUsageLedgerEntries({ limit: 5000 })).length;

    const answer = await estimate({ providerId: "est-priced", modelId: "any-model", inputText: text });

    expect(answer.body.data?.estimate.kind).toBe("estimate");
    expect(answer.body.data?.estimate.inputTokensMin).toBe(estimateTokensFromText(text));
    // Nobody stated a reply ceiling, so the upper bound stays unknown instead of being invented.
    expect(answer.body.data?.estimate.amountMax).toBeNull();
    expect(answer.body.data?.estimate.notes).toContain("output-ceiling-unknown");
    // The text is not echoed, and no ledger row was written: it was measured and dropped.
    expect(JSON.stringify(answer.body)).not.toContain(text);
    expect((await listAiUsageLedgerEntries({ limit: 5000 })).length).toBe(rowsBefore);
    // And asking takes no hold, so a preview cannot change anyone's remaining budget.
    expect(await inFlightAiBudgetReservations()).toEqual([]);
  });

  it("answers \"unpriced\" for a model the catalog has nothing to say about, instead of calling it free", async () => {
    await updateAiBudgetSettings({ policy: "warn", monthlyLimit: 100, currency: "CNY", unknownCostPolicy: "allow" });

    const cheap = await estimate({ providerId: "est-no-price", modelId: "m", inputTokens: 10 });
    expect(cheap.status).toBe(200);
    expect(cheap.body.data?.estimate).toMatchObject({ kind: "unpriced" });
    expect(cheap.body.data?.estimate.notes).toContain("price-not-on-file");
    // Passed, but explicitly not counted: an unstated cost is not a 0 in anyone's total.
    expect(cheap.body.data?.decision.status).toBe("allowed");
    expect(cheap.body.data?.decision.reasons).toContain("unknown-cost-not-counted");
    expect(cheap.body.data?.decision.estimateCounted).toBe(false);

    // With the stricter policy the same question is refused before any call would be sent.
    await updateAiBudgetSettings({ unknownCostPolicy: "block" });
    const strict = await estimate({ providerId: "est-no-price", modelId: "m", inputTokens: 10 });
    expect(strict.body.data?.decision.status).toBe("blocked");
    expect(strict.body.data?.decision.reasons).toContain("unknown-cost-refused");
  });

  it("refuses to price a per-unit dimension with no quantity", async () => {
    await createAiModelPrice({
      providerId: "est-image",
      meteredKind: "image",
      currency: "USD",
      unitLabel: "image",
      unitPrice: 0.04,
      priceVersion: "2026-10",
      effectiveFrom: 1_700_000_000_000,
    });

    const withoutQuantity = await estimate({ providerId: "est-image", modelId: "m", meteredKind: "image" });
    // An unknown number of images has no price, and guessing one would be inventing a figure.
    expect(withoutQuantity.body.data?.estimate).toMatchObject({ kind: "unknown" });
    expect(withoutQuantity.body.data?.estimate.notes).toContain("usage-basis-unknown");

    const withQuantity = await estimate({
      providerId: "est-image",
      modelId: "m",
      meteredKind: "image",
      quantity: 5,
    });
    // A per-unit call is one figure, both bounds the same: five images at 0.04.
    expect(withQuantity.body.data?.estimate).toMatchObject({ kind: "estimate", currency: "USD", amountMin: 0.2, amountMax: 0.2 });
  });

  it("answers a question with no model named by resolving the route, and says the route is unresolved", async () => {
    await updateAiBudgetSettings({ policy: "off", monthlyLimit: null, currency: "CNY", unknownCostPolicy: "allow" });

    const answer = await estimate({ inputText: "hello" });
    expect(answer.status).toBe(200);
    // Nothing is configured in this database, so there is no route to price - and the answer says that
    // rather than picking a model to price on the user's behalf.
    expect(answer.body.data?.target.routeResolved).toBe(false);
    expect(answer.body.data?.estimate.kind).toBe("unpriced");
    expect(answer.body.data?.estimate.notes).toContain("route-unresolved");
  });

  it("rejects a payload it cannot price rather than guessing what was meant", async () => {
    // A reply ceiling of 0 tokens is not a ceiling; a negative token count is not a count.
    const zeroCeiling = await estimate({ providerId: "est-priced", modelId: "m", maxOutputTokens: 0 });
    expect(zeroCeiling.status).toBe(400);
    expect(zeroCeiling.body.code).toBe("INVALID_PAYLOAD");

    const negativeTokens = await estimate({ providerId: "est-priced", modelId: "m", inputTokens: -1 });
    expect(negativeTokens.status).toBe(400);
    expect(negativeTokens.body.code).toBe("INVALID_PAYLOAD");
  });
});
