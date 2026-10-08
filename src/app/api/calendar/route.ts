import { listAccounts, listPublishRecords, listRuns, listSchedules } from "@/db/repository";
import { ok } from "@/lib/api";
import { buildCalendarEntries, monthRange, summarizeCalendar } from "@/lib/calendar";
import { bestTimeSlots } from "@/lib/metrics";

export const runtime = "nodejs";

/** Windows the calendar reads history from; the scheduler keeps its own limits. */
const runsLimit = 400;
const publishRecordsLimit = 1000;

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

  const entries = buildCalendarEntries({
    schedules,
    runs,
    publishRecords,
    accounts,
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
    generatedAt: now,
  });
}
