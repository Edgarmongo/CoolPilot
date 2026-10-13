import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db, ensureDatabase } from "@/db/client";
import { knowledgeEmbeddings } from "@/db/schema";
import { knowledgeChunkId, knowledgeChunkingVersion } from "@/lib/knowledge-embedding/embedding";
import type { KnowledgeEmbeddingChunkRecord } from "@/lib/types";

/**
 * The knowledge index as the database sees it (CI-EMB-01, D11).
 *
 * This is the only place that reads or writes `knowledge_embeddings`, and it is deliberately small: the
 * chunking rule, the hashes and the similarity live in `@/lib/knowledge-embedding/embedding`, and the task
 * that fills this table lives in `@/lib/knowledge-embedding/embedding-task`. What is left here is where a
 * wrong answer would be *silent*:
 *
 * - **A write is a replace, not an append.** `replaceKnowledgeChunks()` upserts by the stable id and drops
 *   the rows of that record that the new set does not name, so re-embedding an edited record cannot leave a
 *   trailing chunk of the old text behind, and a retried task cannot grow the index.
 * - **A vector that cannot be read back is not a vector.** `parseVector` returns `[]` for anything that is
 *   not an array of finite numbers, which `cosineSimilarity()` then refuses. A row a hand-edit broke is
 *   therefore unusable rather than comparable.
 * - **Deleting a record deletes its chunks**, through the knowledge repository's own delete entry, so there
 *   are no orphans to clean up later.
 */

function now() {
  return Date.now();
}

/** The stored vector, or `[]` when the column does not hold one this build can compare. */
function parseVector(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const vector = parsed.map((value) =>
      typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN,
    );
    return vector.some((value) => !Number.isFinite(value)) ? [] : vector;
  } catch {
    return [];
  }
}

function toChunk(row: typeof knowledgeEmbeddings.$inferSelect): KnowledgeEmbeddingChunkRecord {
  return {
    id: row.id,
    knowledgeId: row.knowledgeId,
    chunkIndex: row.chunkIndex,
    chunkingVersion: row.chunkingVersion,
    text: row.text,
    chunkHash: row.chunkHash,
    sourceHash: row.sourceHash,
    providerId: row.providerId,
    modelId: row.modelId,
    dimensions: row.dimensions,
    vector: parseVector(row.vectorJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * One chunk as the task hands it over, before it becomes a row.
 *
 * The model is not part of this shape: it belongs to the *write* (`replaceKnowledgeChunks` takes it), so no
 * caller can accidentally write one row of one model and another row of another in a single replace.
 */
export type KnowledgeChunkWrite = {
  chunkIndex: number;
  text: string;
  chunkHash: string;
  sourceHash: string;
  dimensions: number;
  vector: number[];
};

/** The chunks stored for one knowledge record, in chunk order. */
export async function listKnowledgeChunks(knowledgeId: string): Promise<KnowledgeEmbeddingChunkRecord[]> {
  await ensureDatabase();
  const rows = await db.select().from(knowledgeEmbeddings).where(eq(knowledgeEmbeddings.knowledgeId, knowledgeId));
  return rows.map(toChunk).sort((left, right) => left.chunkIndex - right.chunkIndex);
}

/**
 * The chunks of several records at once, in chunk order.
 *
 * Batched on purpose: a semantic query reads the vectors of every candidate record, and one read per record
 * would make that query cost scale with the size of the knowledge base rather than with what it returns.
 */
export async function listKnowledgeChunksFor(
  knowledgeIds: readonly string[],
): Promise<KnowledgeEmbeddingChunkRecord[]> {
  if (knowledgeIds.length === 0) return [];
  await ensureDatabase();
  const rows = await db
    .select()
    .from(knowledgeEmbeddings)
    .where(inArray(knowledgeEmbeddings.knowledgeId, [...knowledgeIds]));
  return rows
    .map(toChunk)
    .sort((left, right) => left.knowledgeId.localeCompare(right.knowledgeId) || left.chunkIndex - right.chunkIndex);
}

/**
 * The model every stored chunk of a record was written for, or `null` when the rows disagree.
 *
 * `null` is a real answer here: rows of two models inside one record mean a rebuild was interrupted, and a
 * reader that needs one model's answer must see that instead of being handed whichever row came back first.
 */
export function storedModelOf(
  chunks: ReadonlyArray<Pick<KnowledgeEmbeddingChunkRecord, "providerId" | "modelId">>,
): { providerId: string; modelId: string } | null {
  const models = new Set(chunks.map((chunk) => `${chunk.providerId}::${chunk.modelId}`));
  if (models.size !== 1) return null;
  const [first] = chunks;
  return first ? { providerId: first.providerId, modelId: first.modelId } : null;
}

/**
 * Writes one record's chunks **for one model**, replacing whatever that record had for *that* model.
 *
 * The stable ids are the whole mechanism: a row still part of the record is updated in place (keeping its
 * `created_at`), a row the new set no longer names is deleted, and a new row is inserted. The postcondition is
 * therefore exactly "this record's chunks for this model are this set", whatever the table held before - which
 * is what makes a retry, a resume and a second worker harmless.
 *
 * `model` is a parameter rather than something read off the writes, because the empty case has to be scoped too:
 * a body that lost all its text must clear *this model's* rows, not every model's. And it is what keeps D4's
 * promise - a rebuild with another model writes its own rows and leaves the previous model's index intact.
 */
export async function replaceKnowledgeChunks(
  knowledgeId: string,
  model: { providerId: string; modelId: string },
  writes: readonly KnowledgeChunkWrite[],
): Promise<KnowledgeEmbeddingChunkRecord[]> {
  await ensureDatabase();
  const timestamp = now();
  const ids = writes.map((write) => knowledgeChunkId(knowledgeId, write.chunkIndex, model));
  const scope = and(
    eq(knowledgeEmbeddings.knowledgeId, knowledgeId),
    eq(knowledgeEmbeddings.providerId, model.providerId),
    eq(knowledgeEmbeddings.modelId, model.modelId),
  );

  if (ids.length === 0) {
    await db.delete(knowledgeEmbeddings).where(scope);
    return [];
  }

  await db.delete(knowledgeEmbeddings).where(and(scope, notInArray(knowledgeEmbeddings.id, ids)));

  for (const write of writes) {
    const id = knowledgeChunkId(knowledgeId, write.chunkIndex, model);
    const values = {
      id,
      knowledgeId,
      chunkIndex: write.chunkIndex,
      chunkingVersion: knowledgeChunkingVersion,
      text: write.text,
      chunkHash: write.chunkHash,
      sourceHash: write.sourceHash,
      providerId: model.providerId,
      modelId: model.modelId,
      dimensions: write.dimensions,
      vectorJson: JSON.stringify(write.vector),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await db
      .insert(knowledgeEmbeddings)
      .values(values)
      .onConflictDoUpdate({
        target: knowledgeEmbeddings.id,
        // `created_at` is not in the update set: it is when this chunk *first* existed, and a re-embedding is
        // the same chunk being recomputed rather than a new one being stored.
        set: {
          knowledgeId: values.knowledgeId,
          chunkIndex: values.chunkIndex,
          chunkingVersion: values.chunkingVersion,
          text: values.text,
          chunkHash: values.chunkHash,
          sourceHash: values.sourceHash,
          providerId: values.providerId,
          modelId: values.modelId,
          dimensions: values.dimensions,
          vectorJson: values.vectorJson,
          updatedAt: values.updatedAt,
        },
      });
  }

  // The read-back is scoped to the model that was just written, because that is what the postcondition above
  // states - and because the caller compares this list against what it wrote. Returning every model's rows
  // made a *migration* (D4: the index rebuilt for a second model while the first model's rows remain) fail
  // its own consistency check with `STORAGE_FAILED`, even though both writes had succeeded.
  const rows = await listKnowledgeChunks(knowledgeId);
  return rows.filter((row) => row.providerId === model.providerId && row.modelId === model.modelId);
}

/** Every chunk of one knowledge record - the cleanup a record's own deletion performs (D5). */
export async function deleteKnowledgeChunks(knowledgeId: string) {
  await ensureDatabase();
  await db.delete(knowledgeEmbeddings).where(eq(knowledgeEmbeddings.knowledgeId, knowledgeId));
}

/** How many rows the index holds, for the coverage line the task's log and the UI report. */
export async function countKnowledgeChunks() {
  await ensureDatabase();
  const rows = await db.select({ id: knowledgeEmbeddings.id }).from(knowledgeEmbeddings);
  return rows.length;
}

