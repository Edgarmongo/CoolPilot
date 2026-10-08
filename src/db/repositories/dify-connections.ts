import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, ensureDatabase } from "@/db/client";
import { difyConnections } from "@/db/schema";
import { isDifyInsufficientMode, isDifyScope } from "@/lib/knowledge-base";
import { maskKey } from "@/lib/secrets";
import type { DifyConnectionRecord, DifyInsufficientMode, DifyScope } from "@/lib/types";

function now() {
  return Date.now();
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseScopes(value: string): DifyScope[] {
  return parseStringArray(value).filter(isDifyScope);
}

function toConnection(row: typeof difyConnections.$inferSelect): DifyConnectionRecord {
  return {
    id: row.id,
    name: row.name,
    apiBase: row.apiBase,
    apiKeyMasked: maskKey(row.apiKey),
    knowledgeIds: parseStringArray(row.knowledgeIdsJson),
    publicConfirmed: row.publicConfirmed,
    scopes: parseScopes(row.scopesJson),
    positionId: row.positionId,
    insufficientMode: isDifyInsufficientMode(row.insufficientMode) ? row.insufficientMode : "knowledge_first",
    scoreThreshold: row.scoreThreshold,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type DifyConnectionInput = {
  name: string;
  apiBase: string;
  /** Raw key. Leave empty on update to keep the stored value. */
  apiKey?: string;
  knowledgeIds?: string[];
  publicConfirmed?: boolean;
  scopes?: DifyScope[];
  positionId?: string;
  insufficientMode?: DifyInsufficientMode;
  scoreThreshold?: number;
  enabled?: boolean;
};

export async function listDifyConnections() {
  await ensureDatabase();
  return (await db.select().from(difyConnections).orderBy(desc(difyConnections.updatedAt))).map(toConnection);
}

export async function getDifyConnection(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(difyConnections).where(eq(difyConnections.id, id)).limit(1);
  return row ? toConnection(row) : null;
}

/** Returns the raw stored API key for server-side Dify calls. */
export async function getDifyConnectionSecret(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(difyConnections).where(eq(difyConnections.id, id)).limit(1);
  return row ? { apiBase: row.apiBase, apiKey: row.apiKey } : null;
}

export async function createDifyConnection(input: DifyConnectionInput) {
  await ensureDatabase();
  const id = nanoid();
  const createdAt = now();
  await db.insert(difyConnections).values({
    id,
    name: input.name,
    apiBase: input.apiBase,
    apiKey: input.apiKey ?? "",
    knowledgeIdsJson: JSON.stringify(input.knowledgeIds ?? []),
    publicConfirmed: input.publicConfirmed ?? false,
    scopesJson: JSON.stringify(input.scopes ?? []),
    positionId: input.positionId ?? "",
    insufficientMode: input.insufficientMode ?? "knowledge_first",
    scoreThreshold: input.scoreThreshold ?? 45,
    enabled: input.enabled ?? false,
    createdAt,
    updatedAt: createdAt,
  });
  return getDifyConnection(id);
}

export async function updateDifyConnection(id: string, patch: Partial<DifyConnectionInput>) {
  await ensureDatabase();
  await db
    .update(difyConnections)
    .set({
      name: patch.name,
      apiBase: patch.apiBase,
      // An empty apiKey means "leave the stored key untouched".
      apiKey: patch.apiKey ? patch.apiKey : undefined,
      knowledgeIdsJson: patch.knowledgeIds ? JSON.stringify(patch.knowledgeIds) : undefined,
      publicConfirmed: patch.publicConfirmed,
      scopesJson: patch.scopes ? JSON.stringify(patch.scopes) : undefined,
      positionId: patch.positionId,
      insufficientMode: patch.insufficientMode,
      scoreThreshold: patch.scoreThreshold,
      enabled: patch.enabled,
      updatedAt: now(),
    })
    .where(eq(difyConnections.id, id));
  return getDifyConnection(id);
}

export async function deleteDifyConnection(id: string) {
  await ensureDatabase();
  await db.delete(difyConnections).where(eq(difyConnections.id, id));
}
