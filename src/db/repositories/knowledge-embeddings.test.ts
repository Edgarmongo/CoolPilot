import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The knowledge index as the database sees it (CI-EMB-01, D2/D4/D5/D11).
 *
 * `src/lib/knowledge-embedding/embedding.test.ts` already pins the rules that decide what a vector means.
 * What is left for this file is the storage boundary, because that is where a wrong answer is *silent* rather
 * than loud:
 *
 * - a chunk keeps its stable id across re-embeddings, so a retry updates rows instead of growing the index;
 * - a shorter body leaves no trailing chunk of its old text behind;
 * - rows of two models stay tellable apart, so nothing can mix two models' vectors into one similarity;
 * - deleting a record takes its vectors with it, so the index holds no orphan;
 * - a vector that cannot be read back is `[]` - unusable - rather than a comparable-looking row of zeros.
 *
 * The temp database is pinned before the repositories are imported, because `@/db/client` resolves its URL
 * once per process (the same three lines as `src/db/repositories/ai-usage-ledger.test.ts`).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-knowledge-embeddings-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "embeddings.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { createKnowledgeBase, deleteKnowledgeBase, getKnowledgeBase, updateKnowledgeBase } = await import(
  "./knowledge-base"
);
const {
  countKnowledgeChunks,
  listKnowledgeChunks,
  listKnowledgeChunksFor,
  replaceKnowledgeChunks,
  storedModelOf,
} = await import("./knowledge-embeddings");
const { knowledgeChunkId } = await import("@/lib/knowledge-embedding/embedding");

const model = { providerId: "qwen", modelId: "text-embedding-v4" };

/** A record that really exists, so every case below reads as its own statement rather than a null check. */
async function makeRecord(title: string, content: string) {
  const record = await createKnowledgeBase({ title, content });
  if (!record) throw new Error("the knowledge record could not be created");
  return record;
}

function write(index: number, vector: number[]) {
  return {
    chunkIndex: index,
    text: `第${index}块正文。`,
    chunkHash: `chunk-${index}`,
    sourceHash: "source-1",
    dimensions: vector.length,
    vector,
  };
}

const gemini = { providerId: "gemini", modelId: "text-embedding-004" };

describe("knowledge embeddings repository", () => {
  it("stores a record's chunks and reads them back in chunk order", async () => {
    const record = await makeRecord("折叠收纳箱", "甲。\n\n乙。");
    await replaceKnowledgeChunks(record.id, model, [write(0, [1, 0, 0]), write(1, [0, 1, 0])]);

    const chunks = await listKnowledgeChunks(record.id);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);
    expect(chunks.map((chunk) => chunk.id)).toEqual([
      knowledgeChunkId(record.id, 0, model),
      knowledgeChunkId(record.id, 1, model),
    ]);
    expect(chunks[0]).toMatchObject({
      knowledgeId: record.id,
      text: "第0块正文。",
      chunkHash: "chunk-0",
      sourceHash: "source-1",
      providerId: "qwen",
      modelId: "text-embedding-v4",
      dimensions: 3,
      vector: [1, 0, 0],
    });
    expect(chunks[1].vector).toEqual([0, 1, 0]);
    // The batch read answers the same rows, which is what a semantic query actually uses.
    expect((await listKnowledgeChunksFor([record.id])).map((chunk) => chunk.id)).toEqual(
      chunks.map((chunk) => chunk.id),
    );
  });

  it("replaces rather than appends: an edited body leaves no trailing chunk behind", async () => {
    const record = await makeRecord("平台规则", "甲。\n\n乙。\n\n丙。");
    const first = await replaceKnowledgeChunks(record.id, model, [
      write(0, [1, 0]),
      write(1, [0, 1]),
      write(2, [1, 1]),
    ]);
    expect(first).toHaveLength(3);

    // The body now has two chunks, with new text and a new source hash - the shape an edit produces.
    await replaceKnowledgeChunks(record.id, model, [
      { ...write(0, [0.5, 0.5]), text: "改过的甲。", chunkHash: "chunk-0-v2", sourceHash: "source-2" },
      { ...write(1, [0.25, 0.75]), text: "改过的乙。", chunkHash: "chunk-1-v2", sourceHash: "source-2" },
    ]);

    const chunks = await listKnowledgeChunks(record.id);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);
    expect(chunks[0]).toMatchObject({ text: "改过的甲。", sourceHash: "source-2", chunkHash: "chunk-0-v2" });
    // The chunk that was already there keeps its `created_at`: it is the same chunk, recomputed.
    expect(chunks[0].createdAt).toBe(first[0].createdAt);
  });

  it("is idempotent: writing the same chunks twice leaves one index", async () => {
    const record = await makeRecord("重复向量化", "甲。\n\n乙。");
    await replaceKnowledgeChunks(record.id, model, [write(0, [1, 0]), write(1, [0, 1])]);
    const before = await listKnowledgeChunks(record.id);
    await replaceKnowledgeChunks(record.id, model, [write(0, [1, 0]), write(1, [0, 1])]);
    const after = await listKnowledgeChunks(record.id);

    expect(after.map((chunk) => chunk.id)).toEqual(before.map((chunk) => chunk.id));
    expect(after[0].createdAt).toBe(before[0].createdAt);
    expect(after[0].updatedAt).toBeGreaterThanOrEqual(before[0].updatedAt);
  });

  it("clears a record's index when its body has nothing left to embed", async () => {
    const record = await makeRecord("清空正文", "甲。");
    await replaceKnowledgeChunks(record.id, model, [write(0, [1, 0])]);
    expect(await replaceKnowledgeChunks(record.id, model, [])).toEqual([]);
    expect(await listKnowledgeChunks(record.id)).toEqual([]);
  });

  it("keeps another model's rows when rebuilding with this one (D4)", async () => {
    const record = await makeRecord("换过模型", "甲。\n\n乙。");
    await replaceKnowledgeChunks(record.id, model, [write(0, [1, 0]), write(1, [0, 1])]);
    await replaceKnowledgeChunks(record.id, gemini, [write(0, [0, 1]), write(1, [1, 0])]);

    const chunks = await listKnowledgeChunks(record.id);
    // Both indexes exist: the migration added the new model's vectors without destroying the old model's.
    expect(chunks).toHaveLength(4);
    expect(new Set(chunks.map((chunk) => `${chunk.providerId}:${chunk.modelId}`))).toEqual(
      new Set(["qwen:text-embedding-v4", "gemini:text-embedding-004"]),
    );
    // Rows of two models in one record are never reported as one model's reading, which is what keeps a mixed
    // similarity impossible.
    expect(storedModelOf(chunks)).toBeNull();
    expect(storedModelOf(chunks.filter((chunk) => chunk.providerId === "gemini"))).toEqual(gemini);

    // Clearing one model's index clears only that model's rows.
    await replaceKnowledgeChunks(record.id, gemini, []);
    expect((await listKnowledgeChunks(record.id)).every((chunk) => chunk.providerId === "qwen")).toBe(true);
  });

  it("deletes a record's chunks with the record, so no orphan is left", async () => {
    const record = await makeRecord("会被删掉", "甲。\n\n乙。");
    await replaceKnowledgeChunks(record.id, model, [write(0, [1, 0]), write(1, [0, 1])]);
    expect(await countKnowledgeChunks()).toBeGreaterThan(0);

    await deleteKnowledgeBase(record.id);
    expect(await getKnowledgeBase(record.id)).toBeNull();
    expect(await listKnowledgeChunks(record.id)).toEqual([]);
  });

  it("treats a vector it cannot read back as no vector at all", async () => {
    const record = await makeRecord("坏向量", "甲。");
    // `JSON.stringify(NaN)` is `[null]`: a row like that must not compare as a vector of zeros.
    await replaceKnowledgeChunks(record.id, model, [write(0, [Number.NaN, 1])]);
    expect((await listKnowledgeChunks(record.id))[0].vector).toEqual([]);
  });

  it("keeps the record's own body untouched while indexing it", async () => {
    const record = await makeRecord("正文不动", "甲。\n\n乙。");
    await replaceKnowledgeChunks(record.id, model, [write(0, [1, 0])]);
    await updateKnowledgeBase(record.id, { weight: "high" });
    const after = await getKnowledgeBase(record.id);
    expect(after?.content).toBe("甲。\n\n乙。");
    expect(after?.weight).toBe("high");
    // Re-weighting is not a content change: the vector rows are still there, still valid.
    expect((await listKnowledgeChunks(record.id))[0].sourceHash).toBe("source-1");
  });
});
