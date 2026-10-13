import { describe, expect, it } from "vitest";
import {
  chunkKnowledgeBody,
  cosineSimilarity,
  knowledgeChunkId,
  knowledgeChunkMaxCharacters,
  knowledgeChunkingVersion,
  knowledgeEmbeddingInput,
  knowledgeEmbeddingInputVersion,
  knowledgeEmbeddingState,
  normalizeKnowledgeText,
} from "./embedding";
import { knowledgeChunkHash, knowledgeEmbeddingSourceFingerprint, knowledgeSourceHash } from "./source";

/**
 * The Embedding contract of the knowledge base (CI-EMB-01 of
 * `docs/coolpilot-capability-integration-plan.md`), pinned rule by rule.
 *
 * Nothing here needs a database or a model, because nothing here may: these are the rules that decide what a
 * vector *means*, and each of them is a rule whose failure would be invisible in production. A chunking rule
 * that varied between runs would put two cut patterns in one index; a hash that ignored the tags would call
 * an edited record current; a similarity that compared mismatched vectors would rank results by a number
 * nobody can interpret. So every rule gets its own case, and the *reason* it exists is the assertion.
 */
describe("knowledge embedding contract", () => {
  const record = { title: "折叠收纳箱", category: "product", tags: ["家居", "储物"] };
  const source = { title: record.title, content: "承重 30kg。\n\n可折叠。", category: record.category, tags: record.tags };

  it("normalises line endings and whitespace, so an editor cannot change a vector", () => {
    expect(normalizeKnowledgeText("a\r\nb")).toBe("a\nb");
    expect(normalizeKnowledgeText("a  \nb\t\n")).toBe("a\nb");
    expect(normalizeKnowledgeText("a\n\n\n\nb")).toBe("a\n\nb");
    expect(normalizeKnowledgeText("  \n  ")).toBe("");
    // The same text written on Windows and on Unix hashes to the same source.
    expect(knowledgeSourceHash({ ...source, content: "承重 30kg。\r\n\r\n可折叠。" })).toBe(knowledgeSourceHash(source));
  });

  it("cuts a body into ordered, deterministic chunks", () => {
    const body = ["第一段。", "第二段。", "第三段。"].join("\n\n");
    const chunks = chunkKnowledgeBody(body);
    expect(chunks).toEqual(["第一段。\n\n第二段。\n\n第三段。"]);
    // Same input, same output - the property a chunk id's stability rests on.
    expect(chunkKnowledgeBody(body)).toEqual(chunks);
  });

  it("splits a paragraph that exceeds the ceiling instead of truncating it", () => {
    const long = Array.from({ length: 120 }, (_, index) => `第${index}句，写得很长很长。`).join("");
    expect(long.length).toBeGreaterThan(knowledgeChunkMaxCharacters);
    const chunks = chunkKnowledgeBody(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= knowledgeChunkMaxCharacters)).toBe(true);
    // Nothing is lost: merging two pieces only ever adds the separator between them, so every character of
    // the body that was really there is still there.
    expect(chunks.join("").replace(/\s+/g, "")).toBe(long.replace(/\s+/g, ""));
  });

  it("hard-cuts a single sentence that has no boundary left", () => {
    const sentence = "甲".repeat(knowledgeChunkMaxCharacters * 2 + 10);
    const chunks = chunkKnowledgeBody(sentence);
    expect(chunks.map((chunk) => chunk.length)).toEqual([
      knowledgeChunkMaxCharacters,
      knowledgeChunkMaxCharacters,
      10,
    ]);
  });

  it("gives a body with no text no chunks at all", () => {
    expect(chunkKnowledgeBody("")).toEqual([]);
    expect(chunkKnowledgeBody("   \n\n  ")).toEqual([]);
  });

  it("labels the four contributing fields and keeps the chunk's body under its own label", () => {
    const input = knowledgeEmbeddingInput(record, "承重 30kg。");
    expect(input).toBe("标题：折叠收纳箱\n分类：product\n标签：家居、储物\n正文：\n承重 30kg。");
    // A labelled field is not the same input as a bare join: `标题：ab` differs from `标题：a` + `正文：bc`.
    expect(knowledgeEmbeddingInput({ ...record, title: "ab" }, "c")).not.toBe(
      knowledgeEmbeddingInput({ ...record, title: "a" }, "bc"),
    );
  });

  it("hashes only what a vector depends on", () => {
    const fingerprint = JSON.parse(knowledgeEmbeddingSourceFingerprint(source)) as Record<string, unknown>;
    // The exact key set *is* the assertion: `enabled`, `positionId`, `weight` and `updatedAt` are filter and
    // sort inputs, so hashing them would re-embed a whole record when a user merely toggles it off.
    expect(Object.keys(fingerprint).sort()).toEqual(
      ["category", "chunkingVersion", "content", "inputVersion", "tags", "title"].sort(),
    );
    expect(fingerprint.chunkingVersion).toBe(knowledgeChunkingVersion);
    expect(fingerprint.inputVersion).toBe(knowledgeEmbeddingInputVersion);

    // Key order in the object literal cannot change the hash, and every contributing field can.
    expect(
      knowledgeSourceHash({
        content: source.content,
        tags: source.tags,
        category: source.category,
        title: source.title,
      }),
    ).toBe(knowledgeSourceHash(source));
    const base = knowledgeSourceHash(source);
    expect(knowledgeSourceHash({ ...source, title: "改过的标题" })).not.toBe(base);
    expect(knowledgeSourceHash({ ...source, content: "改过的正文" })).not.toBe(base);
    expect(knowledgeSourceHash({ ...source, category: "faq" })).not.toBe(base);
    expect(knowledgeSourceHash({ ...source, tags: ["家居"] })).not.toBe(base);
  });

  it("identifies a chunk by its record, its position and its model, and hashes its own text", () => {
    // The model is part of the id (D4), which is what lets a rebuild keep the previous model's rows.
    expect(knowledgeChunkId("kb1", 0, { providerId: "qwen", modelId: "text-embedding-v4" })).toBe(
      "kb1#0#qwen:text-embedding-v4",
    );
    expect(knowledgeChunkId("kb1", 0, { providerId: "gemini", modelId: "text-embedding-004" })).not.toBe(
      knowledgeChunkId("kb1", 0, { providerId: "qwen", modelId: "text-embedding-v4" }),
    );
    expect(knowledgeChunkHash("承重 30kg。")).toBe(knowledgeChunkHash("承重 30kg。"));
    expect(knowledgeChunkHash("承重 30kg。")).not.toBe(knowledgeChunkHash("承重 40kg。"));
  });
});

describe("knowledge index state", () => {
  const hashes = ["hash-0", "hash-1"];

  it("reads a record with no body as ready, because it has nothing to embed", () => {
    expect(knowledgeEmbeddingState({ expectedChunks: 0, stored: [], sourceHash: "s", expectedChunkHashes: [] })).toBe(
      "ready",
    );
  });

  it("tells missing apart from stale and from another model's rows", () => {
    expect(
      knowledgeEmbeddingState({ expectedChunks: 2, stored: [], sourceHash: "s", expectedChunkHashes: hashes }),
    ).toBe("missing");
    // Rows exist, but for another model: the record is not stale, it has never been built for this one.
    expect(
      knowledgeEmbeddingState({
        expectedChunks: 2,
        stored: [],
        storedModels: [{ providerId: "gemini", modelId: "text-embedding-004" }],
        sourceHash: "s",
        expectedChunkHashes: hashes,
      }),
    ).toBe("incompatible");
    expect(
      knowledgeEmbeddingState({
        expectedChunks: 2,
        stored: [{ chunkIndex: 0, sourceHash: "old", chunkHash: "hash-0" }],
        sourceHash: "s",
        expectedChunkHashes: hashes,
      }),
    ).toBe("stale");
  });

  it("is stale when a chunk is missing or its text moved on", () => {
    const ready = [
      { chunkIndex: 0, sourceHash: "s", chunkHash: "hash-0" },
      { chunkIndex: 1, sourceHash: "s", chunkHash: "hash-1" },
    ];
    expect(
      knowledgeEmbeddingState({ expectedChunks: 2, stored: ready, sourceHash: "s", expectedChunkHashes: hashes }),
    ).toBe("ready");
    expect(
      knowledgeEmbeddingState({ expectedChunks: 2, stored: [ready[0]], sourceHash: "s", expectedChunkHashes: hashes }),
    ).toBe("stale");
    expect(
      knowledgeEmbeddingState({
        expectedChunks: 2,
        stored: [ready[0], { ...ready[1], chunkHash: "changed" }],
        sourceHash: "s",
        expectedChunkHashes: hashes,
      }),
    ).toBe("stale");
  });
});

describe("cosine similarity", () => {
  it("measures agreement between two vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2);
  });

  it("refuses a comparison it cannot honestly make", () => {
    // Different lengths are not "nothing in common": they are not comparable at all (D4).
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBeNull();
    expect(cosineSimilarity([], [])).toBeNull();
    // A zero vector has no direction, and dividing by its magnitude would produce NaN.
    expect(cosineSimilarity([0, 0], [1, 0])).toBeNull();
  });
});
