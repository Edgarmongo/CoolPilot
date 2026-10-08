import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Exercises the metrics migrations + repository round-trip against a throwaway
 * SQLite file. This guards the ordering in `initializeDatabase`: the
 * `publish_records(metric_status)` index must be created *after* the ALTER TABLE
 * that adds the column, otherwise migration aborts with "no such column".
 */
describe("metrics repository", () => {
  it("round-trips metrics through migrations and the repository", async () => {
    const previousUrl = process.env.SOCIAL_AUTO_POST_DB_URL;
    const dir = mkdtempSync(path.join(tmpdir(), "coolpilot-metrics-"));
    process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dir, "metrics.db").replace(/\\/g, "/")}`;

    try {
      const repo = await import("@/db/repository");
      const metricsRepo = await import("@/db/repositories/metrics");

      // listAccounts triggers initializeDatabase(), which runs the migrations.
      await repo.listAccounts();

      const record = await repo.createPublishRecord({
        platform: "知乎",
        accountName: "Main",
        title: "Local-first analytics",
        contentType: "article",
        status: "published",
      });
      expect(record?.metricStatus).toBe("pending");
      expect(record?.views).toBe(0);

      await metricsRepo.updatePublishRecordMetrics(record!.id, {
        views: 1204,
        likes: 32,
        comments: 6,
        favorites: 12,
        metricStatus: "collected",
        metricsSource: "browser",
        metricsSyncedAt: Date.now(),
      });

      const list = await repo.listPublishRecords(10);
      expect(list[0].views).toBe(1204);
      expect(list[0].metricStatus).toBe("collected");

      const snapshot = await metricsRepo.createMetricSnapshot({
        publishRecordId: record!.id,
        platform: "知乎",
        views: 1204,
        likes: 32,
        source: "browser",
      });
      expect(snapshot.views).toBe(1204);

      const snapshots = await metricsRepo.listMetricSnapshots(record!.id);
      expect(snapshots).toHaveLength(1);

      const due = await metricsRepo.listRecordsDueForMetrics({});
      expect(due).toHaveLength(1);
      expect(due[0].title).toBe("Local-first analytics");

      await repo.deletePublishRecord(record!.id);
      expect(await repo.listPublishRecords(10)).toHaveLength(0);
    } finally {
      if (previousUrl === undefined) {
        delete process.env.SOCIAL_AUTO_POST_DB_URL;
      } else {
        process.env.SOCIAL_AUTO_POST_DB_URL = previousUrl;
      }
    }
  });
});
