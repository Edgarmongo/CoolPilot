import type { TranslationKey } from "@/lib/locale-resources";
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
