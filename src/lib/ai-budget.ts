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
 * CI-P7-03-C1: how much of the limit the gate keeps back for the rest of the work.
 *
 * The three tiers differ **only** in where they stop. No tier routes a model, re-tries, rotates a key,
 * falls back to another provider, shortens a reply, or changes what a rewrite or an image call does -
 * a tier that quietly sent the same request to a cheaper model would be the "switch a model name"
 * mistake the card forbids, not an execution strategy.
 *
 *  - `cost-saving` keeps a line *below* the limit: a call whose pessimistic (upper bound) cost would
 *    take more than {@link aiBudgetCostSavingCallShare} of the limit is refused, and a *pausable* step
 *    stops once {@link aiBudgetCostSavingRemainingShare} of the limit is all that is left - so the
 *    remainder can pay for smaller work instead of being spent in one gulp.
 *  - `balanced` is the shipped CI-P7-03 behaviour and the default: no line below the limit, and a step
 *    stops only when nothing is left at all.
 *  - `quality-first` keeps the hard per-call line and nothing else: it adds no call line, and it
 *    declines the step's own "nothing left" stop, so a pausable workflow starts its next step and is
 *    stopped by the first call that genuinely crosses the limit. Starting a step cannot overspend -
 *    every call inside still passes the same gate and the same atomic hold - so what is given up is
 *    the pre-emptive stop, never the ceiling.
 *
 * Every tier is a statement about *stops*, and each stop a tier adds is reported under its own reason
 * code rather than as `over-limit`: a decision log that called a strategy's line an exhausted budget
 * would be describing a different event than the one that happened.
 */
export const aiBudgetStrategies = ["cost-saving", "balanced", "quality-first"] as const;

export type AiBudgetStrategy = (typeof aiBudgetStrategies)[number];

/** 80% of the limit: the share `cost-saving` refuses to spend in one call. */
export const aiBudgetCostSavingCallShare = 0.8;

/** 20% of the limit: the headroom `cost-saving` keeps for the rest of a pausable workflow. */
export const aiBudgetCostSavingRemainingShare = 0.2;

/**
 * What a tier does at each boundary, in one table, so the arithmetic, the API and the page cannot
 * describe the same tier three different ways.
 *
 * The two boundaries are the only places a tier acts: `evaluateAiBudget` (one call about to be sent)
 * and `evaluateAiBudgetHeadroom` (a step about to start, whose request does not exist yet). A tier with
 * `null` shares adds no line there, which is why the table also has to say whether the *shipped* line
 * survives: `stepStopsAtZero` is `false` only for the tier that declines it.
 */
export interface AiBudgetStrategyLines {
  /**
   * Under `policy: block`, a call whose projected **upper bound** would take more than this share of
   * the limit is refused. `null` = no line below the limit.
   */
  callShare: number | null;
  /**
   * Under `policy: block`, a *pausable* step stops once this share of the limit is all that is left.
   * `null` = no line below the limit.
   */
  stepShare: number | null;
  /**
   * Whether the step keeps the shipped stop at zero headroom (`remaining <= 0`). `false` = the tier
   * declines it, so a step starts even when the period has nothing left and the calls inside decide.
   */
  stepStopsAtZero: boolean;
}

export const aiBudgetStrategyLines: Record<AiBudgetStrategy, AiBudgetStrategyLines> = {
  // The same line read from both sides - what is left in a period is what has not been spent - so the
  // call line and the step line are one decision about how much of a month one piece of work may use.
  "cost-saving": {
    callShare: aiBudgetCostSavingCallShare,
    stepShare: aiBudgetCostSavingRemainingShare,
    stepStopsAtZero: true,
  },
  balanced: { callShare: null, stepShare: null, stepStopsAtZero: true },
  "quality-first": { callShare: null, stepShare: null, stepStopsAtZero: false },
};

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
  /**
   * CI-P7-03-C1. Only `policy: block` with a stated limit lets a tier act, and even then only on the
   * stop conditions - see {@link aiBudgetStrategyLines} for what each one does.
   */
  strategy: AiBudgetStrategy;
}

/**
 * Off by default: an install that never opened the budget tab is not silently capped. The tier defaults
 * to `balanced`, which is the behaviour that shipped before the tiers existed - so a settings row
 * written by an older build (or by a client that does not know the field) reads back as the semantics it
 * was actually running under, not as a stricter or looser gate nobody chose.
 */
export const defaultAiBudgetSettings: AiBudgetSettings = {
  policy: "off",
  monthlyLimit: null,
  currency: "CNY",
  unknownCostPolicy: "allow",
  strategy: "balanced",
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
  /**
   * CI-P7-03-C1, `cost-saving`: the call's projected **upper bound** would take more than
   * {@link aiBudgetCostSavingCallShare} of the limit, so it was refused while there was still room
   * left. Its own reason, never `over-limit`: no bound crossed the limit, and a row claiming one had
   * would be describing a different event than the one the gate acted on.
   */
  "cost-saving-call-line",
  /**
   * CI-P7-03-C1, `cost-saving`: a pausable step was stopped because
   * {@link aiBudgetCostSavingRemainingShare} of the limit is all that is left. Also its own reason -
   * the period is not over, the tier is keeping the remainder for smaller work.
   */
  "cost-saving-remaining-line",
  /**
   * CI-P7-03-C1, `quality-first`: the step was allowed to start even though the period has nothing
   * left, because this tier declines the step's pre-emptive stop. Recorded so the log says *why* a
   * step started at zero headroom - the calls inside are still judged one by one, and the first one
   * that genuinely crosses the limit is refused under its own reason.
   */
  "step-line-declined-by-strategy",
] as const;

export type AiBudgetDecisionReason = (typeof aiBudgetDecisionReasons)[number];

/**
 * The verdict for one call about to run, with every number that produced it.
 *
 * `certainty` is the part that keeps a partial estimate honest: `definite` means even the estimate's
 * lower bound crosses the limit, `possible` means only the upper bound does (so a reply that stays
 * short would have been fine), and `not-applicable` means no comparison with the limit could be made
 * at all. CI-P7-03-C1 adds a fourth answer rather than reusing one of those three: `strategy-line` says
 * the refusal came from the selected tier's own line *below* the limit - no bound crossed the limit, so
 * calling it `definite` would overstate it and calling it `not-applicable` would hide that a comparison
 * was made and said no.
 */
export interface AiBudgetDecision {
  status: "off" | "allowed" | "blocked";
  policy: AiBudgetPolicy;
  unknownCostPolicy: AiBudgetUnknownCostPolicy;
  /** The tier in force when this verdict was reached (CI-P7-03-C1). */
  strategy: AiBudgetStrategy;
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
  certainty: "definite" | "possible" | "not-applicable" | "strategy-line";
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
 *  5. CI-P7-03-C1: only then does the tier get a say, and only if `block` was chosen and the call did not
 *     already cross the limit. A tier adds a stop *below* the limit or adds none; it never loosens the
 *     comparison above and never re-writes one of its reasons (see {@link aiBudgetStrategyLines}).
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
    strategy: settings.strategy,
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

  // CI-P7-03-C1. A tier may keep a line *below* the limit: under `block`, `cost-saving` refuses a call
  // whose pessimistic (upper bound) cost would take more than 80% of the month, so the remainder can pay
  // for smaller work instead of being spent in one gulp. The line is only reachable with a stated limit
  // and only under `block` - `off` reported its verdict long before here, and `warn` has already been
  // given the whole-limit comparison above, so neither is quietly re-scoped by a tier.
  //
  // The reason code names the tier that drew the line, which is why the branch checks the share rather
  // than the tier name: a tier with no share cannot reach it, so the code can never describe a stop that
  // this tier did not make.
  const strategyLines = aiBudgetStrategyLines[settings.strategy];
  if (settings.policy === "block" && strategyLines.callShare !== null && projectedMax > limit * strategyLines.callShare) {
    return {
      ...base,
      status: "blocked",
      remaining,
      projectedMin,
      projectedMax,
      estimateCounted: true,
      certainty: "strategy-line",
      reasons: ["cost-saving-call-line", ...reasons],
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
 *
 * CI-P7-03-C1 gives the caller's tier two ways to move this stop, and both are narrower than they look.
 * `cost-saving` adds a line *above* the limit's edge - it stops a pausable workflow while a fifth of the
 * month is still there, so the remainder is spent on smaller work rather than in one last gulp.
 * `quality-first` does the opposite and *declines* the stop at zero headroom: the step begins while
 * nothing is left, and the calls inside it are judged one by one by `evaluateAiBudget`, so the first call
 * that genuinely crosses the limit is refused and the run pauses there instead of here. Starting a step
 * was never what spent the money - the pre-emptive stop is what a tier is allowed to give up, and only
 * this one does.
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
    strategy: input.settings.strategy,
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
  const blocking = input.settings.policy === "block";
  const strategyLines = aiBudgetStrategyLines[input.settings.strategy];
  if (remaining !== null && remaining <= 0) {
    // CI-P7-03-C1. The tier that declines the step's pre-emptive stop lets the step start even with nothing
    // left. The money is not spent here: the calls inside are still judged one by one by `evaluateAiBudget`,
    // and the first one that genuinely crosses the limit is refused and pauses the run there - so what this
    // gives up is the early stop, never the ceiling.
    //
    // The decline sits *inside* this branch on purpose. It is a statement about the stop that would have
    // happened here, so a period with headroom left must not produce it: a verdict claiming a decline on a
    // healthy month would name an event nobody observed. `warn` never stopped a step and is untouched;
    // `cost-saving` and `balanced` keep the stop.
    if (blocking && !strategyLines.stepStopsAtZero) {
      return verdict("allowed", ["step-line-declined-by-strategy"]);
    }
    return verdict(blocking ? "blocked" : "allowed", [blocking ? "over-limit" : "over-limit-warning"]);
  }
  // CI-P7-03-C1: the tier's own headroom line, drawn above the limit's edge, so that what is left is kept
  // for smaller work instead of being spent on one last step. Kept *after* the stop at zero on purpose: an
  // exhausted period is exhausted whatever tier is set, and reporting it as a strategy line would name the
  // wrong event.
  if (blocking && strategyLines.stepShare !== null && remaining !== null && remaining <= limit * strategyLines.stepShare) {
    return verdict("blocked", ["cost-saving-remaining-line"]);
  }
  // The same 80% line the per-call decision uses, read from the other side: a fifth of the limit left.
  if (remaining !== null && remaining <= limit * 0.2) return verdict("allowed", ["near-limit"]);
  return verdict("allowed", ["within-limit"]);
}
