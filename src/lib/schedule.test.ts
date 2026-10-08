import { describe, expect, it } from "vitest";
import {
  computeNextRunAt,
  daysInMonth,
  defaultScheduleTimeDraft,
  draftToScheduleTimes,
  expandScheduleTimes,
  isDue,
  nextOccurrenceOf,
  parseTimeOfDay,
  scheduleTimesToDraft,
} from "./schedule";

/** Wednesday, 22 April 2026, 08:00 local. */
const WEDNESDAY_MORNING = new Date(2026, 3, 22, 8, 0, 0);

function toDayKeysOf(values: number[]) {
  return values.map((value) => {
    const date = new Date(value);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, "0")}`;
  });
}

describe("schedule", () => {
  it("computes the next daily run for later today", () => {
    const from = new Date(2026, 3, 22, 8, 0, 0);
    const next = computeNextRunAt([{ type: "daily", time: "09:30" }], from);
    expect(new Date(next ?? 0).getHours()).toBe(9);
    expect(new Date(next ?? 0).getMinutes()).toBe(30);
  });

  it("rolls a daily run to tomorrow after the time has passed", () => {
    const from = new Date(2026, 3, 22, 10, 0, 0);
    const next = computeNextRunAt([{ type: "daily", time: "09:30" }], from);
    expect((next ?? 0) - from.getTime()).toBeGreaterThan(20 * 60 * 60 * 1000);
  });

  it("detects due schedules", () => {
    expect(isDue(1000, 1001)).toBe(true);
    expect(isDue(1002, 1001)).toBe(false);
  });
});

describe("schedule recurrence", () => {
  it("picks the earliest weekday of a weekly rule", () => {
    // Wednesday 22nd: the Friday slot lands on the 24th, two days earlier than Monday's 27th.
    const next = computeNextRunAt([{ type: "weekly", time: "09:30", weekdays: [1, 5] }], WEDNESDAY_MORNING);
    const at = new Date(next ?? 0);
    expect(at.getDay()).toBe(5);
    expect(at.getDate()).toBe(24);
    expect(at.getHours()).toBe(9);
    expect(at.getMinutes()).toBe(30);
  });

  it("keeps a weekly rule on the same day when the time is still ahead", () => {
    const next = nextOccurrenceOf({ type: "weekly", time: "18:00", weekdays: [3] }, WEDNESDAY_MORNING);
    const at = new Date(next ?? 0);
    expect(at.getDate()).toBe(22);
    expect(at.getHours()).toBe(18);
  });

  it("rolls a weekly rule a full week when today's time has passed", () => {
    const next = nextOccurrenceOf({ type: "weekly", time: "07:00", weekdays: [3] }, WEDNESDAY_MORNING);
    expect(new Date(next ?? 0).getDate()).toBe(29);
  });

  it("ignores an empty weekday list", () => {
    expect(nextOccurrenceOf({ type: "weekly", time: "09:00", weekdays: [] }, WEDNESDAY_MORNING)).toBeUndefined();
  });

  it("uses the last day for a monthly rule the month does not have", () => {
    const next = nextOccurrenceOf({ type: "monthly", time: "12:00", days: [31] }, new Date(2026, 1, 1, 0, 0, 0));
    const at = new Date(next ?? 0);
    expect(at.getMonth()).toBe(1);
    expect(at.getDate()).toBe(28);
    expect(at.getHours()).toBe(12);
  });

  it("finds the next month for a monthly rule that already passed", () => {
    const next = nextOccurrenceOf({ type: "monthly", time: "08:00", days: [22] }, new Date(2026, 3, 22, 9, 0, 0));
    const at = new Date(next ?? 0);
    expect(at.getMonth()).toBe(4);
    expect(at.getDate()).toBe(22);
  });

  it("returns the earliest rule of a mixed schedule", () => {
    const interval = { type: "interval", everyMinutes: 120 } as const;
    const next = computeNextRunAt(
      [{ type: "daily", time: "20:00" }, { type: "weekly", time: "09:00", weekdays: [6] }, interval],
      WEDNESDAY_MORNING,
    );
    expect(next).toBe(nextOccurrenceOf(interval, WEDNESDAY_MORNING));
    expect((next ?? 0) - WEDNESDAY_MORNING.getTime()).toBeLessThanOrEqual(120 * 60_000);
  });

  it("aligns an anchored interval to its anchor", () => {
    const anchor = new Date(2026, 3, 22, 8, 0, 0);
    const rule = { type: "interval", everyMinutes: 90, anchor: anchor.toISOString() } as const;
    // The anchor itself plus one step is exactly 09:30, so the next slot is 11:00.
    const next = nextOccurrenceOf(rule, new Date(2026, 3, 22, 9, 30, 0));
    expect(next).toBe(anchor.getTime() + 2 * 90 * 60_000);
    expect(nextOccurrenceOf(rule, new Date(2026, 3, 22, 9, 45, 0))).toBe(anchor.getTime() + 2 * 90 * 60_000);
  });

  it("returns nothing for a one-time rule that already passed", () => {
    const past = new Date(2026, 3, 21, 9, 0, 0).toISOString();
    expect(nextOccurrenceOf({ type: "once", at: past }, WEDNESDAY_MORNING)).toBeUndefined();
  });

  it("returns nothing when no rule resolves", () => {
    expect(computeNextRunAt([], WEDNESDAY_MORNING)).toBeUndefined();
    expect(nextOccurrenceOf({ type: "daily", time: "99:99" }, WEDNESDAY_MORNING)).toBeUndefined();
  });
});

describe("schedule occurrence expansion", () => {
  it("lists every occurrence inside the range", () => {
    const occurrences = expandScheduleTimes([{ type: "daily", time: "09:00" }], {
      from: new Date(2026, 3, 22, 0, 0, 0),
      to: new Date(2026, 3, 25, 0, 0, 0),
    });
    expect(occurrences).toHaveLength(3);
    expect(toDayKeysOf(occurrences)).toEqual(["2026-04-22", "2026-04-23", "2026-04-24"]);
  });

  it("merges overlapping rules and respects the limit", () => {
    const occurrences = expandScheduleTimes(
      [
        { type: "daily", time: "09:00" },
        { type: "weekly", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      ],
      { from: new Date(2026, 3, 22, 0, 0, 0), to: new Date(2026, 4, 1, 0, 0, 0), limit: 4 },
    );
    expect(occurrences).toHaveLength(4);
    expect(new Set(occurrences).size).toBe(4);
  });

  it("keeps a short interval bounded by the limit", () => {
    const occurrences = expandScheduleTimes([{ type: "interval", everyMinutes: 5 }], {
      from: new Date(2026, 3, 22, 0, 0, 0),
      to: new Date(2026, 3, 23, 0, 0, 0),
      limit: 10,
    });
    expect(occurrences).toHaveLength(10);
    expect(occurrences.every((value, index) => index === 0 || value > occurrences[index - 1])).toBe(true);
  });

  it("stops at a one-time rule", () => {
    const at = new Date(2026, 3, 23, 15, 0, 0).toISOString();
    const occurrences = expandScheduleTimes([{ type: "once", at }], {
      from: new Date(2026, 3, 22, 0, 0, 0),
      to: new Date(2026, 4, 1, 0, 0, 0),
    });
    expect(occurrences).toHaveLength(1);
  });
});



describe("schedule form draft", () => {
  it("round-trips a weekly rule through the editor draft", () => {
    const rules = draftToScheduleTimes({
      ...defaultScheduleTimeDraft(),
      type: "weekly",
      time: "9:05",
      weekdays: [3, 1, 1],
    });
    expect(rules).toEqual([{ type: "weekly", time: "09:05", weekdays: [1, 3] }]);
    expect(scheduleTimesToDraft(rules)).toMatchObject({ type: "weekly", time: "09:05", weekdays: [1, 3] });
  });

  it("drops incomplete rules and clamps a too-short interval", () => {
    expect(draftToScheduleTimes({ ...defaultScheduleTimeDraft(), type: "once" })).toEqual([]);
    expect(draftToScheduleTimes({ ...defaultScheduleTimeDraft(), type: "weekly", weekdays: [] })).toEqual([]);
    expect(draftToScheduleTimes({ ...defaultScheduleTimeDraft(), type: "interval", everyMinutes: 1 })).toEqual([
      { type: "interval", everyMinutes: 5 },
    ]);
  });

  it("normalises month days and restores a one-time draft", () => {
    const monthly = draftToScheduleTimes({
      ...defaultScheduleTimeDraft(),
      type: "monthly",
      monthDays: [31, 1, 31, 0, 32],
    });
    expect(monthly).toEqual([{ type: "monthly", time: "09:00", days: [1, 31] }]);

    const once = draftToScheduleTimes({ ...defaultScheduleTimeDraft(), type: "once", dateTime: "2026-05-01T14:30" });
    expect(once).toEqual([{ type: "once", at: new Date(2026, 4, 1, 14, 30, 0).toISOString() }]);
    expect(scheduleTimesToDraft(once)).toMatchObject({ type: "once", dateTime: "2026-05-01T14:30" });
  });

  it("falls back to 09:00 for an invalid time", () => {
    expect(draftToScheduleTimes({ ...defaultScheduleTimeDraft(), time: "99:99" })).toEqual([
      { type: "daily", time: "09:00" },
    ]);
    expect(parseTimeOfDay("99:99")).toBeNull();
    expect(parseTimeOfDay("07:45")).toEqual({ hours: 7, minutes: 45 });
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2026, 2)).toBe(31);
  });
});
