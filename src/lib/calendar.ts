import { localeTag, type Locale } from "./i18n-config";
import type { SlotStat } from "./metrics";
import { expandScheduleTimes, timeOfDayValue, weekStartsOn } from "./schedule";
import type { AccountRecord, PublishRecord, RunRecord, ScheduleRecord, ScheduleTime } from "./types";

/** Where a calendar entry comes from: a plan, an execution, or a publish log. */
export type CalendarEntryKind = "planned" | "run" | "publish";

export const calendarEntryKinds = ["planned", "run", "publish"] as const satisfies readonly CalendarEntryKind[];

export type CalendarEntry = {
  id: string;
  kind: CalendarEntryKind;
  /** Exact moment shown in the day agenda. */
  at: number;
  /** Local `YYYY-MM-DD` bucket the entry is drawn in. */
  dayKey: string;
  title: string;
  /** Raw schedule/run/publish status; the UI maps it to a localized label. */
  status: string;
  accountId?: string;
  accountName: string;
  platform: string;
  playbookId?: string;
  scheduleId?: string;
  runId?: string;
  contentItemId?: string;
  /** Only set for planned entries: whether the schedule is still enabled. */
  enabled?: boolean;
};

const titleMaxLength = 60;

export function toDayKey(value: Date | number): string {
  const date = typeof value === "number" ? new Date(value) : value;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function parseDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function startOfDay(value: Date | number) {
  const date = typeof value === "number" ? new Date(value) : new Date(value.getTime());
  date.setHours(0, 0, 0, 0);
  return date;
}

export function addDays(value: Date | number, days: number) {
  const date = typeof value === "number" ? new Date(value) : new Date(value.getTime());
  date.setDate(date.getDate() + days);
  return date;
}

export function startOfWeek(value: Date | number, weekStart = weekStartsOn) {
  const date = startOfDay(value);
  return addDays(date, -((date.getDay() - weekStart + 7) % 7));
}

export function monthRange(year: number, month: number) {
  return {
    from: new Date(year, month, 1, 0, 0, 0, 0).getTime(),
    to: new Date(year, month + 1, 1, 0, 0, 0, 0).getTime() - 1,
  };
}

/** Month view as weeks of 7 days; first and last week may spill into adjacent months. */
export function buildMonthGrid(year: number, month: number, weekStart = weekStartsOn): Date[][] {
  const first = startOfWeek(new Date(year, month, 1), weekStart);
  const lastMs = addDays(startOfWeek(new Date(year, month + 1, 0), weekStart), 6).getTime();
  const weeks: Date[][] = [];
  for (let cursorMs = first.getTime(); cursorMs <= lastMs; cursorMs = addDays(cursorMs, 7).getTime()) {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(cursorMs, index)));
  }
  return weeks;
}

/** Inclusive `[from, to]` timestamps covering a full month grid. */
export function gridRange(weeks: Date[][]) {
  const first = weeks[0]?.[0];
  const last = weeks[weeks.length - 1]?.[6];
  if (!first || !last) {
    const now = new Date();
    return monthRange(now.getFullYear(), now.getMonth());
  }
  return { from: startOfDay(first).getTime(), to: addDays(startOfDay(last), 1).getTime() - 1 };
}

function shortTitle(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > titleMaxLength ? `${text.slice(0, titleMaxLength - 1)}…` : text;
}

/** Best-effort label from the free-form params a schedule or run carries. */
export function paramsLabel(params: Record<string, unknown> | undefined, fallback = ""): string {
  if (params) {
    for (const key of ["title", "topic", "prompt", "name", "keywords", "keyword"]) {
      const value = params[key];
      if (typeof value === "string" && value.trim()) return shortTitle(value);
    }
  }
  return shortTitle(fallback);
}

export type BuildCalendarEntriesInput = {
  schedules?: ScheduleRecord[];
  runs?: RunRecord[];
  publishRecords?: PublishRecord[];
  accounts?: Pick<AccountRecord, "id" | "name" | "platform">[];
  /** Inclusive window, epoch milliseconds. */
  from: number;
  to: number;
  /** When set, only entries of that account are returned. */
  accountId?: string;
  includePlanned?: boolean;
  includeHistory?: boolean;
  maxOccurrences?: number;
};

export function isFailedStatus(status: string) {
  return status === "failed" || status === "missed";
}

export function isSuccessStatus(status: string) {
  return status === "posted" || status === "success" || status === "published";
}

/**
 * Merges the three sources a content calendar needs:
 * planned occurrences (schedule rules), executions (`runs`), and publish logs.
 */
export function buildCalendarEntries({
  schedules = [],
  runs = [],
  publishRecords = [],
  accounts = [],
  from,
  to,
  accountId = "",
  includePlanned = true,
  includeHistory = true,
  maxOccurrences = 200,
}: BuildCalendarEntriesInput): CalendarEntry[] {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const entries: CalendarEntry[] = [];
  const inRange = (at: number) => at >= from && at <= to;

  if (includePlanned) {
    for (const schedule of schedules) {
      if (accountId && schedule.accountId !== accountId) continue;
      const account = schedule.accountId ? accountsById.get(schedule.accountId) : undefined;
      const occurrences = expandScheduleTimes(schedule.scheduleTimes, {
        from: new Date(from),
        to: new Date(to + 1),
        limit: maxOccurrences,
      });
      for (const at of occurrences) {
        if (!inRange(at)) continue;
        entries.push({
          id: `schedule:${schedule.id}:${at}`,
          kind: "planned",
          at,
          dayKey: toDayKey(at),
          title: paramsLabel(schedule.params, schedule.playbookId),
          status: schedule.enabled ? schedule.status : "disabled",
          accountId: schedule.accountId,
          accountName: account?.name ?? "",
          platform: account?.platform ?? "",
          playbookId: schedule.playbookId,
          scheduleId: schedule.id,
          contentItemId: schedule.contentItemId,
          enabled: schedule.enabled,
        });
      }
    }
  }

  if (includeHistory) {
    for (const run of runs) {
      if (accountId && run.accountId !== accountId) continue;
      const at = run.scheduledFor ?? run.startedAt ?? run.createdAt;
      if (!inRange(at)) continue;
      const account = run.accountId ? accountsById.get(run.accountId) : undefined;
      entries.push({
        id: `run:${run.id}`,
        kind: "run",
        at,
        dayKey: toDayKey(at),
        title: paramsLabel(run.params, run.resultMessage || run.playbookId),
        status: run.status,
        accountId: run.accountId,
        accountName: account?.name ?? "",
        platform: account?.platform ?? "",
        playbookId: run.playbookId,
        scheduleId: run.scheduleId,
        runId: run.id,
      });
    }

    for (const record of publishRecords) {
      if (accountId && record.accountId !== accountId) continue;
      const at = record.publishedAt ?? record.createdAt;
      if (!inRange(at)) continue;
      entries.push({
        id: `publish:${record.id}`,
        kind: "publish",
        at,
        dayKey: toDayKey(at),
        title: shortTitle(record.title || record.contentType),
        status: record.status,
        accountId: record.accountId,
        accountName: record.accountName,
        platform: record.platform,
        contentItemId: record.contentItemId,
      });
    }
  }

  return entries.sort((a, b) => a.at - b.at);
}

export function groupEntriesByDay(entries: CalendarEntry[]): Record<string, CalendarEntry[]> {
  const grouped: Record<string, CalendarEntry[]> = {};
  for (const entry of entries) {
    const bucket = grouped[entry.dayKey];
    if (bucket) bucket.push(entry);
    else grouped[entry.dayKey] = [entry];
  }
  return grouped;
}

export type CalendarSummary = {
  planned: number;
  executed: number;
  published: number;
  failed: number;
  /** Upcoming planned entries, soonest first. */
  upcoming: CalendarEntry[];
};

export function summarizeCalendar(entries: CalendarEntry[], now = Date.now()): CalendarSummary {
  const upcoming: CalendarEntry[] = [];
  let planned = 0;
  let executed = 0;
  let published = 0;
  let failed = 0;

  for (const entry of entries) {
    if (isFailedStatus(entry.status)) failed += 1;
    if (entry.kind === "planned") {
      planned += 1;
      if (entry.at >= now) upcoming.push(entry);
    } else if (entry.kind === "run") {
      executed += 1;
    } else {
      published += 1;
    }
  }

  upcoming.sort((a, b) => a.at - b.at);
  return { planned, executed, published, failed, upcoming: upcoming.slice(0, 5) };
}

/**
 * Turns best-time slots into weekly rules. Slots that share a time of day merge
 * into one rule, so a generated schedule stays readable.
 */
export function slotsToScheduleTimes(slots: SlotStat[]): ScheduleTime[] {
  const byTime = new Map<string, Set<number>>();

  for (const slot of slots) {
    if (!Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6) continue;
    if (!Number.isInteger(slot.hour) || slot.hour < 0 || slot.hour > 23) continue;
    const time = timeOfDayValue(slot.hour);
    const weekdays = byTime.get(time) ?? new Set<number>();
    weekdays.add(slot.weekday);
    byTime.set(time, weekdays);
  }

  return Array.from(byTime.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, weekdays]) => ({ type: "weekly", time, weekdays: Array.from(weekdays).sort((a, b) => a - b) }));
}

export function formatMonthLabel(year: number, month: number, locale: Locale | string = "zh-HK") {
  return new Intl.DateTimeFormat(localeTag(locale), { year: "numeric", month: "long" }).format(
    new Date(year, month, 1),
  );
}

export function formatDayLabel(value: Date | number, locale: Locale | string = "zh-HK") {
  return new Intl.DateTimeFormat(localeTag(locale), { month: "short", day: "numeric", weekday: "short" }).format(
    typeof value === "number" ? new Date(value) : value,
  );
}

export function formatClockTime(value: number, locale: Locale | string = "zh-HK") {
  return new Intl.DateTimeFormat(localeTag(locale), { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
