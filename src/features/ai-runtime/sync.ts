import { AppError } from "@/lib/app-errors";
import {
  insertSyncRecord,
  listModelEndpoints,
  listModels,
  getModelProvider,
  setEndpointStatus,
  upsertModels,
} from "@/db/repositories/ai-runtime";
import { readCredentialKeys } from "@/lib/credentials";
import { runWithCredentialKey } from "./key-pool";
import { adapterFor } from "./adapters";
import type { ModelSyncRecord, NormalizedModel } from "./contracts";

/**
 * Model catalog sync: one provider → live model list → normalized → registry.
 *
 * Discovery never destroys user state. New models of a provider whose credential
 * resolves are enabled (that is the "I added my key, make it work" path); everything
 * the user switched off stays off, and capability rows owned by a probe or by the
 * user survive (`upsertModels`).
 */

export type CatalogSyncResult = {
  providerId: string;
  endpointId: string;
  status: "ok" | "error";
  modelCount: number;
  created: number;
  updated: number;
  message: string;
  models: NormalizedModel[];
};

/** Live catalog of one provider, without persisting anything. */
export async function fetchProviderCatalog(providerId: string) {
  const [provider, endpoints] = await Promise.all([getModelProvider(providerId), listModelEndpoints(providerId)]);
  if (!provider) {
    throw new AppError("MODEL_PROVIDER_NOT_FOUND", { status: 404, details: { providerId } });
  }
  const endpoint = endpoints.find((entry) => entry.isDefault && entry.enabled) ?? endpoints.find((entry) => entry.enabled);
  if (!endpoint) {
    throw new AppError("MODEL_ENDPOINT_INVALID", {
      status: 400,
      message: `${provider.name} has no callable endpoint configured`,
      details: { providerId },
    });
  }
  const adapter = adapterFor(endpoint.protocol);
  // Listing models is a real call: rotate keys and feed the health back into the pool, so
  // a 429 during a sync does not silently take a provider offline.
  const { value: models } = await runWithCredentialKey(
    { ref: endpoint.credentialRef, providerId, allowKeyless: true },
    (secret) => adapter.listModels({ provider, endpoint, credential: secret }),
  );
  return { provider, endpoint, models };
}

export async function syncProviderCatalog(providerId: string): Promise<CatalogSyncResult> {
  const startedAt = Date.now();
  const { provider, endpoint, models } = await fetchProviderCatalog(providerId).catch(async (error: unknown) => {
    const failure = error instanceof AppError ? error : new AppError("MODEL_SYNC_FAILED", { message: (error as Error).message });
    const failureRecord: ModelSyncRecord = {
      providerId,
      endpointId: `${providerId}/default`,
      status: "error",
      modelCount: 0,
      message: failure.message,
      startedAt,
      finishedAt: Date.now(),
    };
    await insertSyncRecord(failureRecord).catch(() => undefined);
    await setEndpointStatus(failureRecord.endpointId, "error", failure.message).catch(() => undefined);
    throw failure;
  });

  if (models.length === 0) {
    const message = `${provider.name} returned no models`;
    await insertSyncRecord({
      providerId,
      endpointId: endpoint.endpointId,
      status: "error",
      modelCount: 0,
      message,
      startedAt,
      finishedAt: Date.now(),
    });
    await setEndpointStatus(endpoint.endpointId, "error", message);
    throw new AppError("MODEL_SYNC_FAILED", { status: 502, message, details: { providerId } });
  }

  const credentialKeys = await readCredentialKeys(endpoint.credentialRef);
  const applied = await upsertModels({
    providerId,
    endpointId: endpoint.endpointId,
    models,
    source: "sync",
    // A provider the user gave a key to becomes callable; without a key the models
    // are recorded as discovered only.
    enableNew: credentialKeys.length > 0,
  });

  const finishedAt = Date.now();
  const message = `${applied.created} new / ${applied.updated} known`;
  await insertSyncRecord({
    providerId,
    endpointId: endpoint.endpointId,
    status: "ok",
    modelCount: models.length,
    message,
    startedAt,
    finishedAt,
  });
  await setEndpointStatus(endpoint.endpointId, "ok", `${models.length} models`);

  return {
    providerId,
    endpointId: endpoint.endpointId,
    status: "ok",
    modelCount: models.length,
    created: applied.created,
    updated: applied.updated,
    message,
    models,
  };
}

/**
 * One bounded discovery pass for providers the user already gave a key to but never synced.
 *
 * The pre-runtime path resolved a model on demand (`/models` → first usable id), so an install
 * that only had a key still worked. Routing needs a callable registry row instead, so the
 * legacy facade used to ask for this pass when routing found nothing at all
 * (`docs/generate-migration.md`, G3); the caller is now the seed's cold-start pass
 * (`ensureColdStartCatalogs` in `./registry`), which is also what keeps routing offline.
 * Best-effort by design: a provider that is already
 * callable or has no credential is skipped without a network call, and a failing sync is
 * swallowed so the caller keeps reporting its own routing error.
 */
export async function discoverProviderCatalogs(providerIds: string[]): Promise<string[]> {
  const discovered: string[] = [];
  for (const providerId of new Set(providerIds)) {
    const endpoints = await listModelEndpoints(providerId).catch(() => []);
    const endpoint =
      endpoints.find((entry) => entry.isDefault && entry.enabled) ?? endpoints.find((entry) => entry.enabled);
    if (!endpoint) continue;
    // Without a key the sync only records knowledge (`enableNew: false`), so it cannot make
    // the provider callable - and the legacy path failed in that case too.
    if ((await readCredentialKeys(endpoint.credentialRef)).length === 0) continue;
    const models = await listModels({ providerId }).catch(() => []);
    if (models.some((model) => model.enabled)) continue;
    const result = await syncProviderCatalog(providerId).catch(() => null);
    if (result) discovered.push(providerId);
  }
  return discovered;
}
