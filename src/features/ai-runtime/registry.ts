import { aiProviderOrder, resolveProviderBaseUrl, resolveProviderModel } from "@/features/ai-settings/provider-registry";
import { mainstreamVendorRegistry } from "@/features/ai-settings/mainstream-model-catalog";
import { modelGatewayModels } from "@/features/ai-settings/model-gateway-snapshot";
import { getLocalAgentSettings, readAppSetting, writeAppSetting } from "@/db/repositories/settings";
import {
  countModels,
  findModelsByCapabilities,
  getModelProvider,
  getModelRow,
  listModelEndpoints,
  listModelPreferences,
  listModelProviders,
  listModels,
  setModelPreference,
  setModelsEnabled,
  upsertModelEndpoint,
  upsertModelProvider,
  upsertModels,
} from "@/db/repositories/ai-runtime";
import { describeCredential, credentialRefFor, readCredentialKeys } from "@/lib/credentials";
import { isProtocolImplemented } from "./adapters";
import { planCredentialKeys } from "./key-pool";
import {
  explainRequirement,
  detectCapabilities,
  matchedCapabilities,
  missingCapabilities,
  modelTypeForCapabilities,
  requiredCapabilities,
  type CapabilityExplanation,
} from "./capability";
import { normalizeGatewayModelIds } from "./normalizers";
import type {
  CredentialKeyHealth,
  ModelCandidate,
  ModelCapability,
  ModelEndpointRecord,
  ModelProviderRecord,
  ModelRequirement,
  ModelRouteReason,
} from "./contracts";

/**
 * Model Registry - the single place that answers "which provider / endpoint / model
 * does this requirement resolve to?".
 *
 * Seeding is idempotent: the vendor registry (`mainstream-model-catalog.ts`) and the
 * bundled gateway snapshot are imported once, and everything the user changes
 * afterwards (keys, endpoints, enabled models, defaults) is preserved. The marker in
 * `app_settings` keeps that from repeating on every request.
 */

const seedSettingsKey = "ai-runtime-seed";
/** Bump when the seed logic changes shape; the marker decides whether to re-run it. */
const seedVersion = 2;

/** Vendor ids that reuse an already-configured local provider instead of a new one. */
const vendorProviderAliases: Record<string, string> = {
  google: "gemini",
  llama: "groq",
};

const legacyProviderNames: Record<string, string> = {
  gemini: "Gemini",
  groq: "Groq",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

const gatewayProviderId = "gateway";

async function seedLegacyProviders(sortOrderBase: number) {
  const settings = await getLocalAgentSettings().catch(() => null);
  for (const [index, providerId] of aiProviderOrder.entries()) {
    await upsertModelProvider({
      providerId,
      name: legacyProviderNames[providerId],
      source: "seeded",
      sortOrder: sortOrderBase + index,
    });
    await upsertModelEndpoint({
      endpointId: `${providerId}/default`,
      providerId,
      name: "Default",
      protocol: providerId === "gemini" ? "gemini" : "openai-compatible",
      // Honours GEMINI_BASE_URL / OPENAI_BASE_URL / the settings form, so an existing
      // install keeps calling through whatever endpoint it already used.
      baseUrl: resolveProviderBaseUrl(providerId, settings),
      credentialRef: credentialRefFor(providerId),
    });
  }
}

async function seedVendorProviders(sortOrderBase: number) {
  const existing = new Set((await listModelProviders()).map((provider) => provider.providerId));
  const registered = new Set<string>();

  for (const [index, vendor] of mainstreamVendorRegistry.entries()) {
    const providerId = vendorProviderAliases[vendor.id] ?? vendor.id;
    if (registered.has(providerId)) continue;
    registered.add(providerId);

    const alreadyConfigured = existing.has(providerId);
    await upsertModelProvider({
      providerId,
      name: vendor.name,
      region: vendor.region,
      docsUrl: vendor.docsUrl,
      apiKeyUrl: vendor.apiKeyUrl ?? "",
      source: "vendor-registry",
      sortOrder: alreadyConfigured ? undefined : sortOrderBase + index,
    });

    // Vendors without an OpenAI-compatible endpoint (Anthropic, Midjourney) stay
    // catalog-only: visible, but the runtime never pretends they can be called.
    // Already configured providers keep the endpoint the user set up.
    if (!vendor.compatibleBaseUrl || alreadyConfigured) continue;
    await upsertModelEndpoint({
      endpointId: `${providerId}/default`,
      providerId,
      name: "Default",
      protocol: "openai-compatible",
      baseUrl: vendor.compatibleBaseUrl,
      credentialRef: credentialRefFor(providerId),
    });
  }
}

async function seedGatewayProvider() {
  await upsertModelProvider({
    providerId: gatewayProviderId,
    name: "模型网关 / Model gateway",
    region: "global",
    source: "gateway-snapshot",
    sortOrder: 2000,
  });
}

/**
 * Seeds the bundled gateway snapshot as catalog *knowledge*: unbound endpoint, all
 * models disabled, so 系统 / 模型管理 can show what exists without claiming that any
 * of it is callable.
 */
async function seedGatewayCatalog() {
  const existing = await listModels({ providerId: gatewayProviderId, limit: 4000 });
  if (existing.length === modelGatewayModels.length && existing.length > 0) {
    return;
  }
  await upsertModels({
    providerId: gatewayProviderId,
    endpointId: "",
    models: normalizeGatewayModelIds(modelGatewayModels),
    source: "gateway-snapshot",
    enableNew: false,
  });
}

export async function ensureModelRuntimeSeeded() {
  const marker = (await readAppSetting(seedSettingsKey)) as { version?: unknown };
  if (Number(marker?.version ?? 0) >= seedVersion) {
    return;
  }
  await seedLegacyProviders(0);
  await seedVendorProviders(10);
  await seedGatewayProvider();
  await seedGatewayCatalog();
  // G2: after the registry owns the models, the legacy form's model choices stop being the
  // source of truth for routing - so they are imported once, here.
  await importLegacyAiSettings().catch(() => undefined);
  await writeAppSetting(seedSettingsKey, { version: seedVersion, seededAt: Date.now() });
}

export type ProviderEndpointView = ModelEndpointRecord & {
  credential: Awaited<ReturnType<typeof describeCredential>>;
  /** Live health of every key of this endpoint's credential (masked, never the key). */
  credentialKeys: CredentialKeyHealth[];
  /** Keys that would sign the next call, i.e. not cooling down, invalid or disabled. */
  usableKeyCount: number;
  /** False when no adapter implements this protocol yet (surfaced, never hidden). */
  implemented: boolean;
  modelCount: number;
  callableCount: number;
};

export type ProviderView = {
  provider: ModelProviderRecord;
  endpoints: ProviderEndpointView[];
  modelCount: number;
  callableCount: number;
};

/** Providers + endpoints + credential state + model counts, for 系统 / 模型管理. */
export async function listProviderViews(): Promise<ProviderView[]> {
  await ensureModelRuntimeSeeded();
  const [providers, endpoints, models] = await Promise.all([
    listModelProviders(),
    listModelEndpoints(),
    listModels({ limit: 4000 }),
  ]);

  const views = new Map<string, ProviderView>(
    providers.map((provider) => [provider.providerId, { provider, endpoints: [], modelCount: 0, callableCount: 0 }]),
  );
  const credentials = new Map<string, Awaited<ReturnType<typeof describeCredential>>>();
  const keyHealth = new Map<string, CredentialKeyHealth[]>();

  for (const endpoint of endpoints) {
    const view = views.get(endpoint.providerId);
    if (!view) continue;
    let credential = credentials.get(endpoint.credentialRef);
    if (!credential) {
      credential = await describeCredential(endpoint.credentialRef);
      credentials.set(endpoint.credentialRef, credential);
    }
    // Key rows are refreshed here, so opening 系统 / 模型管理 also reconciles the pool with
    // the credential store (new key pasted, key removed, cooldown expired).
    let keys = keyHealth.get(endpoint.credentialRef);
    if (!keys) {
      keys = credential.configured
        ? (await planCredentialKeys({ ref: endpoint.credentialRef, providerId: endpoint.providerId })).health
        : [];
      keyHealth.set(endpoint.credentialRef, keys);
    }
    view.endpoints.push({
      ...endpoint,
      credential,
      credentialKeys: keys,
      usableKeyCount: keys.filter((entry) => !entry.skipReason).length,
      implemented: isProtocolImplemented(endpoint.protocol),
      modelCount: 0,
      callableCount: 0,
    });
  }

  for (const model of models) {
    const view = views.get(model.providerId);
    if (!view) continue;
    view.modelCount += 1;
    const callable = model.enabled && Boolean(model.endpointId);
    if (callable) view.callableCount += 1;
    const endpointView = view.endpoints.find((endpoint) => endpoint.endpointId === model.endpointId);
    if (endpointView) {
      endpointView.modelCount += 1;
      if (callable) endpointView.callableCount += 1;
    }
  }

  return Array.from(views.values());
}

export type RouteResolution = {
  candidate: ModelCandidate | null;
  /** Every usable candidate, best first - the router's fallback chain. */
  candidates: ModelCandidate[];
  /** Present only when nothing could be routed. */
  explanation?: CapabilityExplanation;
  reason: ModelRouteReason;
  /** The requirement actually enforced (the caller may have relaxed it). */
  requirement: ModelRequirement;
};

function endpointRank(candidate: ModelCandidate) {
  return candidate.endpoint.isDefault ? 0 : 1;
}

function intentModelType(capability: ModelCapability) {
  if (capability === "reasoning") return "reasoning" as const;
  if (capability === "image_generation") return "image" as const;
  if (capability === "video_generation") return "video" as const;
  if (capability === "embedding" || capability === "rerank") return "embedding" as const;
  if (capability === "text_to_speech" || capability === "speech_to_text") return "audio" as const;
  return "chat" as const;
}

/**
 * Model Router (phase 1: deterministic).
 *
 * Order: pinned model → the user's default for that capability → provider sort order →
 * a model whose `model_type` matches the intent → model id. Cost/latency based routing
 * is deliberately not implemented yet; the candidate list is already ordered, so a
 * later phase can re-rank it without touching callers.
 */
export async function resolveRoute(requirement: ModelRequirement): Promise<RouteResolution> {
  await ensureModelRuntimeSeeded();
  const required = requiredCapabilities(requirement);
  const [providers, endpoints, preferences, capabilityModels, allModels] = await Promise.all([
    listModelProviders(),
    listModelEndpoints(),
    listModelPreferences(),
    findModelsByCapabilities({
      capabilities: required,
      providerId: requirement.providerId,
      modelId: requirement.model,
    }),
    // Only used to explain a failure: without it, "no model supports this capability"
    // would be reported as "nothing is synced", which sends the user to the wrong fix.
    findModelsByCapabilities({ providerId: requirement.providerId, modelId: requirement.model }),
  ]);
  const models = capabilityModels.length > 0 ? capabilityModels : allModels;

  const providerById = new Map(providers.map((provider) => [provider.providerId, provider]));
  const endpointById = new Map(endpoints.map((endpoint) => [endpoint.endpointId, endpoint]));
  const credentialCache = new Map<string, boolean>();

  let blockedByProvider = false;
  let blockedByEndpoint = false;
  let blockedByContext = false;

  const candidates: ModelCandidate[] = [];
  for (const model of models) {
    // The capability query already filters, but the explanation path passes a broader
    // list - so the check has to be here too, not only in SQL.
    if (missingCapabilities(model, requirement).length > 0) {
      continue;
    }
    const provider = providerById.get(model.providerId);
    const endpoint = model.endpointId ? endpointById.get(model.endpointId) : undefined;
    if (!provider || !endpoint) {
      blockedByEndpoint = true;
      continue;
    }
    if (!provider.enabled) {
      blockedByProvider = true;
      continue;
    }
    if (!endpoint.enabled) {
      blockedByEndpoint = true;
      continue;
    }
    if (requirement.minContextWindow && (model.contextWindow ?? 0) < requirement.minContextWindow) {
      blockedByContext = true;
      continue;
    }

    let hasCredential = credentialCache.get(endpoint.credentialRef);
    if (hasCredential === undefined) {
      hasCredential = (await readCredentialKeys(endpoint.credentialRef)).length > 0;
      credentialCache.set(endpoint.credentialRef, hasCredential);
    }
    // Gating asks "is a key configured", not "is a key healthy right now": an endpoint whose
    // keys are all cooling down must still be routable, and the pool reports the cooldown
    // as `MODEL_CREDENTIAL_UNAVAILABLE` instead of pretending the model does not exist.
    if (!hasCredential && requirement.requireCredential !== false) {
      continue;
    }

    candidates.push({
      model,
      provider,
      endpoint,
      credentialRef: endpoint.credentialRef,
      hasCredential,
      matched: matchedCapabilities(model, requirement),
    });
  }

  const preference = requirement.capability
    ? preferences.find((entry) => entry.capability === requirement.capability)
    : undefined;
  const intentType = requirement.capability ? intentModelType(requirement.capability) : undefined;
  // Soft preference (G1): a *hint* that reorders candidates, never a filter. The caller can
  // pass one per request; otherwise the user's configured text provider is used, which is
  // what the legacy `generate.ts` `provider` argument meant.
  const preferredProviderId = requirement.preferProviderId ?? (await loadPreferredProviderId());

  candidates.sort((a, b) => {
    const pinned = Number(b.model.modelId === requirement.model) - Number(a.model.modelId === requirement.model);
    if (pinned !== 0) return pinned;
    const preferred = Number(b.model.id === preference?.modelRowId) - Number(a.model.id === preference?.modelRowId);
    if (preferred !== 0) return preferred;
    if (preferredProviderId) {
      const providerPreferred =
        Number(b.provider.providerId === preferredProviderId) - Number(a.provider.providerId === preferredProviderId);
      if (providerPreferred !== 0) return providerPreferred;
    }
    const providerOrder = a.provider.sortOrder - b.provider.sortOrder;
    if (providerOrder !== 0) return providerOrder;
    const endpointOrder = endpointRank(a) - endpointRank(b);
    if (endpointOrder !== 0) return endpointOrder;
    if (intentType) {
      const typeMatch = Number(b.model.modelType === intentType) - Number(a.model.modelType === intentType);
      if (typeMatch !== 0) return typeMatch;
    }
    return a.model.modelId.localeCompare(b.model.modelId);
  });

  if (candidates.length > 0) {
    const picked = candidates[0];
    const reason: ModelRouteReason = requirement.model
      ? "explicit-model"
      : picked.model.id === preference?.modelRowId
        ? "capability-default"
        : "capability-match";
    return { candidate: picked, candidates, reason, requirement };
  }

  const explanation: CapabilityExplanation = blockedByProvider
    ? { reason: "provider-disabled", missing: [] }
    : blockedByEndpoint
      ? { reason: "endpoint-disabled", missing: [] }
      : blockedByContext
        ? { reason: "context-window-too-small", missing: [] }
        : explainRequirement(requirement, models);

  return { candidate: null, candidates: [], explanation, reason: "capability-match", requirement };
}

/** Default model per capability - the 用户默认模型 layer of the router. */
export async function loadModelDefaults() {
  const preferences = await listModelPreferences();
  return Object.fromEntries(
    preferences.map((preference) => [
      preference.capability,
      { modelRowId: preference.modelRowId, providerId: preference.providerId, modelId: preference.modelId },
    ]),
  ) as Partial<Record<ModelCapability, { modelRowId: string; providerId: string; modelId: string }>>;
}

/**
 * The soft provider preference used when a request does not carry one: the text provider
 * the user configured in the legacy settings form. Read live (not copied) so switching the
 * provider in 系统 / 模型配置 still reorders routing immediately. Returns null when that
 * provider is unknown to the registry, so an unseeded install is not biased by a ghost.
 */
export async function loadPreferredProviderId(): Promise<string | null> {
  const settings = await getLocalAgentSettings().catch(() => null);
  const providerId = settings?.textProvider ?? aiProviderOrder[0] ?? null;
  if (!providerId) return null;
  return (await getModelProvider(providerId)) ? providerId : null;
}

/**
 * Legacy settings → registry import (G2).
 *
 * The legacy form (`LocalAgentSettings`) and env vars (`GEMINI_MODEL`, `OPENAI_IMAGE_MODEL`, …)
 * were the only source of truth for "which model should answer" before the runtime existed.
 * After the migration the registry is the source of truth, so this bridge copies that intent
 * once: the configured model of every legacy provider is enabled (and created if the catalog
 * never saw it), and the preferred provider's text model plus the image provider's image
 * model become the capability defaults.
 *
 * Idempotent and additive: existing capability defaults are never overwritten, extra models are
 * never disabled, and a second run reports "kept" instead of changing anything.
 */
export type LegacyAiImportEntry = {
  providerId: string;
  modelId: string;
  capability: ModelCapability;
  action: "enabled" | "created" | "kept";
};

export type LegacyAiImport = {
  preferredProviderId: string;
  entries: LegacyAiImportEntry[];
  defaults: Array<{ capability: ModelCapability; modelId: string; providerId: string; action: "set" | "kept" }>;
};

/**
 * The models the legacy configuration explicitly asked for, and nothing else.
 *
 * Deliberately no "fallback to the legacy catalog" branch: that call is a live network
 * request, and importing a guessed model list during seeding would create rows the user
 * never asked for (and could not be undone by a second run). A provider with a key but no
 * configured model is handled by the registry's own catalog + capability default instead.
 */
function legacyConfiguredModels(configured: string[]) {
  return Array.from(new Set(configured.map((model) => model.trim()).filter(Boolean)));
}

async function ensureLegacyModel(input: {
  providerId: string;
  modelId: string;
  capability: ModelCapability;
}): Promise<LegacyAiImportEntry> {
  const existing = (await listModels({ providerId: input.providerId })).find((model) => model.modelId === input.modelId);
  if (existing) {
    if (!existing.enabled) {
      await setModelsEnabled([existing.id], true);
      return { ...input, action: "enabled" };
    }
    return { ...input, action: "kept" };
  }
  const [endpoint] = (await listModelEndpoints(input.providerId)).filter(
    (entry) => entry.endpointId === `${input.providerId}/default` && entry.enabled,
  );
  const capabilities = detectCapabilities(input.modelId);
  await upsertModels({
    providerId: input.providerId,
    endpointId: endpoint?.endpointId ?? "",
    models: [
      {
        modelId: input.modelId,
        displayName: input.modelId,
        modelType: modelTypeForCapabilities(capabilities),
        contextWindow: null,
        capabilities,
      },
    ],
    source: "legacy-settings",
    // Only reachable when the provider has an endpoint; otherwise it stays knowledge only.
    enableNew: Boolean(endpoint),
  });
  return { ...input, action: "created" };
}

export async function importLegacyAiSettings(): Promise<LegacyAiImport> {
  const settings = await getLocalAgentSettings().catch(() => null);
  const preferredProviderId = settings?.textProvider ?? aiProviderOrder[0] ?? "gemini";
  const entries: LegacyAiImportEntry[] = [];

  for (const providerId of aiProviderOrder) {
    const models = legacyConfiguredModels([resolveProviderModel(providerId, settings)]);
    for (const modelId of models) {
      entries.push(await ensureLegacyModel({ providerId, modelId, capability: "chat" }));
    }
  }
  for (const providerId of ["gemini", "openai"] as const) {
    const configured =
      providerId === "gemini"
        ? [settings?.geminiImageModel ?? "", process.env.GEMINI_IMAGE_MODEL ?? ""]
        : [settings?.openAIImageModel ?? "", process.env.OPENAI_IMAGE_MODEL ?? ""];
    for (const modelId of legacyConfiguredModels(configured)) {
      entries.push(await ensureLegacyModel({ providerId, modelId, capability: "image_generation" }));
    }
  }

  // Capability defaults only when the user has not chosen one yet.
  const existingDefaults = await loadModelDefaults();
  const defaults: LegacyAiImport["defaults"] = [];
  const wanted: Array<{ capability: ModelCapability; providerId: string; modelId: string }> = [];
  const preferredText = entries.find((entry) => entry.capability === "chat" && entry.providerId === preferredProviderId);
  if (preferredText) {
    wanted.push({ capability: "chat", providerId: preferredText.providerId, modelId: preferredText.modelId });
  }
  const preferredImage = entries.find(
    (entry) => entry.capability === "image_generation" && entry.providerId === (settings?.imageProvider ?? "openai"),
  );
  if (preferredImage) {
    wanted.push({
      capability: "image_generation",
      providerId: preferredImage.providerId,
      modelId: preferredImage.modelId,
    });
  }

  for (const entry of wanted) {
    if (existingDefaults[entry.capability]) {
      defaults.push({ ...entry, action: "kept" });
      continue;
    }
    const row = (await listModels({ providerId: entry.providerId })).find((model) => model.modelId === entry.modelId);
    if (!row) {
      defaults.push({ ...entry, action: "kept" });
      continue;
    }
    await setModelDefaultForCapability(entry.capability, row.id);
    defaults.push({ ...entry, action: "set" });
  }

  return { preferredProviderId, entries, defaults };
}

/**
 * Sets the default model of a capability. The model is enabled as a side effect: a
 * default that cannot be called would be a lie, so the two states move together.
 */
export async function setModelDefaultForCapability(capability: ModelCapability, modelRowIdValue: string | null) {
  if (modelRowIdValue) {
    await setModelsEnabled([modelRowIdValue], true);
  }
  await setModelPreference({ capability, modelRowId: modelRowIdValue });
  return loadModelDefaults();
}

/** Model row + endpoint + provider for a row id the caller already knows. */
export async function loadCallableModel(modelRowIdValue: string) {
  const model = await getModelRow(modelRowIdValue);
  if (!model) {
    return null;
  }
  const [endpoints, providers] = await Promise.all([listModelEndpoints(model.providerId), listModelProviders()]);
  const endpoint = endpoints.find((entry) => entry.endpointId === model.endpointId);
  const provider = providers.find((entry) => entry.providerId === model.providerId);
  if (!endpoint || !provider) {
    return null;
  }
  return { model, endpoint, provider };
}

export async function getRuntimeTotals() {
  await ensureModelRuntimeSeeded();
  return countModels();
}
