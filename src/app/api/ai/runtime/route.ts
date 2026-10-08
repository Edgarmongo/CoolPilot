import { countModelsByCapability, listSyncRecords } from "@/db/repositories/ai-runtime";
import { implementedProtocols } from "@/features/ai-runtime/adapters";
import { modelCapabilities, modelProtocols } from "@/features/ai-runtime/contracts";
import { getRuntimeTotals, listProviderViews, loadModelDefaults } from "@/features/ai-runtime/registry";
import { failFromError, ok } from "@/lib/api";
import { osSecureStorage } from "@/lib/credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Snapshot of the AI runtime for 系统 / 模型管理: providers with their endpoints and
 * credential state, the per-capability 可见 / 可调 counters, the default model of each
 * capability and the recent catalog syncs. Never contains a secret.
 */
export async function GET() {
  try {
    const [providers, defaults, counts, totals, syncs] = await Promise.all([
      listProviderViews(),
      loadModelDefaults(),
      countModelsByCapability(),
      getRuntimeTotals(),
      listSyncRecords(10),
    ]);

    return ok({
      providers,
      defaults,
      totals,
      syncs,
      protocols: modelProtocols,
      implementedProtocols,
      osSecureStorage,
      capabilities: modelCapabilities.map((capability) => ({
        capability,
        total: counts[capability]?.total ?? 0,
        callable: counts[capability]?.callable ?? 0,
      })),
    });
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}
