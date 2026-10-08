import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { probeModelCapability } from "@/features/ai-runtime/probe";
import { aiModelProbeSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Layer 3 capability detection: sends one real request and records the outcome as a
 * `PROBE_TEST` capability row, which outranks the vendor metadata and the name rules.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, aiModelProbeSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }

  try {
    return ok(await probeModelCapability(parsed.data));
  } catch (error) {
    return failFromError(error, "MODEL_PROBE_FAILED", 502);
  }
}
