import { listAccounts } from "@/db/repository";
import {
  createAccountMetricSnapshot,
  createMetricSnapshot,
  listRecordsDueForMetrics,
  updatePublishRecordMetrics,
} from "@/db/repositories/metrics";
import { getMetricsSettings } from "@/db/repositories/settings";
import { collectAccountMetrics } from "@/lib/metric-collector";

export type MetricsSyncScope = {
  accountId?: string;
  platform?: string;
  publishRecordId?: string;
};

export type MetricsSyncState = {
  state: "idle" | "running" | "done" | "failed";
  startedAt?: number;
  finishedAt?: number;
  total: number;
  processed: number;
  updated: number;
  failed: number;
  message?: string;
  scope: MetricsSyncScope;
};

const IDLE_STATE: MetricsSyncState = {
  state: "idle",
  total: 0,
  processed: 0,
  updated: 0,
  failed: 0,
  scope: {},
};

// Single-user local app: one sync runs at a time, tracked in a module singleton
// so the UI can poll progress (mirrors the browser-preview store approach).
let current: MetricsSyncState = { ...IDLE_STATE };
let running = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getMetricsSyncState(): MetricsSyncState {
  return { ...current };
}

export function startMetricsSync(scope: MetricsSyncScope = {}): MetricsSyncState {
  if (running) {
    return getMetricsSyncState();
  }
  running = true;
  current = {
    state: "running",
    startedAt: Date.now(),
    total: 0,
    processed: 0,
    updated: 0,
    failed: 0,
    scope,
  };
  void run(scope).finally(() => {
    running = false;
  });
  return getMetricsSyncState();
}

async function run(scope: MetricsSyncScope) {
  try {
    const settings = await getMetricsSettings();
    const accounts = (await listAccounts()).filter(
      (account) =>
        (!scope.accountId || account.id === scope.accountId) &&
        (!scope.platform || account.platform === scope.platform),
    );
    const due = await listRecordsDueForMetrics({
      accountIds: accounts.map((account) => account.id),
      platform: scope.platform,
      publishRecordId: scope.publishRecordId,
    });
    current.total = due.length;

    const byAccount = new Map<string, typeof due>();
    for (const record of due) {
      const key = record.accountId ?? "";
      byAccount.set(key, [...(byAccount.get(key) ?? []), record]);
    }

    const capturedAt = Date.now();
    for (const account of accounts) {
      const accountRecords = byAccount.get(account.id);
      if (!accountRecords || accountRecords.length === 0) continue;

      const result = await collectAccountMetrics(
        account,
        accountRecords.map((record) => ({ id: record.id, title: record.title })),
      );

      if (result.loginRequired || result.error) {
        for (const record of accountRecords) {
          await updatePublishRecordMetrics(record.id, { metricStatus: "failed", metricsSyncedAt: capturedAt });
          current.processed += 1;
          current.failed += 1;
        }
        if (settings.perAccountThrottleMs > 0) await sleep(settings.perAccountThrottleMs);
        continue;
      }

      for (const reading of result.readings) {
        const dueRecord = accountRecords.find((record) => record.id === reading.recordId);
        if (!reading.matched) {
          // Title missing from the creator list: treat as removed/dead.
          await updatePublishRecordMetrics(reading.recordId, { metricStatus: "dead", metricsSyncedAt: capturedAt });
          current.processed += 1;
          current.failed += 1;
          continue;
        }
        const values = {
          views: reading.views ?? 0,
          likes: reading.likes ?? 0,
          comments: reading.comments ?? 0,
          shares: reading.shares ?? 0,
          favorites: reading.favorites ?? 0,
          completionRate: reading.completionRate ?? null,
        };
        await updatePublishRecordMetrics(reading.recordId, {
          ...values,
          metricStatus: "collected",
          metricsSource: "browser",
          metricsSyncedAt: capturedAt,
        });
        await createMetricSnapshot({
          publishRecordId: reading.recordId,
          accountId: account.id,
          platform: account.platform,
          contentItemId: dueRecord?.contentItemId,
          capturedAt,
          ...values,
          source: "browser",
        });
        current.processed += 1;
        current.updated += 1;
      }

      if (typeof result.followers === "number") {
        await createAccountMetricSnapshot({
          accountId: account.id,
          platform: account.platform,
          capturedAt,
          followers: result.followers,
          source: "browser",
        });
      }

      if (settings.perAccountThrottleMs > 0) await sleep(settings.perAccountThrottleMs);
    }

    current.state = "done";
    current.finishedAt = Date.now();
  } catch (error) {
    current.state = "failed";
    current.finishedAt = Date.now();
    current.message = error instanceof Error ? error.message : String(error);
  }
}
