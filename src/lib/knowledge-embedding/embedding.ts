import { z } from "zod";

/**
 * The Embedding contract of the knowledge base (CI-EMB-01 of
 * `docs/coolpilot-capability-integration-plan.md`).
 *
 * This file is the pure half: what a knowledge record's embedding input *is*, how its body is cut into
 * chunks, what identifies the version of a record a vector was computed from, and how two vectors are
 * compared. It opens no file, calls no model and writes no row, so it is testable without a database.
 *
 * Four rules it exists to keep, because each of them is invisible when it is broken:
 *
 * 1. **The input is deterministic.** Title, body, category and tags are serialised in one fixed order with
 *    labelled fields, so the same record always produces the same text - and two records whose fields
 *    merely *concatenate* to something similar cannot collide into the same vector.
 * 2. **Chunking is deterministic and versioned.** The body is cut by the rule in `chunkKnowledgeBody`, and
 *    that rule's own name (`knowledgeChunkingVersion`) is part of every source hash - so changing the rule
 *    invalidates the vectors it produced instead of quietly mixing two cut patterns in one index.
 * 3. **Only the fields a vector depends on are hashed.** `enabled`, `positionId`, `weight` and `updatedAt`
 *    are filter and sort inputs, not text: toggling an entry off, moving it to another positioning or
 *    re-weighting it must not cost a single embedding call.
 * 4. **Similarity is defined and safe.** `cosineSimilarity` refuses two vectors of different lengths
 *    instead of comparing the prefix that happens to line up.
 */

/** The chunking rule's name, stored with every vector. Changing the rule means changing this. */
export const knowledgeChunkingVersion = "kb-chunk-v1";

/** The input template's name, hashed together with the record and the chunking rule. */
export const knowledgeEmbeddingInputVersion = "kb-embed-input-v1";

/**
 * How many characters one chunk may hold.
 *
 * A **character** ceiling, deliberately: this build does not claim to know any model's token budget, and
 * inventing one would either truncate text a model could have taken or send text it cannot. A model that
 * refuses an over-long input is refused by the provider, and the runtime reports that refusal with the
 * provider's own words instead of this layer guessing.
 */
export const knowledgeChunkMaxCharacters = 800;

/** How many chunk texts one provider request carries, unless the caller says otherwise. */
export const knowledgeEmbeddingBatchSize = 16;

/** The two things a task can be asked to do: fill what is missing, or recompute everything. */
export const knowledgeEmbeddingScopes = ["stale", "rebuild"] as const;

export type KnowledgeEmbeddingScope = (typeof knowledgeEmbeddingScopes)[number];

/**
 * Every way the embedding task can refuse, as a stable name (the shape CI-P3-02's transcription codes use).
 *
 * `BUDGET_EXCEEDED` is deliberately its own code and not `EMBEDDING_FAILED`: no provider was asked and no
 * request was sent, so nothing failed and nothing was billed (D9).
 */
export const knowledgeEmbeddingFailureCodes = [
  /** The stored request is not a valid embedding request (a hand-written `runs` row, say). */
  "REQUEST_INVALID",
  /** No model can serve `embedding`, or the model the request named has no usable credential. */
  "PROVIDER_UNAVAILABLE",
  /** The AI budget refused the run before the remote model was asked (D9). */
  "BUDGET_EXCEEDED",
  /** The provider was asked and the call failed: an upstream error, a rate limit, a rejected key. */
  "EMBEDDING_FAILED",
  /** The run exceeded its own budget and was abandoned. */
  "EMBEDDING_TIMEOUT",
  /** The vectors could not be stored, so the run's work is not in the index. */
  "STORAGE_FAILED",
] as const;

export type KnowledgeEmbeddingFailureCode = (typeof knowledgeEmbeddingFailureCodes)[number];

/** A refusal a caller (and the console) reads the reason out of, exactly like `TranscriptionFailure`. */
export class KnowledgeEmbeddingFailure extends Error {
  readonly code: KnowledgeEmbeddingFailureCode;

  constructor(code: KnowledgeEmbeddingFailureCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "KnowledgeEmbeddingFailure";
    this.code = code;
  }
}

export function isKnowledgeEmbeddingFailure(error: unknown): error is KnowledgeEmbeddingFailure {
  return error instanceof KnowledgeEmbeddingFailure;
}

/** The request one `knowledge_embedding` task stores in `runs.params_json`. */
export const knowledgeEmbeddingRequestSchema = z.object({
  scope: z.enum(knowledgeEmbeddingScopes).default("stale"),
  /** The records to consider; empty means every knowledge record in the workspace. */
  recordIds: z.array(z.string()).default([]),
  /** Pin the embedding model; absent means the runtime's own `embedding` route decides. */
  model: z.string().optional(),
  providerId: z.string().optional(),
  /** How many chunk texts one provider request carries. */
  batchSize: z.number().int().min(1).max(64).default(knowledgeEmbeddingBatchSize),
  /**
   * The caller's key for exactly-once: a second submission carrying the same key reuses the first run,
   * whatever its status - the same rule CI-P3-03's distillation task follows.
   */
  idempotencyKey: z.string().optional(),
});

export type KnowledgeEmbeddingRequest = z.infer<typeof knowledgeEmbeddingRequestSchema>;

/**
 * The one normalisation this feature uses.
 *
 * Line endings are unified, trailing whitespace on a line is dropped, three or more newlines become a
 * paragraph break, and the result is trimmed. The same text typed in a Windows editor and in a Unix one
 * therefore produces the same chunks and the same hash - which is what makes "unchanged content" a
 * comparable fact rather than an editor-dependent one.
 */
export function normalizeKnowledgeText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The sentence-ish boundaries a too-long paragraph is cut on. The delimiter stays with its sentence. */
const sentenceBoundary = /(?<=[。！？!?；;.\n])\s*/;

type Piece = { text: string; separator: string };

/** One paragraph (or one over-long sentence, or one hard character window) as a mergeable piece. */
function piecesOfBlock(block: string): Piece[] {
  if (block.length <= knowledgeChunkMaxCharacters) {
    return [{ text: block, separator: "\n\n" }];
  }
  const sentences = block
    .split(sentenceBoundary)
    .map((part) => part.trim())
    .filter(Boolean);
  const pieces: Piece[] = [];
  for (const sentence of sentences) {
    // A single sentence longer than the ceiling has no boundary left, so it is cut by characters. A hard
    // cut inside a sentence is the one place a chunk is not a whole thought - and it is still deterministic,
    // which is what an index needs.
    for (let start = 0; start < sentence.length; start += knowledgeChunkMaxCharacters) {
      const text = sentence.slice(start, start + knowledgeChunkMaxCharacters);
      pieces.push({ text, separator: pieces.length === 0 ? "\n\n" : "\n" });
    }
  }
  return pieces;
}

/**
 * The chunk texts of one knowledge body - the retrieval units of a record (D2=b).
 *
 * The rule, in one place and in this order:
 *
 *  1. normalise the body (`normalizeKnowledgeText`);
 *  2. split it on blank lines into paragraphs, and cut any paragraph over the ceiling on its own sentence
 *     boundaries (`piecesOfBlock`);
 *  3. merge consecutive pieces greedily while the chunk stays within the ceiling.
 *
 * Merge order is the document's own order, so the *n*-th chunk of the same body is always the same text -
 * which is what lets a chunk row keep a stable id across re-embeddings. An empty body yields no chunks at
 * all: a record nobody wrote a body for has no retrieval unit, and embedding an empty string would put a
 * vector into the index that stands for nothing.
 */
export function chunkKnowledgeBody(content: string): string[] {
  const normalized = normalizeKnowledgeText(content);
  if (!normalized) return [];

  const pieces = normalized.split(/\n{2,}/).flatMap(piecesOfBlock);
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (!current) {
      current = piece.text;
      continue;
    }
    if (current.length + piece.separator.length + piece.text.length <= knowledgeChunkMaxCharacters) {
      current = `${current}${piece.separator}${piece.text}`;
      continue;
    }
    chunks.push(current);
    current = piece.text;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** The labels a chunk's input carries, so the four contributing fields cannot be confused with each other. */
export const knowledgeEmbeddingInputLabels = {
  title: "标题",
  category: "分类",
  tags: "标签",
  body: "正文",
} as const;

/**
 * The exact text one chunk is embedded as (D3=c).
 *
 * The record's own labels go first - title, category, tags, each on its own labelled line - and the chunk's
 * body follows under its own label. Three consequences are deliberate:
 *
 * - **A chunk is self-describing.** A paragraph about "承重 30kg" matches nothing on its own; the same
 *   paragraph under `标题：折叠收纳箱` is the answer a query about that product is looking for. The header is
 *   therefore repeated on every chunk of a record, which is a token cost paid for a retrieval gain - and the
 *   reason the header is three short lines rather than the whole record.
 * - **The fields are labelled, not concatenated.** `标题：a` + `正文：b` cannot be confused with `标题：ab`,
 *   which is exactly the ambiguity a bare join would leave in the index.
 * - **The stored taxonomy values are used, not translated labels.** `分类：product` is the same text whatever
 *   language the UI is showing; translating it here would mean switching the interface language invalidated
 *   every vector in the index.
 */
export function knowledgeEmbeddingInput(
  record: { title: string; category: string; tags: readonly string[] },
  chunkText: string,
) {
  const lines = [
    `${knowledgeEmbeddingInputLabels.title}：${normalizeKnowledgeText(record.title)}`,
    `${knowledgeEmbeddingInputLabels.category}：${record.category}`,
    `${knowledgeEmbeddingInputLabels.tags}：${record.tags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .join("、")}`,
  ];
  const body = normalizeKnowledgeText(chunkText);
  if (body) lines.push(`${knowledgeEmbeddingInputLabels.body}：`, body);
  return lines.join("\n");
}

/**
 * The stable id of a chunk row: the record, the chunk's position, and the model that produced the vector.
 *
 * The model is part of the identity on purpose (D4). Re-embedding a chunk with the *same* model updates the row
 * it already has - which is what makes a retried task idempotent - while rebuilding the index with *another*
 * model adds a second row instead of overwriting the first. Both models' vectors are therefore kept: the old
 * model's rows still answer queries made with the old model, and recall's compatibility filter (same provider,
 * same model, same dimension) is what stops the two from ever being compared.
 */
export function knowledgeChunkId(
  knowledgeId: string,
  chunkIndex: number,
  model: { providerId: string; modelId: string },
) {
  return `${knowledgeId}#${chunkIndex}#${model.providerId}:${model.modelId}`;
}

/** How the semantic index of one record reads right now, for the UI and for a task's own log. */
export type KnowledgeEmbeddingState = "ready" | "missing" | "stale" | "incompatible";

/**
 * Which of the four states one record's index is in, given what is stored and which model a caller is about
 * to query with (D4/D5).
 *
 * `stored` is the record's rows **written for `target`** - the caller filters by model, because rows of another
 * model are not evidence about this one. `missing` and `incompatible` are kept apart on purpose: both mean "this
 * record has no usable vectors", but the first is fixed by embedding it and the second by deciding which model
 * the index should be built for - and they are the two states a user has to be told apart.
 */
export function knowledgeEmbeddingState(input: {
  /** How many chunks the record's current body has; 0 means there is nothing to embed. */
  expectedChunks: number;
  /** The record's rows written for the model being queried or built. */
  stored: ReadonlyArray<{ chunkIndex: number; sourceHash: string; chunkHash: string }>;
  /** Every model this record has rows for, so "never embedded" and "embedded for another model" stay apart. */
  storedModels?: ReadonlyArray<{ providerId: string; modelId: string }>;
  sourceHash: string;
  expectedChunkHashes: readonly string[];
}): KnowledgeEmbeddingState {
  if (input.expectedChunks === 0) return "ready";
  if (input.stored.length === 0) {
    return (input.storedModels?.length ?? 0) > 0 ? "incompatible" : "missing";
  }
  if (input.stored.some((row) => row.sourceHash !== input.sourceHash)) return "stale";
  if (input.stored.length !== input.expectedChunks) return "stale";
  const storedHashes = new Map(input.stored.map((row) => [row.chunkIndex, row.chunkHash]));
  for (const [index, hash] of input.expectedChunkHashes.entries()) {
    if (storedHashes.get(index) !== hash) return "stale";
  }
  return "ready";
}

/**
 * The similarity of two vectors, or `null` when they cannot honestly be compared.
 *
 * `null` rather than `0`: a zero is a measurement ("nothing in common") and a length mismatch is not a
 * measurement at all (D4 forbids mixing dimensions), so a caller must be able to tell them apart. A vector
 * of no length, or one whose magnitude is zero, is refused the same way - a division by zero would otherwise
 * produce `NaN` and then a ranking that depends on comparison order.
 */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number | null {
  if (left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return null;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

