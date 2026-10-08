import {
  appStoreCategories,
  positionStyles,
  positionTones,
  type AppStoreCategory,
  type PositionDraft,
  type PositionPlatformOverride,
  type PositionStoreListing,
  type PositionStyle,
  type PositionTone,
} from "@/lib/types";
import type { TranslationKey } from "@/lib/locale-resources";

/** Character ceilings mirrored by the counters in the reference console. */
export const positionFieldLimits = {
  name: 60,
  description: 500,
  targetAudience: 200,
  contentDirection: 120,
  toneStyle: 500,
  personaRole: 2000,
  personaSeeds: 6000,
  writingGuide: 2000,
  topicAngle: 500,
  tagline: 120,
  sampleQuestion: 200,
} as const;

export const positionTabIds = ["basic", "persona", "writing", "strategy", "platform", "rss", "binding"] as const;

export type PositionTabId = (typeof positionTabIds)[number];

export const positionTabLabelKeys: Record<PositionTabId, TranslationKey> = {
  basic: "posTabBasic",
  persona: "posTabPersona",
  writing: "posTabWriting",
  strategy: "posTabStrategy",
  platform: "posTabPlatform",
  rss: "posTabRss",
  binding: "posTabBinding",
};

export const positionToneLabelKeys: Record<PositionTone, TranslationKey> = {
  colloquial: "posToneColloquial",
  formal: "posToneFormal",
  humorous: "posToneHumorous",
  warm: "posToneWarm",
  authoritative: "posToneAuthoritative",
  story: "posToneStory",
};

export const positionStyleLabelKeys: Record<PositionStyle, TranslationKey> = {
  advertorial: "posStyleAdvertorial",
  news: "posStyleNews",
  story: "posStyleStory",
  review: "posStyleReview",
  guide: "posStyleGuide",
  listicle: "posStyleListicle",
};

export const appStoreCategoryLabelKeys: Record<AppStoreCategory, TranslationKey> = {
  content: "storeCategoryContent",
  tech: "storeCategoryTech",
  marketing: "storeCategoryMarketing",
  life: "storeCategoryLife",
  hobby: "storeCategoryHobby",
  business: "storeCategoryBusiness",
  finance: "storeCategoryFinance",
  trade: "storeCategoryTrade",
};

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function cleanString(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function isTone(value: unknown): value is PositionTone {
  return (positionTones as readonly string[]).includes(value as string);
}

function isStyle(value: unknown): value is PositionStyle {
  return (positionStyles as readonly string[]).includes(value as string);
}

export function isStoreCategory(value: unknown): value is AppStoreCategory {
  return (appStoreCategories as readonly string[]).includes(value as string);
}

export function defaultStoreListing(): PositionStoreListing {
  return {
    emoji: "🐑",
    category: appStoreCategories[0],
    tagline: "",
    sampleQuestion: "",
    status: "none",
    testScore: 0,
  };
}

export function emptyPositionDraft(name = ""): PositionDraft {
  return {
    name,
    description: "",
    targetAudience: "",
    contentDirection: "",
    toneStyle: "",
    personaRole: "",
    personaSeeds: "",
    writingGuide: "",
    bannedWords: [],
    antiAiDetection: true,
    knowledgeHotspotBalance: 50,
    aiFreedom: 50,
    allowKnowledgeReuse: true,
    cooldownDays: 7,
    maxUses: 0,
    platformOverrides: [],
    rssSources: [],
    store: defaultStoreListing(),
  };
}

function normalizeStringList(value: unknown, max: number, maxItems = 200) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const text = cleanString(entry, max);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

function normalizePlatformOverrides(value: unknown): PositionPlatformOverride[] {
  if (!Array.isArray(value)) return [];
  const result: PositionPlatformOverride[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const platform = cleanString(raw.platform, 60);
    if (!platform) continue;
    const tone = isTone(raw.tone) ? raw.tone : "";
    const style = isStyle(raw.style) ? raw.style : "";
    const wordCount = cleanString(raw.wordCount, 12).replace(/[^\d]/g, "");
    const topicAngle = cleanString(raw.topicAngle, positionFieldLimits.topicAngle);
    if (!tone && !style && !wordCount && !topicAngle) continue;
    result.push({ platform, tone, style, wordCount, topicAngle });
  }
  return result;
}

export function normalizeStoreListing(value: unknown): PositionStoreListing {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const status = (["none", "testing", "published", "rejected"] as const).includes(
    raw.status as PositionStoreListing["status"],
  )
    ? (raw.status as PositionStoreListing["status"])
    : "none";
  const category = isStoreCategory(raw.category) ? raw.category : appStoreCategories[0];
  return {
    emoji: cleanString(raw.emoji, 8) || "🐑",
    category,
    tagline: cleanString(raw.tagline, positionFieldLimits.tagline),
    sampleQuestion: cleanString(raw.sampleQuestion, positionFieldLimits.sampleQuestion),
    status,
    testScore: clampNumber(raw.testScore, 0, 100, 0),
    publishedAt: Number.isFinite(Number(raw.publishedAt)) ? Number(raw.publishedAt) : undefined,
  };
}

/** Coerces arbitrary persisted JSON into a safe, fully-populated position draft. */
export function normalizePositionDraft(value: unknown): PositionDraft {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    name: cleanString(raw.name, positionFieldLimits.name),
    description: cleanString(raw.description, positionFieldLimits.description),
    targetAudience: cleanString(raw.targetAudience, positionFieldLimits.targetAudience),
    contentDirection: cleanString(raw.contentDirection, positionFieldLimits.contentDirection),
    toneStyle: cleanString(raw.toneStyle, positionFieldLimits.toneStyle),
    personaRole: cleanString(raw.personaRole, positionFieldLimits.personaRole),
    personaSeeds: cleanString(raw.personaSeeds, positionFieldLimits.personaSeeds),
    writingGuide: cleanString(raw.writingGuide, positionFieldLimits.writingGuide),
    bannedWords: normalizeStringList(raw.bannedWords, 40),
    antiAiDetection: raw.antiAiDetection === undefined ? true : Boolean(raw.antiAiDetection),
    knowledgeHotspotBalance: clampNumber(raw.knowledgeHotspotBalance, 0, 100, 50),
    aiFreedom: clampNumber(raw.aiFreedom, 0, 100, 50),
    allowKnowledgeReuse: raw.allowKnowledgeReuse === undefined ? true : Boolean(raw.allowKnowledgeReuse),
    cooldownDays: clampNumber(raw.cooldownDays, 0, 365, 7),
    maxUses: clampNumber(raw.maxUses, 0, 9999, 0),
    platformOverrides: normalizePlatformOverrides(raw.platformOverrides),
    rssSources: normalizeStringList(raw.rssSources, 500),
    store: normalizeStoreListing(raw.store),
  };
}

const defaultWritingGuide = [
  "如：",
  "1. 开头用生活场景引入",
  "2. 关键数据必须标注来源",
  "3. 结尾引导关注并给出下一步行动",
].join("\n");

/**
 * Deterministic fallback used when the AI profile builder is unavailable (no key / provider error).
 * Mirrors the shape the AI would return so the preview dialog keeps working offline.
 */
export function buildPositionDraftFromPrompt(prompt: string): PositionDraft {
  const seed = prompt.trim().slice(0, positionFieldLimits.description);
  const name =
    seed
      .replace(/[「」""'']/g, "")
      .split(/[，。,.!！?？\s]/)
      .filter(Boolean)[0]
      ?.slice(0, 24) || "新定位";
  const draft = emptyPositionDraft(name);
  return {
    ...draft,
    description: seed,
    targetAudience: "关注该领域的主动读者，希望用碎片时间获取实用、可信的内容。",
    contentDirection: name,
    toneStyle: seed ? `围绕「${name}」，保持自然口语、信息密度高的表达。` : "",
    personaRole: [
      `你是「${name}」的写作智能体。`,
      seed ? `领域设定：${seed}` : "",
      "写作时先给结论，再展开论据；语句简洁，避免套话；引用数据时标注来源。",
      "遇到不确定的信息，明确说明并以可核实的事实为准，不编造细节。",
    ]
      .filter(Boolean)
      .join("\n"),
    personaSeeds: "",
    writingGuide: defaultWritingGuide,
    store: { ...draft.store, tagline: seed.slice(0, positionFieldLimits.tagline) },
  };
}

export type StoreListingEvaluation = {
  score: number;
  passed: boolean;
  missing: string[];
};

/**
 * Test-generation gate for publishing to the app store. Scores listing completeness
 * (tagline + sample question + a usable persona + description) on a 0-100 scale; 60 passes.
 */
export function evaluateStoreListing(listing: PositionStoreListing, draft: PositionDraft): StoreListingEvaluation {
  const missing: string[] = [];
  let score = 0;

  if (listing.tagline.trim().length >= 8) score += 30;
  else missing.push("tagline");

  if (listing.sampleQuestion.trim().length >= 6) score += 25;
  else missing.push("sampleQuestion");

  if (draft.personaRole.trim().length >= 40) score += 25;
  else missing.push("personaRole");

  if (draft.description.trim().length >= 10) score += 20;
  else missing.push("description");

  const normalized = Math.max(0, Math.min(100, score));
  return { score: normalized, passed: normalized >= 60 && missing.length === 0, missing };
}

/** Splits a free-text textarea into trimmed, de-duplicated non-empty lines. */
export function splitTextLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

