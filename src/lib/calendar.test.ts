import { describe, expect, it } from "vitest";
import {
  buildCalendarEntries,
  buildMonthGrid,
  formatClockTime,
  formatDayLabel,
  formatMonthLabel,
  gridRange,
  groupEntriesByDay,
  paramsLabel,
  parseDayKey,
  slotsToScheduleTimes,
  summarizeCalendar,
  toDayKey,
} from "./calendar";
import type { AccountRecord, PublishRecord, RunRecord, ScheduleRecord } from "./types";

/** Wednesday, 22 April 2026, 12:00 local. */
const NOW = new Date(2026, 3, 22, 12, 0, 0).getTime();
const RANGE_FROM = new Date(2026, 3, 20, 0, 0, 0).getTime();
const RANGE_TO = new Date(2026, 3, 25, 23, 59, 59).getTime();

const accounts: Pick<AccountRecord, "id" | "name" | "platform">[] = [
  { id: "acc-1", name: "Main", platform: "知乎" },
  { id: "acc-2", name: "Backup", platform: "小红书" },
];

function schedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: "sch-1",
    playbookId: "threads_compose_post",
    accountId: "acc-1",
    enabled: true,
    scheduleTimes: [{ type: "daily", time: "09:00" }],
    params: {},
    status: "scheduled",
    publishAuthorized: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    playbookId: "threads_compose_post",
    accountId: "acc-1",
    status: "success",
    params: {},
    resultMessage: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function publishRecord(overrides: Partial<PublishRecord> = {}): PublishRecord {
  return {
    id: "pub-1",
    accountId: "acc-1",
    accountName: "Main",
    platform: "知乎",
    title: "Launch note",
    contentType: "article",
    status: "published",
    url: "",
    method: "scheduled",
    terminal: "local",
    message: "",
    publishedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    views: 10,
    likes: 1,
    comments: 0,
    shares: 0,
    favorites: 0,
    followsDelta: 0,
    metricStatus: "collected",
    ...overrides,
  };
}

describe("calendar grid", () => {
  it("builds a Monday-first month grid with the surrounding weeks", () => {
    const weeks = buildMonthGrid(2026, 3);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(toDayKey(weeks[0][0])).toBe("2026-03-30");
    expect(toDayKey(weeks[4][6])).toBe("2026-05-03");
  });

  it("turns the grid into an inclusive timestamp range", () => {
    const range = gridRange(buildMonthGrid(2026, 3));
    expect(toDayKey(range.from)).toBe("2026-03-30");
    expect(toDayKey(range.to)).toBe("2026-05-03");
    expect(new Date(range.from).getHours()).toBe(0);
    expect(new Date(range.to).getHours()).toBe(23);
  });
});

describe("calendar entries", () => {
  it("merges planned occurrences, runs and publish logs in time order", () => {
    const entries = buildCalendarEntries({
      schedules: [
        schedule({
          scheduleTimes: [{ type: "weekly", time: "09:00", weekdays: [3] }],
          params: { title: "Weekly digest" },
        }),
      ],
      runs: [run({ scheduledFor: new Date(2026, 3, 22, 9, 0, 0).getTime() })],
      publishRecords: [publishRecord({ publishedAt: new Date(2026, 3, 22, 9, 5, 0).getTime() })],
      accounts,
      from: RANGE_FROM,
      to: RANGE_TO,
    });

    expect(entries.map((entry) => entry.kind)).toEqual(["planned", "run", "publish"]);
    expect(entries[0].title).toBe("Weekly digest");
    expect(entries[0].dayKey).toBe("2026-04-22");
    expect(entries[0].accountName).toBe("Main");
    expect(entries[0].platform).toBe("知乎");
    expect(entries[0].status).toBe("scheduled");
    expect(entries[1].status).toBe("success");
    expect(entries[2].title).toBe("Launch note");
  });

  it("marks a paused schedule and can hide a history layer", () => {
    const plannedOnly = buildCalendarEntries({
      schedules: [schedule({ enabled: false })],
      runs: [run()],
      publishRecords: [publishRecord()],
      accounts,
      from: RANGE_FROM,
      to: RANGE_TO,
      includeHistory: false,
    });
    expect(plannedOnly).toHaveLength(6);
    expect(plannedOnly.every((entry) => entry.kind === "planned")).toBe(true);
    expect(plannedOnly[0].status).toBe("disabled");
    expect(plannedOnly[0].enabled).toBe(false);

    const historyOnly = buildCalendarEntries({
      runs: [run()],
      publishRecords: [publishRecord()],
      accounts,
      from: RANGE_FROM,
      to: RANGE_TO,
      includePlanned: false,
    });
    expect(historyOnly.map((entry) => entry.kind)).toEqual(["run", "publish"]);
  });

  it("scopes every source to the selected account", () => {
    const entries = buildCalendarEntries({
      schedules: [schedule({ id: "sch-1", accountId: "acc-1" }), schedule({ id: "sch-2", accountId: "acc-2" })],
      runs: [run({ id: "run-1", accountId: "acc-1" }), run({ id: "run-2", accountId: "acc-2" })],
      publishRecords: [publishRecord({ id: "pub-2", accountId: "acc-2", accountName: "Backup" })],
      accounts,
      from: RANGE_FROM,
      to: RANGE_TO,
      accountId: "acc-2",
    });

    expect(entries.every((entry) => entry.accountId === "acc-2")).toBe(true);
    expect(entries).toHaveLength(6 + 1 + 1);
    expect(entries.some((entry) => entry.scheduleId === "sch-2")).toBe(true);
  });
});

describe("calendar summary", () => {
  it("groups entries per day and counts each layer", () => {
    const entries = buildCalendarEntries({
      schedules: [schedule()],
      runs: [run({ status: "failed", scheduledFor: new Date(2026, 3, 20, 9, 0, 0).getTime() })],
      accounts,
      from: RANGE_FROM,
      to: RANGE_TO,
    });

    const grouped = groupEntriesByDay(entries);
    expect(grouped["2026-04-20"]).toHaveLength(2);
    expect(grouped["2026-04-22"]).toHaveLength(1);

    const summary = summarizeCalendar(entries, NOW);
    expect(summary.planned).toBe(6);
    expect(summary.executed).toBe(1);
    expect(summary.published).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.upcoming.map((entry) => entry.dayKey)).toEqual(["2026-04-23", "2026-04-24", "2026-04-25"]);
  });
});

describe("calendar helpers", () => {
  it("turns best-time slots into weekly rules", () => {
    expect(
      slotsToScheduleTimes([
        { weekday: 1, hour: 9, count: 3, avgInteractions: 12 },
        { weekday: 3, hour: 9, count: 2, avgInteractions: 8 },
        { weekday: 5, hour: 20, count: 1, avgInteractions: 4 },
      ]),
    ).toEqual([
      { type: "weekly", time: "09:00", weekdays: [1, 3] },
      { type: "weekly", time: "20:00", weekdays: [5] },
    ]);
    expect(slotsToScheduleTimes([{ weekday: 9, hour: 9, count: 1, avgInteractions: 1 }])).toEqual([]);
  });

  it("derives a short label from free-form params", () => {
    expect(paramsLabel({ topic: "  Weekly   digest " }, "fallback")).toBe("Weekly digest");
    expect(paramsLabel({}, "threads_compose_post")).toBe("threads_compose_post");
    expect(paramsLabel({ prompt: "x".repeat(80) })).toHaveLength(60);
  });

  it("round-trips day keys and formats labels", () => {
    expect(toDayKey(new Date(2026, 3, 22, 23, 30))).toBe("2026-04-22");
    expect(parseDayKey("2026-04-22")?.getDate()).toBe(22);
    expect(parseDayKey("not-a-day")).toBeNull();
    expect(formatClockTime(new Date(2026, 3, 22, 12, 0, 0).getTime(), "en-GB")).toBe("12:00");
    expect(formatMonthLabel(2026, 3, "en-GB")).toBe("April 2026");
    expect(formatDayLabel(new Date(2026, 3, 22, 9, 0, 0).getTime(), "en-GB")).toContain("22");
  });
});

