import { describe, expect, it } from "vitest";
import type { AiUsageLedgerEntry, AiUsageMeteredKind, AiUsagePricingBasis, AiUsageTokens } from "@/lib/types";
import { emptyAiUsageTokens } from "./ai-usage-ledger";
import { meteringReasonFor, summarizeLedgerMeteringCoverage } from "./ai-metering";

/**
 * CI-P7-05-04: 「无法准确计量的服务必须显式标记，而不是漏记」.
 *
 * Two things only this file can pin:
 *
 *  1. **the reason is the row's own evidence.** Each case below is a row shape the ledger really can
 *     hold, and the expected reason is the one its stored fields support - including the case where
 *     they support none (`not-recorded`), which must stay `not-recorded` rather than become a guess;
 *  2. **a dimension with no rows is still named.** The coverage reading is built from the vocabulary,
 *     so `video` / `embedding` appear as unmeterable even over an empty window - the difference
 *     between "cannot be metered" and "was not used" is the whole point of the card.
 */

const emptyTokens: AiUsageTokens = emptyAiUsageTokens();

/** A row as the ledger stores one; every field is filled so each case can state only what it varies. */
function row(partial: Partial<AiUsageLedgerEntry>): AiUsageLedgerEntry {
  return {
    id: partial.id ?? "u1",
    purpose: partial.purpose ?? "article",
    outcome: partial.outcome ?? "success",
    providerId: partial.providerId ?? "qwen",
    modelId: partial.modelId ?? "qwen-plus",
    endpointId: partial.endpointId ?? "ep1",
    credentialLabel: partial.credentialLabel ?? "****1234",
    attemptIndex: partial.attemptIndex ?? 0,
    taskId: partial.taskId ?? "",
    runId: partial.runId ?? "",
    nodeId: partial.nodeId ?? "",
    parentUsageId: partial.parentUsageId ?? "",
    outputAssetId: partial.outputAssetId ?? "",
    contentItemId: partial.contentItemId ?? "",
    extensionId: partial.extensionId ?? "",
    budgetReservationId: partial.budgetReservationId ?? "",
    meteredKind: partial.meteredKind ?? "text",
    tokens: partial.tokens ?? emptyTokens,
    completeness: partial.completeness ?? "reported",
    quantityJson: partial.quantityJson ?? "{}",
    costAmount: partial.costAmount === undefined ? null : partial.costAmount,
    costCurrency: partial.costCurrency ?? "",
    costSource: partial.costSource ?? "unknown",
    pricing: partial.pricing === undefined ? null : partial.pricing,
    durationMs: partial.durationMs ?? 0,
    errorSummary: partial.errorSummary ?? "",
    createdAt: partial.createdAt ?? 1_000,
  };
}

const textPrice: AiUsagePricingBasis = {
  meteredKind: "text",
  currency: "CNY",
  inputPerMillion: 1,
  outputPerMillion: 2,
  priceVersion: "2026-10",
  source: "manual",
};

const imagePrice: AiUsagePricingBasis = {
  meteredKind: "image",
  currency: "USD",
  inputPerMillion: 0,
  outputPerMillion: 0,
  unitPrice: 0.04,
  unitLabel: "image",
  priceVersion: "2026-10",
  source: "manual",
};

describe("meteringReasonFor", () => {
  it("says nothing about a row that stated a figure", () => {
    expect(meteringReasonFor(row({ costAmount: 0.25, costSource: "computed", pricing: textPrice }))).toBe("");
    // A vendor's own charge is a figure too - the only one that is not our arithmetic.
    expect(meteringReasonFor(row({ costAmount: 0.25, costSource: "provider-reported" }))).toBe("");
    // A stated zero is a price that says "free", not a silence: the row needs no reason either.
    expect(meteringReasonFor(row({ costAmount: 0, costSource: "computed", pricing: textPrice }))).toBe("");
  });

  it("names the missing catalog price as the reason a measured-but-blank row is blank", () => {
    // 未定价: the call happened, the usage was measured, and the catalog has nothing for the dimension.
    expect(
      meteringReasonFor(
        row({ completeness: "reported", tokens: { ...emptyTokens, inputTokens: 120 } }),
      ),
    ).toBe("no-price-for-dimension");
  });

  it("keeps a price written for another dimension from passing as this row's price", () => {
    expect(meteringReasonFor(row({ meteredKind: "image", pricing: textPrice, quantityJson: '{"image":1}' }))).toBe(
      "price-kind-mismatch",
    );
  });

  it("names a per-unit price that states no rate", () => {
    const nameless: AiUsagePricingBasis = { ...imagePrice, unitPrice: undefined };
    expect(
      meteringReasonFor(row({ meteredKind: "image", pricing: nameless, quantityJson: '{"image":1}' })),
    ).toBe("price-unit-unspecified");
  });

  it("separates a provider that reported nothing from a request that never succeeded", () => {
    // 未测量, token dimension: the call answered and the provider said nothing about its usage.
    expect(meteringReasonFor(row({ completeness: "unknown" }))).toBe("usage-not-reported");
    // Nothing was measured because nothing came back.
    expect(meteringReasonFor(row({ completeness: "unknown", outcome: "failed" }))).toBe("attempt-failed");
  });

  it("calls an interrupted call what it is - a partial reading", () => {
    expect(meteringReasonFor(row({ completeness: "partial", outcome: "interrupted" }))).toBe("call-interrupted");
    // The partial measurement alone is enough, whatever else the row says.
    expect(meteringReasonFor(row({ completeness: "partial", outcome: "success" }))).toBe("call-interrupted");
  });

  it("names each way a non-token amount can be unusable", () => {
    // The real shape: the live installation's image row records `{"images":1}` while the dimension is
    // priced per `image`, so no price could ever state its amount.
    expect(
      meteringReasonFor(row({ meteredKind: "image", completeness: "unknown", quantityJson: '{"images":1}' })),
    ).toBe("quantity-unit-mismatch");
    expect(meteringReasonFor(row({ meteredKind: "image", completeness: "unknown", quantityJson: "{}" }))).toBe(
      "quantity-not-recorded",
    );
    expect(
      meteringReasonFor(row({ meteredKind: "speech", completeness: "unknown", quantityJson: '{"second":"12.5"}' })),
    ).toBe("quantity-unusable");
    // A speech row that *did* measure its seconds is readable even though no vendor reported any
    // tokens - only the price is missing, so the reason is a missing price and not missing units.
    expect(
      meteringReasonFor(row({ meteredKind: "speech", completeness: "reported", quantityJson: '{"second":12.5}' })),
    ).toBe("no-price-for-dimension");
  });

  it("blames the units only when the units really are the problem", () => {
    // A usable amount on a row stored unmeasured is a row written by the older rule (which asked the
    // token question about an image call). The cause is not the units, so the reading does not name
    // one - the same honest blank as every row that predates this vocabulary.
    expect(
      meteringReasonFor(row({ meteredKind: "image", completeness: "unknown", quantityJson: '{"image":1}' })),
    ).toBe("not-recorded");
  });

  it("keeps a blank whose evidence names no cause at not-recorded", () => {
    // Usage was reported and a matching price is on the row, yet no amount: this reading may not
    // invent a cause for that, and it is also what every row written before this reading gets.
    expect(meteringReasonFor(row({ completeness: "reported", pricing: textPrice, costSource: "unknown" }))).toBe(
      "not-recorded",
    );
  });
});

describe("summarizeLedgerMeteringCoverage", () => {
  it("lists every dimension even when the window holds none of them", () => {
    const coverage = summarizeLedgerMeteringCoverage({ entries: [], pricedKinds: ["text"] });

    expect(coverage.map((entry) => entry.kind)).toEqual([
      "text",
      "image",
      "video",
      "speech",
      "embedding",
      "agent",
    ]);
    // 无法准确计量, stated as such: "no call path" and "not used" cannot be confused with each other.
    expect(coverage.find((entry) => entry.kind === "video")).toMatchObject({
      attempts: 0,
      gap: "no-runtime-path",
      reasons: [],
    });
    // CI-EMB-01 closed the one dimension that had no path: the knowledge index writes `embedding` rows of its
    // own now, so the dimension is *meterable* even over a window that holds none of them (0 attempts means
    // "not used", not "cannot be measured").
    expect(coverage.find((entry) => entry.kind === "embedding")).toMatchObject({ gap: "", attempts: 0 });
    expect(coverage.find((entry) => entry.kind === "agent")).toMatchObject({ gap: "metered-through-text" });
    expect(coverage.find((entry) => entry.kind === "text")).toMatchObject({ priced: true, gap: "" });
  });

  it("counts each dimension's rows in the ledger's own states and collects their reasons", () => {
    const coverage = summarizeLedgerMeteringCoverage({
      pricedKinds: ["text"],
      entries: [
        row({ id: "a", costAmount: 0.5, costSource: "computed", pricing: textPrice }),
        row({ id: "b", costSource: "unpriced", completeness: "reported" }),
        row({ id: "c", costSource: "unpriced", completeness: "reported" }),
        row({ id: "d", costSource: "unknown", completeness: "unknown", outcome: "failed" }),
        row({
          id: "e",
          meteredKind: "image",
          costSource: "unknown",
          completeness: "unknown",
          quantityJson: '{"images":1}',
        }),
      ],
    });

    expect(coverage.find((entry) => entry.kind === "text")).toMatchObject({
      attempts: 4,
      measuredAttempts: 1,
      unpricedAttempts: 2,
      unmeasuredAttempts: 1,
      // Deduped: two unpriced rows with the same cause are one reason, not two.
      reasons: ["attempt-failed", "no-price-for-dimension"],
    });
    expect(coverage.find((entry) => entry.kind === "image")).toMatchObject({
      attempts: 1,
      measuredAttempts: 0,
      unmeasuredAttempts: 1,
      reasons: ["quantity-unit-mismatch"],
      // Declared metered, and the window shows why it could not be read: both facts stay visible.
      gap: "",
      priced: false,
    });
  });

  it("keeps a declaration that no longer holds visible instead of hiding it", () => {
    // A `video` row can only appear if this runtime grew a path for it; the declaration says it has
    // none, so both are reported side by side rather than one silently winning over the other.
    const coverage = summarizeLedgerMeteringCoverage({
      pricedKinds: [],
      entries: [
        row({
          meteredKind: "video" as AiUsageMeteredKind,
          completeness: "reported",
          quantityJson: '{"second":30}',
        }),
      ],
    });
    expect(coverage.find((entry) => entry.kind === "video")).toMatchObject({
      attempts: 1,
      gap: "no-runtime-path",
      reasons: ["no-price-for-dimension"],
    });
  });
});
