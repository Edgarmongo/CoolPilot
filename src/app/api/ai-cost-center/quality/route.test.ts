import { describe, expect, it } from "vitest";

/**
 * CI-P7-04: the 质量与优化 endpoint, over HTTP.
 *
 * The arithmetic is pinned where it lives (`@/lib/quality-cost.test.ts`). What only this file can check
 * is what the endpoint is responsible for: that the window is the tab's own calendar rule, that the
 * readings are assembled from the ledger and the content records (not from anything this route
 * invents), that a read writes nothing, and that the one write this tab may make happens only for a
 * suggestion the server just re-derived - with a `409` when it does not hold any more.
 *
 * The harness pins the temp database before anything that reads it loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
await import("@/test/route-harness");

const { GET, POST } = await import("./route");
const { createAiUsageLedgerEntry, listAiUsageLedgerEntries } = await import("@/db/repositories/ai-usage-ledger");
const { createContentItem, markContentItemPosted, updateContentItem } = await import("@/db/repositories/content");
const { getAiBudgetSettings, updateAiBudgetSettings } = await import("@/db/repositories/settings");
const { qualitySuggestionIds } = await import("@/lib/quality-cost");
const { usageRangeDays } = await import("@/lib/types");
const { jsonRequest } = await import("@/test/route-harness");

type QualityPayload = {
  ok: boolean;
  code?: string;
  details?: { reason?: string; suggestionId?: string; applied?: boolean };
  data?: {
    range: number;
    from: number;
    to: number;
    truncated: boolean;
    calls: {
      calls: number;
      requests: number;
      retries: number;
      retryShare: number | null;
      requestsPerCall: number | null;
      singleRequestSuccesses: number;
      singleRequestSuccessRate: number | null;
      firstRequestSuccessRate: number | null;
      failedCalls: number;
      unresolvedPredecessorRequests: number;
    };
    content: { created: number; adopted: number; adoptionRate: number | null; byStatus: Record<string, number> };
    humanEdits: {
      versions: number;
      derivedVersions: number;
      editedVersions: number;
      editRate: number | null;
      unreadableVersions: number;
      magnitudeRecorded: boolean;
      truncated: boolean;
    };
    objective: {
      adoptedOutputs: number;
      attributedOutputs: number;
      attributionPartial: boolean;
      totalTokens: number;
      tokensPerOutput: number | null;
      byCurrency: Array<{
        currency: string;
        windowAmount: number;
        attributedAmount: number;
        costPerOutput: number | null;
      }>;
      unattributedByCurrency: Array<{ currency: string; amount: number }>;
      costIsComplete: boolean;
      unpricedRequests: number;
      unmeasuredRequests: number;
    };
    suggestions: Array<{ id: string; action: { kind: string; strategy?: string; target?: string } }>;
    budget: {
      settings: { policy: string; strategy: string; monthlyLimit: number | null; currency: string };
      spent: { amount: number; isComplete: boolean };
      remaining: number | null;
      strategyLines: Record<string, unknown>;
    };
    applied?: { suggestionId: string; from: string; to: string; at: number };
  };
};

async function readQuality(range = 7) {
  const response = await GET(new Request(`http://localhost/api/ai-cost-center/quality?range=${range}`));
  return { status: response.status, body: (await response.json()) as QualityPayload };
}

async function applySuggestion(suggestionId: string, range = 7) {
  const response = await POST(
    jsonRequest(`http://localhost/api/ai-cost-center/quality?range=${range}`, { suggestionId }),
  );
  return { status: response.status, body: (await response.json()) as QualityPayload };
}

/** A stored platform rendition in the shape the content reader accepts. */
function rendition(input: { platform: string; source: "derived" | "edited"; at: number }) {
  return {
    platform: input.platform,
    title: "t",
    body: "b",
    imagePath: "",
    videoPath: "",
    source: input.source,
    adaptations: [],
    baseFingerprint: "fp",
    createdAt: input.at,
    updatedAt: input.at,
  };
}

describe("/api/ai-cost-center/quality", () => {
  it("answers a fresh install with no rate, no cost and no suggestion", async () => {
    const answer = await readQuality();
    expect(answer.status).toBe(200);
    expect(answer.body.ok).toBe(true);

    expect(answer.body.data?.range).toBe(usageRangeDays[0]);
    expect(answer.body.data?.truncated).toBe(false);
    // Every share is null rather than 0: nothing was measured in this window.
    expect(answer.body.data?.calls).toMatchObject({
      calls: 0,
      requests: 0,
      retries: 0,
      retryShare: null,
      requestsPerCall: null,
      singleRequestSuccessRate: null,
      failedCalls: 0,
    });
    expect(answer.body.data?.content).toMatchObject({ created: 0, adopted: 0, adoptionRate: null });
    expect(answer.body.data?.humanEdits).toMatchObject({
      versions: 0,
      editedVersions: 0,
      editRate: null,
      // The magnitude the card asks for is not recorded anywhere, and the answer says so.
      magnitudeRecorded: false,
    });
    expect(answer.body.data?.objective).toMatchObject({ adoptedOutputs: 0, tokensPerOutput: null, byCurrency: [] });
    expect(answer.body.data?.suggestions).toEqual([]);

    // The budget state travels with the answer, and the tier table is the server's own.
    expect(answer.body.data?.budget.settings).toMatchObject({
      policy: "off",
      monthlyLimit: null,
      strategy: "balanced",
    });
    expect(Object.keys(answer.body.data?.budget.strategyLines ?? {}).sort()).toEqual([
      "balanced",
      "cost-saving",
      "quality-first",
    ]);
    // Nothing was applied by a read.
    expect(answer.body.data?.applied).toBeUndefined();
  });

  it("changes nothing when it is read", async () => {
    const before = await getAiBudgetSettings();
    const rowsBefore = (await listAiUsageLedgerEntries({ limit: 5000 })).length;
    await readQuality(30);
    expect(await getAiBudgetSettings()).toEqual(before);
    expect((await listAiUsageLedgerEntries({ limit: 5000 })).length).toBe(rowsBefore);
  });

  it("reads the call figures off the ledger's own call chains", async () => {
    // One call that passed on its only request.
    await createAiUsageLedgerEntry({ purpose: "article", attemptIndex: 0 });
    // One call that failed and then succeeded: a retry, not a pass on the first request.
    const failed = await createAiUsageLedgerEntry({ purpose: "article", outcome: "failed", attemptIndex: 0 });
    await createAiUsageLedgerEntry({ purpose: "article", attemptIndex: 1, parentUsageId: failed?.id ?? "" });
    // One retry whose predecessor is not among the rows this window reads.
    await createAiUsageLedgerEntry({ purpose: "article", attemptIndex: 1, parentUsageId: "missing-row" });

    const answer = await readQuality();
    const calls = answer.body.data?.calls;
    expect(calls).toMatchObject({ calls: 3, requests: 4, retries: 2, failedCalls: 0 });
    // One of the three calls passed on a single request; the unreadable-predecessor retry cannot, so it
    // is in `calls` and in neither pass count.
    expect(calls?.singleRequestSuccesses).toBe(1);
    expect(calls?.retryShare).toBe(0.5);
    expect(calls?.unresolvedPredecessorRequests).toBe(1);
  });
});

describe("/api/ai-cost-center/quality - the objective and the edit signal", () => {
  it("divides the money of the adopted outputs by how many were adopted", async () => {
    const item = await createContentItem({ title: "adopted", body: "b", postReadyText: "p" });
    await markContentItemPosted(item.id);
    await createContentItem({ title: "still a draft", body: "b", postReadyText: "p" });

    await createAiUsageLedgerEntry({
      purpose: "article",
      contentItemId: item.id,
      costAmount: 2,
      costCurrency: "CNY",
      tokens: { inputTokens: 600, outputTokens: 400, totalTokens: 1_000 },
    });
    await createAiUsageLedgerEntry({ purpose: "research", costAmount: 3, costCurrency: "CNY" });
    // An amount nobody could state: it stays out of the total and is counted instead.
    await createAiUsageLedgerEntry({ purpose: "article", costAmount: null, costSource: "unpriced" });

    const answer = await readQuality();
    const objective = answer.body.data?.objective;
    expect(answer.body.data?.content).toMatchObject({ created: 2, adopted: 1, adoptionRate: 0.5 });
    expect(objective?.byCurrency).toEqual([
      { currency: "CNY", windowAmount: 5, attributedAmount: 2, costPerOutput: 2 },
    ]);
    // The part of the window's bill that names no adopted output is shown, not dropped.
    expect(objective?.unattributedByCurrency).toEqual([{ currency: "CNY", amount: 3, attempts: 1 }]);
    expect(objective).toMatchObject({
      adoptedOutputs: 1,
      attributedOutputs: 1,
      attributionPartial: false,
      costIsComplete: false,
      unpricedRequests: 1,
    });
    expect(objective?.tokensPerOutput).toBe(1_000);
  });

  it("reads the human-edit signal off the platform renditions and says what it cannot measure", async () => {
    const at = Date.now();
    const item = await createContentItem({ title: "multi-platform", body: "b", postReadyText: "p" });
    await updateContentItem(item.id, {
      metadata: {
        platformVersions: {
          threads: rendition({ platform: "threads", source: "edited", at }),
          xiaohongshu: rendition({ platform: "xiaohongshu", source: "derived", at }),
          // A shape this build cannot read: counted, never dropped.
          weibo: { body: "no shape at all" },
        },
      },
    });

    const answer = await readQuality();
    expect(answer.body.data?.humanEdits).toMatchObject({
      versions: 2,
      editedVersions: 1,
      derivedVersions: 1,
      editRate: 0.5,
      unreadableVersions: 1,
      truncated: false,
      magnitudeRecorded: false,
    });
  });
});

describe("/api/ai-cost-center/quality - applying a suggestion", () => {
  /** A period that is 80% spent under `block`, which is where the tier rule acts. */
  async function nearlySpentPeriod() {
    await updateAiBudgetSettings({
      policy: "block",
      monthlyLimit: 10,
      currency: "CNY",
      unknownCostPolicy: "allow",
      strategy: "balanced",
    });
    await createAiUsageLedgerEntry({ purpose: "article", costAmount: 8, costCurrency: "CNY" });
  }

  it("applies the tier a suggestion names and answers with the window after the write", async () => {
    await nearlySpentPeriod();
    const before = await readQuality();
    const suggestion = before.body.data?.suggestions.find((entry) => entry.id === "switch-to-cost-saving");
    // The tier is named by the server, and the action is the one that writes a setting.
    expect(suggestion?.action).toEqual({ kind: "strategy", strategy: "cost-saving" });

    const answer = await applySuggestion("switch-to-cost-saving");
    expect(answer.status).toBe(200);
    expect(answer.body.ok).toBe(true);
    expect(answer.body.data?.applied?.from).toBe("balanced");
    expect(answer.body.data?.applied?.to).toBe("cost-saving");
    expect(answer.body.data?.applied?.suggestionId).toBe("switch-to-cost-saving");
    // The answer carries the state after the write, so the page never has to guess it.
    expect(answer.body.data?.budget.settings.strategy).toBe("cost-saving");
    expect(await getAiBudgetSettings()).toMatchObject({ strategy: "cost-saving" });
    // And the suggestion it just carried out is gone from the list it returns.
    expect(answer.body.data?.suggestions.map((entry) => entry.id)).not.toContain("switch-to-cost-saving");
    // The window's own figures did not move: the write changed a setting, not the ledger.
    expect(answer.body.data?.budget.spent.amount).toBe(before.body.data?.budget.spent.amount);
  });

  it("refuses a suggestion whose basis no longer holds, and writes nothing", async () => {
    await nearlySpentPeriod();
    // First apply: the period is nearly spent, so the suggestion exists and is applied.
    expect((await applySuggestion("switch-to-cost-saving")).status).toBe(200);

    // Second apply: the tier is in force now, so the rule no longer fires.
    const again = await applySuggestion("switch-to-cost-saving");
    expect(again.status).toBe(409);
    expect(again.body.ok).toBe(false);
    expect(again.body.details).toMatchObject({
      applied: false,
      reason: "suggestion-not-applicable",
      suggestionId: "switch-to-cost-saving",
    });
    // Nothing was written by the refusal, and the refusal did not undo the first write either.
    expect(await getAiBudgetSettings()).toMatchObject({ strategy: "cost-saving" });
  });

  it("refuses a suggestion that has no setting behind it", async () => {
    // `review-adoption` is a hint with `action: none`; the endpoint has nothing it could write.
    const answer = await applySuggestion("review-adoption");
    expect(answer.status).toBe(409);
    expect(answer.body.details?.reason).toBe("suggestion-not-applicable");
  });

  it("rejects a body that is not a suggestion id", async () => {
    const unknown = await applySuggestion("make-everything-cheaper");
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("INVALID_PAYLOAD");

    // The body has to be an object with one of the ids the server implements.
    const empty = await POST(jsonRequest("http://localhost/api/ai-cost-center/quality", {}));
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as QualityPayload).code).toBe("INVALID_PAYLOAD");

    // Every id the code exports is accepted by the boundary (`409` here means "known, not applicable").
    for (const suggestionId of qualitySuggestionIds) {
      const answer = await applySuggestion(suggestionId);
      expect([200, 409]).toContain(answer.status);
    }
  });

  it("keeps the window it was asked about", async () => {
    const answer = await readQuality(90);
    expect(answer.body.data?.range).toBe(90);
    // A range the vocabulary does not have falls back to the shipped default rather than erroring.
    const bogus = await readQuality(Number.NaN);
    expect(bogus.status).toBe(200);
    expect(bogus.body.data?.range).toBe(usageRangeDays[0]);
  });
});
