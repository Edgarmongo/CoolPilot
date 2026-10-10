import {
  type AiCostCenterCallFilters,
  type AiModelPrice,
  type AiModelPriceView,
  type AiUsageCallContentCost,
  type AiUsageCallGroupInfo,
  type AiUsageCallPredecessor,
  type AiUsageCallRetry,
  type AiUsageCallRetryChange,
  type AiUsageCompleteness,
  type AiUsageCostSource,
  type AiUsageLedgerCostSourceCount,
  type AiUsageLedgerCurrencyTotal,
  type AiUsageLedgerDayPoint,
  type AiUsageLedgerEntry,
  type AiUsageLedgerGroup,
  type AiUsageLedgerSummary,
  type AiUsageLedgerTotals,
  type AiUsageMeteredKind,
  type AiUsageOutcome,
  type AiUsagePricingBasis,
  type AiUsageTokens,
} from "@/lib/types";
import { aiUsageCostSources, aiUsageKindIsTokenMetered } from "@/lib/types";

/**
 * The AI usage ledger's arithmetic, with no database and no runtime attached (CI-P7-01).
 *
 * Everything that decides *what a number means* lives here, so it can be asserted directly:
 * when a cost may be stated at all, when `0` would be a lie, and how a total that covers only
 * part of its window is reported. The writers (`@/lib/ai-usage-ledger-recorder`) and the readers
 * (`@/db/repository`) both go through these functions instead of re-deciding.
 */

/** Money is kept to 6 decimals: a fraction of a cent survives, float noise does not. */
const moneyDecimals = 6;

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** The zero row. A fresh attempt that measured nothing looks exactly like this. */
export function emptyAiUsageTokens(): AiUsageTokens {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 };
}

/** Whatever subset a provider reported, normalized into the ledger's fixed shape. */
export function normalizeUsageTokens(
  usage: Partial<AiUsageTokens> | undefined | null,
): AiUsageTokens {
  const inputTokens = Math.max(0, Math.round(usage?.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.round(usage?.outputTokens ?? 0));
  return {
    inputTokens,
    outputTokens,
    // The provider's own total wins when it gave one; only a provider that omitted it gets our sum.
    totalTokens: Math.max(0, Math.round(usage?.totalTokens ?? inputTokens + outputTokens)),
    cachedInputTokens: Math.max(0, Math.round(usage?.cachedInputTokens ?? 0)),
    reasoningTokens: Math.max(0, Math.round(usage?.reasoningTokens ?? 0)),
  };
}

/**
 * What share of the real usage this row saw.
 *
 * `undefined` usage is the provider saying nothing at all, and is stored as `unknown` rather than
 * as zeros: "we were not told" and "it used nothing" are different facts, and only one of them is
 * safe to add up.
 */
export function usageCompleteness(
  outcome: AiUsageOutcome,
  usage: Partial<AiUsageTokens> | undefined | null,
): AiUsageCompleteness {
  if (outcome === "interrupted") return "partial";
  if (outcome !== "success") return "unknown";
  return usage ? "reported" : "unknown";
}

/**
 * Marks which of these catalog rows is the one in force at `at`, per provider+model+dimension.
 *
 * The mark is decided here, on the server, rather than in the page: the recorder is the side that
 * picks a price, so "in force" has to mean the same instant it would ask about - not whatever clock
 * the browser running the page happens to have. A row that takes effect later is reported as *not*
 * in force rather than hidden, because a scheduled price change is worth seeing.
 */
export function markInForceModelPrices(prices: AiModelPrice[], at: number): AiModelPriceView[] {
  const newest = new Map<string, AiModelPrice>();
  for (const price of prices) {
    if (price.effectiveFrom > at) continue;
    const key = `${price.providerId}::${price.modelId}::${price.meteredKind}`;
    const current = newest.get(key);
    if (!current || price.effectiveFrom > current.effectiveFrom) newest.set(key, price);
  }
  const inForce = new Set([...newest.values()].map((price) => price.id));
  return prices.map((price) => ({ ...price, inForce: inForce.has(price.id) }));
}

/** A catalog row as it will be frozen onto a ledger row. */
export function pricingBasisFromRow(row: AiModelPrice): AiUsagePricingBasis {
  return {
    // The dimension travels with the price: a frozen snapshot that could not say what it priced
    // would make "why was this an image price" unanswerable from the ledger alone.
    meteredKind: row.meteredKind,
    currency: row.currency,
    inputPerMillion: row.inputPerMillion,
    outputPerMillion: row.outputPerMillion,
    ...(row.cachedInputPerMillion === undefined ? {} : { cachedInputPerMillion: row.cachedInputPerMillion }),
    ...(row.unitPrice === undefined ? {} : { unitPrice: row.unitPrice }),
    ...(row.unitLabel ? { unitLabel: row.unitLabel } : {}),
    priceVersion: row.priceVersion,
    source: row.source,
  };
}

/** True only for the two sources that name a real figure. `unpriced` and `unknown` are not money. */
export function aiUsageCostSourceIsReal(source: AiUsageCostSource) {
  return source === "computed" || source === "provider-reported";
}

export interface AiUsageCost {
  /** `null` whenever no figure can be claimed - never `0` standing in for "not known". */
  costAmount: number | null;
  costCurrency: string;
  costSource: AiUsageCostSource;
}

/** What a call was metered in, which a price has to agree with before it can cost anything. */
export interface AiUsageMetering {
  kind: AiUsageMeteredKind;
  /** The units the call used, in the shape the recorder stores them (`quantityJson`). */
  quantity?: Record<string, unknown> | null;
}

/** A row that may not state a cost. */
function noCost(source: AiUsageCostSource): AiUsageCost {
  return { costAmount: null, costCurrency: "", costSource: source };
}

/**
 * The money a call costs under one price snapshot and one metering dimension (CI-P7-01-05).
 *
 * Four different "no" answers, kept apart on purpose:
 * - nothing was measured (a failure, or a provider that reported no usage) -> `unknown`, null;
 * - usage is known but no price is on file for this provider+model+dimension -> `unpriced`, null;
 * - a price exists but the amount it would multiply was not measured -> `unknown`, null;
 * - otherwise the rates are applied -> `computed`, a number (which may legitimately be 0).
 *
 * The dimension is matched, not assumed: a price written for tokens may not cost an image, and a
 * per-image price may not cost tokens. That gate is what keeps a provider that happens to report
 * token usage for an image from being charged a text rate - a wrong number is worse than a blank,
 * because a blank says "we cannot state it" while a wrong number claims to know.
 *
 * Token rows are billed at the cached rate when the snapshot names one, and the remainder of the
 * input at the normal rate. That assumes `inputTokens` counts cached tokens as well - the
 * OpenAI-compatible convention - which is stated here because it is an assumption, not a fact
 * every provider guarantees.
 */
export function computeUsageCost(
  tokens: AiUsageTokens,
  completeness: AiUsageCompleteness,
  pricing: AiUsagePricingBasis | null,
  metering: AiUsageMetering,
): AiUsageCost {
  if (completeness !== "reported") return noCost("unknown");
  if (!pricing) return noCost("unpriced");
  // The catalog answered with a price for something else: for this call, that is "no price on file".
  if (pricing.meteredKind !== metering.kind) return noCost("unpriced");

  if (aiUsageKindIsTokenMetered(metering.kind)) {
    const cachedRate = pricing.cachedInputPerMillion;
    const cachedTokens = cachedRate === undefined ? 0 : Math.min(tokens.cachedInputTokens, tokens.inputTokens);
    const uncachedInput = Math.max(0, tokens.inputTokens - cachedTokens);

    const amount =
      (uncachedInput / 1_000_000) * pricing.inputPerMillion +
      (tokens.outputTokens / 1_000_000) * pricing.outputPerMillion +
      (cachedTokens / 1_000_000) * (cachedRate ?? 0);

    return {
      costAmount: roundTo(amount, moneyDecimals),
      costCurrency: pricing.currency,
      costSource: "computed",
    };
  }

  // A non-token kind: what the call used x the price per unit it used. A row that names no unit, or
  // no rate for that unit, can multiply nothing.
  const unitLabel = pricing.unitLabel;
  const unitPrice = pricing.unitPrice;
  if (!unitLabel || unitPrice === undefined) return noCost("unpriced");

  const quantity = metering.quantity?.[unitLabel];
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) {
    // The rate is known but the amount it applies to was not measured. That is a blank about the
    // *usage*, which is a different statement from "no price on file".
    return noCost("unknown");
  }

  return {
    costAmount: roundTo(quantity * unitPrice, moneyDecimals),
    costCurrency: pricing.currency,
    costSource: "computed",
  };
}

function emptyTotals(): AiUsageLedgerTotals {
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    interrupted: 0,
    retries: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    durationMs: 0,
    costAmount: 0,
    unpricedAttempts: 0,
    unmeasuredAttempts: 0,
    costIsComplete: false,
  };
}

function groupKey(entry: AiUsageLedgerEntry) {
  return `${entry.providerId}::${entry.modelId}`;
}

function buildGroups(
  entries: AiUsageLedgerEntry[],
  keyOf: (entry: AiUsageLedgerEntry) => string,
  labelOf: (entry: AiUsageLedgerEntry) => string,
): AiUsageLedgerGroup[] {
  const groups = new Map<string, AiUsageLedgerGroup>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const group = groups.get(key) ?? { key, label: labelOf(entry), attempts: 0, totalTokens: 0, costAmount: 0, hasUnpricedAttempts: false };
    group.attempts += 1;
    group.totalTokens += entry.tokens.totalTokens;
    if (entry.costAmount === null) group.hasUnpricedAttempts = true;
    else group.costAmount = roundTo(group.costAmount + entry.costAmount, moneyDecimals);
    groups.set(key, group);
  }
  // A group that cannot state its cost sorts by how much traffic it saw, not by a total it does not have.
  return Array.from(groups.values()).sort(
    (a, b) => b.costAmount - a.costAmount || b.attempts - a.attempts || a.label.localeCompare(b.label),
  );
}

/**
 * Local start-of-day of an instant, the same calendar rule `usageRangeStart` gives a window.
 *
 * It is deliberately the *local* calendar and not UTC: "yesterday's spending" has to mean the
 * yesterday the user is living in, and the 用量统计 window this page sits next to is built the same
 * way. A UTC bucket would put an evening call in tomorrow.
 */
function dayStartOf(at: number) {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Attempts per `cost_source` (CI-P7-02).
 *
 * Every source is listed even at zero, in the vocabulary's own order, because the statement a page
 * has to be able to make is exactly the one a total cannot make: "none of this window's money came
 * from the vendor's own charge". `costAmount` stays `null` for a source that stated nothing - a 0
 * there would read as "these calls were free".
 */
export function summarizeLedgerCostSources(entries: AiUsageLedgerEntry[]): AiUsageLedgerCostSourceCount[] {
  return aiUsageCostSources.map((source) => {
    const rows = entries.filter((entry) => entry.costSource === source);
    const stated = rows.filter((entry) => entry.costAmount !== null);
    return {
      source,
      attempts: rows.length,
      costAmount: stated.length
        ? roundTo(stated.reduce((sum, entry) => sum + (entry.costAmount ?? 0), 0), moneyDecimals)
        : null,
    };
  });
}

/**
 * Money per currency (CI-P7-02).
 *
 * Rows in two currencies are never added together: there is no rate in this database to convert
 * with, so one number across a CNY row and a USD row would be a figure in no currency at all.
 * Sorted by amount, so the currency the user actually spends in is read first.
 */
export function summarizeLedgerCurrencies(entries: AiUsageLedgerEntry[]): AiUsageLedgerCurrencyTotal[] {
  const byCurrency = new Map<string, AiUsageLedgerCurrencyTotal>();
  for (const entry of entries) {
    if (entry.costAmount === null) continue;
    const currency = entry.costCurrency;
    const total = byCurrency.get(currency) ?? { currency, amount: 0, attempts: 0 };
    total.amount = roundTo(total.amount + entry.costAmount, moneyDecimals);
    total.attempts += 1;
    byCurrency.set(currency, total);
  }
  return Array.from(byCurrency.values()).sort(
    (a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency),
  );
}

/**
 * One point per local day that saw activity, oldest first (CI-P7-02).
 *
 * A day keeps its unstated calls next to its stated ones, so a day full of unpriced traffic cannot
 * be drawn as a cheap day.
 */
export function summarizeLedgerDays(entries: AiUsageLedgerEntry[]): AiUsageLedgerDayPoint[] {
  const byDay = new Map<number, AiUsageLedgerDayPoint>();
  for (const entry of entries) {
    const dayStart = dayStartOf(entry.createdAt);
    const point =
      byDay.get(dayStart) ?? { dayStart, attempts: 0, totalTokens: 0, costAmount: 0, unpricedAttempts: 0 };
    point.attempts += 1;
    point.totalTokens += entry.tokens.totalTokens;
    if (entry.costAmount === null) point.unpricedAttempts += 1;
    else point.costAmount = roundTo(point.costAmount + entry.costAmount, moneyDecimals);
    byDay.set(dayStart, point);
  }
  return Array.from(byDay.values()).sort((a, b) => a.dayStart - b.dayStart);
}

/**
 * One window of ledger rows, added up.
 *
 * `costAmount` deliberately sums only the rows that name a figure. The rows that could not are
 * counted in `unpricedAttempts` / `unmeasuredAttempts` and flip `costIsComplete` to false, so a
 * reader can tell "this is the whole bill" from "this is the part of the bill we can state".
 */
export function summarizeAiUsageLedger(
  entries: AiUsageLedgerEntry[],
  window: { from: number; to: number },
): AiUsageLedgerSummary {
  const inWindow = entries.filter((entry) => entry.createdAt >= window.from && entry.createdAt <= window.to);
  const totals = emptyTotals();

  for (const entry of inWindow) {
    totals.attempts += 1;
    if (entry.outcome === "success") totals.successes += 1;
    else if (entry.outcome === "interrupted") totals.interrupted += 1;
    else totals.failures += 1;
    if (entry.attemptIndex > 0) totals.retries += 1;
    totals.inputTokens += entry.tokens.inputTokens;
    totals.outputTokens += entry.tokens.outputTokens;
    totals.totalTokens += entry.tokens.totalTokens;
    totals.durationMs += entry.durationMs;
    if (entry.costAmount === null) {
      if (entry.costSource === "unpriced") totals.unpricedAttempts += 1;
      else totals.unmeasuredAttempts += 1;
    } else {
      totals.costAmount = roundTo(totals.costAmount + entry.costAmount, moneyDecimals);
    }
  }

  totals.costIsComplete =
    totals.attempts > 0 && totals.unpricedAttempts === 0 && totals.unmeasuredAttempts === 0;

  return {
    from: window.from,
    to: window.to,
    totals,
    byPurpose: buildGroups(inWindow, (entry) => entry.purpose, (entry) => entry.purpose),
    byModel: buildGroups(inWindow, groupKey, (entry) => entry.modelId || entry.providerId),
    // The three readings CI-P7-02 added: where the money came from, in which currency, and on which
    // day. Each is built from the same in-window rows as the totals, so no figure on the page can
    // describe a different set of calls than the headline does.
    byCostSource: summarizeLedgerCostSources(inWindow),
    costByCurrency: summarizeLedgerCurrencies(inWindow),
    byDay: summarizeLedgerDays(inWindow),
  };
}

/**
 * Which attempts a summary's headline money figure covers, for a caller that needs to say so out
 * loud. Returns `null` when the figure covers every attempt in the window.
 */
export function aiUsageLedgerCostCaveat(totals: AiUsageLedgerTotals) {
  if (totals.attempts === 0) return null;
  if (totals.costIsComplete) return null;
  return { unpricedAttempts: totals.unpricedAttempts, unmeasuredAttempts: totals.unmeasuredAttempts };
}

// ---------------------------------------------------------------------------
// 调用明细与追溯 (CI-P7-02-04 / CI-P7-02-05)
//
// The readers below turn a window of ledger rows into the 调用明细 view: one line per request, each
// line's position in its call, and what the retries actually did. They stay pure for the same reason
// the rest of this module does - the rules that matter here are rules about *evidence*:
//
//  - a retry is never classified from `attemptIndex`. The index says a request was not the first; it
//    cannot say why. The successor's predecessor row is read instead (`parentUsageId`), and when that
//    row is outside the scan the answer is `unresolved-predecessor` rather than a guess;
//  - a call's cost is the sum over its requests, retries included - a "winner only" figure would
//    under-report exactly the calls that cost the most;
//  - a row that named no content item is kept as its own unclassified group instead of being dropped.
// ---------------------------------------------------------------------------

/** The modality units a row recorded (`quantityJson`). Malformed JSON is `{}`, never an exception. */
export function parseLedgerQuantity(json: string): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * The attempts the 调用明细 filters accept.
 *
 * `taskId` matches either recorded field: the call sites that run inside a task store its id in
 * `taskId`, the ones that run inside an automation store the run's id in `runId`, and a reader
 * looking for "this task's calls" means both.
 */
export function selectLedgerAttempts(
  entries: AiUsageLedgerEntry[],
  filters: AiCostCenterCallFilters,
): AiUsageLedgerEntry[] {
  return entries.filter((entry) => {
    if (filters.purpose && entry.purpose !== filters.purpose) return false;
    if (filters.outcome && entry.outcome !== filters.outcome) return false;
    if (filters.costSource && entry.costSource !== filters.costSource) return false;
    if (filters.model && groupKey(entry) !== filters.model) return false;
    if (filters.contentItemId && entry.contentItemId !== filters.contentItemId) return false;
    if (filters.taskId && entry.taskId !== filters.taskId && entry.runId !== filters.taskId) return false;
    // "Not the first request of its call": the index is one signal and a recorded predecessor the
    // other, and a row is a retry when either says so.
    if (filters.retryOnly && entry.attemptIndex <= 0 && !entry.parentUsageId) return false;
    return true;
  });
}

/** Newest call first, and inside one call the requests read in the order they were sent. */
export function sortLedgerAttemptsForCallList(entries: AiUsageLedgerEntry[]): AiUsageLedgerEntry[] {
  return [...entries].sort(
    (left, right) =>
      right.createdAt - left.createdAt ||
      left.attemptIndex - right.attemptIndex ||
      left.id.localeCompare(right.id),
  );
}

export interface LedgerCallIndex {
  /** Every row's call root: the id of the first request of the call it belongs to. */
  rootOf: Map<string, string>;
  /** The rows of each call, lowest `attemptIndex` first. */
  byRoot: Map<string, AiUsageLedgerEntry[]>;
}

/**
 * Groups the scanned rows into the calls they belong to, by following `parentUsageId` backwards.
 *
 * Two breaks are deliberate. A predecessor that is not in the scanned rows ends the walk (the row
 * becomes its own root) - the page then says the predecessor is outside the window instead of
 * inventing a link. A cycle likewise ends the walk, so a corrupted chain cannot hang a request.
 */
export function indexLedgerCalls(entries: AiUsageLedgerEntry[]): LedgerCallIndex {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const rootOf = new Map<string, string>();

  for (const entry of entries) {
    const seen = new Set<string>([entry.id]);
    let current = entry;
    while (current.parentUsageId) {
      const parent = byId.get(current.parentUsageId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      current = parent;
    }
    rootOf.set(entry.id, current.id);
  }

  const byRoot = new Map<string, AiUsageLedgerEntry[]>();
  for (const entry of entries) {
    const root = rootOf.get(entry.id) ?? entry.id;
    const rows = byRoot.get(root) ?? [];
    rows.push(entry);
    byRoot.set(root, rows);
  }
  for (const rows of byRoot.values()) {
    rows.sort(
      (left, right) =>
        left.attemptIndex - right.attemptIndex ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id),
    );
  }

  return { rootOf, byRoot };
}

/**
 * What kind of retry a request was, read from the request it followed - never from its index.
 *
 * `self-correction` is the one case that can be stated positively: the predecessor *succeeded*, and
 * the call asked again anyway (a structured answer that failed its own schema). Every other retry
 * follows a predecessor that did not succeed, and the difference between "the key was rotated",
 * "the model was demoted" and "a transient error was retried" is not recorded anywhere - so the kind
 * stays `after-failed-request` and only the *facts that differ* between the two rows are reported.
 */
export function classifyCallRetry(
  entry: AiUsageLedgerEntry,
  parent: AiUsageLedgerEntry | null,
): AiUsageCallRetry {
  if (!entry.parentUsageId) {
    // Nothing was recorded to read. Only a request at index 0 can be called the first one; an index
    // above 0 with no predecessor is a chain nobody wrote, which is not a retry type either.
    return {
      kind: entry.attemptIndex === 0 ? "first-request" : "unresolved-predecessor",
      parentUsageId: "",
      parent: null,
      parentOutsideScan: false,
      changed: [],
    };
  }
  if (!parent) {
    // Recorded, but not among the rows this answer covers: saying "self-correction" or "after a
    // failure" here would be a claim about a row nobody read.
    return {
      kind: "unresolved-predecessor",
      parentUsageId: entry.parentUsageId,
      parent: null,
      parentOutsideScan: true,
      changed: [],
    };
  }

  const changed: AiUsageCallRetryChange[] = [];
  if (parent.providerId !== entry.providerId) changed.push("provider");
  if (parent.modelId !== entry.modelId) changed.push("model");
  if (parent.endpointId !== entry.endpointId) changed.push("endpoint");
  if (parent.credentialLabel !== entry.credentialLabel) changed.push("credential");

  const predecessor: AiUsageCallPredecessor = {
    id: parent.id,
    attemptIndex: parent.attemptIndex,
    outcome: parent.outcome,
    providerId: parent.providerId,
    modelId: parent.modelId,
    endpointId: parent.endpointId,
    credentialLabel: parent.credentialLabel,
  };

  return {
    kind: parent.outcome === "success" ? "self-correction" : "after-failed-request",
    parentUsageId: entry.parentUsageId,
    parent: predecessor,
    parentOutsideScan: false,
    changed,
  };
}

/**
 * One call's requests added up, for the line that says what the call really cost.
 *
 * The retried requests are included on purpose: a call that failed twice before it answered was
 * billed for all three, and a total that counted only the winner would hide exactly that.
 */
export function summarizeLedgerCallGroup(
  rows: AiUsageLedgerEntry[],
): Omit<AiUsageCallGroupInfo, "rootId" | "index"> {
  let failedRequests = 0;
  let unpricedAttempts = 0;
  let unmeasuredAttempts = 0;

  for (const row of rows) {
    if (row.outcome !== "success") failedRequests += 1;
    if (row.costAmount === null) {
      if (row.costSource === "unpriced") unpricedAttempts += 1;
      else unmeasuredAttempts += 1;
    }
  }

  return {
    attempts: rows.length,
    failedRequests,
    costByCurrency: summarizeLedgerCurrencies(rows),
    unpricedAttempts,
    unmeasuredAttempts,
    costIsComplete: rows.length > 0 && unpricedAttempts === 0 && unmeasuredAttempts === 0,
  };
}

/**
 * 单篇内容成本 (CI-P7-02-05): one group per content item the window's rows named.
 *
 * The rows that named none are kept together under an empty id: "we could not attribute this" is a
 * fact the page has to be able to show, and a list that quietly omitted those rows would make the
 * attributed amounts look like the whole bill. Groups are ordered by how much traffic they saw, and
 * the money inside a group is per currency for the same reason the headline is.
 */
export function summarizeLedgerByContent(
  entries: AiUsageLedgerEntry[],
): Array<Omit<AiUsageCallContentCost, "content">> {
  const groups = new Map<string, Omit<AiUsageCallContentCost, "content">>();
  const tasksByContent = new Map<string, Set<string>>();
  const nodesByContent = new Map<string, Set<string>>();

  for (const entry of entries) {
    const key = entry.contentItemId;
    const group =
      groups.get(key) ??
      ({
        contentItemId: key,
        attempts: 0,
        totalTokens: 0,
        costByCurrency: [],
        unpricedAttempts: 0,
        unmeasuredAttempts: 0,
        costIsComplete: false,
        taskIds: [],
        nodeIds: [],
      } satisfies Omit<AiUsageCallContentCost, "content">);

    group.attempts += 1;
    group.totalTokens += entry.tokens.totalTokens;
    if (entry.costAmount === null) {
      if (entry.costSource === "unpriced") group.unpricedAttempts += 1;
      else group.unmeasuredAttempts += 1;
    }
    groups.set(key, group);

    const taskIdentity = entry.taskId || entry.runId;
    if (taskIdentity) {
      const set = tasksByContent.get(key) ?? new Set<string>();
      set.add(taskIdentity);
      tasksByContent.set(key, set);
    }
    if (entry.nodeId) {
      const set = nodesByContent.get(key) ?? new Set<string>();
      set.add(entry.nodeId);
      nodesByContent.set(key, set);
    }
  }

  return Array.from(groups.entries())
    .map(([key, group]) => {
      const rows = entries.filter((entry) => entry.contentItemId === key);
      return {
        ...group,
        costByCurrency: summarizeLedgerCurrencies(rows),
        costIsComplete: group.unpricedAttempts === 0 && group.unmeasuredAttempts === 0,
        taskIds: Array.from(tasksByContent.get(key) ?? []).sort(),
        nodeIds: Array.from(nodesByContent.get(key) ?? []).sort(),
      };
    })
    .sort((left, right) => right.attempts - left.attempts || left.contentItemId.localeCompare(right.contentItemId));
}
