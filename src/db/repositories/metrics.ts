import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, ensureDatabase } from "@/db/client";
import { accountMetricSnapshots, metricSnapshots, publishRecords } from "@/db/schema";
import type {
  AccountMetricSnapshot,
  MetricSnapshot,
  MetricSource,
  MetricStatus,
  PublishRecord,
} from "@/lib/types";

function now() {
  return Date.now();
}

function parseExtra(value: string): Record<string, number> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function toMetricSnapshot(row: typeof metricSnapshots.$inferSelect): MetricSnapshot {
  return {
    id: row.id,
    publishRecordId: row.publishRecordId,
    accountId: row.accountId ?? undefined,
    platform: row.platform,
    contentItemId: row.contentItemId ?? undefined,
    capturedAt: row.capturedAt,
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    favorites: row.favorites,
    followsDelta: row.followsDelta,
    completionRate: row.completionRate ?? undefined,
    extra: parseExtra(row.extraJson),
    source: row.source as MetricSource,
    createdAt: row.createdAt,
  };
}

function toAccountMetricSnapshot(row: typeof accountMetricSnapshots.$inferSelect): AccountMetricSnapshot {
  return {
    id: row.id,
    accountId: row.accountId,
    platform: row.platform,
    capturedAt: row.capturedAt,
    followers: row.followers,
    postsCount: row.postsCount,
    extra: parseExtra(row.extraJson),
    source: row.source as MetricSource,
    createdAt: row.createdAt,
  };
}

export type MetricUpdate = {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  favorites?: number;
  followsDelta?: number;
  completionRate?: number | null;
  metricStatus?: MetricStatus;
  metricsSource?: MetricSource;
  metricsSyncedAt?: number | null;
};

/** Appends one immutable metric sample for a publish record. */
export async function createMetricSnapshot(input: {
  publishRecordId: string;
  accountId?: string;
  platform?: string;
  contentItemId?: string;
  capturedAt?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  favorites?: number;
  followsDelta?: number;
  completionRate?: number | null;
  extra?: Record<string, number>;
  source?: MetricSource;
}) {
  await ensureDatabase();
  const createdAt = now();
  const id = nanoid();
  await db.insert(metricSnapshots).values({
    id,
    publishRecordId: input.publishRecordId,
    accountId: input.accountId,
    platform: input.platform ?? "",
    contentItemId: input.contentItemId,
    capturedAt: input.capturedAt ?? createdAt,
    views: Math.max(0, Math.trunc(input.views ?? 0)),
    likes: Math.max(0, Math.trunc(input.likes ?? 0)),
    comments: Math.max(0, Math.trunc(input.comments ?? 0)),
    shares: Math.max(0, Math.trunc(input.shares ?? 0)),
    favorites: Math.max(0, Math.trunc(input.favorites ?? 0)),
    followsDelta: Math.trunc(input.followsDelta ?? 0),
    completionRate: input.completionRate ?? null,
    extraJson: JSON.stringify(input.extra ?? {}),
    source: input.source ?? "browser",
    createdAt,
  });
  const [row] = await db.select().from(metricSnapshots).where(eq(metricSnapshots.id, id)).limit(1);
  return toMetricSnapshot(row);
}

export async function listMetricSnapshots(publishRecordId: string, limit = 200) {
  await ensureDatabase();
  const rows = await db
    .select()
    .from(metricSnapshots)
    .where(eq(metricSnapshots.publishRecordId, publishRecordId))
    .orderBy(asc(metricSnapshots.capturedAt))
    .limit(limit);
  return rows.map(toMetricSnapshot);
}

export async function createAccountMetricSnapshot(input: {
  accountId: string;
  platform?: string;
  capturedAt?: number;
  followers?: number;
  postsCount?: number;
  extra?: Record<string, number>;
  source?: MetricSource;
}) {
  await ensureDatabase();
  const createdAt = now();
  const id = nanoid();
  await db.insert(accountMetricSnapshots).values({
    id,
    accountId: input.accountId,
    platform: input.platform ?? "",
    capturedAt: input.capturedAt ?? createdAt,
    followers: Math.max(0, Math.trunc(input.followers ?? 0)),
    postsCount: Math.max(0, Math.trunc(input.postsCount ?? 0)),
    extraJson: JSON.stringify(input.extra ?? {}),
    source: input.source ?? "browser",
    createdAt,
  });
  const [row] = await db.select().from(accountMetricSnapshots).where(eq(accountMetricSnapshots.id, id)).limit(1);
  return toAccountMetricSnapshot(row);
}

export async function listAccountMetricSnapshots(limit = 1000) {
  await ensureDatabase();
  const rows = await db
    .select()
    .from(accountMetricSnapshots)
    .orderBy(desc(accountMetricSnapshots.capturedAt))
    .limit(limit);
  return rows.map(toAccountMetricSnapshot);
}

/** Latest account snapshot per account, keyed by accountId. */
export async function latestAccountMetricSnapshots() {
  const snapshots = await listAccountMetricSnapshots();
  const latest = new Map<string, AccountMetricSnapshot>();
  for (const snapshot of snapshots) {
    if (!latest.has(snapshot.accountId)) {
      latest.set(snapshot.accountId, snapshot);
    }
  }
  return latest;
}

/** Writes the latest metric values onto a publish record (the ranking cache). */
export async function updatePublishRecordMetrics(id: string, patch: MetricUpdate) {
  await ensureDatabase();
  const values: Partial<typeof publishRecords.$inferInsert> = { updatedAt: now() };
  if (patch.views !== undefined) values.views = Math.max(0, Math.trunc(patch.views));
  if (patch.likes !== undefined) values.likes = Math.max(0, Math.trunc(patch.likes));
  if (patch.comments !== undefined) values.comments = Math.max(0, Math.trunc(patch.comments));
  if (patch.shares !== undefined) values.shares = Math.max(0, Math.trunc(patch.shares));
  if (patch.favorites !== undefined) values.favorites = Math.max(0, Math.trunc(patch.favorites));
  if (patch.followsDelta !== undefined) values.followsDelta = Math.trunc(patch.followsDelta);
  if (patch.completionRate !== undefined) values.completionRate = patch.completionRate;
  if (patch.metricStatus !== undefined) values.metricStatus = patch.metricStatus;
  if (patch.metricsSource !== undefined) values.metricsSource = patch.metricsSource;
  if (patch.metricsSyncedAt !== undefined) values.metricsSyncedAt = patch.metricsSyncedAt;
  await db.update(publishRecords).set(values).where(eq(publishRecords.id, id));
  const [row] = await db.select().from(publishRecords).where(eq(publishRecords.id, id)).limit(1);
  return row
    ? ({
        id: row.id,
        metricStatus: row.metricStatus as MetricStatus,
        metricsSyncedAt: row.metricsSyncedAt ?? undefined,
      } as Pick<PublishRecord, "id" | "metricStatus" | "metricsSyncedAt">)
    : null;
}

/**
 * Published records whose metrics should be (re)collected, optionally narrowed
 * to a set of accounts, a platform or a single record.
 */
export async function listRecordsDueForMetrics(
  input: {
    accountIds?: string[];
    platform?: string;
    publishRecordId?: string;
    limit?: number;
  } = {},
) {
  await ensureDatabase();
  const conditions = [eq(publishRecords.status, "published")];
  if (input.accountIds?.length) {
    conditions.push(inArray(publishRecords.accountId, input.accountIds));
  }
  if (input.platform) {
    conditions.push(eq(publishRecords.platform, input.platform));
  }
  if (input.publishRecordId) {
    conditions.push(eq(publishRecords.id, input.publishRecordId));
  }
  const rows = await db
    .select()
    .from(publishRecords)
    .where(and(...conditions))
    .orderBy(desc(publishRecords.publishedAt))
    .limit(Math.min(Math.max(1, input.limit ?? 500), 2000));
  return rows.map((row) => ({
    id: row.id,
    accountId: row.accountId ?? undefined,
    accountName: row.accountName,
    platform: row.platform,
    title: row.title,
    url: row.url,
    contentType: row.contentType,
    contentItemId: row.contentItemId ?? undefined,
    publishedAt: row.publishedAt ?? undefined,
    metricStatus: row.metricStatus as MetricStatus,
    metricsSyncedAt: row.metricsSyncedAt ?? undefined,
  }));
}

/** Convenience counter: how many published records are still missing metrics. */
export async function countRecordsMissingMetrics() {
  await ensureDatabase();
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(publishRecords)
    .where(and(eq(publishRecords.status, "published"), eq(publishRecords.metricStatus, "pending")));
  return Number(row?.total ?? 0);
}
