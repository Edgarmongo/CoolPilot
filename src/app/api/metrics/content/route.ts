import { listPublishRecords } from "@/db/repository";
import { ok } from "@/lib/api";
import type { MetricStatus } from "@/lib/types";

export const runtime = "nodejs";

/** Content ranking rows for the board. Filtering happens in-memory (small, local dataset). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim().toLowerCase() ?? "";
  const platform = params.get("platform")?.trim() ?? "";
  const accountId = params.get("accountId")?.trim() ?? "";
  const type = params.get("type")?.trim() ?? "";
  const status = (params.get("status")?.trim() ?? "") as MetricStatus | "";
  const rangeDays = Number(params.get("range") || 0);

  let records = await listPublishRecords(1000);
  if (rangeDays > 0) {
    const from = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
    records = records.filter((record) => (record.publishedAt ?? record.createdAt) >= from);
  }
  if (platform) records = records.filter((record) => record.platform === platform);
  if (accountId) records = records.filter((record) => record.accountId === accountId);
  if (type) records = records.filter((record) => record.contentType === type);
  if (status) records = records.filter((record) => record.metricStatus === status);
  if (query) records = records.filter((record) => record.title.toLowerCase().includes(query));

  return ok(records);
}
