import { pricingBasisFromRow } from "@/lib/ai-usage-ledger";
import {
  aiUsageKindIsTokenMetered,
  type AiModelPrice,
  type AiPriceCurrency,
  type AiUsageLedgerEntry,
  type AiUsageMeteredKind,
  type AiUsagePricingBasis,
} from "@/lib/types";

/**
 * 预算与生成前预估的算术 (CI-P7-03), with no database and no runtime attached.
 *
 * Three statements this module refuses to make, because each of them would turn a guess into a bill:
 *
 *  - **a missing figure is not 0.** An unpriced model, a dimension with no price on file and an
 *    amount nobody stated stay `null` / `unpriced` / `unknown` and are counted, never summed as
 *    zero. The four money states are the ledger's own (`costSource`); this module adds no fifth.
 *  - **an estimate is a range, not a price.** There is no tokenizer here, so input size is a stated
 *    heuristic (`textTokenEstimateMethod`) and the upper bound is only real when the caller states
 *    the reply ceiling it will send. When it does not, `amountMax` is `null` - an unknown ceiling is
 *    reported as unknown instead of being quietly filled in with the lower bound.
 *  - **a pre-check is not a hard budget.** {@link aiBudgetEnforcement} names exactly what the check
 *    can promise. The vocabulary lives here so the page, the route and the delivery note cannot
 *    describe the same mechanism three different ways. Since CI-P7-03-A the check is *admission
 *    against a shared hold* rather than a look at a private one, and the constant says how far that
 *    reaches - including what it still does not promise.
 */

/** How the budget is allowed to react to a call that would cross the limit. */
export const aiBudgetPolicies = ["off", "warn", "block"] as const;

export type AiBudgetPolicy = (typeof aiBudgetPolicies)[number];

/**
 * What to do when the cost of the call that is about to run cannot be stated at all.
 *
 * `allow` is the default on purpose: refusing every call to a model the user has not priced would
 * make the price catalog a precondition for using CoolPilot. What `allow` may **not** do is pretend
 * the call is free - the decision says `unknown-cost-not-counted`, `estimateCounted: false`, and the
 * amount is left out of every total instead of being added as a zero.
 */
export const aiBudgetUnknownCostPolicies = ["allow", "block"] as const;

export type AiBudgetUnknownCostPolicy = (typeof aiBudgetUnknownCostPolicies)[number];

/**
 * The semantics of the gate this card ships, in one constant, so no surface has to paraphrase it.
 *
 * What it **does** promise: a call whose estimate and the period's own spending already cross the
 * limit is refused **before** the request is sent, and the check and the hold it takes are **one
 * statement against the shared database** (CI-P7-03-A), so two checks that overlap - in one process
 * or in two - cannot both pass through the same room. A hold is a row, so a second process (a worker
 * beside the app, or the app restarted) sees it instead of keeping a private one.
 *
 * What it **does not** promise (and must never be described as): a hold that no call ever reports back
 * from keeps counting for {@link aiBudgetReservationTtlMs} and then stops - a crash therefore
 * over-reserves for at most that long and never under-reserves; and a model with no price on file
 * holds nothing at all, because there is no honest amount to hold. Both are stated on the budget
 * surface and in the delivery note rather than hidden here.
 */
export const aiBudgetEnforcement = "cross-process-atomic";

/** How long a reservation is held when the caller never reports back (a hang, a crash). */
export const aiBudgetReservationTtlMs = 30 * 60_000;

/**
 * How long a hold or a decision is kept before the sweep drops it (CI-P7-03-A).
 *
 * One row per gated call is a lot of rows over a year, and a local-first database is the user's own
 * disk. Six months is long enough that "what did the budget do in March" still has an answer in July,
 * and the sweep never deletes a *live* hold - only rows that have already stopped counting.
 */
export const aiBudgetRecordRetentionMs = 180 * 24 * 60 * 60_000;

/** The budget settings the user can change. `monthlyLimit: null` is "no ceiling stated". */
export interface AiBudgetSettings {
  policy: AiBudgetPolicy;
  monthlyLimit: number | null;
  currency: AiPriceCurrency;
  unknownCostPolicy: AiBudgetUnknownCostPolicy;
}

/** Off by default: an install that never opened the budget tab is not silently capped. */
export const defaultAiBudgetSettings: AiBudgetSettings = {
  policy: "off",
  monthlyLimit: null,
  currency: "CNY",
  unknownCostPolicy: "allow",
};

/** A natural month, in the machine's own calendar — the window a budget period is measured over. */
export interface AiBudgetPeriod {
  /** `2026-10`, so two periods can be told apart without a date formatter. */
  key: string;
  start: number;
  end: number;
}

/**
 * The **natural month** containing `at`, in local time: `[monthStart, nextMonthStart)`.
 *
 * Deliberately not the rolling 30-day window the 用量统计 page uses (`usageRangeStart`): a monthly
 * budget that silently means "the last 30 days" resets on a different day every time the user looks
 * at it, and a call made on the 1st would be judged against the previous month's spending.
 */
export function budgetPeriodOf(at: number): AiBudgetPeriod {
  const date = new Date(at);
  const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
  return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`, start, end };
}

/** The name of the heuristic below, carried on every estimate so a guess is never read as a count. */
export const textTokenEstimateMethod = "heuristic-cjk-1-latin-0.25";

function isWideScript(code: number) {
  // CJK ideographs, kana, Hangul and the fullwidth forms: roughly one token per character.
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7ff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  );
}

/**
 * How many input tokens a text is likely to cost, without a tokenizer.
 *
 * A heuristic and nothing more: wide-script characters are counted as one token each and everything
 * else as a quarter. It is used only to size an estimate's lower bound, and every result that
 * carries it is labelled `textTokenEstimateMethod`, so it can never be mistaken for measured usage
 * (which is the ledger's `reported` figure, the provider's own count).
 */
export function estimateTokensFromText(text: string): number {
  let wide = 0;
  let narrow = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (isWideScript(text.charCodeAt(index))) wide += 1;
    else narrow += 1;
  }
  return wide + Math.ceil(narrow / 4);
}

/** Every honest caveat an estimate can carry. A note is not an error: it is what the number is not. */
export const aiCostEstimateNotes = [
  /** Nobody stated the reply ceiling (`maxTokens`), so the upper bound is not knowable. */
  "output-ceiling-unknown",
  /** The price came from the route resolved *before* the call, which the runtime may still change. */
  "route-may-differ",
  /** No model could be resolved for this call at all, so there was nothing to look a price up for. */
  "route-unresolved",
  /** A per-unit dimension with no quantity stated: there is nothing to multiply. */
  "usage-basis-unknown",
  /** The catalog has nothing to say about this provider+model+dimension. Not "free". */
  "price-not-on-file",
  /** The catalog priced a different dimension than the one about to be metered. */
  "dimension-mismatch",
  /**
   * The price is quoted in another currency than the budget limit, and this database holds no
   * exchange rate - so the two are never subtracted, exactly as the cost center keeps its totals
   * separate per currency.
   */
  "currency-mismatch",
  /** The rows behind this period's spending include a money figure nobody could state. */
  "spend-incomplete",
  /** The period's ledger read hit its own row ceiling, so the spending figure is a floor. */
  "spend-truncated",
] as const;

export type AiCostEstimateNote = (typeof aiCostEstimateNotes)[number];

/**
 * What one call is expected to cost, before it is sent.
 *
 * `estimate` carries a real range over a frozen price snapshot. `unpriced` and `unknown` carry **no
 * amount at all** - not a zero - because those two are different statements ("the catalog does not
 * price this model" vs "the usage this would be billed on cannot be stated") and a 0 would flatten
 * both into "free".
 */
export type AiCostEstimate =
  | {
      kind: "estimate";
      method: string;
      meteredKind: AiUsageMeteredKind;
      currency: string;
      /** Lower bound. Always a real figure when `kind` is `estimate`. */
      amountMin: number;
      /** Upper bound, or `null` when the reply ceiling is unknown. Never a stand-in for `amountMin`. */
      amountMax: number | null;
      inputTokensMin: number;
      outputTokensMax: number | null;
      basis: AiUsagePricingBasis;
      notes: AiCostEstimateNote[];
    }
  | {
      kind: "unpriced" | "unknown";
      method: string;
      meteredKind: AiUsageMeteredKind;
      notes: AiCostEstimateNote[];
    };

export interface AiCostEstimateInput {
  /** The price the catalog resolved, or `null` when it has nothing to say. */
  pricing: AiUsagePricingBasis | null;
  meteredKind: AiUsageMeteredKind;
  /** The input text, when the caller has it as text rather than as a count. */
  inputText?: string;
  /** A count the caller already made; wins over `inputText`. */
  inputTokens?: number;
  /** The reply ceiling this call will send. `null`/absent = nobody stated one. */
  maxOutputTokens?: number | null;
  /** For a per-unit dimension: how many units the call is expected to consume. */
  quantity?: number | null;
  /** Caveats the caller knows about (`route-may-differ`, `spend-truncated`). */
  notes?: AiCostEstimateNote[];
}

/** Six decimals, the ledger's own resolution: a fraction of a cent is often the whole figure. */
export function roundAmount(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * The cost range of one call, or an honest refusal to state one.
 *
 * Token-metered dimensions take the input count (measured or heuristically estimated) for the lower
 * bound and add the caller's stated reply ceiling for the upper one. Per-unit dimensions need a
 * quantity; without one, the answer is `unknown` rather than a price for an unknown number of
 * images. A price row of another dimension is never applied - that refusal is the one thing
 * CI-P7-01-05 pinned, and it holds here too.
 */
export function estimateAiCallCost(input: AiCostEstimateInput): AiCostEstimate {
  const notes = [...(input.notes ?? [])];
  const method = textTokenEstimateMethod;

  if (!input.pricing) {
    return { kind: "unpriced", method, meteredKind: input.meteredKind, notes: [...notes, "price-not-on-file"] };
  }
  if (input.pricing.meteredKind !== input.meteredKind) {
    return { kind: "unknown", method, meteredKind: input.meteredKind, notes: [...notes, "dimension-mismatch"] };
  }

  if (aiUsageKindIsTokenMetered(input.meteredKind)) {
    const inputTokensMin = Math.max(
      0,
      Math.round(input.inputTokens ?? estimateTokensFromText(input.inputText ?? "")),
    );
    const maxOutputTokens = input.maxOutputTokens ?? null;
    const inputCost = (inputTokensMin * input.pricing.inputPerMillion) / 1_000_000;
    const amountMin = roundAmount(inputCost);
    const amountMax =
      maxOutputTokens === null
        ? null
        : roundAmount(inputCost + (maxOutputTokens * input.pricing.outputPerMillion) / 1_000_000);
    if (maxOutputTokens === null) notes.push("output-ceiling-unknown");
    return {
      kind: "estimate",
      method,
      meteredKind: input.meteredKind,
      currency: input.pricing.currency,
      amountMin,
      amountMax,
      inputTokensMin,
      outputTokensMax: maxOutputTokens,
      basis: input.pricing,
      notes,
    };
  }

  const unitPrice = input.pricing.unitPrice;
  if (unitPrice === undefined || unitPrice === null) {
    // A per-unit row with no unit price cannot price anything. The catalog refuses to store one, so
    // reaching here means the basis came from somewhere other than `createAiModelPrice`.
    return { kind: "unpriced", method, meteredKind: input.meteredKind, notes: [...notes, "price-not-on-file"] };
  }
  const quantity = input.quantity ?? null;
  if (quantity === null) {
    return { kind: "unknown", method, meteredKind: input.meteredKind, notes: [...notes, "usage-basis-unknown"] };
  }
  const amount = roundAmount(Math.max(0, quantity) * unitPrice);
  return {
    kind: "estimate",
    method,
    meteredKind: input.meteredKind,
    currency: input.pricing.currency,
    amountMin: amount,
    amountMax: amount,
    inputTokensMin: 0,
    outputTokensMax: null,
    basis: input.pricing,
    notes,
  };
}

/** The frozen price snapshot of a catalog row, as the estimate and the ledger both carry it. */
export function priceBasisFor(price: AiModelPrice): AiUsagePricingBasis {
  return pricingBasisFromRow(price);
}

/**
 * What the period's own ledger rows state about money, for one currency.
 *
 * The window's rows are the truth about what happened - including the retries, which really were
 * sent and may well have been billed. Two things are reported separately rather than folded into the
 * total: rows whose money cannot be stated (`unpriced` / `unknown`) and rows costed in another
 * currency, so `amount` is a **floor** and `isComplete: false` says so. `truncated` marks a read
 * that hit its own row ceiling, so a large month cannot look smaller than it is.
 *
 * An empty period genuinely is `amount: 0` with `isComplete: true`: nothing was spent, which is a
 * real figure - unlike a row that was spent and cannot be priced.
 */
export interface AiBudgetSpend {
  currency: string;
  amount: number;
  attempts: number;
  statedAttempts: number;
  unpricedAttempts: number;
  unmeasuredAttempts: number;
  otherCurrencyAttempts: number;
  otherCurrencies: string[];
  isComplete: boolean;
  truncated: boolean;
  from: number;
  to: number;
}

export function summarizeBudgetSpend(
  entries: AiUsageLedgerEntry[],
  currency: string,
  window: { from: number; to: number },
  options: { truncated?: boolean } = {},
): AiBudgetSpend {
  let amount = 0;
  let statedAttempts = 0;
  let unpricedAttempts = 0;
  let unmeasuredAttempts = 0;
  let otherCurrencyAttempts = 0;
  const otherCurrencies = new Set<string>();

  for (const entry of entries) {
    if (entry.costAmount === null) {
      if (entry.costSource === "unpriced") unpricedAttempts += 1;
      else unmeasuredAttempts += 1;
      continue;
    }
    if (entry.costCurrency === currency) {
      amount += entry.costAmount;
      statedAttempts += 1;
      continue;
    }
    otherCurrencyAttempts += 1;
    if (entry.costCurrency) otherCurrencies.add(entry.costCurrency);
  }

  return {
    currency,
    amount: roundAmount(amount),
    attempts: entries.length,
    statedAttempts,
    unpricedAttempts,
    unmeasuredAttempts,
    otherCurrencyAttempts,
    otherCurrencies: [...otherCurrencies].sort(),
    isComplete: unpricedAttempts === 0 && unmeasuredAttempts === 0 && otherCurrencyAttempts === 0 && !(options.truncated ?? false),
    truncated: options.truncated ?? false,
    from: window.from,
    to: window.to,
  };
}

/** Why a decision came out the way it did. This list is what a page translates. */
export const aiBudgetDecisionReasons = [
  "budget-off",
  "no-limit",
  "within-limit",
  "near-limit",
  "over-limit",
  "over-limit-warning",
  "unknown-cost-not-counted",
  "unknown-cost-refused",
  "spend-incomplete",
  /** The estimate is in another currency than the limit, so no comparison was made at all. */
  "currency-not-compared",
  /**
   * The estimate and the period's spending said yes, but by the time the hold was written the room
   * was gone - another call, in this process or in another one, had taken it (CI-P7-03-A). Kept as
   * its own reason because it is the *only* case where the arithmetic and the admission disagree,
   * and a reader of the decision log deserves to see that rather than a plain "over-limit".
   */
  "hold-lost-to-concurrent-call",
] as const;

export type AiBudgetDecisionReason = (typeof aiBudgetDecisionReasons)[number];

/**
 * The verdict for one call about to run, with every number that produced it.
 *
 * `certainty` is the part that keeps a partial estimate honest: `definite` means even the estimate's
 * lower bound crosses the limit, `possible` means only the upper bound does (so a reply that stays
 * short would have been fine), and `not-applicable` means no comparison could be made at all.
 */
export interface AiBudgetDecision {
  status: "off" | "allowed" | "blocked";
  policy: AiBudgetPolicy;
  unknownCostPolicy: AiBudgetUnknownCostPolicy;
  enforcement: typeof aiBudgetEnforcement;
  period: AiBudgetPeriod;
  currency: string;
  limit: number | null;
  spent: AiBudgetSpend;
  /** Estimated cost held by calls that are in flight right now, in this process. */
  reserved: number;
  /** `limit - spent.amount - reserved`, or `null` when no limit is stated. May be negative. */
  remaining: number | null;
  projectedMin: number | null;
  projectedMax: number | null;
  estimate: AiCostEstimate;
  /** False when the estimate states no amount - which is why nothing was added to the totals. */
  estimateCounted: boolean;
  certainty: "definite" | "possible" | "not-applicable";
  reasons: AiBudgetDecisionReason[];
}

/** How much a passing check holds until the call reports back. An unstated cost holds nothing. */
export function aiBudgetReservationAmount(estimate: AiCostEstimate) {
  if (estimate.kind !== "estimate") return 0;
  return estimate.amountMax ?? estimate.amountMin;
}

/**
 * What is left of the limit once the period's spending and the calls in flight are taken off it.
 *
 * `null` when no limit is stated - "no ceiling" is not the same answer as "0 left" - and it may be
 * negative, which is a real state the page shows rather than clamps: a month can already be over.
 * One helper, used by the decision and by the status the budget page reads, so the number on screen
 * and the number a refusal was based on cannot be two different subtractions.
 */
export function aiBudgetRemaining(limit: number | null, spentAmount: number, reserved: number): number | null {
  if (limit === null) return null;
  return roundAmount(limit - spentAmount - Math.max(0, reserved));
}

export interface AiBudgetEvaluationInput {
  settings: AiBudgetSettings;
  period: AiBudgetPeriod;
  spent: AiBudgetSpend;
  reserved: number;
  estimate: AiCostEstimate;
}

/**
 * The decision, and nothing else: no database, no clock, no IO.
 *
 * Order of business:
 *
 *  1. `off` decides nothing, but still reports the numbers - a user who turned control off has not
 *     turned *information* off.
 *  2. No limit stated → allowed, `remaining: null`. There is nothing to cross.
 *  3. An estimate that states no amount is **never** added as 0; it either blocks (when the user
 *     asked for that) or passes with `unknown-cost-not-counted` and `estimateCounted: false`.
 *  4. A stated estimate is compared on its **upper** bound (`possible`) and on its **lower** bound
 *     (`definite`), so a reply that stays short is not treated as if it were a long one.
 */
export function evaluateAiBudget(input: AiBudgetEvaluationInput): AiBudgetDecision {
  const { settings, estimate } = input;
  const reserved = Math.max(0, input.reserved);
  const limit = settings.monthlyLimit;
  const reasons: AiBudgetDecisionReason[] = [];
  if (!input.spent.isComplete) reasons.push("spend-incomplete");

  const base = {
    policy: settings.policy,
    unknownCostPolicy: settings.unknownCostPolicy,
    enforcement: aiBudgetEnforcement,
    period: input.period,
    currency: settings.currency,
    limit,
    spent: input.spent,
    reserved,
    estimate,
  } as const;

  const remaining = aiBudgetRemaining(limit, input.spent.amount, reserved);

  if (settings.policy === "off") {
    return {
      ...base,
      status: "off",
      remaining,
      projectedMin: null,
      projectedMax: null,
      estimateCounted: false,
      certainty: "not-applicable",
      reasons: ["budget-off", ...reasons],
    };
  }

  if (limit === null) {
    return {
      ...base,
      status: "allowed",
      remaining: null,
      projectedMin: null,
      projectedMax: null,
      estimateCounted: false,
      certainty: "not-applicable",
      reasons: ["no-limit", ...reasons],
    };
  }

  if (estimate.kind !== "estimate") {
    const blocked = settings.unknownCostPolicy === "block";
    return {
      ...base,
      status: blocked ? "blocked" : "allowed",
      remaining,
      projectedMin: null,
      projectedMax: null,
      estimateCounted: false,
      certainty: "not-applicable",
      reasons: [blocked ? "unknown-cost-refused" : "unknown-cost-not-counted", ...reasons],
    };
  }

  // A price in another currency cannot be subtracted from a limit in this one: there is no rate in
  // this database, and inventing one would be a fabricated figure in the one place the user is
  // deciding whether to spend money. Reported as its own state, and the unknown-cost policy decides
  // whether it may run.
  if (estimate.currency !== settings.currency) {
    const blocked = settings.unknownCostPolicy === "block";
    const currencyReasons: AiBudgetDecisionReason[] = blocked
      ? ["currency-not-compared", "unknown-cost-refused"]
      : ["currency-not-compared"];
    return {
      ...base,
      status: blocked ? "blocked" : "allowed",
      remaining,
      projectedMin: null,
      projectedMax: null,
      estimateCounted: false,
      certainty: "not-applicable",
      reasons: [...currencyReasons, ...reasons],
    };
  }

  const countedMax = estimate.amountMax ?? estimate.amountMin;
  const projectedMin = roundAmount(input.spent.amount + reserved + estimate.amountMin);
  const projectedMax = roundAmount(input.spent.amount + reserved + countedMax);
  const overOnMinimum = projectedMin > limit;
  const overOnMaximum = projectedMax > limit;

  if (overOnMinimum || overOnMaximum) {
    return {
      ...base,
      status: settings.policy === "block" ? "blocked" : "allowed",
      remaining,
      projectedMin,
      projectedMax,
      estimateCounted: true,
      certainty: overOnMinimum ? "definite" : "possible",
      reasons: [settings.policy === "block" ? "over-limit" : "over-limit-warning", ...reasons],
    };
  }

  // 80% of the limit: close enough that the next call of this size is worth being told about.
  const nearLimit = projectedMax > limit * 0.8;
  return {
    ...base,
    status: "allowed",
    remaining,
    projectedMin,
    projectedMax,
    estimateCounted: true,
    certainty: "not-applicable",
    reasons: [nearLimit ? "near-limit" : "within-limit", ...reasons],
  };
}

/**
 * The verdict for starting a *step* rather than sending one call (CI-P7-03's run/node gate).
 *
 * A playbook loops over URLs and a node's request is not written yet when the step begins, so there is
 * nothing to measure - the only honest question at that boundary is "does this period still have budget
 * at all". This answers exactly that and nothing more: the arithmetic of the period, no estimate.
 *
 * Two things keep it from pretending to be more than it is. `estimate` is `unknown` with `method:
 * "step-headroom"` and `estimateCounted` is false, because no call was measured and nothing here may
 * point at a figure that was never computed. And a *warn* policy only reports: only `block` stops a step,
 * which is the same split `evaluateAiBudget` makes for one call.
 */
export function evaluateAiBudgetHeadroom(input: {
  settings: AiBudgetSettings;
  period: AiBudgetPeriod;
  spent: AiBudgetSpend;
  reserved: number;
}): AiBudgetDecision {
  const reserved = Math.max(0, input.reserved);
  const limit = input.settings.monthlyLimit;
  const remaining = aiBudgetRemaining(limit, input.spent.amount, reserved);
  const estimate: AiCostEstimate = { kind: "unknown", method: "step-headroom", meteredKind: "text", notes: [] };
  const reasons: AiBudgetDecisionReason[] = [];
  if (!input.spent.isComplete) reasons.push("spend-incomplete");

  const base = {
    policy: input.settings.policy,
    unknownCostPolicy: input.settings.unknownCostPolicy,
    enforcement: aiBudgetEnforcement,
    period: input.period,
    currency: input.settings.currency,
    limit,
    spent: input.spent,
    reserved,
    estimate,
  } as const;

  const verdict = (status: AiBudgetDecision["status"], why: AiBudgetDecisionReason[]): AiBudgetDecision => ({
    ...base,
    status,
    remaining,
    projectedMin: null,
    projectedMax: null,
    estimateCounted: false,
    certainty: "not-applicable",
    reasons: [...why, ...reasons],
  });

  if (input.settings.policy === "off") return verdict("off", ["budget-off"]);
  if (limit === null) return verdict("allowed", ["no-limit"]);
  if (remaining !== null && remaining <= 0) {
    const blocking = input.settings.policy === "block";
    return verdict(blocking ? "blocked" : "allowed", [blocking ? "over-limit" : "over-limit-warning"]);
  }
  // The same 80% line the per-call decision uses, read from the other side: a fifth of the limit left.
  if (remaining !== null && remaining <= limit * 0.2) return verdict("allowed", ["near-limit"]);
  return verdict("allowed", ["within-limit"]);
}
