import { getContentItem } from "@/db/repository";
import { listAiUsageLedgerEntries } from "@/db/repositories/ai-usage-ledger";
import { failFromError, ok } from "@/lib/api";
import {
  classifyCallRetry,
  indexLedgerCalls,
  parseLedgerQuantity,
  selectLedgerAttempts,
  sortLedgerAttemptsForCallList,
  summarizeAiUsageLedger,
  summarizeLedgerByContent,
  summarizeLedgerCallGroup,
  summarizeLedgerCurrencies,
} from "@/lib/ai-usage-ledger";
import { findTaskView } from "@/lib/tasks/task-library";
import {
  aiUsageCostSources,
  aiUsageOutcomes,
  type AiCostCenterCallFilters,
  type AiCostCenterCallsPayload,
  type AiUsageCallContentCost,
  type AiUsageCallContentTrace,
  type AiUsageCallTaskRef,
  type AiUsageCallTaskTrace,
  type AiUsageCallTrace,
  type AiUsageCallView,
  type AiUsageCostSource,
  type AiUsageLedgerEntry,
  type AiUsageOutcome,
} from "@/lib/types";
import { normalizeUsageRange, usageRangeStart } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 调用明细与追溯 (CI-P7-02-04 / CI-P7-02-05), read-only.
 *
 * One line per request the runtime actually sent - failures and retries included, each on its own
 * row and never merged into the winning attempt - with the business identity the ledger recorded
 * resolved to real records where such records exist.
 *
 * The rules this route refuses to break, all of them inherited from the ledger's own discipline:
 *
 *  - **a retry is never classified from `attemptIndex`.** The predecessor row is read instead, and
 *    when it is outside the scanned window the answer is `unresolved-predecessor`;
 *  - **a call's cost includes its retries.** Group figures are computed from every attempt of the
 *    call inside the window, so a call that failed twice before answering cannot look cheap;
 *  - **a missing cost stays missing.** `costAmount` is copied as `null`, never as 0, and the counts
 *    of unpriced / unmeasured attempts travel with every total;
 *  - **nothing is invented to fill a chain.** A content item that no longer exists is reported as
 *    `found: false`, an id that resolves to no task yields `task: null`, and a row that named no
 *    content item is kept in the unclassified group rather than dropped;
 *  - **the read is bounded and says so.** The window scan, and the identity lookups it feeds, report
 *    their ceilings through `scan.truncated` / `scan.traceCapped`.
 *
 * Nothing here writes, and no response carries a prompt, a response body or a credential: rows only
 * have the masked key label the ledger already stores.
 */

/** The window read's ceiling, matching the repository's own maximum. */
const scanLimit = 5000;
/** How many distinct content items / tasks one answer is allowed to resolve. */
const traceLookupBudget = 60;
const defaultPageSize = 25;
const maxPageSize = 100;

const purposePattern = /^[A-Za-z0-9._:-]{1,64}$/;
const idPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const modelKeyPattern = /^[^:]{1,64}::[^:]{1,128}$/;

function readString(value: string | null, pattern: RegExp) {
  if (!value) return "";
  const trimmed = value.trim();
  return pattern.test(trimmed) ? trimmed : "";
}

function readOutcome(value: string | null): AiUsageOutcome | "" {
  const trimmed = (value ?? "").trim();
  return (aiUsageOutcomes as readonly string[]).includes(trimmed) ? (trimmed as AiUsageOutcome) : "";
}

function readCostSource(value: string | null): AiUsageCostSource | "" {
  const trimmed = (value ?? "").trim();
  return (aiUsageCostSources as readonly string[]).includes(trimmed) ? (trimmed as AiUsageCostSource) : "";
}

/** An unknown filter value is not an error to shout about: it is simply no filter. */
function readFilters(params: URLSearchParams): AiCostCenterCallFilters {
  return {
    purpose: readString(params.get("purpose"), purposePattern),
    outcome: readOutcome(params.get("outcome")),
    costSource: readCostSource(params.get("source")),
    model: readString(params.get("model"), modelKeyPattern),
    retryOnly: params.get("retry") === "1" || params.get("retry") === "true",
    contentItemId: readString(params.get("contentItemId"), idPattern),
    taskId: readString(params.get("taskId"), idPattern),
  };
}

function readCount(value: string | null, fallback: number, min: number, max: number) {
  // `Number(null)` is 0, so an absent parameter has to be caught before the conversion - otherwise a
  // plain `?range=7` would ask for a page of one instead of the default page.
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/**
 * The identity lookups share one budget, so a wide window cannot turn one page read into hundreds
 * of queries. An id that did not fit is left unresolved and the answer says so.
 */
class TraceReader {
  private readonly contentCache = new Map<string, AiUsageCallContentTrace | null>();
  private readonly taskCache = new Map<string, AiUsageCallTaskTrace | null>();
  capped = false;
  private contentLookups = 0;
  private taskLookups = 0;

  async content(id: string): Promise<AiUsageCallContentTrace | null> {
    if (!id) return null;
    const cached = this.contentCache.get(id);
    if (cached !== undefined) return cached;
    if (this.contentLookups >= traceLookupBudget) {
      this.capped = true;
      return null;
    }
    this.contentLookups += 1;
    const item = await getContentItem(id);
    // A content item deleted after the call is reported as missing, not as unnamed.
    const resolved: AiUsageCallContentTrace = item
      ? { id, title: item.title, status: item.status, found: true }
      : { id, title: "", status: "", found: false };
    this.contentCache.set(id, resolved);
    return resolved;
  }

  async task(id: string): Promise<AiUsageCallTaskTrace | null> {
    if (!id) return null;
    const cached = this.taskCache.get(id);
    if (cached !== undefined) return cached;
    if (this.taskLookups >= traceLookupBudget) {
      this.capped = true;
      return null;
    }
    this.taskLookups += 1;
    const view = await findTaskView(id);
    const resolved: AiUsageCallTaskTrace | null = view
      ? { id: view.id, kind: view.kind, type: view.type, status: view.status, rawStatus: view.rawStatus }
      : null;
    this.taskCache.set(id, resolved);
    return resolved;
  }
}

/** 内容 → 业务任务 → 执行节点 → 模型调用, with every hop either read or reported as missing. */
async function buildTrace(entry: AiUsageLedgerEntry, reader: TraceReader): Promise<AiUsageCallTrace> {
  const content = await reader.content(entry.contentItemId);
  // `taskId` is the task the call belonged to when the call site had one; `runId` is the automation
  // or agent run it was sent from. Whichever resolves first is named, so an empty `taskId` stays
  // visible instead of being papered over by the run id.
  let taskRef: AiUsageCallTaskRef | null = null;
  let task: AiUsageCallTaskTrace | null = null;
  if (entry.taskId) {
    task = await reader.task(entry.taskId);
    if (task) taskRef = "taskId";
  }
  if (!task && entry.runId) {
    task = await reader.task(entry.runId);
    if (task) taskRef = "runId";
  }

  return {
    contentItemId: entry.contentItemId,
    content,
    taskId: entry.taskId,
    runId: entry.runId,
    nodeId: entry.nodeId,
    outputAssetId: entry.outputAssetId,
    taskRef,
    task,
  };
}

/** The filter choices the window's rows actually offer, so a filter is never offered empty. */
function buildOptions(rows: AiUsageLedgerEntry[]) {
  const purposes = Array.from(new Set(rows.map((row) => row.purpose).filter(Boolean))).sort();
  const outcomes = aiUsageOutcomes.filter((outcome) => rows.some((row) => row.outcome === outcome));
  const costSources = aiUsageCostSources.filter((source) => rows.some((row) => row.costSource === source));
  const models = Array.from(new Set(rows.map((row) => `${row.providerId}::${row.modelId}`)))
    .map((key) => {
      const [providerId, modelId] = key.split("::");
      return { key, label: [providerId, modelId].filter(Boolean).join(" · ") };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
  return { purposes, outcomes, costSources, models };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const range = normalizeUsageRange(params.get("range") ?? undefined);
    const window = { from: usageRangeStart(range), to: Date.now() };
    const filters = readFilters(params);
    const limit = readCount(params.get("limit"), defaultPageSize, 1, maxPageSize);
    const offset = readCount(params.get("offset"), 0, 0, scanLimit);

    // The same window rule the overview and 用量统计 use (`usageRangeStart`), read once and reused, so
    // the three readings cannot describe different days.
    const scanned = await listAiUsageLedgerEntries({ from: window.from, limit: scanLimit });
    const inWindow = scanned.filter((entry) => entry.createdAt <= window.to);

    const reader = new TraceReader();
    const byContent: AiUsageCallContentCost[] = [];
    for (const group of summarizeLedgerByContent(inWindow)) {
      byContent.push({ ...group, content: await reader.content(group.contentItemId) });
    }

    const matched = selectLedgerAttempts(inWindow, filters);
    // The headline for a filtered view is the *matched* set's total, never the window's.
    const totals = summarizeAiUsageLedger(matched, window).totals;
    const ordered = sortLedgerAttemptsForCallList(matched);
    const page = ordered.slice(offset, offset + limit);

    // The call a row belongs to is read from the whole window rather than from the filtered set: with
    // "retries only" active, a call must still be reported as having sent its first request too.
    const calls = indexLedgerCalls(inWindow);
    const byId = new Map(inWindow.map((entry) => [entry.id, entry]));
    const views: AiUsageCallView[] = [];
    for (const entry of page) {
      const rootId = calls.rootOf.get(entry.id) ?? entry.id;
      const rows = calls.byRoot.get(rootId) ?? [entry];
      views.push({
        entry,
        quantity: parseLedgerQuantity(entry.quantityJson),
        // The predecessor is looked up in the window's rows, not the page's: the fact that a retry
        // followed a *successful* request is knowable even when the filter hid that request.
        retry: classifyCallRetry(entry, byId.get(entry.parentUsageId) ?? null),
        group: {
          rootId,
          ...summarizeLedgerCallGroup(rows),
          index: rows.findIndex((row) => row.id === entry.id),
        },
        trace: await buildTrace(entry, reader),
      });
    }

    const payload: AiCostCenterCallsPayload = {
      range,
      from: window.from,
      to: window.to,
      filters,
      scan: {
        rows: scanned.length,
        limit: scanLimit,
        truncated: scanned.length >= scanLimit,
        traceCapped: reader.capped,
      },
      matched: matched.length,
      totals,
      matchedCostByCurrency: summarizeLedgerCurrencies(matched),
      offset,
      limit,
      hasMore: offset + page.length < ordered.length,
      calls: views,
      byContent,
      options: buildOptions(inWindow),
    };
    return ok(payload);
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}

