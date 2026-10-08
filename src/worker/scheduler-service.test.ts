import { describe, expect, it } from "vitest";
import { isMissedOneTimeSchedule, isOnceOnlySchedule, missedOneTimeGraceMs } from "./scheduler-service";

describe("scheduled run recovery", () => {
  it("marks a one-time schedule missed only after the grace period", () => {
    expect(isMissedOneTimeSchedule({ dueAt: 1_000, now: 1_000 + missedOneTimeGraceMs, isOnce: true })).toBe(false);
    expect(isMissedOneTimeSchedule({ dueAt: 1_000, now: 1_001 + missedOneTimeGraceMs, isOnce: true })).toBe(true);
  });

  it("does not mark recurring schedules missed", () => {
    expect(isMissedOneTimeSchedule({ dueAt: 1_000, now: 1_000_000, isOnce: false })).toBe(false);
  });

  it("treats a schedule as one-time only when every rule fires once", () => {
    expect(isOnceOnlySchedule([{ type: "once", at: new Date(2026, 4, 1, 9, 0, 0).toISOString() }])).toBe(true);
    expect(
      isOnceOnlySchedule([
        { type: "once", at: new Date(2026, 4, 1, 9, 0, 0).toISOString() },
        { type: "daily", time: "09:00" },
      ]),
    ).toBe(false);
    expect(isOnceOnlySchedule([{ type: "weekly", time: "09:00", weekdays: [1, 3] }])).toBe(false);
    expect(isOnceOnlySchedule([])).toBe(false);
  });
});
