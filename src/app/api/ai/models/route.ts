import { listModels, setModelCapability, setModelsEnabled } from "@/db/repositories/ai-runtime";
import { isModelCapability } from "@/features/ai-runtime/contracts";
import {
  ensureModelRuntimeSeeded,
  listProviderViews,
  loadModelDefaults,
  setModelDefaultForCapability,
} from "@/features/ai-runtime/registry";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { aiModelPatchSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const defaultListLimit = 600;

/** Registry model list, filterable by provider / keyword / enabled state. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const providerId = url.searchParams.get("providerId") ?? undefined;
    const keyword = (url.searchParams.get("keyword") ?? "").trim() || undefined;
    const enabledOnly = url.searchParams.get("enabled") === "1";
    const limit = Number(url.searchParams.get("limit") ?? defaultListLimit);

    await ensureModelRuntimeSeeded();
    const [models, providers, defaults] = await Promise.all([
      listModels({ providerId, keyword, enabledOnly, limit: Number.isFinite(limit) ? limit : defaultListLimit }),
      listProviderViews(),
      loadModelDefaults(),
    ]);

    return ok({
      models,
      defaults,
      providers: providers.map((view) => ({
        providerId: view.provider.providerId,
        name: view.provider.name,
        region: view.provider.region,
        enabled: view.provider.enabled,
        modelCount: view.modelCount,
        callableCount: view.callableCount,
        endpointCount: view.endpoints.length,
      })),
    });
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}

/**
 * One body, three actions: enable/disable models, override a capability and set the
 * default model of a capability. Each maps to a registry write, never to raw SQL.
 */
export async function PATCH(request: Request) {
  const parsed = await parseJson(request, aiModelPatchSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }

  try {
    const input = parsed.data;
    let updated = 0;

    if (input.modelRowIds && input.enabled !== undefined) {
      updated += await setModelsEnabled(input.modelRowIds, input.enabled);
    }
    if (input.capability) {
      await setModelCapability({
        modelRowId: input.capability.modelRowId,
        capability: input.capability.capability,
        supported: input.capability.supported,
        source: "USER_OVERRIDE",
      });
      updated += 1;
    }
    if (input.defaultFor && isModelCapability(input.defaultFor.capability)) {
      await setModelDefaultForCapability(input.defaultFor.capability, input.defaultFor.modelRowId);
      updated += 1;
    }

    return ok({ updated, defaults: await loadModelDefaults() });
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}
