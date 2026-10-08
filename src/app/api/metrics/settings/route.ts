import { getMetricsSettings, updateMetricsSettings } from "@/db/repositories/settings";
import { fail, ok, parseJson } from "@/lib/api";
import { metricSettingsSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  return ok(await getMetricsSettings());
}

export async function PATCH(request: Request) {
  const parsed = await parseJson(request, metricSettingsSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }
  return ok(await updateMetricsSettings(parsed.data));
}
