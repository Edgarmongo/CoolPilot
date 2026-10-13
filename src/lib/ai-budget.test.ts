import { describe, expect, it } from "vitest";
import { emptyAiUsageTokens } from "@/lib/ai-usage-ledger";
import type { AiUsageLedgerEntry, AiUsagePricingBasis } from "@/lib/types";
import {
  aiBudgetRemaining,
  aiBudgetReservationAmount,
  budgetPeriodOf,
  defaultAiBudgetSettings,
  estimateAiCallCost,
  estimateTokensFromText,
  evaluateAiBudget,
  roundAmount,
  summarizeBudgetSpend,
  textTokenEstimateMethod,
  type AiBudgetSettings,
  type AiBudgetSpend,
  type AiCostEstimate,
} from "./ai-budget";

/**
 * CI-P7-03: the budget arithmetic, and the two things it must never do - state a figure it does not
 * have, and compare two figures that are not comparable.
 *
 * No database, no runtime, no clock: everything here is the pure layer (`./ai-budget`), which is the
 * half of the card that can be pinned without IO. What the *gate* does with these answers - holds,
 * refusals, settings - is `./ai-budget-guard.test.ts`, and the pages are the route tests.
 */

/** A token price: 1 CNY per million in, 2 per million out. The numbers are chosen to be readable. */
const textPricing: AiUsagePricingBasis = {
  meteredKind: "text",
  currency: "CNY",
  inputPerMillion: 1,
  outputPerMillion: 2,
  priceVersion: "2026-10-01",
  source: "manual",
};

/** A per-image price, the shape a row has when its dimension is not billed in tokens. */
const imagePricing: AiUsagePricingBasis = {
  meteredKind: "image",
  currency: "CNY",
  inputPerMillion: 0,
  outputPerMillion: 0,
  unitPrice: 0.04,
  unitLabel: "image",
  priceVersion: "2026-10",
  source: "manual",
};

function settings(partial: Partial<AiBudgetSettings> = {}): AiBudgetSettings {
  return { ...defaultAiBudgetSettings, ...partial };
}

function spend(partial: Partial<AiBudgetSpend> = {}): AiBudgetSpend {
  return {
    currency: "CNY",
    amount: 0,
    attempts: 0,
    statedAttempts: 0,
    unpricedAttempts: 0,
    unmeasuredAttempts: 0,
    otherCurrencyAttempts: 0,
    otherCurrencies: [],
    isComplete: true,
    truncated: false,
    from: 0,
    to: 1,
    ...partial,
  };
}

function estimate(amountMin: number, amountMax: number | null, currency = "CNY"): AiCostEstimate {
  return {
    kind: "estimate",
    method: textTokenEstimateMethod,
    meteredKind: "text",
    currency,
    amountMin,
    amountMax,
    inputTokensMin: 1,
    outputTokensMax: amountMax === null ? null : 10,
    basis: { ...textPricing, currency },
    notes: [],
  };
}

function unstated(kind: "unpriced" | "unknown" = "unpriced"): AiCostEstimate {
  return { kind, method: textTokenEstimateMethod, meteredKind: "text", notes: [] };
}

/** One ledger row, as `summarizeBudgetSpend` reads it. Mirrors `ai-usage-ledger.test.ts`'s helper. */
function row(partial: Partial<AiUsageLedgerEntry>): AiUsageLedgerEntry {
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
    extensionId: partial.extensionId ?? "",
    meteredKind: partial.meteredKind ?? "text",
    tokens: partial.tokens ?? emptyAiUsageTokens(),
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

describe("budgetPeriodOf", () => {
  it("is the natural month containing the instant, in the machine's own calendar", () => {
    const at = new Date(2026, 9, 10, 12, 0, 0).getTime();
    const period = budgetPeriodOf(at);
    expect(period.key).toBe("2026-10");
    expect(period.start).toBe(new Date(2026, 9, 1).getTime());
    expect(period.end).toBe(new Date(2026, 10, 1).getTime());
    // Half-open `[start, end)`: the last instant of the month is inside it…
    expect(at).toBeGreaterThanOrEqual(period.start);
    expect(at).toBeLessThan(period.end);
  });

  it("gives the next month the first instant of the next month, not one millisecond of this one", () => {
    const december = budgetPeriodOf(new Date(2026, 11, 31, 23, 59, 59).getTime());
    expect(december.key).toBe("2026-12");
    expect(december.end).toBe(new Date(2027, 0, 1).getTime());
    // The boundary belongs to the month that starts there, which is what keeps a budget from
    // charging a January call to December.
    expect(budgetPeriodOf(december.end).key).toBe("2027-01");
  });

  it("is not the usage page's rolling window: the 1st starts a budget period, not the 30-day window", () => {
    const firstOfMonth = budgetPeriodOf(new Date(2026, 9, 1, 0, 0, 1).getTime());
    expect(firstOfMonth.key).toBe("2026-10");
    expect(firstOfMonth.start).toBe(new Date(2026, 9, 1).getTime());
  });
});

describe("estimateTokensFromText", () => {
  it("counts wide-script characters as one token each", () => {
    expect(estimateTokensFromText("夜市")).toBe(2);
    expect(estimateTokensFromText("ヒント")).toBe(3);
  });

  it("counts everything else as a quarter, rounded up", () => {
    expect(estimateTokensFromText("abcd")).toBe(1);
    expect(estimateTokensFromText("abcde")).toBe(2);
    expect(estimateTokensFromText("")).toBe(0);
  });

  it("adds the two scripts together rather than treating the text as one of them", () => {
    expect(estimateTokensFromText("你好 ab")).toBe(3);
  });
});

describe("estimateAiCallCost", () => {
  it("refuses to price a model the catalog has nothing to say about", () => {
    const result = estimateAiCallCost({ pricing: null, meteredKind: "text", inputTokens: 1_000 });
    expect(result.kind).toBe("unpriced");
    expect(result.notes).toEqual(["price-not-on-file"]);
    // No amount at all. A 0 here would read as "this call is free", which is the one claim an absent
    // price cannot support.
    expect("amountMin" in result).toBe(false);
    expect("currency" in result).toBe(false);
  });

  it("refuses to apply a price quoted for another dimension", () => {
    const result = estimateAiCallCost({ pricing: imagePricing, meteredKind: "text", inputTokens: 1_000 });
    expect(result).toEqual({
      kind: "unknown",
      method: textTokenEstimateMethod,
      meteredKind: "text",
      notes: ["dimension-mismatch"],
    });
  });

  it("prices a token-metered call as a range over the resolved price", () => {
    const result = estimateAiCallCost({
      pricing: textPricing,
      meteredKind: "text",
      inputTokens: 1_000_000,
      maxOutputTokens: null,
    });
    expect(result).toMatchObject({
      kind: "estimate",
      currency: "CNY",
      amountMin: 1,
      // Nobody stated a ceiling, so the upper bound is unknown - not quietly set to the lower one.
      amountMax: null,
      inputTokensMin: 1_000_000,
      outputTokensMax: null,
      method: textTokenEstimateMethod,
      basis: textPricing,
      notes: ["output-ceiling-unknown"],
    });
  });

  it("adds the stated reply ceiling to the upper bound", () => {
    const result = estimateAiCallCost({
      pricing: textPricing,
      meteredKind: "text",
      inputTokens: 1_000_000,
      maxOutputTokens: 500,
    });
    expect(result).toMatchObject({ amountMin: 1, amountMax: 1.001, outputTokensMax: 500 });
    expect(result.kind === "estimate" && result.notes).toEqual([]);
  });

  it("sizes the lower bound from the text when the caller has no count", () => {
    const text = "夜市摊位平均每小时出单 12 杯";
    const result = estimateAiCallCost({ pricing: textPricing, meteredKind: "text", inputText: text });
    expect(result).toMatchObject({ inputTokensMin: estimateTokensFromText(text) });
  });

  it("lets the caller's own count win over the text", () => {
    const result = estimateAiCallCost({
      pricing: textPricing,
      meteredKind: "text",
      inputText: "夜市摊位平均每小时出单 12 杯",
      inputTokens: 0,
    });
    expect(result).toMatchObject({ inputTokensMin: 0, amountMin: 0 });
  });

  it("prices a per-unit call by its quantity, both bounds the same", () => {
    const result = estimateAiCallCost({ pricing: imagePricing, meteredKind: "image", quantity: 3 });
    expect(result).toMatchObject({
      kind: "estimate",
      meteredKind: "image",
      amountMin: 0.12,
      amountMax: 0.12,
      inputTokensMin: 0,
      outputTokensMax: null,
    });
  });

  it("says so when a per-unit call states no quantity, instead of pricing an unknown number", () => {
    const result = estimateAiCallCost({ pricing: imagePricing, meteredKind: "image", quantity: null });
    expect(result.kind).toBe("unknown");
    expect(result.notes).toEqual(["usage-basis-unknown"]);
  });

  it("keeps the caveats the caller brought with it", () => {
    const result = estimateAiCallCost({
      pricing: textPricing,
      meteredKind: "text",
      inputTokens: 1,
      notes: ["route-may-differ"],
      maxOutputTokens: 10,
    });
    expect(result.kind === "estimate" && result.notes).toEqual(["route-may-differ"]);
  });
});

describe("roundAmount", () => {
  it("keeps the ledger's own six decimals and does not round a real figure to zero", () => {
    expect(roundAmount(1.23456789)).toBe(1.234568);
    expect(roundAmount(0.0000004)).toBe(0);
    expect(roundAmount(0.0000005)).toBe(0.000001);
  });
});

describe("summarizeBudgetSpend", () => {
  const window = { from: 1_000, to: 2_000 };

  it("reports an empty period as a real zero, because nothing was spent", () => {
    const result = summarizeBudgetSpend([], "CNY", window);
    expect(result).toMatchObject({ currency: "CNY", amount: 0, attempts: 0, isComplete: true, truncated: false });
    expect(result).toMatchObject(window);
  });

  it("adds up the rows that state a figure in the limit's currency", () => {
    const result = summarizeBudgetSpend(
      [row({ costAmount: 0.5, costCurrency: "CNY" }), row({ costAmount: 0.25, costCurrency: "CNY" })],
      "CNY",
      window,
    );
    expect(result).toMatchObject({ amount: 0.75, attempts: 2, statedAttempts: 2, isComplete: true });
  });

  it("counts an unpriced row instead of adding it as zero, and calls the total a floor", () => {
    const result = summarizeBudgetSpend(
      [
        row({ costAmount: 0.5, costCurrency: "CNY" }),
        // A call that really happened to a model with no price on file: it is not free, and it is not
        // 0. `amount` therefore stops being a total.
        row({ costAmount: null, costSource: "unpriced" }),
      ],
      "CNY",
      window,
    );
    expect(result).toMatchObject({
      amount: 0.5,
      attempts: 2,
      statedAttempts: 1,
      unpricedAttempts: 1,
      unmeasuredAttempts: 0,
      isComplete: false,
    });
  });

  it("reads a null amount as unmeasured unless the row says unpriced, so nothing can be laundered", () => {
    const result = summarizeBudgetSpend([row({ costAmount: null, costSource: "computed" })], "CNY", window);
    expect(result).toMatchObject({ unpricedAttempts: 0, unmeasuredAttempts: 1, isComplete: false });
  });

  it("keeps another currency out of the total and names it", () => {
    const result = summarizeBudgetSpend(
      [
        row({ costAmount: 0.5, costCurrency: "CNY" }),
        row({ costAmount: 3, costCurrency: "USD" }),
        row({ costAmount: 1, costCurrency: "USD" }),
      ],
      "CNY",
      window,
    );
    // There is no exchange rate in this database, so the two are never added together.
    expect(result).toMatchObject({ amount: 0.5, otherCurrencyAttempts: 2, isComplete: false });
    expect(result.otherCurrencies).toEqual(["USD"]);
  });

  it("marks a read that hit its own row ceiling, so a large month cannot look small", () => {
    const result = summarizeBudgetSpend([row({ costAmount: 1, costCurrency: "CNY" })], "CNY", window, {
      truncated: true,
    });
    expect(result).toMatchObject({ amount: 1, truncated: true, isComplete: false });
  });
});

describe("aiBudgetReservationAmount", () => {
  it("holds the upper bound, which is what the call could spend", () => {
    expect(aiBudgetReservationAmount(estimate(0.1, 0.4))).toBe(0.4);
  });

  it("falls back to the lower bound when no ceiling was stated", () => {
    expect(aiBudgetReservationAmount(estimate(0.1, null))).toBe(0.1);
  });

  it("holds nothing for a cost nobody can state - never an invented number", () => {
    expect(aiBudgetReservationAmount(unstated("unpriced"))).toBe(0);
    expect(aiBudgetReservationAmount(unstated("unknown"))).toBe(0);
  });
});

describe("evaluateAiBudget", () => {
  /** The period every decision in this block is judged against; `at` only has to be a real instant. */
  const period = budgetPeriodOf(new Date(2026, 9, 10, 12, 0, 0).getTime());

  function evaluate(input: {
    settings?: Partial<AiBudgetSettings>;
    spent?: Partial<AiBudgetSpend>;
    reserved?: number;
    estimate: AiCostEstimate;
  }) {
    return evaluateAiBudget({
      settings: settings(input.settings),
      period,
      spent: spend(input.spent),
      reserved: input.reserved ?? 0,
      estimate: input.estimate,
    });
  }

  it("decides nothing while the policy is off, but still reports the month", () => {
    const decision = evaluate({
      settings: { policy: "off", monthlyLimit: 100 },
      spent: { amount: 40 },
      estimate: estimate(0.2, 0.3),
    });
    expect(decision).toMatchObject({
      status: "off",
      estimateCounted: false,
      certainty: "not-applicable",
      projectedMin: null,
      projectedMax: null,
    });
    expect(decision.reasons).toEqual(["budget-off"]);
    // Turning control off is not turning information off: the figures are still there.
    expect(decision.spent.amount).toBe(40);
    expect(decision.remaining).toBe(60);
    expect(decision.enforcement).toBe("cross-process-atomic");
  });

  it("allows anything when no limit is stated, because there is nothing to cross", () => {
    const decision = evaluate({ settings: { policy: "block", monthlyLimit: null }, estimate: estimate(999, 999) });
    expect(decision).toMatchObject({ status: "allowed", remaining: null, estimateCounted: false });
    expect(decision.reasons).toEqual(["no-limit"]);
  });

  it("blocks a call whose lower bound already crosses the limit, and says it is definite", () => {
    const decision = evaluate({
      settings: { policy: "block", monthlyLimit: 1 },
      spent: { amount: 0.9 },
      estimate: estimate(0.2, 0.3),
    });
    expect(decision).toMatchObject({
      status: "blocked",
      certainty: "definite",
      estimateCounted: true,
      projectedMin: 1.1,
      projectedMax: 1.2,
      remaining: 0.1,
    });
    expect(decision.reasons).toEqual(["over-limit"]);
  });

  it("separates 'would cross if the reply is long' from 'already crosses'", () => {
    const decision = evaluate({
      settings: { policy: "block", monthlyLimit: 1 },
      spent: { amount: 0.8 },
      estimate: estimate(0.05, 0.3),
    });
    // Only the upper bound crosses: the call may still stay inside if the model keeps its answer short.
    expect(decision).toMatchObject({ status: "blocked", certainty: "possible", projectedMin: 0.85, projectedMax: 1.1 });
    expect(decision.reasons).toEqual(["over-limit"]);
  });

  it("lets the same over-limit call through under a warn policy, and says why", () => {
    const decision = evaluate({
      settings: { policy: "warn", monthlyLimit: 1 },
      spent: { amount: 0.8 },
      estimate: estimate(0.05, 0.3),
    });
    expect(decision).toMatchObject({ status: "allowed", certainty: "possible", policy: "warn" });
    expect(decision.reasons).toEqual(["over-limit-warning"]);
  });

  it("counts the holds of calls in flight, which is what stops two overlapping calls both passing", () => {
    const held = evaluate({
      settings: { policy: "block", monthlyLimit: 1 },
      reserved: 0.9,
      estimate: estimate(0.2, 0.3),
    });
    expect(held).toMatchObject({ status: "blocked", certainty: "definite", reserved: 0.9, projectedMin: 1.1 });

    // The same call, once that hold has been released: the money is free again.
    const released = evaluate({
      settings: { policy: "block", monthlyLimit: 1 },
      reserved: 0,
      estimate: estimate(0.2, 0.3),
    });
    expect(released).toMatchObject({ status: "allowed", reserved: 0, projectedMin: 0.2 });
    expect(released.reasons).toEqual(["within-limit"]);
  });

  it("never adds an unstated cost as 0: it passes with the caveat, and the total is left alone", () => {
    const decision = evaluate({
      settings: { policy: "block", monthlyLimit: 1, unknownCostPolicy: "allow" },
      spent: { amount: 0.99 },
      estimate: unstated("unpriced"),
    });
    expect(decision).toMatchObject({
      status: "allowed",
      estimateCounted: false,
      certainty: "not-applicable",
      // Nothing was added - not even a zero, which is why there is no projection to compare.
      projectedMin: null,
      projectedMax: null,
      remaining: 0.01,
    });
    expect(decision.reasons).toEqual(["unknown-cost-not-counted"]);
  });

  it("refuses an unstated cost when the user asked it to", () => {
    const decision = evaluate({
      settings: { policy: "block", monthlyLimit: 1, unknownCostPolicy: "block" },
      spent: { amount: 0.99 },
      estimate: unstated("unknown"),
    });
    expect(decision).toMatchObject({ status: "blocked", estimateCounted: false });
    expect(decision.reasons).toEqual(["unknown-cost-refused"]);
  });

  it("does not subtract a price quoted in another currency from a limit in this one", () => {
    const decision = evaluate({
      settings: { policy: "block", monthlyLimit: 100, currency: "CNY" },
      estimate: estimate(0.5, 0.5, "USD"),
    });
    expect(decision).toMatchObject({ status: "allowed", estimateCounted: false, projectedMin: null });
    expect(decision.reasons).toEqual(["currency-not-compared"]);
  });

  it("treats an incomparable currency as an unstated cost when the policy refuses those", () => {
    const decision = evaluate({
      settings: { policy: "block", monthlyLimit: 100, currency: "CNY", unknownCostPolicy: "block" },
      estimate: estimate(0.5, 0.5, "USD"),
    });
    expect(decision).toMatchObject({ status: "blocked" });
    expect(decision.reasons).toEqual(["currency-not-compared", "unknown-cost-refused"]);
  });

  it("reports a floor for spending it cannot add up, and blocks on it anyway", () => {
    const decision = evaluate({
      settings: { policy: "block", monthlyLimit: 1 },
      spent: { amount: 1.2, unpricedAttempts: 1, isComplete: false },
      estimate: estimate(0.2, 0.3),
    });
    expect(decision.status).toBe("blocked");
    // The caveat is a reason, not an excuse to skip the comparison.
    expect(decision.reasons).toEqual(["over-limit", "spend-incomplete"]);
    expect(decision.spent.isComplete).toBe(false);
  });

  it("tells the user when the next call of this size is close to the limit", () => {
    const near = evaluate({
      settings: { policy: "warn", monthlyLimit: 1 },
      estimate: estimate(0.1, 0.85),
    });
    expect(near).toMatchObject({ status: "allowed", certainty: "not-applicable", projectedMax: 0.85 });
    expect(near.reasons).toEqual(["near-limit"]);

    const comfortable = evaluate({
      settings: { policy: "warn", monthlyLimit: 1 },
      estimate: estimate(0.1, 0.5),
    });
    expect(comfortable.reasons).toEqual(["within-limit"]);
  });
});

describe("aiBudgetRemaining", () => {
  it("answers \"no ceiling stated\" rather than 0 when there is no limit", () => {
    // A limit of `null` is a user who has not set one, which is not a user who may spend nothing.
    expect(aiBudgetRemaining(null, 12, 3)).toBeNull();
  });

  it("takes this month's spending and the calls in flight off the limit", () => {
    expect(aiBudgetRemaining(10, 4, 1.5)).toBe(4.5);
  });

  it("goes negative rather than clamping, because a month can already be over", () => {
    expect(aiBudgetRemaining(1, 2, 0)).toBe(-1);
    expect(aiBudgetRemaining(1, 0, 2)).toBe(-1);
  });

  it("does not let a negative hold hand budget back to the user", () => {
    // The same clamp `evaluateAiBudget` applies: a hold is never a credit.
    expect(aiBudgetRemaining(10, 1, -5)).toBe(9);
  });

  it("keeps the ledger's six decimals, the same rounding the decision uses", () => {
    expect(aiBudgetRemaining(0.3, 0.1, 0.1)).toBe(0.1);
    expect(aiBudgetRemaining(1_000_000, 333_333.333333, 0.666667)).toBe(666_666);
  });
});

