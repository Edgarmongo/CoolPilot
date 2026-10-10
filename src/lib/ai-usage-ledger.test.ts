import { describe, expect, it } from "vitest";
import type {
  AiCostCenterCallFilters,
  AiModelPrice,
  AiUsageLedgerEntry,
  AiUsageMeteredKind,
  AiUsagePricingBasis,
  AiUsageTokens,
} from "@/lib/types";
import {
  aiUsageCostSourceIsReal,
  aiUsageLedgerCostCaveat,
  classifyCallRetry,
  computeUsageCost,
  emptyAiUsageTokens,
  indexLedgerCalls,
  markInForceModelPrices,
  normalizeUsageTokens,
  parseLedgerQuantity,
  pricingBasisFromRow,
  selectLedgerAttempts,
  sortLedgerAttemptsForCallList,
  summarizeAiUsageLedger,
  summarizeLedgerByContent,
  summarizeLedgerCallGroup,
  usageCompleteness,
} from "./ai-usage-ledger";

const pricing: AiUsagePricingBasis = {
  meteredKind: "text",
  currency: "CNY",
  inputPerMillion: 1,
  outputPerMillion: 2,
  priceVersion: "2026-10-01",
  source: "manual",
};

/** A token-metered call, which is every call that does not say otherwise. */
const textMetering = { kind: "text" as const };

/** A per-image price: the shape a row has when its dimension is not billed in tokens. */
const imagePricing: AiUsagePricingBasis = {
  meteredKind: "image",
  currency: "USD",
  inputPerMillion: 0,
  outputPerMillion: 0,
  unitPrice: 0.04,
  unitLabel: "image",
  priceVersion: "2026-10",
  source: "manual",
};

function tokens(partial: Partial<AiUsageTokens>): AiUsageTokens {
  return { ...emptyAiUsageTokens(), ...partial };
}

function entry(partial: Partial<AiUsageLedgerEntry>): AiUsageLedgerEntry {
  return {
    id: partial.id ?? "u1",
    purpose: partial.purpose ?? "article",
    outcome: partial.outcome ?? "success",
    providerId: partial.providerId ?? "qwen",
    modelId: partial.modelId ?? "qwen-plus",
    endpointId: partial.endpointId ?? "ep1",
    credentialLabel: partial.credentialLabel ?? "****1234",
    budgetReservationId: partial.budgetReservationId ?? "",
    attemptIndex: partial.attemptIndex ?? 0,
    taskId: partial.taskId ?? "",
    runId: partial.runId ?? "",
    nodeId: partial.nodeId ?? "",
    parentUsageId: partial.parentUsageId ?? "",
    outputAssetId: partial.outputAssetId ?? "",
    contentItemId: partial.contentItemId ?? "",
    meteredKind: partial.meteredKind ?? "text",
    tokens: partial.tokens ?? tokens({}),
    completeness: partial.completeness ?? "reported",
    quantityJson: partial.quantityJson ?? "{}",
    costAmount: partial.costAmount === undefined ? null : partial.costAmount,
    costCurrency: partial.costCurrency ?? "",
    costSource: partial.costSource ?? "computed",
    pricing: partial.pricing === undefined ? null : partial.pricing,
    durationMs: partial.durationMs ?? 0,
    errorSummary: partial.errorSummary ?? "",
    createdAt: partial.createdAt ?? 1_000,
  };
}

describe("normalizeUsageTokens", () => {
  it("treats absent usage as zeros without inventing a total", () => {
    expect(normalizeUsageTokens(undefined)).toEqual(emptyAiUsageTokens());
  });

  it("keeps the provider's own total instead of overriding it with our sum", () => {
    expect(normalizeUsageTokens({ inputTokens: 10, outputTokens: 5, totalTokens: 99 }).totalTokens).toBe(99);
  });

  it("derives the total only when the provider omitted it", () => {
    const result = normalizeUsageTokens({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 40 });
    expect(result.totalTokens).toBe(15);
    expect(result.cachedInputTokens).toBe(40);
  });

  it("clamps negative and fractional readings to non-negative integers", () => {
    expect(normalizeUsageTokens({ inputTokens: -3, outputTokens: 2.6 })).toMatchObject({
      inputTokens: 0,
      outputTokens: 3,
    });
  });
});

describe("usageCompleteness", () => {
  it("reports unknown - not zero - when a successful call came back without usage", () => {
    expect(usageCompleteness("success", undefined)).toBe("unknown");
  });

  it("reports reported when the provider answered with a usage object, even an empty one", () => {
    expect(usageCompleteness("success", {})).toBe("reported");
  });

  it("marks a failure as unmeasured and an interruption as partial", () => {
    expect(usageCompleteness("failed", undefined)).toBe("unknown");
    expect(usageCompleteness("interrupted", { inputTokens: 4 })).toBe("partial");
  });
});

describe("computeUsageCost", () => {
  it("states nothing when the row was never measured", () => {
    expect(computeUsageCost(tokens({ inputTokens: 100 }), "unknown", pricing, textMetering)).toEqual({
      costAmount: null,
      costCurrency: "",
      costSource: "unknown",
    });
  });

  it("says unpriced - not free, not zero - when usage is known but no price is on file", () => {
    expect(computeUsageCost(tokens({ inputTokens: 100 }), "reported", null, textMetering)).toEqual({
      costAmount: null,
      costCurrency: "",
      costSource: "unpriced",
    });
  });

  it("applies both rates per million tokens", () => {
    const result = computeUsageCost(
      tokens({ inputTokens: 1000, outputTokens: 500 }),
      "reported",
      pricing,
      textMetering,
    );
    expect(result.costSource).toBe("computed");
    expect(result.costCurrency).toBe("CNY");
    expect(result.costAmount).toBe(0.002);
  });

  it("bills cached input at the cached rate and the rest at the normal rate", () => {
    const withCached = { ...pricing, cachedInputPerMillion: 0.5 };
    const result = computeUsageCost(
      tokens({ inputTokens: 1000, cachedInputTokens: 400 }),
      "reported",
      withCached,
      textMetering,
    );
    expect(result.costAmount).toBe(0.0008);
  });

  it("bills every input token at the normal rate when the snapshot names no cached rate", () => {
    const result = computeUsageCost(
      tokens({ inputTokens: 1000, cachedInputTokens: 400 }),
      "reported",
      pricing,
      textMetering,
    );
    expect(result.costAmount).toBe(0.001);
  });

  it("never lets a cached count exceed the input it is part of", () => {
    const withCached = { ...pricing, cachedInputPerMillion: 0.5 };
    const result = computeUsageCost(
      tokens({ inputTokens: 100, cachedInputTokens: 900 }),
      "reported",
      withCached,
      textMetering,
    );
    expect(result.costAmount).toBe(0.00005);
  });

  it("returns a real zero for a measured call that used nothing, distinguishable by its source", () => {
    const result = computeUsageCost(tokens({}), "reported", pricing, textMetering);
    expect(result.costAmount).toBe(0);
    expect(result.costSource).toBe("computed");
  });
});

/**
 * CI-P7-01-05: a price only costs the dimension it was written for.
 *
 * The scenario these cases exist for is not hypothetical - an image endpoint that reports token
 * usage would, under a text rate, produce a `computed` figure that looks exact and is wrong. A
 * blank says "we cannot state this"; a wrong number claims to know.
 */
describe("computeUsageCost across billing dimensions", () => {
  it("never costs an image with a text price, whatever usage the provider reported", () => {
    const result = computeUsageCost(
      tokens({ inputTokens: 1_000_000 }),
      "reported",
      pricing,
      { kind: "image", quantity: { image: 1 } },
    );
    expect(result).toEqual({ costAmount: null, costCurrency: "", costSource: "unpriced" });
  });

  it("costs an image with its own per-unit price and the units the call used", () => {
    const result = computeUsageCost(tokens({}), "reported", imagePricing, {
      kind: "image",
      quantity: { image: 3 },
    });
    expect(result.costAmount).toBe(0.12);
    expect(result.costCurrency).toBe("USD");
    expect(result.costSource).toBe("computed");
  });

  it("says unknown - not 0 - when the price is known but the units it multiplies are not", () => {
    expect(computeUsageCost(tokens({}), "reported", imagePricing, { kind: "image", quantity: {} })).toEqual({
      costAmount: null,
      costCurrency: "",
      costSource: "unknown",
    });
    expect(computeUsageCost(tokens({}), "reported", imagePricing, { kind: "image" }).costSource).toBe("unknown");
  });

  it("refuses a per-unit price whose quantity was metered in another unit", () => {
    const result = computeUsageCost(tokens({}), "reported", imagePricing, {
      kind: "image",
      quantity: { second: 2 },
    });
    expect(result.costAmount).toBeNull();
    expect(result.costSource).toBe("unknown");
  });

  it("prices speech per character and video per second, each with its own unit", () => {
    const speech: AiUsagePricingBasis = {
      ...imagePricing,
      meteredKind: "speech",
      unitPrice: 0.001,
      unitLabel: "character",
    };
    expect(
      computeUsageCost(tokens({}), "reported", speech, { kind: "speech", quantity: { character: 1500 } })
        .costAmount,
    ).toBe(1.5);

    const video: AiUsagePricingBasis = { ...imagePricing, meteredKind: "video", unitPrice: 0.02, unitLabel: "second" };
    expect(
      computeUsageCost(tokens({}), "reported", video, { kind: "video", quantity: { second: 30 } }).costAmount,
    ).toBe(0.6);
  });

  it("still prices an embedding call by its input tokens", () => {
    const embedding: AiUsagePricingBasis = { ...pricing, meteredKind: "embedding", outputPerMillion: 0 };
    const result = computeUsageCost(tokens({ inputTokens: 2_000_000 }), "reported", embedding, {
      kind: "embedding",
    });
    expect(result.costAmount).toBe(2);
    expect(result.costSource).toBe("computed");
  });

  it("treats a per-unit price that states no rate as unpriced rather than as free", () => {
    const nameless: AiUsagePricingBasis = { ...imagePricing, unitPrice: undefined };
    expect(computeUsageCost(tokens({}), "reported", nameless, { kind: "image", quantity: { image: 1 } })).toEqual({
      costAmount: null,
      costCurrency: "",
      costSource: "unpriced",
    });
  });
});

describe("pricingBasisFromRow", () => {
  it("omits the cached rate when the catalog row has none", () => {
    const basis = pricingBasisFromRow({
      id: "p1",
      providerId: "qwen",
      modelId: "*",
      meteredKind: "text",
      currency: "CNY",
      inputPerMillion: 1,
      outputPerMillion: 2,
      unitLabel: "",
      declaredFree: false,
      priceVersion: "v1",
      source: "manual",
      effectiveFrom: 0,
      notes: "",
      createdAt: 0,
    });
    expect(basis).toEqual({
      meteredKind: "text",
      currency: "CNY",
      inputPerMillion: 1,
      outputPerMillion: 2,
      priceVersion: "v1",
      source: "manual",
    });
    expect("cachedInputPerMillion" in basis).toBe(false);
    expect("unitPrice" in basis).toBe(false);
    expect("unitLabel" in basis).toBe(false);
  });

  it("freezes the dimension and the unit onto a per-unit row", () => {
    const basis = pricingBasisFromRow({
      id: "p2",
      providerId: "openai",
      modelId: "gpt-image-1",
      meteredKind: "image",
      currency: "USD",
      inputPerMillion: 0,
      outputPerMillion: 0,
      unitPrice: 0.04,
      unitLabel: "image",
      declaredFree: false,
      priceVersion: "2026-10",
      source: "provider-doc",
      effectiveFrom: 0,
      notes: "",
      createdAt: 0,
    });
    // A snapshot that could not say which dimension it priced would make "why was this an image
    // price" unanswerable from a ledger row alone.
    expect(basis).toMatchObject({ meteredKind: "image", unitPrice: 0.04, unitLabel: "image" });
  });
});

/**
 * CI-P7-01-05: "which price is in force" is answered on the server.
 *
 * The page renders this mark, so the rule has to live where it can be asserted: the recorder is the
 * side that picks a price for the next call, and it asks with its own clock.
 */
describe("markInForceModelPrices", () => {
  const row = (id: string, effectiveFrom: number, meteredKind: AiUsageMeteredKind = "text"): AiModelPrice => ({
    id,
    providerId: "p",
    modelId: "m",
    meteredKind,
    currency: "CNY",
    inputPerMillion: 1,
    outputPerMillion: 1,
    unitLabel: "",
    declaredFree: false,
    priceVersion: id,
    source: "manual",
    effectiveFrom,
    notes: "",
    createdAt: 0,
  });

  it("marks the newest row already in force and leaves its predecessors unmarked", () => {
    const marked = markInForceModelPrices([row("old", 100), row("new", 200)], 250);
    expect(marked.map((price) => [price.id, price.inForce])).toEqual([
      ["old", false],
      ["new", true],
    ]);
  });

  it("marks a scheduled price as not yet in force instead of hiding it", () => {
    const marked = markInForceModelPrices([row("now", 100), row("later", 500)], 250);
    expect(marked.find((price) => price.id === "later")?.inForce).toBe(false);
    expect(marked.find((price) => price.id === "now")?.inForce).toBe(true);
  });

  it("decides per dimension, not per model", () => {
    const marked = markInForceModelPrices([row("text-price", 100), row("image-price", 100, "image")], 250);
    expect(marked.every((price) => price.inForce)).toBe(true);
  });

  it("marks nothing when every row still takes effect later", () => {
    expect(markInForceModelPrices([row("later", 900)], 250).every((price) => !price.inForce)).toBe(true);
  });
});

describe("aiUsageCostSourceIsReal", () => {
  it("counts only computed and provider-reported figures as money", () => {
    expect(aiUsageCostSourceIsReal("computed")).toBe(true);
    expect(aiUsageCostSourceIsReal("provider-reported")).toBe(true);
    expect(aiUsageCostSourceIsReal("unpriced")).toBe(false);
    expect(aiUsageCostSourceIsReal("unknown")).toBe(false);
  });
});

describe("summarizeAiUsageLedger", () => {
  const window = { from: 1_000, to: 2_000 };

  it("counts outcomes and retries without hiding them inside the success count", () => {
    const summary = summarizeAiUsageLedger(
      [
        entry({ id: "a", attemptIndex: 1, createdAt: 1_100 }),
        entry({ id: "b", attemptIndex: 0, createdAt: 1_200 }),
        entry({ id: "c", outcome: "failed", costSource: "unknown", createdAt: 1_300 }),
        entry({ id: "d", outcome: "interrupted", costSource: "unknown", createdAt: 1_400 }),
      ],
      window,
    );
    expect(summary.totals).toMatchObject({
      attempts: 4,
      successes: 2,
      failures: 1,
      interrupted: 1,
      retries: 1,
    });
  });

  it("excludes rows outside the window and keeps both boundary rows", () => {
    const summary = summarizeAiUsageLedger(
      [
        entry({ id: "a", createdAt: 999 }),
        entry({ id: "b", createdAt: 1_000 }),
        entry({ id: "c", createdAt: 2_000 }),
        entry({ id: "d", createdAt: 2_001 }),
      ],
      window,
    );
    expect(summary.totals.attempts).toBe(2);
  });

  it("sums only stated costs and refuses to call a partial figure complete", () => {
    const summary = summarizeAiUsageLedger(
      [
        entry({ id: "a", costAmount: 0.5, costSource: "computed", createdAt: 1_100 }),
        entry({ id: "b", costAmount: 0.25, costSource: "provider-reported", createdAt: 1_200 }),
        entry({ id: "c", costAmount: null, costSource: "unpriced", createdAt: 1_300 }),
        entry({ id: "d", costAmount: null, costSource: "unknown", outcome: "failed", createdAt: 1_400 }),
      ],
      window,
    );
    expect(summary.totals.costAmount).toBe(0.75);
    expect(summary.totals.unpricedAttempts).toBe(1);
    expect(summary.totals.unmeasuredAttempts).toBe(1);
    expect(summary.totals.costIsComplete).toBe(false);
  });

  it("calls the figure complete only when every attempt could be stated", () => {
    const summary = summarizeAiUsageLedger(
      [entry({ id: "a", costAmount: 0, costSource: "computed", createdAt: 1_100 })],
      window,
    );
    expect(summary.totals.costAmount).toBe(0);
    expect(summary.totals.costIsComplete).toBe(true);
  });

  it("reports an empty window as incomplete rather than as a zero bill", () => {
    const summary = summarizeAiUsageLedger([], window);
    expect(summary.totals.attempts).toBe(0);
    expect(summary.totals.costIsComplete).toBe(false);
    expect(summary.byPurpose).toEqual([]);
  });

  it("groups by purpose and by model, and flags the groups that cannot state a cost", () => {
    const summary = summarizeAiUsageLedger(
      [
        entry({ id: "a", purpose: "article", modelId: "m1", costAmount: 0.4, tokens: tokens({ totalTokens: 100 }), createdAt: 1_100 }),
        entry({ id: "b", purpose: "article", modelId: "m1", costAmount: 0.4, tokens: tokens({ totalTokens: 100 }), createdAt: 1_200 }),
        entry({ id: "c", purpose: "extraction", modelId: "m2", costAmount: null, costSource: "unpriced", tokens: tokens({ totalTokens: 10 }), createdAt: 1_300 }),
      ],
      window,
    );
    expect(summary.byPurpose.map((group) => group.key)).toEqual(["article", "extraction"]);
    expect(summary.byPurpose[0]).toMatchObject({ attempts: 2, totalTokens: 200, costAmount: 0.8, hasUnpricedAttempts: false });
    expect(summary.byPurpose[1]).toMatchObject({ attempts: 1, costAmount: 0, hasUnpricedAttempts: true });
    expect(summary.byModel.map((group) => group.key)).toEqual(["qwen::m1", "qwen::m2"]);
  });

  it("states which attempts a headline figure leaves out", () => {
    const partial = summarizeAiUsageLedger(
      [entry({ id: "a", costAmount: null, costSource: "unpriced", createdAt: 1_100 })],
      window,
    );
    expect(aiUsageLedgerCostCaveat(partial.totals)).toEqual({ unpricedAttempts: 1, unmeasuredAttempts: 0 });
    expect(aiUsageLedgerCostCaveat(summarizeAiUsageLedger([], window).totals)).toBeNull();
    expect(
      aiUsageLedgerCostCaveat(summarizeAiUsageLedger([entry({ id: "a", costAmount: 1, createdAt: 1_100 })], window).totals),
    ).toBeNull();
  });
});

/**
 * CI-P7-02: the three readings the 成本总览 needs on top of the totals - where the money came from,
 * in which currency, and on which day. Timestamps are built on the local calendar on purpose:
 * `dayStartOf` is a local-midnight rule, so fixed epoch constants would only be deterministic in
 * whichever timezone the author happened to run them in.
 */
describe("summarizeAiUsageLedger's cost-center readings", () => {
  const window = { from: new Date(2026, 2, 1).getTime(), to: new Date(2026, 2, 4).getTime() };
  const at = (dayOffset: number, hour = 9) => new Date(2026, 2, 1 + dayOffset, hour, 0, 0).getTime();
  const midnight = (dayOffset: number) => new Date(2026, 2, 1 + dayOffset).getTime();

  it("counts every cost source, and keeps a source's amount null when it stated nothing", () => {
    const summary = summarizeAiUsageLedger(
      [
        entry({ id: "a", costAmount: 0.5, costSource: "computed", costCurrency: "CNY", createdAt: at(0) }),
        entry({ id: "b", costAmount: 0.25, costSource: "provider-reported", costCurrency: "CNY", createdAt: at(0, 10) }),
        entry({ id: "c", costAmount: null, costSource: "unpriced", createdAt: at(0, 11) }),
        entry({ id: "d", costAmount: null, costSource: "unknown", outcome: "failed", createdAt: at(0, 12) }),
      ],
      window,
    );

    // All four states, in the vocabulary's own order, zeros included - so a page can say "none of
    // this window's money was the vendor's own charge" instead of staying silent about it.
    expect(summary.byCostSource.map((count) => [count.source, count.attempts, count.costAmount])).toEqual([
      ["provider-reported", 1, 0.25],
      ["computed", 1, 0.5],
      ["unpriced", 1, null],
      ["unknown", 1, null],
    ]);
  });

  it("keeps two currencies apart instead of inventing a rate", () => {
    const summary = summarizeAiUsageLedger(
      [
        entry({ id: "a", costAmount: 0.5, costCurrency: "CNY", createdAt: at(0) }),
        entry({ id: "b", costAmount: 0.25, costCurrency: "CNY", createdAt: at(0, 10) }),
        entry({ id: "c", costAmount: 0.25, costCurrency: "USD", createdAt: at(0, 11) }),
        entry({ id: "d", costAmount: null, costSource: "unpriced", costCurrency: "CNY", createdAt: at(0, 12) }),
      ],
      window,
    );

    // A CNY row and a USD row are never added into one figure: there is no rate here to add them
    // with, and the unpriced row adds nothing to either.
    expect(summary.costByCurrency).toEqual([
      { currency: "CNY", amount: 0.75, attempts: 2 },
      { currency: "USD", amount: 0.25, attempts: 1 },
    ]);
  });

  it("buckets the window by local day, oldest first, with unstated calls kept visible", () => {
    const summary = summarizeAiUsageLedger(
      [
        entry({ id: "a", costAmount: 0.5, tokens: tokens({ totalTokens: 100 }), createdAt: at(1, 23) }),
        entry({ id: "b", costAmount: 0.25, tokens: tokens({ totalTokens: 50 }), createdAt: at(1, 8) }),
        entry({ id: "c", costAmount: null, costSource: "unpriced", tokens: tokens({ totalTokens: 10 }), createdAt: at(2) }),
      ],
      window,
    );

    expect(summary.byDay).toEqual([
      { dayStart: midnight(1), attempts: 2, totalTokens: 150, costAmount: 0.75, unpricedAttempts: 0 },
      // A day whose only call could not be costed says so, rather than reading as a free day.
      { dayStart: midnight(2), attempts: 1, totalTokens: 10, costAmount: 0, unpricedAttempts: 1 },
    ]);
  });

  it("leaves rows outside the window out of every reading", () => {
    const summary = summarizeAiUsageLedger(
      [
        entry({ id: "before", costAmount: 9, costCurrency: "USD", createdAt: window.from - 1 }),
        entry({ id: "after", costAmount: 9, costCurrency: "USD", createdAt: window.to + 1 }),
        entry({ id: "inside", costAmount: 0.5, costCurrency: "CNY", createdAt: at(0, 12) }),
      ],
      window,
    );

    expect(summary.byCostSource.find((count) => count.source === "computed")).toEqual({
      source: "computed",
      attempts: 1,
      costAmount: 0.5,
    });
    expect(summary.costByCurrency).toEqual([{ currency: "CNY", amount: 0.5, attempts: 1 }]);
    expect(summary.byDay).toEqual([
      { dayStart: midnight(0), attempts: 1, totalTokens: 0, costAmount: 0.5, unpricedAttempts: 0 },
    ]);
  });
});

/**
 * CI-P7-02-04 / CI-P7-02-05: the readers behind 调用明细 / 追溯.
 *
 * What these cases pin is entirely about evidence: which row a retry's type was read from, that a
 * call's money includes its retries, that a content item nobody named is still counted, and that an
 * index above 0 is never on its own a story about why a request was sent twice.
 */
describe("call detail readers", () => {
  const filters = (partial: Partial<AiCostCenterCallFilters> = {}): AiCostCenterCallFilters => ({
    purpose: "",
    outcome: "",
    costSource: "",
    model: "",
    retryOnly: false,
    contentItemId: "",
    taskId: "",
    ...partial,
  });

  it("parses the recorded quantity and answers malformed JSON with an empty object", () => {
    expect(parseLedgerQuantity('{"image":2}')).toEqual({ image: 2 });
    expect(parseLedgerQuantity("not json at all")).toEqual({});
    expect(parseLedgerQuantity("")).toEqual({});
    // A JSON array or number is not a quantity object, so it is not treated as one.
    expect(parseLedgerQuantity("[1,2]")).toEqual({});
    expect(parseLedgerQuantity("3")).toEqual({});
  });

  it("groups the requests of one call by following the predecessor chain", () => {
    const first = entry({ id: "a", attemptIndex: 0, createdAt: 1_000 });
    const second = entry({ id: "b", attemptIndex: 1, parentUsageId: "a", outcome: "failed", createdAt: 1_000 });
    const third = entry({ id: "c", attemptIndex: 2, parentUsageId: "b", createdAt: 1_000 });

    const { rootOf, byRoot } = indexLedgerCalls([third, first, second, entry({ id: "z", createdAt: 2_000 })]);

    expect(rootOf.get("c")).toBe("a");
    expect(byRoot.get("a")?.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(byRoot.get("z")?.map((row) => row.id)).toEqual(["z"]);
  });

  it("starts a new group at a predecessor outside the scan, and does not hang on a cycle", () => {
    const orphan = entry({ id: "orphan", attemptIndex: 1, parentUsageId: "gone" });
    expect(indexLedgerCalls([orphan]).byRoot.get("orphan")?.map((row) => row.id)).toEqual(["orphan"]);

    const left = entry({ id: "left", parentUsageId: "right" });
    const right = entry({ id: "right", parentUsageId: "left" });
    const cyclic = indexLedgerCalls([left, right]);
    // A corrupted chain cannot be resolved into one call, so the two rows stay separate: the page
    // then says the link is unreadable instead of drawing a loop.
    expect(Array.from(cyclic.byRoot.keys()).sort()).toEqual(["left", "right"]);
  });

  it("reads the retry kind off the predecessor row, never off the attempt index", () => {
    const success = entry({ id: "p1", outcome: "success" });
    const failure = entry({ id: "p2", outcome: "failed" });

    expect(classifyCallRetry(entry({ id: "f" }), null).kind).toBe("first-request");
    // The predecessor succeeded and the call asked again: that is the one retry type that can be stated.
    expect(classifyCallRetry(entry({ id: "c1", attemptIndex: 1, parentUsageId: "p1" }), success).kind).toBe(
      "self-correction",
    );
    expect(classifyCallRetry(entry({ id: "c2", attemptIndex: 1, parentUsageId: "p2" }), failure).kind).toBe(
      "after-failed-request",
    );
    // Recorded but unreadable: "self-correction" or "after a failure" would be a claim about a row
    // nobody read.
    expect(classifyCallRetry(entry({ id: "c3", attemptIndex: 1, parentUsageId: "gone" }), null)).toMatchObject({
      kind: "unresolved-predecessor",
      parentOutsideScan: true,
    });
    // Index above 0 with no recorded predecessor is the same honest blank, not a retry type.
    expect(classifyCallRetry(entry({ id: "c4", attemptIndex: 3 }), null)).toMatchObject({
      kind: "unresolved-predecessor",
      parentOutsideScan: false,
    });
  });

  it("reports which identity fields changed, as facts rather than as a reason", () => {
    const parent = entry({ id: "p", modelId: "m1", endpointId: "e1", credentialLabel: "****0001" });
    const retry = entry({
      id: "c",
      attemptIndex: 1,
      parentUsageId: "p",
      modelId: "m2",
      credentialLabel: "****0002",
    });

    const classified = classifyCallRetry(retry, parent);
    // `endpointId` differs too (the fixture's default), and that fact is reported as well.
    expect(classified.changed).toEqual(["model", "endpoint", "credential"]);
    expect(classified.parent).toMatchObject({ id: "p", outcome: "success", modelId: "m1" });
  });

  it("adds a call's retries into its total instead of counting only the winner", () => {
    const summary = summarizeLedgerCallGroup([
      entry({ id: "a", outcome: "failed", costAmount: 0.5, costCurrency: "CNY" }),
      entry({ id: "b", costAmount: null, costSource: "unpriced", costCurrency: "" }),
      entry({ id: "c", costAmount: 0.25, costCurrency: "CNY" }),
    ]);

    expect(summary).toMatchObject({
      attempts: 3,
      failedRequests: 1,
      unpricedAttempts: 1,
      unmeasuredAttempts: 0,
      // One request could not state a figure, so the call's total is not a total.
      costIsComplete: false,
    });
    // The retried requests' money is inside the figure - only the rows that named one.
    expect(summary.costByCurrency).toEqual([{ currency: "CNY", amount: 0.75, attempts: 2 }]);
  });

  it("keeps unattributed requests counted and never merges two currencies inside a content group", () => {
    const groups = summarizeLedgerByContent([
      entry({
        id: "a",
        contentItemId: "c1",
        costAmount: 0.5,
        costCurrency: "CNY",
        tokens: tokens({ totalTokens: 100 }),
        taskId: "t1",
        nodeId: "n1",
      }),
      entry({ id: "b", contentItemId: "c1", costAmount: 0.25, costCurrency: "USD", runId: "r1" }),
      entry({ id: "c", contentItemId: "", costAmount: null, costSource: "unpriced" }),
    ]);

    // Most traffic first; the rows that named nothing keep a group of their own.
    expect(groups.map((group) => group.contentItemId)).toEqual(["c1", ""]);
    expect(groups[0]).toMatchObject({
      attempts: 2,
      totalTokens: 100,
      unpricedAttempts: 0,
      costIsComplete: true,
      taskIds: ["r1", "t1"],
      nodeIds: ["n1"],
    });
    expect(groups[0].costByCurrency).toEqual([
      { currency: "CNY", amount: 0.5, attempts: 1 },
      { currency: "USD", amount: 0.25, attempts: 1 },
    ]);
    expect(groups[1]).toMatchObject({ attempts: 1, unpricedAttempts: 1, costIsComplete: false });
  });

  it("filters the requests the 调用明细 view lists", () => {
    const rows = [
      entry({ id: "a", purpose: "article", modelId: "m1", contentItemId: "c1", costAmount: 0.5 }),
      entry({ id: "b", purpose: "extraction", modelId: "m2", taskId: "t1", attemptIndex: 1, parentUsageId: "a" }),
      entry({ id: "c", purpose: "article", modelId: "m1", outcome: "failed", costSource: "unknown", runId: "r9" }),
    ];

    expect(selectLedgerAttempts(rows, filters({ purpose: "article" })).map((row) => row.id)).toEqual(["a", "c"]);
    expect(selectLedgerAttempts(rows, filters({ outcome: "failed" })).map((row) => row.id)).toEqual(["c"]);
    expect(selectLedgerAttempts(rows, filters({ costSource: "unknown" })).map((row) => row.id)).toEqual(["c"]);
    expect(selectLedgerAttempts(rows, filters({ model: "qwen::m2" })).map((row) => row.id)).toEqual(["b"]);
    expect(selectLedgerAttempts(rows, filters({ contentItemId: "c1" })).map((row) => row.id)).toEqual(["a"]);
    // "This task's calls" means both recorded fields: the task id and the automation run it came from.
    expect(selectLedgerAttempts(rows, filters({ taskId: "t1" })).map((row) => row.id)).toEqual(["b"]);
    expect(selectLedgerAttempts(rows, filters({ taskId: "r9" })).map((row) => row.id)).toEqual(["c"]);
    expect(selectLedgerAttempts(rows, filters({ retryOnly: true })).map((row) => row.id)).toEqual(["b"]);
  });

  it("lists the newest call first with its requests in the order they were sent", () => {
    const ordered = sortLedgerAttemptsForCallList([
      entry({ id: "b", createdAt: 2_000, attemptIndex: 1, parentUsageId: "a" }),
      entry({ id: "a", createdAt: 2_000, attemptIndex: 0 }),
      entry({ id: "z", createdAt: 3_000 }),
    ]);

    expect(ordered.map((row) => row.id)).toEqual(["z", "a", "b"]);
  });
});

