import type { TranslationKey } from "@/lib/locale-resources";
import { cosineSimilarity } from "@/lib/knowledge-embedding/embedding";
import {
  difyInsufficientModes,
  difyScopes,
  knowledgeBaseCategories,
  knowledgeBaseOrigins,
  knowledgeBaseWeights,
  type DifyInsufficientMode,
  type DifyScope,
  type KnowledgeBaseCategory,
  type KnowledgeBaseOrigin,
  type KnowledgeBaseRecord,
  type KnowledgeBaseWeight,
  type ProductRecord,
} from "@/lib/types";

/** How many knowledge entries are injected into a writing prompt at most. */
export const knowledgeReferenceLimit = 8;

export const knowledgeBaseCategoryLabelKeys: Record<KnowledgeBaseCategory, TranslationKey> = {
  product: "kbCategoryProduct",
  industry: "kbCategoryIndustry",
  brand: "kbCategoryBrand",
  faq: "kbCategoryFaq",
  formula: "kbCategoryFormula",
  reference: "kbCategoryReference",
  other: "kbCategoryOther",
};

export const knowledgeBaseWeightLabelKeys: Record<KnowledgeBaseWeight, TranslationKey> = {
  high: "kbWeightHigh",
  medium: "kbWeightMedium",
  low: "kbWeightLow",
};

export const knowledgeBaseOriginLabelKeys: Record<KnowledgeBaseOrigin, TranslationKey> = {
  manual: "kbOriginManual",
  ai: "kbOriginAi",
  file: "kbOriginFile",
  product: "kbOriginProduct",
};

export const difyScopeLabelKeys: Record<DifyScope, TranslationKey> = {
  article: "kbDifyScopeArticle",
  post: "kbDifyScopePost",
  video: "kbDifyScopeVideo",
};

export const difyInsufficientLabelKeys: Record<DifyInsufficientMode, TranslationKey> = {
  knowledge_first: "kbDifyInsufficientKnowledgeFirst",
  reference_only: "kbDifyInsufficientReferenceOnly",
};

/** Whitespace-insensitive character count shown in the "Size" column ("19字"). */
export function knowledgeCharacterCount(text: string) {
  return text.replace(/\s+/g, "").length;
}

export function isKnowledgeBaseCategory(value: unknown): value is KnowledgeBaseCategory {
  return (knowledgeBaseCategories as readonly string[]).includes(value as string);
}

export function isKnowledgeBaseWeight(value: unknown): value is KnowledgeBaseWeight {
  return (knowledgeBaseWeights as readonly string[]).includes(value as string);
}

export function isKnowledgeBaseOrigin(value: unknown): value is KnowledgeBaseOrigin {
  return (knowledgeBaseOrigins as readonly string[]).includes(value as string);
}

export function isDifyScope(value: unknown): value is DifyScope {
  return (difyScopes as readonly string[]).includes(value as string);
}

export function isDifyInsufficientMode(value: unknown): value is DifyInsufficientMode {
  return (difyInsufficientModes as readonly string[]).includes(value as string);
}

/** Heuristically maps keywords in a raw title/body to a category. */
export function guessKnowledgeCategory(text: string): KnowledgeBaseCategory {
  const value = text.toLowerCase();
  if (/faq|常见问题|常见问答|问答|q&a|question/.test(value)) return "faq";
  if (/配方|recipe|配料|做法/.test(value)) return "formula";
  if (/品牌|brand|slogan|口号/.test(value)) return "brand";
  if (/行业|industry|市场|趋势/.test(value)) return "industry";
  if (/产品|product|型号|参数|规格/.test(value)) return "product";
  if (/参考|reference|资料|素材/.test(value)) return "reference";
  return "other";
}

/**
 * Deterministic fallback for the "Smart import" dialog when the AI provider is
 * unavailable. Uses the first non-empty line as the title and the rest as content.
 */
export function parseKnowledgeFromRawText(raw: string): {
  title: string;
  content: string;
  category: KnowledgeBaseCategory;
  weight: KnowledgeBaseWeight;
  tags: string[];
} {
  const text = raw.trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const firstLine = lines.find(Boolean) ?? "";
  const title = (firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine) || "未命名知识";
  const content = lines.filter((line) => line !== firstLine).join("\n").trim() || text;
  return {
    title,
    content,
    category: guessKnowledgeCategory(`${title}\n${content}`),
    weight: "medium",
    tags: [],
  };
}

/** Builds a knowledge entry payload from a product-library record. */
export function buildKnowledgeFromProduct(product: ProductRecord): {
  title: string;
  content: string;
  category: KnowledgeBaseCategory;
  weight: KnowledgeBaseWeight;
  tags: string[];
} {
  const parts = [
    product.brand ? `品牌：${product.brand}` : "",
    product.description,
    product.category ? `分类：${product.category}` : "",
    product.keywords.length ? `关键词：${product.keywords.join("、")}` : "",
    product.price ? `价格：${product.price}` : "",
    product.linkUrl ? `链接：${product.linkUrl}` : "",
  ].filter(Boolean);
  return {
    title: product.name,
    content: parts.join("\n"),
    category: "product",
    weight: "medium",
    tags: [product.brand, product.category, ...product.keywords].filter(Boolean).slice(0, 8),
  };
}

const knowledgeWeightRank: Record<KnowledgeBaseWeight, number> = { high: 0, medium: 1, low: 2 };

/**
 * Picks the highest-weighted enabled entries that apply to a positioning and
 * renders them as compact reference lines for a writing prompt.
 */
export function selectKnowledgeReferences(
  entries: KnowledgeBaseRecord[],
  positioningId?: string | null,
  limit = knowledgeReferenceLimit,
): string[] {
  return [...entries]
    .filter((entry) => entry.enabled)
    .filter((entry) => !positioningId || !entry.positionId || entry.positionId === positioningId)
    .sort((a, b) => knowledgeWeightRank[a.weight] - knowledgeWeightRank[b.weight] || b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map((entry) => `【${entry.title}】${entry.content.slice(0, 300)}`);
}

/**
 * How close two similarities have to be before they are treated as the same rank (CI-EMB-01, D6).
 *
 * Cosine similarity is continuous, so "0.7312 beats 0.7311" is not a fact about relevance - it is floating
 * point noise deciding which knowledge entry a user sees. Inside this window the two chunks are equally good
 * matches and the *business* ordering decides, which is what keeps the semantic mode's result explainable
 * instead of being a ranking nobody can account for.
 */
export const semanticSimilarityTieWindow = 0.02;

/**
 * The similarity at or below which a chunk is not a match at all.
 *
 * A non-positive cosine means the two texts point in unrelated or opposite directions, and returning such a
 * record as a "reference" would put noise into the prompt. A query that matches nothing therefore returns
 * fewer references - or none - rather than the least-bad unrelated ones.
 */
export const semanticMinimumSimilarity = 0;

/** One stored chunk vector, as the semantic selector needs to see it. */
export type SemanticKnowledgeChunk = {
  knowledgeId: string;
  chunkIndex: number;
  vector: readonly number[];
  sourceHash: string;
  providerId: string;
  modelId: string;
};

export type SemanticKnowledgeMatch = {
  entry: KnowledgeBaseRecord;
  /** The best chunk's similarity for this record. */
  similarity: number;
  /** Which chunk of the record won, so a reader can say *what* matched. */
  chunkIndex: number;
};

export type SemanticKnowledgeDiagnostics = {
  /** Enabled entries that pass the positioning rule, before any vector was read. */
  considered: number;
  /** Of those, the ones with no stored vector at all. */
  withoutCompatibleVectors: number;
  /** Records dropped because their vectors were written for another model or another dimension. */
  incompatibleVectors: number;
  /** Records dropped because every candidate chunk was stale. */
  staleVectors: number;
  /** Records whose only matches did not clear `semanticMinimumSimilarity`. */
  unrelated: number;
};

/**
 * Ranks a knowledge base semantically, in the order D6 states it (CI-EMB-01).
 *
 * The steps are deliberately visible and in this order, because each one is a promise:
 *
 *  1. **`enabled` first.** A disabled entry is not a candidate whatever its similarity.
 *  2. **The existing positioning rule, unchanged**: an entry with no positioning applies to all of them, and
 *     a positioning that is not named matches nothing of another one - the semantic mode filters exactly like
 *     `selectKnowledgeReferences` does, so switching modes cannot widen what a user sees.
 *  3. **Only compatible chunks**: the same provider and model as the query, the same vector length, non-empty.
 *     Vectors of two dimensions are never compared (D4), and a chunk whose vector cannot be read is not a
 *     vector.
 *  4. **Only valid chunks**: a chunk whose `sourceHash` is not the record's current one is stale, and a stale
 *     vector may exist but is not evidence about the text the user has now.
 *  5. **Similarity**, over the chunks that survived. A record is scored by its *best* chunk, which is what
 *     aggregation means here: a record with one strongly matching paragraph is a match, and a record whose
 *     five paragraphs each match weakly does not win by having more of them.
 *  6. **One entry per record**, so a long record cannot fill the whole limit and hide every other record.
 *  7. **A total, explainable order**: similarity, with near-ties decided by the weight the user set, then by
 *     recency, then by title. Every factor is one a reader can point at; none is a fitted constant.
 */
export function selectSemanticKnowledgeReferences(input: {
  entries: readonly KnowledgeBaseRecord[];
  positioningId?: string | null;
  queryVector: readonly number[];
  chunks: readonly SemanticKnowledgeChunk[];
  /** The record's *current* source hash, computed by the caller from the same fields the vectors used. */
  sourceHashOf: (entry: KnowledgeBaseRecord) => string;
  /** The model the query vector came from; rows of another model are incompatible, never mixed in. */
  target: { providerId: string; modelId: string };
  limit?: number;
}): { matches: SemanticKnowledgeMatch[]; references: string[]; diagnostics: SemanticKnowledgeDiagnostics } {
  const limit = input.limit ?? knowledgeReferenceLimit;
  const diagnostics: SemanticKnowledgeDiagnostics = {
    considered: 0,
    withoutCompatibleVectors: 0,
    incompatibleVectors: 0,
    staleVectors: 0,
    unrelated: 0,
  };

  const candidates = input.entries
    .filter((entry) => entry.enabled)
    .filter((entry) => !input.positioningId || !entry.positionId || entry.positionId === input.positioningId);
  diagnostics.considered = candidates.length;

  const chunksByKnowledgeId = new Map<string, SemanticKnowledgeChunk[]>();
  for (const chunk of input.chunks) {
    const list = chunksByKnowledgeId.get(chunk.knowledgeId);
    if (list) list.push(chunk);
    else chunksByKnowledgeId.set(chunk.knowledgeId, [chunk]);
  }

  const matches: SemanticKnowledgeMatch[] = [];
  for (const entry of candidates) {
    const stored = chunksByKnowledgeId.get(entry.id) ?? [];
    if (stored.length === 0) {
      diagnostics.withoutCompatibleVectors += 1;
      continue;
    }
    const compatible = stored.filter(
      (chunk) =>
        chunk.providerId === input.target.providerId &&
        chunk.modelId === input.target.modelId &&
        chunk.vector.length > 0 &&
        chunk.vector.length === input.queryVector.length,
    );
    if (compatible.length === 0) {
      diagnostics.incompatibleVectors += 1;
      continue;
    }
    const sourceHash = input.sourceHashOf(entry);
    const valid = compatible.filter((chunk) => chunk.sourceHash === sourceHash);
    if (valid.length === 0) {
      diagnostics.staleVectors += 1;
      continue;
    }

    let best: SemanticKnowledgeMatch | null = null;
    for (const chunk of valid) {
      const similarity = cosineSimilarity(input.queryVector, chunk.vector);
      // `null` is not zero: a zero-length or mismatched pair is not a similarity at all, and it must not enter
      // the ranking as if the chunk had been measured and found unrelated.
      if (similarity === null || similarity <= semanticMinimumSimilarity) continue;
      if (!best || similarity > best.similarity) {
        best = { entry, similarity, chunkIndex: chunk.chunkIndex };
      }
    }
    if (!best) {
      diagnostics.unrelated += 1;
      continue;
    }
    matches.push(best);
  }

  matches.sort(compareSemanticMatches);
  const selected = matches.slice(0, limit);
  return { matches: selected, references: selected.map(renderKnowledgeReference), diagnostics };
}

/**
 * The semantic order, as one comparator: similarity first, with the documented tie window.
 *
 * Exported so a test can pin the *rule* rather than a sorted array's coincidence, and so any future caller
 * that wants the whole ranking (not just the top `limit`) sorts by exactly the same order.
 */
export function compareSemanticMatches(left: SemanticKnowledgeMatch, right: SemanticKnowledgeMatch) {
  if (Math.abs(left.similarity - right.similarity) > semanticSimilarityTieWindow) {
    return right.similarity - left.similarity;
  }
  return (
    knowledgeWeightRank[left.entry.weight] - knowledgeWeightRank[right.entry.weight] ||
    right.entry.updatedAt - left.entry.updatedAt ||
    left.entry.title.localeCompare(right.entry.title) ||
    left.entry.id.localeCompare(right.entry.id)
  );
}

/** The reference line a prompt reads, in exactly the shape `selectKnowledgeReferences` produces. */
function renderKnowledgeReference(match: SemanticKnowledgeMatch) {
  return `【${match.entry.title}】${match.entry.content.slice(0, 300)}`;
}
