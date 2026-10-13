import { classifyCallRetry, indexLedgerCalls, summarizeLedgerCurrencies } from "@/lib/ai-usage-ledger";
import { readPlatformContentVersions } from "@/lib/platform-content";
import {
  roundAmount,
  type AiBudgetPolicy,
  type AiBudgetSettings,
  type AiBudgetSpend,
  type AiBudgetStrategy,
  type AiBudgetStrategyLines,
} from "@/lib/ai-budget";
import {
  aiUsageOutcomes,
  type AiUsageLedgerCurrencyTotal,
  type AiUsageLedgerEntry,
  type AiUsageOutcome,
  type ContentStatus,
  type UsageRangeDays,
} from "@/lib/types";

/**
 * 质量与成本优化 (CI-P7-04) - the arithmetic behind the 质量与优化 tab.
 *
 * The card asks for four quality signals (`P7-04-01`), the cost of one *qualified* output
 * (`P7-04-02`) and suggestions a user has to confirm before anything changes (`P7-04-03`). Everything
 * here is pure and reads only what the workspace already stores, because the one thing this surface
 * may never do is answer a quality question with an invention (dev-list `P8-05`, `A7`):
 *
 *  - **A request that returned successfully is not a quality judgement.** The only quality-adjacent
 *    facts this install records are request-level (did the call need a retry, did it succeed at all)
 *    and adoption-level (did the content reach `posted`, did a human rewrite a platform rendition).
 *    Each is named for what it measures (`singleRequestSuccesses`, `adopted`, `editedVersions`) and no
 *    figure is called "质量达标率" - nothing here scored a piece of content.
 *  - **A metric with no denominator is `null`, never `0`.** A window with no output has no cost per
 *    output; a window with no call has no pass rate. The page prints 无法计量 for those, which is a
 *    different statement from "it was zero".
 *  - **A metric nobody recorded says so.** `人工修改幅度` (how *much* text a human changed) is not
 *    stored anywhere: a platform rendition keeps that it *was* edited (`source: "edited"`) and when,
 *    not a before/after text. So the summary carries `magnitudeRecorded: false` instead of a number.
 *  - **A suggestion is a reading of the figures, not a promise.** Each one carries the basis it rests
 *    on, and only the ones whose action already exists in the product (the budget's own strategy
 *    tiers, or a page that holds the missing input) can be applied at all. No percentage of savings is
 *    ever claimed: the effect text describes what the tier's own stop lines do, which is a fact about
 *    the code rather than a forecast about the bill.
 */


/**
 * How many ledger rows one window reads. The same ceiling the overview and the budget use, kept here
 * so the quality tab cannot quietly read more than the tab beside it - and reported, not hidden, when
 * it is hit (`AiQualityPayload.truncated`).
 */
export const qualityLedgerReadLimit = 5000;

/** How many adopted outputs one window's cost may be attributed to before the list is cut short. */
export const qualityAdoptedOutputLimit = 5000;

/** A share without a denominator is `null`, never `0`: nothing was measured, so nothing was zero. */
function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function zeroedOutcomes(): Record<AiUsageOutcome, number> {
  return aiUsageOutcomes.reduce(
    (counts, outcome) => ({ ...counts, [outcome]: 0 }),
    {} as Record<AiUsageOutcome, number>,
  );
}

// ---------------------------------------------------------------------------
// 首轮通过率与重试 (CI-P7-04-01)
// ---------------------------------------------------------------------------

/**
 * The request-level reading of a window of ledger rows.
 *
 * Two pass rates travel together on purpose, and neither one is called "质量":
 *
 *  - `singleRequestSuccessRate` - the call sent **one** request and it succeeded. This is the closest
 *    thing to "首轮通过" this install can measure: no retry was needed.
 *  - `firstRequestSuccessRate` - the call's **first** request succeeded, whether or not a later one
 *    followed. It is the larger number, and the gap between the two is exactly the self-corrections
 *    (`classifyCallRetry` calls a retry after a *successful* predecessor `self-correction`, and this
 *    install records no reason for it, so neither rate may be read as a content verdict).
 *
 * Calls are grouped the way the 调用明细 tab groups them (`indexLedgerCalls`, by `parentUsageId`), so
 * the two surfaces cannot disagree about what one call is. A retry whose predecessor is outside the
 * window is counted as `unresolvedPredecessorRequests` instead of being guessed at, and a call split
 * by the window's edge is counted on both sides - both are facts the page has to be able to state.
 */
export interface QualityCallSummary {
  /** Calls whose requests the window covers. */
  calls: number;
  /** Ledger rows: one per request the runtime actually sent, retries included. */
  requests: number;
  /** Requests that were not the first one of their call (`attemptIndex > 0`). */
  retries: number;
  /** `retries / requests`, or `null` when the window sent nothing. */
  retryShare: number | null;
  /**
   * Average requests per call - the "平均重试次数" the card names, said as what it is. `null` when the
   * window has no call.
   */
  requestsPerCall: number | null;
  /**
   * Calls that sent one request, it was the call's **first** request (`attemptIndex === 0`), and it
   * succeeded. A lone retry whose first request is outside the window is not counted here: nothing about
   * its start was read, so it can neither pass nor be held against the rate.
   */
  singleRequestSuccesses: number;
  singleRequestSuccessRate: number | null;
  /** Calls whose first request was read and succeeded, whether or not a later one followed. */
  firstRequestSuccesses: number;
  firstRequestSuccessRate: number | null;
  /** Calls in which no request succeeded at all. */
  failedCalls: number;
  attemptsByOutcome: Record<AiUsageOutcome, number>;
  /** Retries whose predecessor row is outside this window: their kind is deliberately not classified. */
  unresolvedPredecessorRequests: number;
}

export function summarizeCallQuality(entries: AiUsageLedgerEntry[]): QualityCallSummary {
  const { byRoot } = indexLedgerCalls(entries);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const attemptsByOutcome = zeroedOutcomes();

  let calls = 0;
  let singleRequestSuccesses = 0;
  let firstRequestSuccesses = 0;
  let failedCalls = 0;

  for (const rows of byRoot.values()) {
    calls += 1;
    const ordered = [...rows].sort(
      (left, right) =>
        left.attemptIndex - right.attemptIndex ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id),
    );
    const first = ordered[0];
    // `attemptIndex === 0` is required, not assumed: a call whose *first* request is outside the window
    // shows up here as a group whose lowest row is already a retry, and neither pass rate may claim it.
    // Such a call is still counted in `calls`, so the two rates are conservative rather than generous.
    const firstRequestRead = first.attemptIndex === 0;
    if (firstRequestRead && first.outcome === "success") firstRequestSuccesses += 1;
    if (firstRequestRead && ordered.length === 1 && first.outcome === "success") singleRequestSuccesses += 1;
    if (!ordered.some((row) => row.outcome === "success")) failedCalls += 1;
  }

  let requests = 0;
  let retries = 0;
  let unresolvedPredecessorRequests = 0;
  for (const entry of entries) {
    requests += 1;
    attemptsByOutcome[entry.outcome] += 1;
    if (entry.attemptIndex > 0) retries += 1;
    // The classification is asked for, not re-derived: `unresolved-predecessor` is the module's own
    // way of saying "a predecessor was recorded but is not among the rows read".
    const parent = entry.parentUsageId ? byId.get(entry.parentUsageId) ?? null : null;
    if (classifyCallRetry(entry, parent).kind === "unresolved-predecessor") unresolvedPredecessorRequests += 1;
  }

  return {
    calls,
    requests,
    retries,
    retryShare: ratio(retries, requests),
    requestsPerCall: ratio(requests, calls),
    singleRequestSuccesses,
    singleRequestSuccessRate: ratio(singleRequestSuccesses, calls),
    firstRequestSuccesses,
    firstRequestSuccessRate: ratio(firstRequestSuccesses, calls),
    failedCalls,
    attemptsByOutcome,
    unresolvedPredecessorRequests,
  };
}

// ---------------------------------------------------------------------------
// 人工修改 (CI-P7-04-01)
// ---------------------------------------------------------------------------

/**
 * What this workspace actually records about human editing.
 *
 * The signal is the per-platform rendition (`content_items.metadata_json.platformVersions`): a version
 * written by the adapter is `derived`, one the author wrote or rewrote is `edited`, and the write
 * stamps the version's own `updatedAt` (`PATCH /api/content/[id]/platform-versions`). So the recorded
 * half of the card's 「人工修改幅度」 is *how many renditions a human rewrote, and when*.
 *
 * The magnitude half is **not recorded** - a version keeps no pre-edit text, and the item's own
 * `updatedAt` is bumped by every metadata write (adapters, images, status flips), so no character
 * delta can be read out of it. `magnitudeRecorded: false` says that in the type, so a page cannot draw
 * a number where the workspace has none, and the reason is printed on screen rather than hidden here.
 */
export interface QualityHumanEditSummary {
  /** Platform renditions whose own `updatedAt` falls inside the window. */
  versions: number;
  /** Of those, the ones the adapter produced (`source: "derived"`, never hand-written). */
  derivedVersions: number;
  /** Of those, the ones a human wrote or rewrote (`source: "edited"`). */
  editedVersions: number;
  /** `editedVersions / versions`, or `null` when the window saw no rendition at all. */
  editRate: number | null;
  /** Entries stored under `platformVersions` this build could not read - counted, never dropped quietly. */
  unreadableVersions: number;
  /** Always `false`: see the type's own note. A number here would be a magnitude nobody stored. */
  magnitudeRecorded: false;
  /** True when the item scan hit its row ceiling, so the counts above are floors. */
  truncated: boolean;
}

export function summarizeHumanEdits(
  items: Array<{ metadata: Record<string, unknown> }>,
  window: { from: number; to: number },
  options: { truncated?: boolean } = {},
): QualityHumanEditSummary {
  let versions = 0;
  let derivedVersions = 0;
  let editedVersions = 0;
  let unreadableVersions = 0;

  for (const item of items) {
    const stored = readPlatformContentVersions(item.metadata);
    unreadableVersions += stored.unreadable;
    for (const version of stored.versions) {
      if (version.updatedAt < window.from || version.updatedAt > window.to) continue;
      versions += 1;
      if (version.source === "edited") editedVersions += 1;
      else derivedVersions += 1;
    }
  }

  return {
    versions,
    derivedVersions,
    editedVersions,
    editRate: ratio(editedVersions, versions),
    unreadableVersions,
    magnitudeRecorded: false,
    truncated: options.truncated ?? false,
  };
}

// ---------------------------------------------------------------------------
// 内容采用 (CI-P7-04-01)
// ---------------------------------------------------------------------------

/**
 * Content items created inside the window, by the status vocabulary `content_items.status` already
 * has (`draft` / `ready` / `posted` / `failed`).
 *
 * `adopted` is `byStatus.posted` - the one state that means the item was actually published
 * (`content-lifecycle` maps it to its `published` stage, and `publish/verify` is what writes it). A
 * plan, a rendition and a publish attempt are none of those things, so they are not counted here.
 */
export interface QualityContentSummary {
  /** Content items created inside the window, whatever became of them. */
  created: number;
  byStatus: Record<ContentStatus, number>;
  /** The created items that reached `posted` - the adopted, i.e. used, outputs. */
  adopted: number;
  /** `adopted / created`, or `null` when the window produced no content at all. */
  adoptionRate: number | null;
}

export function summarizeContentAdoption(
  byStatus: Record<ContentStatus, number>,
): QualityContentSummary {
  const created = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
  const adopted = byStatus.posted;
  return { created, byStatus, adopted, adoptionRate: ratio(adopted, created) };
}

// ---------------------------------------------------------------------------
// 单位合格产出的成本 (CI-P7-04-02)
// ---------------------------------------------------------------------------

/**
 * One currency's side of the optimisation objective: what the adopted outputs cost.
 *
 * Two amounts travel together because they answer two different questions, and a page that showed only
 * one of them would be lying by omission:
 *
 *  - `windowAmount` - **every** stated amount in the window, whatever purpose produced it. This is the
 *    bill the user actually paid in the window, and it covers calls that belong to no output at all
 *    (chat, research fetches, image probes).
 *  - `attributedAmount` - the stated amounts on rows that name one of the window's **adopted** outputs
 *    (`ai_usage_ledger.content_item_id`). This is the numerator of 单位合格产出的成本, and it is smaller
 *    than the window's bill for a reason the page states: it is a *sum over the calls that named this
 *    output*, not a share of the bill allocated by any rule nobody wrote down.
 *
 * `costPerOutput` is `attributedAmount / adoptedOutputs`, or `null` when the window adopted nothing -
 * a window with no qualified output has no unit cost, and `0` there would read as "free".
 */
export interface QualityOutputCost {
  currency: string;
  windowAmount: number;
  attributedAmount: number;
  /** `null` when no output was adopted. A floor when `QualityObjective.costIsComplete` is false. */
  costPerOutput: number | null;
}

export interface QualityObjective {
  /** The adopted outputs the unit cost divides by (`content_items.status = 'posted'`, created here). */
  adoptedOutputs: number;
  /** How many of them the attribution could actually read (`qualityAdoptedOutputLimit` bounds it). */
  attributedOutputs: number;
  /** True when the adopted-output list was cut short, so `attributedAmount` is a floor. */
  attributionPartial: boolean;
  /** Ledger tokens of the whole window, retries included - the second half of the cost story. */
  totalTokens: number;
  /** `totalTokens / adoptedOutputs`, or `null` when nothing was adopted. */
  tokensPerOutput: number | null;
  /** Per currency, ordered by the window's own amount, largest first. */
  byCurrency: QualityOutputCost[];
  /** The window's money that names no adopted output, per currency, so nothing is silently dropped. */
  unattributedByCurrency: AiUsageLedgerCurrencyTotal[];
  /** Every request in the window stated a figure - only then is `windowAmount` a total. */
  costIsComplete: boolean;
  unpricedRequests: number;
  unmeasuredRequests: number;
}

export function summarizeQualityObjective(input: {
  entries: AiUsageLedgerEntry[];
  /** The ids of the adopted outputs the attribution may use. */
  adoptedContentItemIds: Iterable<string>;
  /** How many adopted outputs the window had - the denominator, from the counted status, not this list. */
  adoptedOutputs: number;
  /** True when the ids list was cut short by its read limit. */
  attributionPartial?: boolean;
}): QualityObjective {
  const adopted = new Set(input.adoptedContentItemIds);
  const attributed: AiUsageLedgerEntry[] = [];
  const unattributed: AiUsageLedgerEntry[] = [];
  let totalTokens = 0;
  let unpricedRequests = 0;
  let unmeasuredRequests = 0;

  for (const entry of input.entries) {
    totalTokens += entry.tokens.totalTokens;
    if (entry.costAmount === null) {
      if (entry.costSource === "unpriced") unpricedRequests += 1;
      else unmeasuredRequests += 1;
    }
    // An empty id is not an output: "we could not attribute this call" stays unattributed rather than
    // being joined to a group of unnamed rows that would read like an output.
    if (entry.contentItemId && adopted.has(entry.contentItemId)) attributed.push(entry);
    else unattributed.push(entry);
  }

  const windowByCurrency = summarizeLedgerCurrencies(input.entries);
  const attributedByCurrency = new Map(
    summarizeLedgerCurrencies(attributed).map((total) => [total.currency, total] as const),
  );

  return {
    adoptedOutputs: input.adoptedOutputs,
    attributedOutputs: adopted.size,
    attributionPartial: input.attributionPartial ?? false,
    totalTokens,
    tokensPerOutput: input.adoptedOutputs > 0 ? totalTokens / input.adoptedOutputs : null,
    byCurrency: windowByCurrency.map((total) => {
      const attributedAmount = attributedByCurrency.get(total.currency)?.amount ?? 0;
      return {
        currency: total.currency,
        windowAmount: total.amount,
        attributedAmount,
        costPerOutput:
          input.adoptedOutputs > 0 ? roundAmount(attributedAmount / input.adoptedOutputs) : null,
      };
    }),
    unattributedByCurrency: summarizeLedgerCurrencies(unattributed),
    // The same rule the overview and the budget use: an empty window states nothing, so it cannot be
    // a "complete" figure either.
    costIsComplete: input.entries.length > 0 && unpricedRequests === 0 && unmeasuredRequests === 0,
    unpricedRequests,
    unmeasuredRequests,
  };
}

// ---------------------------------------------------------------------------
// 优化建议 (CI-P7-04-03)
// ---------------------------------------------------------------------------

/**
 * This page's advisory line for "spending is close to the ceiling", as a share of the limit.
 *
 * Deliberately its **own** constant and not `aiBudgetCostSavingCallShare`: that one is the share of the
 * limit one *call* may not exceed under the `cost-saving` tier. This one only decides when the page
 * raises the subject - it changes no verdict, and a user who ignores it loses nothing.
 */
export const qualitySuggestionSpendShare = 0.8;

/** Below this share of created content being adopted, the page raises adoption as a subject. */
export const qualitySuggestionAdoptionShare = 0.5;

export const qualitySuggestionIds = [
  "switch-to-cost-saving",
  "record-prices",
  "enable-budget",
  "investigate-failed-calls",
  "review-adoption",
] as const;

export type QualitySuggestionId = (typeof qualitySuggestionIds)[number];

/**
 * What applying a suggestion does. Only one kind writes anything: `strategy` sets the budget's own
 * execution tier through the settings the budget tab already owns. `link` sends the user to a page that
 * holds an input this endpoint cannot invent (a real price, a real ceiling), and `none` is a hint whose
 * only effect is that the user read it - the honest answer for "this is not a knob we have".
 */
export type QualitySuggestionAction =
  | { kind: "strategy"; strategy: AiBudgetStrategy }
  | { kind: "link"; target: "price-catalog" | "budget-tab" }
  | { kind: "none" };

/**
 * One suggestion, with the figures it rests on attached as a union rather than as a bag of optional
 * fields: a page that drew a suggestion has the basis for *that* suggestion in hand, so it cannot
 * print a rule's title beside another rule's numbers. Each rule fires only on facts that were read,
 * and `[]` (nothing to suggest) is a normal, expected answer.
 */
export type QualitySuggestion =
  | {
      id: "switch-to-cost-saving";
      action: { kind: "strategy"; strategy: "cost-saving" };
      basis: {
        currency: string;
        spentAmount: number;
        limitAmount: number;
        spentShare: number;
        strategy: AiBudgetStrategy;
      };
    }
  | {
      id: "record-prices";
      action: { kind: "link"; target: "price-catalog" };
      basis: { requests: number; unpricedRequests: number };
    }
  | {
      id: "enable-budget";
      action: { kind: "link"; target: "budget-tab" };
      basis: { currency: string; windowAmount: number; requests: number };
    }
  | {
      id: "investigate-failed-calls";
      action: { kind: "none" };
      basis: {
        calls: number;
        requests: number;
        retries: number;
        failedCalls: number;
        singleRequestSuccessRate: number | null;
      };
    }
  | {
      id: "review-adoption";
      action: { kind: "none" };
      basis: { created: number; adopted: number; adoptionRate: number };
    };

/** Everything the rules are allowed to read. All of it was measured; none of it is extrapolated. */
export interface QualitySuggestionInput {
  objective: QualityObjective;
  calls: QualityCallSummary;
  content: QualityContentSummary;
  budget: {
    policy: AiBudgetPolicy;
    strategy: AiBudgetStrategy;
    monthlyLimit: number | null;
    currency: string;
    spent: AiBudgetSpend;
  };
}

/**
 * The suggestions the figures support right now, most actionable first.
 *
 * The order is the promise: a suggestion whose action is a click-to-apply comes before the ones that
 * only name a page, and both come before the hints that have no action at all. Within one rule the
 * thresholds are the exported constants above, so a test can pin them rather than guess at them.
 *
 * Two rules deliberately do **not** fire:
 *
 *  - nothing is suggested from the unit cost alone. There is no baseline in this workspace to call a
 *    cost per output "high", and inventing one would be the fabricated optimisation the plan forbids.
 *  - `unmeasuredRequests` (a call that failed before usage was reported) never produces the
 *    price-catalog suggestion: nothing about a failed request is fixed by writing a price, so the rule
 *    reads `unpricedRequests` only.
 */
export function buildQualitySuggestions(input: QualitySuggestionInput): QualitySuggestion[] {
  const suggestions: QualitySuggestion[] = [];
  const { objective, calls, content, budget } = input;

  // 1. There is a ceiling, this period is most of the way to it, and the tier that keeps a line below it
  //    is not the one in force. The only rule with an action this endpoint can carry out by itself.
  const limitAmount = budget.monthlyLimit;
  if (budget.policy === "block" && limitAmount !== null && limitAmount > 0) {
    const spentShare = budget.spent.amount / limitAmount;
    if (spentShare >= qualitySuggestionSpendShare && budget.strategy !== "cost-saving") {
      suggestions.push({
        id: "switch-to-cost-saving",
        action: { kind: "strategy", strategy: "cost-saving" },
        basis: {
          currency: budget.currency,
          spentAmount: budget.spent.amount,
          limitAmount,
          spentShare,
          strategy: budget.strategy,
        },
      });
    }
  }

  // 2. Money the workspace can see but cannot state, because the catalog has no price for it.
  if (objective.unpricedRequests > 0) {
    suggestions.push({
      id: "record-prices",
      action: { kind: "link", target: "price-catalog" },
      basis: { requests: calls.requests, unpricedRequests: objective.unpricedRequests },
    });
  }

  // 3. The window spent real money while the gate was off, so nothing was watching it.
  if (budget.policy === "off" && objective.byCurrency.length > 0) {
    const largest = objective.byCurrency[0];
    suggestions.push({
      id: "enable-budget",
      action: { kind: "link", target: "budget-tab" },
      basis: { currency: largest.currency, windowAmount: largest.windowAmount, requests: calls.requests },
    });
  }

  // 4. Calls that did not succeed, or that needed more than one request. No tier changes this - the
  //    three tiers differ in where they *stop*, not in how a request is retried - so the hint says so
  //    instead of pointing at a knob that would not move the number.
  if (calls.failedCalls > 0 || calls.retries > 0) {
    suggestions.push({
      id: "investigate-failed-calls",
      action: { kind: "none" },
      basis: {
        calls: calls.calls,
        requests: calls.requests,
        retries: calls.retries,
        failedCalls: calls.failedCalls,
        singleRequestSuccessRate: calls.singleRequestSuccessRate,
      },
    });
  }

  // 5. The window produced content and most of it was never published - a quality question the cost
  //    figures cannot answer, raised without pretending to score anything.
  if (content.adoptionRate !== null && content.adoptionRate < qualitySuggestionAdoptionShare) {
    suggestions.push({
      id: "review-adoption",
      action: { kind: "none" },
      basis: {
        created: content.created,
        adopted: content.adopted,
        adoptionRate: content.adoptionRate,
      },
    });
  }

  return suggestions;
}

/** What a successful apply did, so the page never has to guess what it just wrote. */
export interface AiQualityApplied {
  suggestionId: QualitySuggestionId;
  /** The tier in force before the write. */
  from: AiBudgetStrategy;
  /** The tier in force after it. */
  to: AiBudgetStrategy;
  at: number;
}

/**
 * One window of the 质量与优化 tab, in one answer: the three signals that were measured, the objective
 * they feed, the suggestions the figures support, and the budget state those suggestions are read
 * against.
 *
 * `truncated` is about the ledger read (the window hit `qualityLedgerReadLimit`, so every count derived
 * from it is a floor). `applied` is present only on the answer to an apply, and it describes the write
 * - the metrics in that same answer are the ones measured *after* it.
 */
export interface AiQualityPayload {
  range: UsageRangeDays;
  from: number;
  to: number;
  truncated: boolean;
  calls: QualityCallSummary;
  content: QualityContentSummary;
  humanEdits: QualityHumanEditSummary;
  objective: QualityObjective;
  suggestions: QualitySuggestion[];
  budget: {
    settings: AiBudgetSettings;
    period: { key: string; start: number; end: number };
    spent: AiBudgetSpend;
    remaining: number | null;
    /** What each tier does at each boundary, from the server's own table - never re-worded by a page. */
    strategyLines: Record<AiBudgetStrategy, AiBudgetStrategyLines>;
  };
  applied?: AiQualityApplied;
}




