import { describe, expect, it } from "vitest";
import type { AccountRecord, MetricSnapshot } from "@/lib/types";
import {
  bestTimeSlots,
  buildMetricSeries,
  computeBaseline,
  engagementRate,
  interactionCount,
  isZeroData,
  summarizeMetrics,
  topPerformers,
  zeroPerformers,
  type MetricBearing,
} from "./metrics";

const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();

function record(overrides: Partial<MetricBearing> = {}): MetricBearing {
  return {
    id: overrides.id ?? `rec-${Math.random().toString(36).slice(2)}`,
    accountId: overrides.accountId ?? "acc-1",
    platform: overrides.platform ?? "知乎",
    createdAt: NOW,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    favorites: 0,
    followsDelta: 0,
    metricStatus: "collected",
    ...overrides,
  };
}

function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: overrides.id ?? "acc-1",
    name: overrides.name ?? "Main",
    platform: overrides.platform ?? "知乎",
    url: "",
    account: "",
    profilePath: "",
    memo: "",
    status: "active",
    preset: {},
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("metric primitives", () => {
  it("sums interactions and derives the engagement rate", () => {
    const row = record({ views: 1000, likes: 20, comments: 4, shares: 3, favorites: 3 });
    expect(interactionCount(row)).toBe(30);
    expect(engagementRate(row)).toBeCloseTo(0.03, 6);
  });

  it("guards against a zero-views engagement rate", () => {
    expect(engagementRate(record({ views: 0, likes: 5 }))).toBe(0);
  });

  it("flags collected rows with no views as zero-data", () => {
    expect(isZeroData(record({ views: 0, metricStatus: "collected" }))).toBe(true);
    expect(isZeroData(record({ views: 0, metricStatus: "pending" }))).toBe(false);
    expect(isZeroData(record({ views: 5, metricStatus: "collected" }))).toBe(false);
  });
});

describe("summarizeMetrics", () => {
  it("aggregates totals, per-platform rows and status counts", () => {
    const records = [
      record({ id: "a", platform: "知乎", views: 100, likes: 10, favorites: 2, metricsSyncedAt: NOW - 1000 }),
      record({ id: "b", platform: "知乎", views: 40, likes: 3, comments: 1 }),
      record({ id: "c", platform: "小红书", views: 300, likes: 30, shares: 5, metricStatus: "pending" }),
    ];
    const overview = summarizeMetrics(
      records,
      [account(), account({ id: "acc-2", platform: "小红书" })],
      new Map([
        ["acc-1", 500],
        ["acc-2", 1200],
      ]),
      30,
      NOW,
    );

    expect(overview.totals.posts).toBe(3);
    expect(overview.totals.views).toBe(440);
    expect(overview.totals.interactions).toBe(10 + 2 + 3 + 1 + 30 + 5);
    expect(overview.totals.followers).toBe(1700);
    expect(overview.totals.engagementRate).toBeCloseTo((10 + 2 + 3 + 1 + 30 + 5) / 440, 6);
    expect(overview.statusCounts.collected).toBe(2);
    expect(overview.statusCounts.pending).toBe(1);
    expect(overview.lastSyncedAt).toBe(NOW - 1000);

    const zhihu = overview.byPlatform.find((p) => p.platform === "知乎");
    expect(zhihu?.posts).toBe(2);
    expect(zhihu?.views).toBe(140);
    expect(zhihu?.followers).toBe(500);
    const xhs = overview.byPlatform.find((p) => p.platform === "小红书");
    expect(xhs?.followers).toBe(1200);
  });

  it("excludes rows outside the range window and averages completion rate", () => {
    const records = [
      record({ id: "recent", views: 10, completionRate: 40 }),
      record({ id: "old", views: 999, publishedAt: new Date(2025, 0, 1).getTime(), completionRate: 20 }),
    ];
    const overview = summarizeMetrics(records, [account()], new Map(), 7, NOW);
    expect(overview.totals.posts).toBe(1);
    expect(overview.totals.views).toBe(10);
    expect(overview.totals.completionRate).toBe(40);
    expect(overview.totals.zeroData).toBe(0);
  });

  it("returns zeroed averages when there is no data", () => {
    const overview = summarizeMetrics([], [account()], new Map(), 30, NOW);
    expect(overview.totals).toEqual({
      posts: 0,
      views: 0,
      interactions: 0,
      followers: 0,
      engagementRate: 0,
      completionRate: 0,
      zeroData: 0,
    });
    expect(overview.byPlatform).toEqual([]);
  });
});

describe("baseline, best-time and rankings", () => {
  it("compares a record against account and platform averages", () => {
    const target = record({ id: "t", accountId: "acc-1", platform: "知乎", views: 100 });
    const baseline = computeBaseline(
      [
        target,
        record({ accountId: "acc-1", platform: "知乎", views: 50 }),
        record({ accountId: "acc-2", platform: "知乎", views: 0 }),
      ],
      target,
    );
    expect(baseline.accountAvgViews).toBe(Math.round((100 + 50) / 2));
    expect(baseline.platformAvgViews).toBe(Math.round((100 + 50 + 0) / 3));
    expect(baseline.accountCount).toBe(2);
    expect(baseline.platformCount).toBe(3);
  });

  it("ranks weekday × hour slots by average interactions", () => {
    const monday10 = new Date(2026, 0, 12, 10, 0, 0).getTime(); // Monday
    const records = [
      record({ publishedAt: monday10, likes: 40 }),
      record({ publishedAt: monday10, likes: 20 }),
      record({ publishedAt: new Date(2026, 0, 13, 20, 0, 0).getTime(), likes: 5 }),
    ];
    const slots = bestTimeSlots(records);
    expect(slots[0].weekday).toBe(1);
    expect(slots[0].hour).toBe(10);
    expect(slots[0].avgInteractions).toBe(30);
  });

  it("surfaces top and zero performers", () => {
    const records = [
      record({ id: "hot", views: 500, likes: 50 }),
      record({ id: "zero", views: 0, metricStatus: "collected" }),
      record({ id: "mid", views: 50, likes: 5 }),
    ];
    expect(topPerformers(records)[0].id).toBe("hot");
    expect(zeroPerformers(records).map((r) => r.id)).toEqual(["zero"]);
  });
});

describe("buildMetricSeries", () => {
  it("orders snapshot points chronologically", () => {
    const snapshots: MetricSnapshot[] = [
      { id: "2", publishRecordId: "r", platform: "知乎", capturedAt: 200, views: 200, likes: 2, comments: 0, shares: 0, favorites: 0, followsDelta: 0, extra: {}, source: "browser", createdAt: 200 },
      { id: "1", publishRecordId: "r", platform: "知乎", capturedAt: 100, views: 50, likes: 1, comments: 0, shares: 0, favorites: 0, followsDelta: 0, extra: {}, source: "browser", createdAt: 100 },
    ];
    const series = buildMetricSeries({ id: "r", platform: "知乎", accountName: "Main", title: "Hello" }, snapshots);
    expect(series.points.map((p) => p.views)).toEqual([50, 200]);
    expect(series.title).toBe("Hello");
  });
});
