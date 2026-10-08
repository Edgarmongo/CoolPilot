import { fail, failFromError, ok, parseJson } from "@/lib/api";
import {
  getModelGatewayState,
  resetModelGateway,
  saveModelGatewaySettings,
  syncModelGateway,
} from "@/features/ai-settings/model-gateway-sync";
import { modelGatewayActionSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current state of the manual model-gateway sync (never exposes the cookie). */
export async function GET() {
  try {
    return ok(await getModelGatewayState());
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}

/**
 * `save` stores the feature switch, endpoint and account cookie; `sync` pulls the
 * live model list; `reset` drops both the synced list and the stored cookie.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, modelGatewayActionSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }

  try {
    if (parsed.data.action === "save") {
      return ok(await saveModelGatewaySettings(parsed.data));
    }
    if (parsed.data.action === "sync") {
      return ok(await syncModelGateway());
    }
    return ok(await resetModelGateway());
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}
