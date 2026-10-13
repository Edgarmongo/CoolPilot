import { createHash } from "node:crypto";
import {
  knowledgeChunkingVersion,
  knowledgeEmbeddingInputVersion,
  normalizeKnowledgeText,
} from "./embedding";

/**
 * The *identity* of a knowledge record's embedding source (CI-EMB-01, D3): the hashes and the stable chunk id.
 *
 * It is a module of its own, and not a few more lines in `embedding.ts`, for one concrete reason: this file
 * imports `node:crypto`, and `@/lib/knowledge-base` - which re-exports the same feature's vocabulary to the
 * client components that show a knowledge table - must stay importable from a browser. So the pure rules
 * (chunking, the input text, similarity) live in `embedding.ts`, and the digest lives here, where only the
 * server-side writers reach it.
 */

/** What a source hash is computed over: only the fields a vector really depends on. */
export type KnowledgeEmbeddingSource = {
  title: string;
  content: string;
  category: string;
  tags: readonly string[];
};

/** The canonical serialisation a source hash is taken over. Exported so a test can pin it. */
export function knowledgeEmbeddingSourceFingerprint(source: KnowledgeEmbeddingSource) {
  return JSON.stringify({
    inputVersion: knowledgeEmbeddingInputVersion,
    chunkingVersion: knowledgeChunkingVersion,
    // The order is fixed here rather than inherited from the object literal: `JSON.stringify` would otherwise
    // hash `{b,a}` and `{a,b}` differently, and a hash that depends on key order is not a hash of content.
    // `enabled`, `positionId`, `weight` and `updatedAt` are deliberately absent - they filter and sort results
    // without changing what a vector means, so hashing them would re-embed a whole record when a user merely
    // toggles it off or moves it to another positioning.
    title: normalizeKnowledgeText(source.title),
    category: source.category,
    tags: source.tags.map((tag) => tag.trim()),
    content: normalizeKnowledgeText(source.content),
  });
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * The version identifier of a record's embedding source (D3): the fields that go into the input text, plus the
 * two template versions. Equal hashes mean the stored vectors are still valid.
 */
export function knowledgeSourceHash(source: KnowledgeEmbeddingSource) {
  return sha256(knowledgeEmbeddingSourceFingerprint(source));
}

/**
 * The hash of one chunk's own text.
 *
 * `sourceHash` answers "is this record's index up to date"; this answers "did *this* chunk's text change",
 * which is what lets a reader say which chunk a stale vector belongs to instead of only that the record as a
 * whole moved on.
 */
export function knowledgeChunkHash(chunkText: string) {
  return sha256(normalizeKnowledgeText(chunkText));
}