import { getPublishRecord } from "@/db/repository";
import { createMetricSnapshot, updatePublishRecordMetrics } from "@/db/repositories/metrics";
import { fail, ok, parseJson } from "@/lib/api";
import { metricPatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Manual metric correction. Writes the latest values AND appends a snapshot so
 *  hand-entered data also shows up on the trend chart. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await parseJson(request, metricPatchSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }
  const existing = await getPublishRecord(id);
  if (!existing) {
    return fail("Publish record not found", 404);
  }

  const capturedAt = Date.now();
  await updatePublishRecordMetrics(id, {
    ...parsed.data,
    metricStatus: parsed.data.metricStatus ?? "manual",
    metricsSource: "manual",
    metricsSyncedAt: capturedAt,
  });

  const refreshed = await getPublishRecord(id);
  if (refreshed) {
    await createMetricSnapshot({
      publishRecordId: id,
      accountId: refreshed.accountId,
      platform: refreshed.platform,
      contentItemId: refreshed.contentItemId,
      capturedAt,
      views: refreshed.views,
      likes: refreshed.likes,
      comments: refreshed.comments,
      shares: refreshed.shares,
      favorites: refreshed.favorites,
      followsDelta: refreshed.followsDelta,
      completionRate: refreshed.completionRate ?? null,
      source: "manual",
    });
  }
  return ok(refreshed);
}
