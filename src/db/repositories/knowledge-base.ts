import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, ensureDatabase } from "@/db/client";
import { knowledgeBase } from "@/db/schema";
import { deleteKnowledgeChunks } from "@/db/repositories/knowledge-embeddings";
import { isKnowledgeBaseCategory, isKnowledgeBaseOrigin, isKnowledgeBaseWeight } from "@/lib/knowledge-base";
import type { KnowledgeBaseRecord } from "@/lib/types";

function now() {
  return Date.now();
}

function parseTags(value: string): string[] {
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
}

function toKnowledgeBase(row: typeof knowledgeBase.$inferSelect): KnowledgeBaseRecord {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    category: isKnowledgeBaseCategory(row.category) ? row.category : "other",
    weight: isKnowledgeBaseWeight(row.weight) ? row.weight : "medium",
    enabled: row.enabled,
    origin: isKnowledgeBaseOrigin(row.origin) ? row.origin : "manual",
    tags: parseTags(row.tagsJson),
    sourceUrl: row.sourceUrl,
    fileName: row.fileName,
    positionId: row.positionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type KnowledgeBaseInput = {
  title: string;
  content?: string;
  category?: KnowledgeBaseRecord["category"];
  weight?: KnowledgeBaseRecord["weight"];
  enabled?: boolean;
  origin?: KnowledgeBaseRecord["origin"];
  tags?: string[];
  sourceUrl?: string;
  fileName?: string;
  positionId?: string;
};

export async function listKnowledgeBase() {
  await ensureDatabase();
  return (await db.select().from(knowledgeBase).orderBy(desc(knowledgeBase.updatedAt))).map(toKnowledgeBase);
}

export async function getKnowledgeBase(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(knowledgeBase).where(eq(knowledgeBase.id, id)).limit(1);
  return row ? toKnowledgeBase(row) : null;
}

export async function createKnowledgeBase(input: KnowledgeBaseInput) {
  await ensureDatabase();
  const id = nanoid();
  const createdAt = now();
  await db.insert(knowledgeBase).values({
    id,
    title: input.title,
    content: input.content ?? "",
    category: input.category ?? "other",
    weight: input.weight ?? "medium",
    enabled: input.enabled ?? true,
    origin: input.origin ?? "manual",
    tagsJson: JSON.stringify(input.tags ?? []),
    sourceUrl: input.sourceUrl ?? "",
    fileName: input.fileName ?? "",
    positionId: input.positionId ?? "",
    createdAt,
    updatedAt: createdAt,
  });
  return getKnowledgeBase(id);
}

export async function updateKnowledgeBase(
  id: string,
  patch: Partial<Omit<KnowledgeBaseRecord, "id" | "createdAt">>,
) {
  await ensureDatabase();
  await db
    .update(knowledgeBase)
    .set({
      title: patch.title,
      content: patch.content,
      category: patch.category,
      weight: patch.weight,
      enabled: patch.enabled,
      origin: patch.origin,
      tagsJson: patch.tags ? JSON.stringify(patch.tags) : undefined,
      sourceUrl: patch.sourceUrl,
      fileName: patch.fileName,
      positionId: patch.positionId,
      updatedAt: now(),
    })
    .where(eq(knowledgeBase.id, id));
  return getKnowledgeBase(id);
}

export async function deleteKnowledgeBase(id: string) {
  await ensureDatabase();
  // CI-EMB-01 (D5): a knowledge record's delete takes its chunk vectors with it, so the index holds no
  // orphan pointing at a record nobody can open. The vector table has no foreign key to cascade from - the
  // schema is built with `CREATE TABLE IF NOT EXISTS` on an existing database - so the cleanup is explicit
  // here, at the one entry that deletes a record.
  await deleteKnowledgeChunks(id);
  await db.delete(knowledgeBase).where(eq(knowledgeBase.id, id));
}

