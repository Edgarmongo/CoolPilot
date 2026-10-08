import { localeTag, type Locale } from "./i18n-config";
import type { ScheduleTime, ScheduleTimeType } from "./types";

const minuteMs = 60_000;

/** Calendar weeks start on Monday (HK/CN convention); 0 = Sunday. */
export const weekStartsOn = 1;

/** Hard cap for `expandScheduleTimes`, so a 1-minute interval cannot spin forever. */
export const maxExpandedOccurrences = 500;

export type TimeOfDay = { hours: number; minutes: number };

export function parseTimeOfDay(value: string | undefined): TimeOfDay | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/** `HH:MM` from an hour/minute pair (used by best-time slots and form inputs). */
export function timeOfDayValue(hours: number, minutes = 0) {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function atTimeOfDay(day: Date, time: TimeOfDay) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.hours, time.minutes, 0, 0);
}

function normalizeWeekdays(weekdays: number[]) {
  return Array.from(new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort(
    (a, b) => a - b,
  );
}

function normalizeMonthDays(days: number[]) {
  return Array.from(new Set(days.filter((day) => Number.isInteger(day) && day >= 1 && day <= 31))).sort(
    (a, b) => a - b,
  );
}

/** The next timestamp strictly after `from` for a single recurrence rule. */
export function nextOccurrenceOf(scheduleTime: ScheduleTime, from: Date = new Date()): number | undefined {
  const fromMs = from.getTime();

  if (scheduleTime.type === "once") {
    const at = Date.parse(scheduleTime.at);
    return Number.isFinite(at) && at > fromMs ? at : undefined;
  }

  if (scheduleTime.type === "interval") {
    const step = Math.max(1, Math.round(scheduleTime.everyMinutes)) * minuteMs;
    const anchor = scheduleTime.anchor ? Date.parse(scheduleTime.anchor) : Number.NaN;
    if (Number.isFinite(anchor)) {
      const elapsed = Math.floor((fromMs - anchor) / step) + 1;
      return anchor + Math.max(0, elapsed) * step;
    }
    return Math.ceil((fromMs + 1) / step) * step;
  }

  const time = parseTimeOfDay(scheduleTime.time);
  if (!time) return undefined;

  if (scheduleTime.type === "daily") {
    const next = atTimeOfDay(from, time);
    if (next.getTime() <= fromMs) next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  if (scheduleTime.type === "weekly") {
    const weekdays = normalizeWeekdays(scheduleTime.weekdays);
    let best: number | undefined;
    for (const weekday of weekdays) {
      const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      day.setDate(day.getDate() + ((weekday - day.getDay() + 7) % 7));
      const candidate = atTimeOfDay(day, time);
      if (candidate.getTime() <= fromMs) candidate.setDate(candidate.getDate() + 7);
      if (best === undefined || candidate.getTime() < best) best = candidate.getTime();
    }
    return best;
  }

  const monthDays = normalizeMonthDays(scheduleTime.days);
  if (monthDays.length === 0) return undefined;
  // Walk up to 13 months ahead and return the earliest matching day.
  for (let offset = 0; offset <= 13; offset += 1) {
    const cursor = new Date(from.getFullYear(), from.getMonth() + offset, 1);
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    let best: number | undefined;
    // A day past a short month's length resolves to that month's last day.
    for (const day of monthDays) {
      const candidate = new Date(year, month, Math.min(day, daysInMonth(year, month)), time.hours, time.minutes, 0, 0);
      if (candidate.getTime() > fromMs && (best === undefined || candidate.getTime() < best)) {
        best = candidate.getTime();
      }
    }
    if (best !== undefined) return best;
  }
  return undefined;
}

/** Earliest next occurrence across every rule of a schedule. */
export function computeNextRunAt(scheduleTimes: ScheduleTime[], from = new Date()) {
  const candidates = scheduleTimes
    .map((entry) => nextOccurrenceOf(entry, from))
    .filter((value): value is number => typeof value === "number");

  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}

export type OccurrenceRange = {
  from?: Date;
  /** Exclusive upper bound. */
  to: Date;
  limit?: number;
};

/**
 * Every occurrence of the rules inside `[from, to)`, ascending and de-duplicated.
 * The calendar uses this to draw planned content; the scheduler itself only
 * needs `computeNextRunAt`.
 */
export function expandScheduleTimes(scheduleTimes: ScheduleTime[], range: OccurrenceRange): number[] {
  const from = range.from ?? new Date();
  const toMs = range.to.getTime();
  const limit = Math.max(1, Math.min(range.limit ?? maxExpandedOccurrences, maxExpandedOccurrences));
  const found = new Set<number>();

  for (const entry of scheduleTimes) {
    let cursor = new Date(from.getTime());
    for (let guard = 0; guard <= limit; guard += 1) {
      const next = nextOccurrenceOf(entry, cursor);
      if (next === undefined || next >= toMs) break;
      found.add(next);
      cursor = new Date(next + minuteMs);
      if (found.size >= limit) break;
    }
    if (found.size >= limit) break;
  }

  return Array.from(found)
    .sort((a, b) => a - b)
    .slice(0, limit);
}

/** Form state of the schedule editor, one rule at a time. */
export type ScheduleTimeDraft = {
  type: ScheduleTimeType;
  /** `HH:MM`, used by every rule except `interval`. */
  time: string;
  /** `datetime-local` value, used by `once`. */
  dateTime: string;
  /** 0 = Sunday … 6 = Saturday, used by `weekly`. */
  weekdays: number[];
  /** 1–31, used by `monthly`. */
  monthDays: number[];
  /** Used by `interval`. */
  everyMinutes: number;
};

export function defaultScheduleTimeDraft(time = "09:00"): ScheduleTimeDraft {
  return { type: "daily", time, dateTime: "", weekdays: [weekStartsOn], monthDays: [1], everyMinutes: 60 };
}

/** `YYYY-MM-DDTHH:MM` local time, the value shape of `<input type="datetime-local">`. */
export function toDateTimeLocalValue(date: Date) {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${day}T${timeOfDayValue(date.getHours(), date.getMinutes())}`;
}

/** Rules for a draft. An incomplete draft (no date / no day picked) yields no rule. */
export function draftToScheduleTimes(draft: ScheduleTimeDraft): ScheduleTime[] {
  const parsed = parseTimeOfDay(draft.time);
  const time = parsed ? timeOfDayValue(parsed.hours, parsed.minutes) : "09:00";

  switch (draft.type) {
    case "once": {
      const at = Date.parse(draft.dateTime);
      return Number.isFinite(at) ? [{ type: "once", at: new Date(at).toISOString() }] : [];
    }
    case "weekly": {
      const weekdays = normalizeWeekdays(draft.weekdays);
      return weekdays.length > 0 ? [{ type: "weekly", time, weekdays }] : [];
    }
    case "monthly": {
      const days = normalizeMonthDays(draft.monthDays);
      return days.length > 0 ? [{ type: "monthly", time, days }] : [];
    }
    case "interval": {
      const everyMinutes = Math.min(43_200, Math.max(5, Math.round(draft.everyMinutes || 60)));
      return [{ type: "interval", everyMinutes }];
    }
    default:
      return [{ type: "daily", time }];
  }
}

/** Inverse of `draftToScheduleTimes`, used when editing an existing schedule. */
export function scheduleTimesToDraft(scheduleTimes: ScheduleTime[]): ScheduleTimeDraft {
  const draft = defaultScheduleTimeDraft();
  const [first] = scheduleTimes;
  if (!first) return draft;
  draft.type = first.type;

  if (first.type === "once") {
    const at = Date.parse(first.at);
    if (Number.isFinite(at)) draft.dateTime = toDateTimeLocalValue(new Date(at));
    return draft;
  }
  if (first.type === "interval") {
    draft.everyMinutes = first.everyMinutes;
    return draft;
  }

  const parsed = parseTimeOfDay(first.time);
  if (parsed) draft.time = timeOfDayValue(parsed.hours, parsed.minutes);
  if (first.type === "weekly") draft.weekdays = [...first.weekdays];
  if (first.type === "monthly") draft.monthDays = [...first.days];
  return draft;
}


export function isDue(nextRunAt: number | undefined, from = Date.now()) {
  return typeof nextRunAt === "number" && nextRunAt <= from;
}

export function formatRunTime(timestamp?: number, locale: Locale | string = "zh-HK") {
  if (!timestamp) {
    return "未設定";
  }
  return new Intl.DateTimeFormat(localeTag(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
