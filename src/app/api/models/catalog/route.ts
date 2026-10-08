import { getLocalAgentSettings } from "@/db/repositories/settings";
import {
  findMainstreamVendor,
  mainstreamModelCapabilities,
  mainstreamVendorRegistry,
  normalizeEndpoint,
  type MainstreamProviderStatus,
} from "@/features/ai-settings/mainstream-model-catalog";
import { buildGatewayVendorGroups, countGatewayModelsByCapability } from "@/features/ai-settings/model-gateway-catalog";
import { getModelGatewayState, resolveModelGatewayCatalog } from "@/features/ai-settings/model-gateway-sync";
import { aiProviderOrder, resolveProviderBaseUrl, resolveProviderModel } from "@/features/ai-settings/provider-registry";
import { failFromError, ok } from "@/lib/api";
import { readProviderKeys } from "@/lib/secrets";
import type { LocalAIProvider } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getLocalAgentSettings();
    const keyed = Object.fromEntries(
      await Promise.all(
        aiProviderOrder.map(async (provider) => [provider, Boolean((await readProviderKeys(provider))[0])] as const),
      ),
    ) as Record<LocalAIProvider, boolean>;

    const providers = aiProviderOrder.map((provider) => ({
      id: provider,
      configured: keyed[provider],
      baseUrl: resolveProviderBaseUrl(provider, settings),
      model: resolveProviderModel(provider, settings),
    }));
    const baseUrls = Object.fromEntries(providers.map((provider) => [provider.id, provider.baseUrl])) as Record<
      LocalAIProvider,
      string
    >;

    // Serves the user's own synced gateway list when the feature switch is on,
    // otherwise the snapshot bundled by scripts/import-gateway-models.ts.
    const [catalog, gateway] = await Promise.all([resolveModelGatewayCatalog(), getModelGatewayState()]);

    const vendors = buildGatewayVendorGroups(catalog.models).map((group) => {
      const metadata = findMainstreamVendor(group.id);
      const provider = metadata?.localProvider ?? null;
      let status: MainstreamProviderStatus = "external";
      if (provider) {
        if (!keyed[provider]) {
          status = "missing-key";
        } else if (metadata?.compatibleBaseUrl && normalizeEndpoint(metadata.compatibleBaseUrl) !== normalizeEndpoint(baseUrls[provider])) {
          status = "key-only";
        } else {
          status = "ready";
        }
      }
      return {
        ...group,
        region: metadata?.region ?? group.region,
        docsUrl: metadata?.docsUrl ?? null,
        apiKeyUrl: metadata?.apiKeyUrl ?? null,
        compatibleBaseUrl: metadata?.compatibleBaseUrl ?? null,
        provider,
        baseUrl: provider ? baseUrls[provider] : "",
        status,
      };
    });

    const capabilityCounts = countGatewayModelsByCapability(catalog.models);

    return ok({
      source: catalog.source,
      capturedAt: catalog.capturedAt,
      total: catalog.models.length,
      usingSyncedModels: catalog.usingSyncedModels,
      gateway,
      runtimeMode: settings.runtimeMode,
      providers,
      capabilities: mainstreamModelCapabilities.map((id) => ({ id, count: capabilityCounts[id] })),
      documentedVendors: mainstreamVendorRegistry.length,
      vendors,
    });
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}
