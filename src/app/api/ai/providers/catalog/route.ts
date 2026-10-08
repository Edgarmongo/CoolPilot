import { fail, failFromError, ok } from "@/lib/api";
import { fetchProviderCatalog } from "@/features/ai-runtime/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live model list of one provider, without persisting anything. Used by 系统 / 模型管理
 * to preview what a sync would import before it touches the registry.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const providerId = url.searchParams.get("providerId") ?? "";
    const keyword = (url.searchParams.get("keyword") ?? "").trim().toLowerCase();
    if (!providerId) {
      return fail("INVALID_PAYLOAD", 400, { providerId });
    }

    const { endpoint, models } = await fetchProviderCatalog(providerId);
    const filtered = keyword ? models.filter((model) => model.modelId.toLowerCase().includes(keyword)) : models;

    return ok({
      providerId,
      endpointId: endpoint.endpointId,
      total: models.length,
      matched: filtered.length,
      models: filtered.slice(0, 200).map((model) => ({
        modelId: model.modelId,
        displayName: model.displayName,
        modelType: model.modelType,
        capabilities: model.capabilities,
      })),
    });
  } catch (error) {
    return failFromError(error, "MODEL_SYNC_FAILED", 502);
  }
}
