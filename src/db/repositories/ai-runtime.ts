import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, ensureDatabase } from "@/db/client";
import {
  aiCredentialKeys,
  aiModelCapabilities,
  aiModelEndpoints,
  aiModelPreferences,
  aiModelProviders,
  aiModels,
  aiProbeResults,
  aiSyncRecords,
} from "@/db/schema";
import { modelTypeForCapabilities } from "@/features/ai-runtime/capability";
import {
  isCredentialKeyStatus,
  isModelCapability,
  isModelCapabilitySource,
  isModelProtocol,
  isModelType,
  type CapabilityRecord,
  type CredentialKeyRecord,
  type CredentialKeyStatus,
  type ModelCapability,
  type ModelCapabilitySource,
  type ModelEndpointRecord,
  type ModelProbeRecord,
  type ModelProviderRecord,
  type ModelRecord,
  type ModelSyncRecord,
  type NormalizedModel,
} from "@/features/ai-runtime/contracts";

/**
 * Persistence for the AI runtime: row <-> record mapping plus the queries the registry
 * needs. No policy (routing, seeding, health checks) lives here.
 */

/** libsql/SQLite have a bounded number of bound parameters per statement. */
const chunkSize = 200;

function chunk<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function emptyChunks(items: string[]) {
  return items.length === 0 ? [] : chunk(items);
}

function toProvider(row: typeof aiModelProviders.$inferSelect): ModelProviderRecord {
  return {
    providerId: row.providerId,
    name: row.name,
    region: row.region,
    docsUrl: row.docsUrl,
    apiKeyUrl: row.apiKeyUrl,
    enabled: row.enabled,
    source: row.source,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toEndpoint(row: typeof aiModelEndpoints.$inferSelect): ModelEndpointRecord {
  return {
    endpointId: row.endpointId,
    providerId: row.providerId,
    name: row.name,
    protocol: isModelProtocol(row.protocol) ? row.protocol : "openai-compatible",
    baseUrl: row.baseUrl,
    credentialRef: row.credentialRef,
    enabled: row.enabled,
    isDefault: row.isDefault,
    status: row.status,
    lastCheckAt: row.lastCheckAt,
    lastCheckMessage: row.lastCheckMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCapability(row: typeof aiModelCapabilities.$inferSelect): CapabilityRecord | null {
  if (!isModelCapability(row.capability) || !isModelCapabilitySource(row.source)) {
    return null;
  }
  return {
    capability: row.capability,
    supported: row.supported,
    source: row.source,
    confidence: row.confidence,
  };
}

function toModel(row: typeof aiModels.$inferSelect, capabilities: CapabilityRecord[]): ModelRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    endpointId: row.endpointId,
    modelId: row.modelId,
    displayName: row.displayName || row.modelId,
    modelType: isModelType(row.modelType) ? row.modelType : "unknown",
    contextWindow: row.contextWindow,
    enabled: row.enabled,
    source: row.source,
    syncedAt: row.syncedAt,
    capabilities,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Deterministic row id so a re-sync updates a model instead of duplicating it. */
export function modelRowId(providerId: string, endpointId: string, modelId: string) {
  return `${providerId}:${endpointId}:${modelId}`;
}

function capabilityId(modelRowIdValue: string, capability: ModelCapability) {
  return `${modelRowIdValue}#${capability}`;
}

export function preferenceId(scope: string, capability: string) {
  return `${scope}:${capability}`;
}

export async function listModelProviders(): Promise<ModelProviderRecord[]> {
  await ensureDatabase();
  const rows = await db.select().from(aiModelProviders).orderBy(aiModelProviders.sortOrder, aiModelProviders.name);
  return rows.map(toProvider);
}

export async function getModelProvider(providerId: string): Promise<ModelProviderRecord | null> {
  await ensureDatabase();
  const [row] = await db.select().from(aiModelProviders).where(eq(aiModelProviders.providerId, providerId)).limit(1);
  return row ? toProvider(row) : null;
}

export type ModelProviderInput = {
  providerId: string;
  name: string;
  region?: string;
  docsUrl?: string;
  apiKeyUrl?: string;
  enabled?: boolean;
  source?: string;
  sortOrder?: number;
};

export async function upsertModelProvider(input: ModelProviderInput): Promise<ModelProviderRecord> {
  await ensureDatabase();
  const now = Date.now();
  const [existing] = await db
    .select()
    .from(aiModelProviders)
    .where(eq(aiModelProviders.providerId, input.providerId))
    .limit(1);

  if (existing) {
    await db
      .update(aiModelProviders)
      .set({
        name: input.name,
        region: input.region ?? existing.region,
        docsUrl: input.docsUrl ?? existing.docsUrl,
        apiKeyUrl: input.apiKeyUrl ?? existing.apiKeyUrl,
        enabled: input.enabled ?? existing.enabled,
        source: input.source ?? existing.source,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        updatedAt: now,
      })
      .where(eq(aiModelProviders.providerId, input.providerId));
    return (await getModelProvider(input.providerId)) as ModelProviderRecord;
  }

  await db.insert(aiModelProviders).values({
    id: input.providerId,
    providerId: input.providerId,
    name: input.name,
    region: input.region ?? "global",
    docsUrl: input.docsUrl ?? "",
    apiKeyUrl: input.apiKeyUrl ?? "",
    enabled: input.enabled ?? true,
    source: input.source ?? "manual",
    sortOrder: input.sortOrder ?? 1000,
    createdAt: now,
    updatedAt: now,
  });
  return (await getModelProvider(input.providerId)) as ModelProviderRecord;
}

/** Removes a provider together with its endpoints, models, capabilities and defaults. */
export async function deleteModelProvider(providerId: string) {
  await ensureDatabase();
  const rows = await db.select({ id: aiModels.id }).from(aiModels).where(eq(aiModels.providerId, providerId));
  for (const batch of emptyChunks(rows.map((row) => row.id))) {
    await db.delete(aiModelCapabilities).where(inArray(aiModelCapabilities.modelRowId, batch));
    await db.delete(aiProbeResults).where(inArray(aiProbeResults.modelRowId, batch));
  }
  await db.delete(aiModels).where(eq(aiModels.providerId, providerId));
  await db.delete(aiModelEndpoints).where(eq(aiModelEndpoints.providerId, providerId));
  await db.delete(aiModelPreferences).where(eq(aiModelPreferences.providerId, providerId));
  await db.delete(aiModelProviders).where(eq(aiModelProviders.providerId, providerId));
}

export async function listModelEndpoints(providerId?: string): Promise<ModelEndpointRecord[]> {
  await ensureDatabase();
  const base = db.select().from(aiModelEndpoints);
  const rows = providerId
    ? await base.where(eq(aiModelEndpoints.providerId, providerId))
    : await base.orderBy(aiModelEndpoints.providerId, desc(aiModelEndpoints.isDefault));
  return rows.map(toEndpoint);
}

export async function getModelEndpoint(endpointId: string): Promise<ModelEndpointRecord | null> {
  await ensureDatabase();
  const [row] = await db.select().from(aiModelEndpoints).where(eq(aiModelEndpoints.endpointId, endpointId)).limit(1);
  return row ? toEndpoint(row) : null;
}

export type ModelEndpointInput = {
  endpointId: string;
  providerId: string;
  name?: string;
  protocol: ModelEndpointRecord["protocol"];
  baseUrl: string;
  credentialRef?: string;
  enabled?: boolean;
  isDefault?: boolean;
};

export async function upsertModelEndpoint(input: ModelEndpointInput): Promise<ModelEndpointRecord> {
  await ensureDatabase();
  const now = Date.now();
  const [existing] = await db
    .select()
    .from(aiModelEndpoints)
    .where(eq(aiModelEndpoints.endpointId, input.endpointId))
    .limit(1);

  if (existing) {
    await db
      .update(aiModelEndpoints)
      .set({
        providerId: input.providerId,
        name: input.name ?? existing.name,
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        credentialRef: input.credentialRef ?? existing.credentialRef,
        enabled: input.enabled ?? existing.enabled,
        isDefault: input.isDefault ?? existing.isDefault,
        updatedAt: now,
      })
      .where(eq(aiModelEndpoints.endpointId, input.endpointId));
  } else {
    await db.insert(aiModelEndpoints).values({
      id: input.endpointId,
      endpointId: input.endpointId,
      providerId: input.providerId,
      name: input.name ?? "",
      protocol: input.protocol,
      baseUrl: input.baseUrl,
      credentialRef: input.credentialRef ?? "",
      enabled: input.enabled ?? true,
      isDefault: input.isDefault ?? true,
      status: "unknown",
      createdAt: now,
      updatedAt: now,
    });
  }
  return (await getModelEndpoint(input.endpointId)) as ModelEndpointRecord;
}

export async function setEndpointStatus(endpointId: string, status: string, message = "") {
  await ensureDatabase();
  const now = Date.now();
  await db
    .update(aiModelEndpoints)
    .set({ status, lastCheckAt: now, lastCheckMessage: message, updatedAt: now })
    .where(eq(aiModelEndpoints.endpointId, endpointId));
}

export async function deleteModelEndpoint(endpointId: string) {
  await ensureDatabase();
  const rows = await db.select({ id: aiModels.id }).from(aiModels).where(eq(aiModels.endpointId, endpointId));
  for (const batch of emptyChunks(rows.map((row) => row.id))) {
    await db.delete(aiModelCapabilities).where(inArray(aiModelCapabilities.modelRowId, batch));
    await db.delete(aiProbeResults).where(inArray(aiProbeResults.modelRowId, batch));
  }
  await db.delete(aiModels).where(eq(aiModels.endpointId, endpointId));
  await db.delete(aiModelEndpoints).where(eq(aiModelEndpoints.endpointId, endpointId));
}

/** `SELECT` of capability rows for a batch of models, grouped by model row id. */
async function loadCapabilities(modelRowIds: string[]): Promise<Map<string, CapabilityRecord[]>> {
  const grouped = new Map<string, CapabilityRecord[]>();
  for (const batch of emptyChunks(modelRowIds)) {
    const rows = await db.select().from(aiModelCapabilities).where(inArray(aiModelCapabilities.modelRowId, batch));
    for (const row of rows) {
      const capability = toCapability(row);
      if (!capability) continue;
      grouped.set(row.modelRowId, [...(grouped.get(row.modelRowId) ?? []), capability]);
    }
  }
  return grouped;
}

export type ModelListFilter = {
  providerId?: string;
  endpointId?: string;
  enabledOnly?: boolean;
  keyword?: string;
  limit?: number;
};

export async function listModels(filter: ModelListFilter = {}): Promise<ModelRecord[]> {
  await ensureDatabase();
  const conditions = [];
  if (filter.providerId) conditions.push(eq(aiModels.providerId, filter.providerId));
  if (filter.endpointId) conditions.push(eq(aiModels.endpointId, filter.endpointId));
  if (filter.enabledOnly) conditions.push(eq(aiModels.enabled, true));
  if (filter.keyword) {
    const pattern = `%${filter.keyword.toLowerCase()}%`;
    conditions.push(
      sql`(lower(${aiModels.modelId}) like ${pattern} or lower(${aiModels.displayName}) like ${pattern})`,
    );
  }

  const rows = await db
    .select()
    .from(aiModels)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(aiModels.providerId, aiModels.modelType, aiModels.modelId)
    .limit(filter.limit ?? 4000);

  const capabilities = await loadCapabilities(rows.map((row) => row.id));
  return rows.map((row) => toModel(row, capabilities.get(row.id) ?? []));
}

export async function getModelRow(id: string): Promise<ModelRecord | null> {
  await ensureDatabase();
  const [row] = await db.select().from(aiModels).where(eq(aiModels.id, id)).limit(1);
  if (!row) return null;
  const capabilities = await loadCapabilities([row.id]);
  return toModel(row, capabilities.get(row.id) ?? []);
}

export async function countModels() {
  await ensureDatabase();
  const [total] = await db.select({ value: sql<number>`count(*)` }).from(aiModels);
  const [callable] = await db
    .select({ value: sql<number>`count(*)` })
    .from(aiModels)
    .where(eq(aiModels.enabled, true));
  return { total: Number(total?.value ?? 0), callable: Number(callable?.value ?? 0) };
}

export type RoutableModelFilter = {
  capabilities?: ModelCapability[];
  providerId?: string;
  modelId?: string;
  includeDisabled?: boolean;
};

/**
 * The capability registry query: models that support *every* requested capability.
 * Answered by SQL (`count(distinct capability) = n`) instead of loading the whole
 * catalog into memory, which is what keeps routing cheap.
 */
export async function findModelsByCapabilities(
  filter: RoutableModelFilter = {},
): Promise<ModelRecord[]> {
  await ensureDatabase();
  const capabilities = filter.capabilities ?? [];
  const conditions = [sql`${aiModels.endpointId} <> ''`];
  if (!filter.includeDisabled) {
    conditions.push(sql`${aiModels.enabled} = 1`);
  }
  if (filter.providerId) {
    conditions.push(sql`${aiModels.providerId} = ${filter.providerId}`);
  }
  if (filter.modelId) {
    conditions.push(sql`${aiModels.modelId} = ${filter.modelId}`);
  }
  if (capabilities.length > 0) {
    const placeholders = sql.join(
      capabilities.map((capability) => sql`${capability}`),
      sql`, `,
    );
    conditions.push(
      sql`(select count(distinct cap.capability) from ai_model_capabilities cap
            where cap.model_row_id = ${aiModels.id}
              and cap.supported = 1
              and cap.capability in (${placeholders})) = ${capabilities.length}`,
    );
  }

  const rows = await db
    .select()
    .from(aiModels)
    .where(and(...conditions))
    .orderBy(aiModels.providerId, aiModels.modelType, aiModels.modelId)
    .limit(500);
  const grouped = await loadCapabilities(rows.map((row) => row.id));
  return rows.map((row) => toModel(row, grouped.get(row.id) ?? []));
}

export type UpsertModelsInput = {
  providerId: string;
  endpointId: string;
  models: NormalizedModel[];
  source?: string;
  /** State for newly discovered models; existing rows keep what the user chose. */
  enableNew?: boolean;
};

export type UpsertModelsResult = { created: number; updated: number; total: number };

/**
 * Applies a synced catalog. Ids are deterministic, so re-syncing updates in place.
 * Capability rows owned by a probe or by the user survive the refresh; the rows this
 * sync owns (`MODEL_CATALOG` / `PROVIDER_METADATA`) are replaced.
 */
export async function upsertModels(input: UpsertModelsInput): Promise<UpsertModelsResult> {
  await ensureDatabase();
  const now = Date.now();
  const source = input.source ?? "sync";
  const existing = await db
    .select()
    .from(aiModels)
    .where(and(eq(aiModels.providerId, input.providerId), eq(aiModels.endpointId, input.endpointId)));
  const byModelId = new Map(existing.map((row) => [row.modelId, row]));

  const inserts: Array<typeof aiModels.$inferInsert> = [];
  const updates: Array<{ id: string; displayName: string; modelType: NormalizedModel["modelType"]; contextWindow: number | null }> = [];
  const capabilityPlan: Array<{ rowId: string; capabilities: CapabilityRecord[] }> = [];
  let created = 0;
  let updated = 0;

  for (const model of input.models) {
    const id = modelRowId(input.providerId, input.endpointId, model.modelId);
    const row = byModelId.get(model.modelId);
    if (!row) {
      inserts.push({
        id,
        providerId: input.providerId,
        endpointId: input.endpointId,
        modelId: model.modelId,
        displayName: model.displayName,
        modelType: model.modelType,
        contextWindow: model.contextWindow,
        enabled: input.enableNew ?? false,
        source,
        syncedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      capabilityPlan.push({ rowId: id, capabilities: model.capabilities });
      created += 1;
      continue;
    }
    if (
      row.displayName !== model.displayName ||
      row.modelType !== model.modelType ||
      row.contextWindow !== model.contextWindow
    ) {
      updates.push({
        id: row.id,
        displayName: model.displayName,
        modelType: model.modelType,
        contextWindow: model.contextWindow,
      });
    }
    capabilityPlan.push({ rowId: row.id, capabilities: model.capabilities });
    updated += 1;
  }

  for (const batch of chunk(inserts)) {
    await db.insert(aiModels).values(batch);
  }
  for (const update of updates) {
    await db
      .update(aiModels)
      .set({ ...update, syncedAt: now, source, updatedAt: now })
      .where(eq(aiModels.id, update.id));
  }
  // One statement marks every model of this endpoint as freshly synced.
  await db
    .update(aiModels)
    .set({ syncedAt: now, updatedAt: now })
    .where(and(eq(aiModels.providerId, input.providerId), eq(aiModels.endpointId, input.endpointId)));

  const rowIds = capabilityPlan.map((plan) => plan.rowId);
  for (const batch of emptyChunks(rowIds)) {
    await db
      .delete(aiModelCapabilities)
      .where(
        and(
          inArray(aiModelCapabilities.modelRowId, batch),
          inArray(aiModelCapabilities.source, ["MODEL_CATALOG", "PROVIDER_METADATA"]),
        ),
      );
  }

  const owned = new Map<string, Set<string>>();
  for (const batch of emptyChunks(rowIds)) {
    const rows = await db.select().from(aiModelCapabilities).where(inArray(aiModelCapabilities.modelRowId, batch));
    for (const row of rows) {
      const current = owned.get(row.modelRowId) ?? new Set<string>();
      current.add(row.capability);
      owned.set(row.modelRowId, current);
    }
  }

  const capabilityRows: Array<typeof aiModelCapabilities.$inferInsert> = [];
  for (const plan of capabilityPlan) {
    const existingCapabilities = owned.get(plan.rowId) ?? new Set<string>();
    for (const capability of plan.capabilities) {
      if (existingCapabilities.has(capability.capability)) continue;
      capabilityRows.push({
        id: capabilityId(plan.rowId, capability.capability),
        modelRowId: plan.rowId,
        capability: capability.capability,
        supported: capability.supported,
        source: capability.source,
        confidence: capability.confidence,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  for (const batch of chunk(capabilityRows)) {
    await db
      .insert(aiModelCapabilities)
      .values(batch)
      .onConflictDoUpdate({
        target: aiModelCapabilities.id,
        set: {
          supported: sql`excluded.supported`,
          source: sql`excluded.source`,
          confidence: sql`excluded.confidence`,
          updatedAt: now,
        },
      });
  }

  return { created, updated, total: input.models.length };
}

/** Bulk enable/disable. `enabled` is the "可调用" state; synced-but-off stays "已发现". */
export async function setModelsEnabled(modelRowIds: string[], enabled: boolean) {
  await ensureDatabase();
  const now = Date.now();
  for (const batch of emptyChunks(modelRowIds)) {
    await db.update(aiModels).set({ enabled, updatedAt: now }).where(inArray(aiModels.id, batch));
  }
  return modelRowIds.length;
}

export async function setModelsEnabledByProvider(providerId: string, enabled: boolean) {
  await ensureDatabase();
  await db.update(aiModels).set({ enabled, updatedAt: Date.now() }).where(eq(aiModels.providerId, providerId));
}

/** Recomputes the coarse `model_type` from the surviving capability rows. */
export async function recomputeModelType(modelRowIdValue: string) {
  await ensureDatabase();
  const capabilities = (await loadCapabilities([modelRowIdValue])).get(modelRowIdValue) ?? [];
  await db
    .update(aiModels)
    .set({ modelType: modelTypeForCapabilities(capabilities), updatedAt: Date.now() })
    .where(eq(aiModels.id, modelRowIdValue));
}

/**
 * Writes a single capability row. Used by probe results (`PROBE_TEST`) and by the
 * user's manual override; both outrank the catalog heuristics.
 */
export async function setModelCapability(input: {
  modelRowId: string;
  capability: ModelCapability;
  supported: boolean;
  source?: ModelCapabilitySource;
  confidence?: number;
}) {
  await ensureDatabase();
  const now = Date.now();
  const source = input.source ?? "USER_OVERRIDE";
  await db
    .insert(aiModelCapabilities)
    .values({
      id: capabilityId(input.modelRowId, input.capability),
      modelRowId: input.modelRowId,
      capability: input.capability,
      supported: input.supported,
      source,
      confidence: input.confidence ?? 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: aiModelCapabilities.id,
      set: { supported: input.supported, source, confidence: input.confidence ?? 1, updatedAt: now },
    });
  await recomputeModelType(input.modelRowId);
}

export type ModelPreferenceRecord = {
  scope: string;
  capability: ModelCapability;
  modelRowId: string;
  providerId: string;
  modelId: string;
};

export async function listModelPreferences(scope = "default"): Promise<ModelPreferenceRecord[]> {
  await ensureDatabase();
  const rows = await db.select().from(aiModelPreferences).where(eq(aiModelPreferences.scope, scope));
  return rows.flatMap((row) =>
    isModelCapability(row.capability)
      ? [
          {
            scope: row.scope,
            capability: row.capability,
            modelRowId: row.modelRowId,
            providerId: row.providerId,
            modelId: row.modelId,
          },
        ]
      : [],
  );
}

/** `modelRowId: null` clears the default so the router picks automatically again. */
export async function setModelPreference(input: {
  capability: ModelCapability;
  modelRowId: string | null;
  scope?: string;
}) {
  await ensureDatabase();
  const scope = input.scope ?? "default";
  if (!input.modelRowId) {
    await db
      .delete(aiModelPreferences)
      .where(and(eq(aiModelPreferences.scope, scope), eq(aiModelPreferences.capability, input.capability)));
    return;
  }
  const model = await getModelRow(input.modelRowId);
  const now = Date.now();
  await db
    .insert(aiModelPreferences)
    .values({
      id: preferenceId(scope, input.capability),
      scope,
      capability: input.capability,
      modelRowId: input.modelRowId,
      providerId: model?.providerId ?? "",
      modelId: model?.modelId ?? "",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: aiModelPreferences.id,
      set: {
        modelRowId: input.modelRowId,
        providerId: model?.providerId ?? "",
        modelId: model?.modelId ?? "",
        updatedAt: now,
      },
    });
}

export async function insertSyncRecord(record: ModelSyncRecord) {
  await ensureDatabase();
  await db.insert(aiSyncRecords).values({
    id: `${record.providerId}:${record.finishedAt}`,
    providerId: record.providerId,
    endpointId: record.endpointId,
    status: record.status,
    modelCount: record.modelCount,
    message: record.message.slice(0, 1000),
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  });
}

export async function listSyncRecords(limit = 20): Promise<ModelSyncRecord[]> {
  await ensureDatabase();
  const rows = await db.select().from(aiSyncRecords).orderBy(desc(aiSyncRecords.finishedAt)).limit(limit);
  return rows.map((row) => ({
    providerId: row.providerId,
    endpointId: row.endpointId,
    status: row.status === "error" ? "error" : "ok",
    modelCount: row.modelCount,
    message: row.message,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  }));
}

export async function saveProbeRecord(record: ModelProbeRecord) {
  await ensureDatabase();
  const [existing] = await db
    .select()
    .from(aiProbeResults)
    .where(and(eq(aiProbeResults.modelRowId, record.modelRowId), eq(aiProbeResults.capability, record.capability)))
    .limit(1);
  const values = {
    status: record.status,
    latencyMs: record.latencyMs,
    message: record.message.slice(0, 500),
    probedAt: record.probedAt,
  };
  if (existing) {
    await db.update(aiProbeResults).set(values).where(eq(aiProbeResults.id, existing.id));
    return;
  }
  await db.insert(aiProbeResults).values({
    id: `${record.modelRowId}#${record.capability}`,
    modelRowId: record.modelRowId,
    capability: record.capability,
    ...values,
  });
}

export async function listProbeRecords(modelRowIdValue: string): Promise<ModelProbeRecord[]> {
  await ensureDatabase();
  const rows = await db.select().from(aiProbeResults).where(eq(aiProbeResults.modelRowId, modelRowIdValue));
  return rows.flatMap((row) =>
    isModelCapability(row.capability)
      ? [
          {
            modelRowId: row.modelRowId,
            capability: row.capability,
            status: row.status === "ok" ? "ok" : row.status === "unsupported" ? "unsupported" : "failed",
            latencyMs: row.latencyMs,
            message: row.message,
            probedAt: row.probedAt,
          },
        ]
      : [],
  );
}

/** Callable vs merely known, per capability - drives the "可见 / 可调" summary. */
export async function countModelsByCapability() {
  await ensureDatabase();
  const rows = await db
    .select({
      capability: aiModelCapabilities.capability,
      supported: aiModelCapabilities.supported,
      enabled: aiModels.enabled,
      total: sql<number>`count(*)`,
    })
    .from(aiModelCapabilities)
    .innerJoin(aiModels, eq(aiModels.id, aiModelCapabilities.modelRowId))
    .groupBy(aiModelCapabilities.capability, aiModelCapabilities.supported, aiModels.enabled);

  const summary: Record<string, { total: number; callable: number }> = {};
  for (const row of rows) {
    if (!isModelCapability(row.capability) || !row.supported) continue;
    const entry = summary[row.capability] ?? { total: 0, callable: 0 };
    entry.total += Number(row.total);
    if (row.enabled) entry.callable += Number(row.total);
    summary[row.capability] = entry;
  }
  return summary;
}

/**
 * Key health inside a credential. Rows are keyed by `(credential_ref, fingerprint)`;
 * the fingerprint is derived from the secret, so nothing here needs the plaintext.
 */
function toCredentialKey(row: typeof aiCredentialKeys.$inferSelect): CredentialKeyRecord {
  return {
    id: row.id,
    credentialRef: row.credentialRef,
    providerId: row.providerId,
    fingerprint: row.fingerprint,
    label: row.label,
    masked: row.masked,
    status: isCredentialKeyStatus(row.status) ? row.status : "unknown",
    cooldownUntil: row.cooldownUntil,
    lastCheckAt: row.lastCheckAt,
    lastUsedAt: row.lastUsedAt,
    useCount: row.useCount,
    errorCount: row.errorCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Deterministic row id: the same key of the same credential always maps to one row. */
export function credentialKeyRowId(credentialRef: string, fingerprint: string) {
  return `${credentialRef}#${fingerprint.slice(0, 24)}`;
}

export async function listCredentialKeys(credentialRef?: string): Promise<CredentialKeyRecord[]> {
  await ensureDatabase();
  const rows = credentialRef
    ? await db.select().from(aiCredentialKeys).where(eq(aiCredentialKeys.credentialRef, credentialRef))
    : await db.select().from(aiCredentialKeys);
  return rows.map(toCredentialKey).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/**
 * Registers a key (or refreshes its label) without touching its health: re-pasting an
 * existing key must not clear the cooldown the provider just handed us.
 */
export async function upsertCredentialKey(input: {
  credentialRef: string;
  providerId: string;
  fingerprint: string;
  masked: string;
  label?: string;
}): Promise<CredentialKeyRecord> {
  await ensureDatabase();
  const now = Date.now();
  const id = credentialKeyRowId(input.credentialRef, input.fingerprint);
  const [existing] = await db.select().from(aiCredentialKeys).where(eq(aiCredentialKeys.id, id)).limit(1);
  if (existing) {
    await db
      .update(aiCredentialKeys)
      .set({
        providerId: input.providerId || existing.providerId,
        masked: input.masked,
        label: input.label ?? existing.label,
        updatedAt: now,
      })
      .where(eq(aiCredentialKeys.id, id));
  } else {
    await db.insert(aiCredentialKeys).values({
      id,
      credentialRef: input.credentialRef,
      providerId: input.providerId,
      fingerprint: input.fingerprint,
      label: input.label ?? "",
      masked: input.masked,
      status: "unknown",
      cooldownUntil: null,
      lastCheckAt: null,
      lastUsedAt: null,
      useCount: 0,
      errorCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  const [row] = await db.select().from(aiCredentialKeys).where(eq(aiCredentialKeys.id, id)).limit(1);
  return toCredentialKey(row);
}


/** Counts a call attempt: round-robin orders by `useCount`, LRU by `lastUsedAt`. */
export async function markCredentialKeyUsed(id: string) {
  await ensureDatabase();
  const now = Date.now();
  await db
    .update(aiCredentialKeys)
    .set({ useCount: sql`${aiCredentialKeys.useCount} + 1`, lastUsedAt: now, updatedAt: now })
    .where(eq(aiCredentialKeys.id, id));
}

/** A key that answered correctly: back to `ok`, cooldown cleared. */
export async function markCredentialKeySuccess(id: string) {
  await ensureDatabase();
  const now = Date.now();
  await db
    .update(aiCredentialKeys)
    .set({ status: "ok", cooldownUntil: null, lastCheckAt: now, lastUsedAt: now, updatedAt: now })
    .where(eq(aiCredentialKeys.id, id));
}

/**
 * A key that failed. `status` is what the state machine deduced from the upstream error;
 * `cooldownUntil` only applies to `rate_limited`. A failure that indicts the request
 * rather than the key (`countError: false`) leaves the key's standing alone.
 */
export async function markCredentialKeyFailure(input: {
  id: string;
  status?: CredentialKeyStatus;
  cooldownUntil?: number | null;
  countError?: boolean;
}) {
  await ensureDatabase();
  const now = Date.now();
  await db
    .update(aiCredentialKeys)
    .set({
      ...(input.status
        ? {
            status: input.status,
            cooldownUntil: input.status === "rate_limited" ? (input.cooldownUntil ?? now) : null,
            lastCheckAt: now,
          }
        : {}),
      ...(input.countError === false ? {} : { errorCount: sql`${aiCredentialKeys.errorCount} + 1` }),
      updatedAt: now,
    })
    .where(eq(aiCredentialKeys.id, input.id));
}

/** Manual override from the UI: reset a cooldown, disable a key, re-enable it. */
export async function setCredentialKeyStatus(id: string, status: CredentialKeyStatus, cooldownUntil: number | null = null) {
  await ensureDatabase();
  const now = Date.now();
  await db
    .update(aiCredentialKeys)
    .set({
      status,
      cooldownUntil: status === "rate_limited" ? cooldownUntil : null,
      ...(status === "unknown" ? { errorCount: 0 } : {}),
      updatedAt: now,
    })
    .where(eq(aiCredentialKeys.id, id));
}

/** Drops rows whose key no longer exists in the credential store. */
export async function deleteCredentialKeys(ids: string[]) {
  await ensureDatabase();
  for (const idsChunk of emptyChunks(ids)) {
    await db.delete(aiCredentialKeys).where(inArray(aiCredentialKeys.id, idsChunk));
  }
}

export async function deleteCredentialKeysForRef(credentialRef: string) {
  await ensureDatabase();
  await db.delete(aiCredentialKeys).where(eq(aiCredentialKeys.credentialRef, credentialRef));
}
