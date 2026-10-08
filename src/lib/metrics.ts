import type {
  AccountRecord,
  MetricOverview,
  MetricSeries,
  MetricSnapshot,
  MetricStatus,
  MetricTotals,
  PlatformMetricOverview,
} from "@/lib/types";

/**
 * The subset of a publish record the metrics layer reads. Accepting a structural
 * type keeps the aggregators pure and unit-testable without the DB.
 */
export type MetricBearing = {
  id: string;
  accountId?: string;
  accountName?: string;
  platform: string;
  publishedAt?: number;
  createdAt: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  favorites: number;
  followsDelta: number;
  completionRate?: number;
  metricStatus: MetricStatus;
  metricsSyncedAt?: number;
};

export function interactionCount(row: MetricBearing) {
  return row.likes + row.comments + row.shares + row.favorites;
}

export function engagementRate(row: MetricBearing) {
  const interactions = interactionCount(row);
  return row.views > 0 ? interactions / row.views : 0;
}

/** "零阅读问题": a collected row that is published but still has no views. */
export function isZeroData(row: MetricBearing) {
  return row.metricStatus === "collected" && row.views === 0;
}

function withinWindow(row: MetricBearing, from: number, to: number) {
  const at = row.publishedAt ?? row.createdAt;
  return at >= from && at <= to;
}

function emptyStatusCounts(): Record<MetricStatus, number> {
  return { pending: 0, collected: 0, stale: 0, failed: 0, dead: 0, manual: 0 };
}

/**
 * Aggregates publish records + accounts into the board payload. `followersByAccount`
 * carries the latest known follower count per account (cumulative, not windowed).
 */
export function summarizeMetrics(
  records: MetricBearing[],
  accounts: Pick<AccountRecord, "id" | "platform">[],
  followersByAccount: Map<string, number>,
  rangeDays: number,
  now = Date.now(),
): MetricOverview {
  const to = now;
  const days = Math.max(1, Math.floor(rangeDays));
  const from = to - days * 24 * 60 * 60 * 1000;
  const windowed = records.filter((row) => withinWindow(row, from, to));

  const statusCounts = emptyStatusCounts();
  for (const row of records) {
    statusCounts[row.metricStatus] = (statusCounts[row.metricStatus] ?? 0) + 1;
  }

  const platformMap = new Map<string, PlatformMetricOverview>();
  const totals: MetricTotals = {
    posts: 0,
    views: 0,
    interactions: 0,
    followers: 0,
    engagementRate: 0,
    completionRate: 0,
    zeroData: 0,
  };
  let completionSum = 0;
  let completionCount = 0;
  let lastSyncedAt: number | undefined;

  for (const row of windowed) {
    const interactions = interactionCount(row);
    totals.posts += 1;
    totals.views += row.views;
    totals.interactions += interactions;
    if (isZeroData(row)) totals.zeroData += 1;
    if (typeof row.completionRate === "number") {
      completionSum += row.completionRate;
      completionCount += 1;
    }
    if (row.metricsSyncedAt && (!lastSyncedAt || row.metricsSyncedAt > lastSyncedAt)) {
      lastSyncedAt = row.metricsSyncedAt;
    }
    const entry =
      platformMap.get(row.platform) ??
      ({ platform: row.platform, posts: 0, views: 0, interactions: 0, followers: 0 } as PlatformMetricOverview);
    entry.posts += 1;
    entry.views += row.views;
    entry.interactions += interactions;
    if (row.metricsSyncedAt && (!entry.lastSyncedAt || row.metricsSyncedAt > entry.lastSyncedAt)) {
      entry.lastSyncedAt = row.metricsSyncedAt;
    }
    platformMap.set(row.platform, entry);
  }

  // Followers are account-level and cumulative: seeded from the latest snapshot
  // per account, attributed to that account's platform.
  for (const account of accounts) {
    const followers = followersByAccount.get(account.id) ?? 0;
    if (followers === 0) continue;
    totals.followers += followers;
    const entry =
      platformMap.get(account.platform) ??
      ({ platform: account.platform, posts: 0, views: 0, interactions: 0, followers: 0 } as PlatformMetricOverview);
    entry.followers += followers;
    platformMap.set(account.platform, entry);
  }

  totals.engagementRate = totals.views > 0 ? totals.interactions / totals.views : 0;
  totals.completionRate = completionCount > 0 ? completionSum / completionCount : 0;

  const byPlatform = Array.from(platformMap.values()).sort(
    (a, b) => b.views - a.views || b.posts - a.posts || a.platform.localeCompare(b.platform),
  );

  return { rangeDays: days, from, to, totals, byPlatform, statusCounts, lastSyncedAt };
}

export function buildMetricSeries(
  record: Pick<MetricBearing, "id" | "platform" | "accountName" | "publishedAt"> & { title?: string },
  snapshots: MetricSnapshot[],
): MetricSeries {
  const points = snapshots
    .slice()
    .sort((a, b) => a.capturedAt - b.capturedAt)
    .map((snapshot) => ({
      capturedAt: snapshot.capturedAt,
      views: snapshot.views,
      likes: snapshot.likes,
      comments: snapshot.comments,
      shares: snapshot.shares,
      favorites: snapshot.favorites,
    }));
  return {
    publishRecordId: record.id,
    title: record.title ?? "",
    platform: record.platform,
    accountName: record.accountName ?? "",
    publishedAt: record.publishedAt,
    points,
  };
}

export type Baseline = {
  accountAvgViews: number;
  platformAvgViews: number;
  accountCount: number;
  platformCount: number;
};

/** How a single record compares to its account's and platform's average views. */
export function computeBaseline(records: MetricBearing[], target: MetricBearing): Baseline {
  let accountSum = 0;
  let accountCount = 0;
  let platformSum = 0;
  let platformCount = 0;
  for (const row of records) {
    if (target.accountId && row.accountId === target.accountId) {
      accountSum += row.views;
      accountCount += 1;
    }
    if (row.platform === target.platform) {
      platformSum += row.views;
      platformCount += 1;
    }
  }
  return {
    accountAvgViews: accountCount > 0 ? Math.round(accountSum / accountCount) : 0,
    platformAvgViews: platformCount > 0 ? Math.round(platformSum / platformCount) : 0,
    accountCount,
    platformCount,
  };
}

export type SlotStat = {
  weekday: number;
  hour: number;
  count: number;
  avgInteractions: number;
};

/** Publishes grouped by weekday × hour, ranked by average interactions. */
export function bestTimeSlots(records: MetricBearing[], limit = 6): SlotStat[] {
  const buckets = new Map<string, { count: number; interactions: number }>();
  for (const row of records) {
    const at = row.publishedAt ?? row.createdAt;
    const date = new Date(at);
    const key = `${date.getDay()}-${date.getHours()}`;
    const bucket = buckets.get(key) ?? { count: 0, interactions: 0 };
    bucket.count += 1;
    bucket.interactions += interactionCount(row);
    buckets.set(key, bucket);
  }
  return Array.from(buckets.entries())
    .map(([key, bucket]) => {
      const [weekday, hour] = key.split("-").map(Number);
      return {
        weekday,
        hour,
        count: bucket.count,
        avgInteractions: bucket.count > 0 ? bucket.interactions / bucket.count : 0,
      };
    })
    .filter((slot) => slot.count >= 1)
    .sort((a, b) => b.avgInteractions - a.avgInteractions || b.count - a.count)
    .slice(0, limit);
}

export function topPerformers<T extends MetricBearing>(records: T[], limit = 5): T[] {
  return records
    .slice()
    .sort((a, b) => interactionCount(b) - interactionCount(a) || b.views - a.views)
    .slice(0, limit);
}

export function zeroPerformers<T extends MetricBearing>(records: T[], limit = 10): T[] {
  return records.filter(isZeroData).slice(0, limit);
}

