import { getLocalAgentSettings } from "@/db/repositories/settings";
import { aiProviderOrder } from "@/features/ai-settings/provider-registry";
import { discoverProviderCatalogs } from "@/features/ai-runtime";
import { AppError } from "@/lib/app-errors";
import { readProviderKeys } from "@/lib/secrets";
import type { LocalAIProvider } from "@/lib/types";

/**
 * Legacy <-> runtime compatibility shims (phase P2 of `docs/generate-migration.md`).
 *
 * Both legacy facades (`lib/ai/generate.ts`, `lib/agent/image-generation.ts`) run on
 * `aiRuntime` now, but the code that calls them was written against the pre-runtime
 * behaviour. Two of those behaviours have no equivalent in the runtime, so they are
 * reproduced here - and nowhere else - until the callers are migrated (P3) and the shims
 * can be deleted (P4):
 *
 *   1. `MissingAIKeyError` - the old "not one key to try" error. `scraper.ts` and
 *      `api/metrics/insights` branch on `instanceof`, and they must keep working (G4).
 *   2. On-demand model discovery - the old path asked the provider for its model list when
 *      nothing was configured (`resolveFirstAvailableModel`), so an install with only an API
 *      key answered out of the box. Routing needs a callable registry row instead (G3).
 */

/** The legacy provider vocabulary (D4). Only these four ever produced a "missing key". */
export type LegacyProvider = LocalAIProvider;

export class MissingAIKeyError extends Error {
  constructor(provider: LegacyProvider) {
    super(`Missing ${provider} API key`);
    this.name = "MissingAIKeyError";
  }
}

/** `MODEL_CREDENTIAL_*`: a key should be there and is not usable. */
const credentialFailureCodes = ["MODEL_CREDENTIAL_MISSING", "MODEL_CREDENTIAL_UNAVAILABLE"] as const;

function isCredentialFailure(error: unknown) {
  return error instanceof AppError && (credentialFailureCodes as readonly string[]).includes(error.code);
}

/** Nothing is routable at all - which for a never-populated registry is normal, not an error. */
function isUnroutable(error: unknown) {
  return (
    error instanceof AppError && (error.code === "MODEL_NOT_CONFIGURED" || error.code === "MODEL_CAPABILITY_UNAVAILABLE")
  );
}

async function hasAnyKey(providerIds: LegacyProvider[]): Promise<boolean> {
  for (const providerId of providerIds) {
    const keys = await readProviderKeys(providerId).catch(() => []);
    if (keys.length > 0) return true;
  }
  return false;
}

/** The legacy provider order (R1): the caller's preference first, then the settings order. */
export async function legacyProviderOrder(preferred?: LegacyProvider): Promise<LegacyProvider[]> {
  const settings = await getLocalAgentSettings().catch(() => null);
  const wanted: Array<LegacyProvider | undefined> = [preferred, settings?.textProvider, ...aiProviderOrder];
  return Array.from(new Set(wanted.filter((entry): entry is LegacyProvider => Boolean(entry))));
}

/** The provider a legacy `MissingAIKeyError` named: the caller's, else the configured text provider. */
export async function preferredTextProvider(preferred?: LegacyProvider): Promise<LegacyProvider> {
  if (preferred) return preferred;
  const settings = await getLocalAgentSettings().catch(() => null);
  return settings?.textProvider ?? "gemini";
}

/** Same for the image path, which has its own configured provider. */
export async function preferredImageProvider(preferred?: "gemini" | "openai"): Promise<"gemini" | "openai"> {
  if (preferred) return preferred;
  const settings = await getLocalAgentSettings().catch(() => null);
  return settings?.imageProvider ?? "openai";
}

/**
 * Runs one runtime call while keeping the legacy error meaning, with a single bounded
 * recovery: if routing finds nothing, discover the catalogs of the providers that already
 * hold a key (never more than once per call) and route again.
 */
export async function withLegacyCompatibility<T>(input: {
  /** Providers the legacy path would have tried, in order - resolved lazily, only on failure. */
  providerIds: () => Promise<LegacyProvider[]>;
  /** Provider name for `MissingAIKeyError`. */
  namedProvider: () => Promise<LegacyProvider>;
  run: () => Promise<T>;
  /** Re-run after the discovery pass; defaults to `run`, because the request is unchanged. */
  rerouted?: () => Promise<T>;
}): Promise<T> {
  try {
    return await input.run();
  } catch (error) {
    if (isCredentialFailure(error)) {
      throw new MissingAIKeyError(await input.namedProvider());
    }
    if (!isUnroutable(error)) throw error;

    const providerIds = await input.providerIds();
    const discovered = await discoverProviderCatalogs(providerIds).catch(() => []);
    if (discovered.length > 0) {
      return await (input.rerouted ?? input.run)();
    }
    // Nothing to discover either: with no key in sight the old path never made an attempt and
    // called that a missing key. Keep the meaning instead of leaking a routing error.
    if (!(await hasAnyKey(providerIds))) {
      throw new MissingAIKeyError(await input.namedProvider());
    }
    throw error;
  }
}
