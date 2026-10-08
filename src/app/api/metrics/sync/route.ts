import { fail, ok, parseJson } from "@/lib/api";
import { getMetricsSyncState, startMetricsSync } from "@/lib/metric-sync";
import { metricSyncSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  return ok(getMetricsSyncState());
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, metricSyncSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }
  return ok(startMetricsSync(parsed.data));
}
