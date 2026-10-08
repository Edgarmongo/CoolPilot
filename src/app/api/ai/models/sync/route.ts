import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { syncProviderCatalog } from "@/features/ai-runtime/sync";
import { loadModelDefaults } from "@/features/ai-runtime/registry";
import { aiModelSyncSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pulls one provider's live model catalog into the registry. Capability rows owned by
 * a probe or by the user survive the refresh; new models of a provider with a working
 * credential arrive enabled.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, aiModelSyncSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }

  try {
    const result = await syncProviderCatalog(parsed.data.providerId);
    return ok({
      providerId: result.providerId,
      endpointId: result.endpointId,
      status: result.status,
      modelCount: result.modelCount,
      created: result.created,
      updated: result.updated,
      message: result.message,
      sample: result.models.slice(0, 12).map((model) => model.modelId),
      defaults: await loadModelDefaults(),
    });
  } catch (error) {
    return failFromError(error, "MODEL_SYNC_FAILED", 502);
  }
}
