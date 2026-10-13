import { listKnowledgeChunksFor } from "@/db/repositories/knowledge-embeddings";
import { aiRuntime } from "@/features/ai-runtime";
import type { AiWritingMaterial } from "@/lib/ai-writing";
import { beginAiBudgetCall, isAiBudgetRefusal } from "@/lib/ai-budget-guard";
import { recordAiUsageCall, recordAiUsageFailure, type AiUsageCallContext } from "@/lib/ai-usage-ledger-recorder";
import {
  knowledgeReferenceLimit,
  selectKnowledgeReferences,
  selectSemanticKnowledgeReferences,
  type SemanticKnowledgeChunk,
} from "@/lib/knowledge-base";
import type { KnowledgeBaseRecord } from "@/lib/types";
import { knowledgeSourceHash } from "./source";

/**
 * Semantic knowledge recall for article generation (CI-EMB-01, D6/D8/D9).
 *
 * This is the business half of the semantic mode - the half the Runtime must not contain: it owns the budget
 * gate, the ledger rows, the fallback and the query text. It sits where D1 put it, and it exists as a module of
 * its own so that the *whole* of the query-side money and failure handling is one file to read.
 *
 * Four decisions are the point of it:
 *
 * 1. **The query text is decided before the recall, from what the caller already has** (D8): the requested
 *    title and the article's material - never the article body, which does not exist yet. The same request
 *    therefore produces the same query, and the recall cannot depend on the model's own answer.
 * 2. **The query embedding is a call of its own** (D8): its own gate, its own ledger purpose (`knowledge`) and
 *    its own metered dimension (`embedding`), so a cost centre sees it as its own spend rather than as part of
 *    the article's text call - and so its failure cannot look like a failure of the article.
 * 3. **A refusal is not a fallback** (D9). `AI_BUDGET_EXCEEDED` is re-thrown: the budget said no, the whole
 *    operation is refused, and degrading to the keyword selector would be exactly the bypass the ruling
 *    forbids. Every *other* problem - no embedding model, no credential, a provider failure, a vector set this
 *    build cannot compare - falls back to `selectKnowledgeReferences()`, which is named in the returned reason
 *    and logged, never swallowed.
 * 4. **An index that answered is not an index that failed.** Falling back happens when the index could not be
 *    *asked* (no compatible vectors at all). A query the index answered with nothing relevant returns nothing:
 *    that is a measurement, not a degradation, and replacing it with the keyword list would hide it.
 */

/** How much of the request's material the query text may carry, so one huge material cannot flood it. */
export const knowledgeQueryMaxCharacters = 600;

/**
 * The text a semantic query is embedded as (D8).
 *
 * The parts are the request's own facts, in a fixed order and with labels, with the empty ones dropped and the
 * whole capped: the requested title, the topics the article is about, the products it will mention and the free
 * text the user typed. Every part is available *before* the article is generated, which is the requirement -
 * and the cap means a long material cannot push the title, the strongest signal, out of the model's window.
 */
export function knowledgeQueryText(input: { material: AiWritingMaterial; titleFallback: string }) {
  const products = input.material.products.flatMap((product) => [
    product.name,
    product.brand,
    product.category,
    ...(product.keywords ?? []),
  ]);
  const lines = [
    input.titleFallback.trim() ? `标题：${input.titleFallback.trim()}` : "",
    input.material.topics.length > 0 ? `选题：${input.material.topics.map((topic) => topic.title).join("、")}` : "",
    products.filter(Boolean).length > 0 ? `产品：${products.filter(Boolean).join("、")}` : "",
    input.material.freeText.trim() ? `素材：${input.material.freeText.trim()}` : "",
  ].filter(Boolean);
  const text = lines.join("\n");
  if (text.length <= knowledgeQueryMaxCharacters) return text;
  // Cutting on a line boundary keeps every part whole; a single over-long part is cut by characters.
  const lastBreak = text.lastIndexOf("\n", knowledgeQueryMaxCharacters);
  return lastBreak > 0 ? text.slice(0, lastBreak) : text.slice(0, knowledgeQueryMaxCharacters);
}

/** Which path answered a knowledge recall, and why the semantic one did not when it did not. */
export type KnowledgeRecallOutcome = {
  references: string[];
  /** `semantic` when the vector index answered, `position` when the existing selector did (D9). */
  source: "semantic" | "position";
  /** The stable name of the reason the semantic path was not used; `""` when it was. */
  fallbackReason: string;
  /** How many knowledge records the index really compared, when it answered. */
  compared?: number;
  model?: string;
  providerId?: string;
};

/** The stable names a fallback can carry, so a log line is greppable and a test can assert the reason. */
export const knowledgeRecallFallbackReasons = [
  /** The caller had nothing to ask with: no title, no material. */
  "empty-query",
  /** No model can embed, or the one that can has no usable credential. */
  "provider-unavailable",
  /** The provider was asked and refused or failed (rate limit, bad key, upstream error). */
  "embedding-failed",
  /** The index holds no vector this query could be compared with (missing, another model, another dimension). */
  "no-compatible-vectors",
  /** The budget gate itself could not run; the recall degrades rather than failing the article. */
  "gate-unavailable",
] as const;

export type KnowledgeRecallFallbackReason = (typeof knowledgeRecallFallbackReasons)[number];

/** Never silent (D9): one console line per degradation, plus the reason on the returned outcome. */
function logFallback(reason: KnowledgeRecallFallbackReason, detail: string) {
  console.warn(`[knowledge-embedding] semantic recall fell back to position mode (${reason}): ${detail}`);
}

/**
 * The knowledge references an article should be written with, in the mode the caller selected.
 *
 * `entries` is the whole knowledge base as `listKnowledgeBase()` reads it - the same list the position mode has
 * always been handed, so both modes filter one in-memory set and cannot disagree about what exists.
 */
export async function recallKnowledgeForArticle(input: {
  entries: readonly KnowledgeBaseRecord[];
  positioningId?: string | null;
  queryText: string;
  limit?: number;
  /** The Marketplace listing this article runs as, copied onto the query call's ledger rows (CI-P7-05-03). */
  extensionId?: string;
}): Promise<KnowledgeRecallOutcome> {
  const limit = input.limit ?? knowledgeReferenceLimit;
  const fallback = (reason: KnowledgeRecallFallbackReason, detail: string): KnowledgeRecallOutcome => {
    logFallback(reason, detail);
    return {
      references: selectKnowledgeReferences([...input.entries], input.positioningId, limit),
      source: "position",
      fallbackReason: reason,
    };
  };

  if (!input.queryText.trim()) {
    return fallback("empty-query", "the request carried no title or material to query with");
  }

  // CI-P7-05-01/03: this call's own ledger context. `meteredKind` is stated rather than left to the default,
  // because the ledger's default is `text` and an embedding call recorded as text is priced by the wrong column.
  const usageCall: AiUsageCallContext = {
    purpose: "knowledge",
    meteredKind: "embedding",
    ...(input.extensionId ? { extensionId: input.extensionId } : {}),
  };

  let budget: Awaited<ReturnType<typeof beginAiBudgetCall>>;
  try {
    // CI-P7-03: the gate stands between the query text and the request and measures the very text the call
    // carries. A refusal escapes this function on purpose (D9) - it is the user's budget policy speaking, and
    // the caller's own refusal path applies.
    budget = await beginAiBudgetCall({
      purpose: usageCall.purpose,
      meteredKind: "embedding",
      capability: "embedding",
      capabilities: ["embedding"],
      inputText: input.queryText,
    });
  } catch (error) {
    if (isAiBudgetRefusal(error)) throw error;
    return fallback("gate-unavailable", error instanceof Error ? error.message : "the budget gate failed");
  }
  usageCall.budgetReservationId = budget.reservationId ?? undefined;

  let queryVector: number[];
  let providerId: string;
  let model: string;
  try {
    const answer = await aiRuntime.embed({ input: [input.queryText] });
    providerId = answer.providerId;
    model = answer.model;
    queryVector = answer.vectors[0] ?? [];
    await recordAiUsageCall({ ...usageCall, attempts: answer.attempts });
  } catch (error) {
    // The requests this call sent travel on the error (the runtime's own trail), so a failed attempt becomes a
    // ledger row with a NULL cost rather than a call that never happened.
    await recordAiUsageFailure(usageCall, error);
    const code = (error as { code?: string }).code ?? "";
    const unavailable =
      code === "MODEL_CAPABILITY_UNAVAILABLE" || code === "MODEL_CREDENTIAL_MISSING" || code === "MODEL_NOT_CONFIGURED";
    return fallback(
      unavailable ? "provider-unavailable" : "embedding-failed",
      `${code || "unexpected error"}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await budget.release();
  }

  const chunks = await listKnowledgeChunksFor(input.entries.map((entry) => entry.id));
  const selection = selectSemanticKnowledgeReferences({
    entries: input.entries,
    positioningId: input.positioningId,
    queryVector,
    chunks: chunks.map<SemanticKnowledgeChunk>((chunk) => ({
      knowledgeId: chunk.knowledgeId,
      chunkIndex: chunk.chunkIndex,
      vector: chunk.vector,
      sourceHash: chunk.sourceHash,
      providerId: chunk.providerId,
      modelId: chunk.modelId,
    })),
    sourceHashOf: (entry) => knowledgeSourceHash(entry),
    target: { providerId, modelId: model },
    limit,
  });

  const { diagnostics } = selection;
  // How many records the index could really *score*: the candidates that are not missing, not written for
  // another model and not stale. A record whose every vector is stale cannot answer either - the index holds a
  // description of text the user has since edited - so it belongs to this count and not to "compared".
  const compared =
    diagnostics.considered -
    diagnostics.withoutCompatibleVectors -
    diagnostics.incompatibleVectors -
    diagnostics.staleVectors;
  if (compared <= 0 && diagnostics.considered > 0) {
    // Nothing in the index could answer *this* query: every candidate record is unembedded, stale, or written
    // for another model. That is the degradation D9 names, so the keyword selector answers - and says so.
    return fallback(
      "no-compatible-vectors",
      `${diagnostics.withoutCompatibleVectors} record(s) have no vectors, ${diagnostics.incompatibleVectors} are for another model or dimension, ${diagnostics.staleVectors} are stale`,
    );
  }

  return {
    references: selection.references,
    source: "semantic",
    fallbackReason: "",
    compared,
    model,
    providerId,
  };
}
