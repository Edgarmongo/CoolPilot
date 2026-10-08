import { getPublishRecord } from "@/db/repository";
import { listMetricSnapshots } from "@/db/repositories/metrics";
import { fail, ok } from "@/lib/api";
import { buildMetricSeries } from "@/lib/metrics";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return fail("Missing publish record id", 400);
  const record = await getPublishRecord(id);
  if (!record) return fail("Publish record not found", 404);
  const snapshots = await listMetricSnapshots(id);
  return ok(buildMetricSeries(record, snapshots));
}
