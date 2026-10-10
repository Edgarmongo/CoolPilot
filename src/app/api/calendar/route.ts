import { listAccounts, listContentItemRefs, listPublishRecords, listRuns, listSchedules } from "@/db/repository";
import { ok } from "@/lib/api";
import { buildCalendarEntries, monthRange, runContentItemId, summarizeCalendar } from "@/lib/calendar";
import { bestTimeSlots } from "@/lib/metrics";

export const runtime = "nodejs";

/** Windows the calendar reads history from; the scheduler keeps its own limits. */
const runsLimit = 400;
const publishRecordsLimit = 1000;
/** How many distinct content items one view may resolve by title (CI-P2-04). */
const contentTitleBudget = 200;

function readTimestamp(value: string | null) {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Calendar payload for a window: planned occurrences, run history, publish logs,
 * plus the best publishing slots derived from the same publish records.
 * `?from`/`?to` (epoch ms or ISO) win over `?month=YYYY-MM`.
 *
 * CI-P2-04 adds one thing to the same three sources: the content title each entry names. A plan or a
 * publish is much more useful when it says *which article* it is about, and the id alone is not a
 * name. Resolution is bounded (`contentTitles.budget`) and reports its own ceiling.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const now = Date.now();
  const monthParam = /^(\d{4})-(\d{1,2})$/.exec(url.searchParams.get("month") ?? "");
  const fallback = monthParam
    ? monthRange(Number(monthParam[1]), Number(monthParam[2]) - 1)
    : monthRange(new Date(now).getFullYear(), new Date(now).getMonth());

  const from = readTimestamp(url.searchParams.get("from"));
  const to = readTimestamp(url.searchParams.get("to"));
  const range = from !== undefined && to !== undefined && to > from ? { from, to } : fallback;
  const accountId = (url.searchParams.get("accountId") ?? "").trim();

  const [schedules, runs, publishRecords, accounts] = await Promise.all([
    listSchedules(),
    listRuns(runsLimit),
    listPublishRecords(publishRecordsLimit),
    listAccounts(),
  ]);

  const contentItemIds = new Set<string>();
  for (const schedule of schedules) if (schedule.contentItemId) contentItemIds.add(schedule.contentItemId);
  for (const run of runs) {
    const contentItemId = runContentItemId(run);
    if (contentItemId) contentItemIds.add(contentItemId);
  }
  for (const record of publishRecords) if (record.contentItemId) contentItemIds.add(record.contentItemId);
  const requestedIds = [...contentItemIds];
  const references = await listContentItemRefs(requestedIds.slice(0, contentTitleBudget));
  const contentTitles = new Map(references.map((item) => [item.id, item.title]));

  const entries = buildCalendarEntries({
    schedules,
    runs,
    publishRecords,
    accounts,
    contentTitles,
    from: range.from,
    to: range.to,
    accountId,
  });
  const scopedRecords = accountId ? publishRecords.filter((record) => record.accountId === accountId) : publishRecords;

  return ok({
    range,
    accountId,
    entries,
    summary: summarizeCalendar(entries, now),
    bestSlots: bestTimeSlots(scopedRecords, 6),
    accounts: accounts.map((account) => ({ id: account.id, name: account.name, platform: account.platform })),
    contentTitles: {
      requested: requestedIds.length,
      resolved: contentTitles.size,
      budget: contentTitleBudget,
      capped: requestedIds.length > contentTitleBudget,
    },
    generatedAt: now,
  });
}
