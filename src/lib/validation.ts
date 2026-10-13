import { z } from "zod";
import {
  aiWritingKeywordsMaxLength,
  aiWritingWordCountMax,
  aiWritingWordCountMin,
  articleStyles,
  audiences,
  imageCounts,
  imageStrategies,
  industryDomains,
  knowledgeModes,
  materialSources,
  outputLanguages,
} from "./ai-writing";
import { articleThemeIds } from "./article-themes";
import { knowledgeEmbeddingBatchSize, knowledgeEmbeddingScopes } from "./knowledge-embedding/embedding";
import {
  appStoreCategories,
  difyInsufficientModes,
  difyScopes,
  knowledgeBaseCategories,
  knowledgeBaseOrigins,
  knowledgeBaseWeights,
  metricStatuses,
  playbookIds,
  positionStoreStatuses,
  positionStyles,
  positionTones,
  publishRecordStatuses,
  accountPlatforms,
  researchMaterialKinds,
  aiPriceCurrencies,
  aiPriceSources,
  aiUsageMeteredKinds,
  aiUsageUnitLabels,
  marketingLeadStatuses,
} from "./types";
import { topicStatuses } from "./topics";
import { researchExtractionOutputSchema } from "./research-extraction/extraction";
import { aiBudgetPolicies, aiBudgetStrategies, aiBudgetUnknownCostPolicies } from "./ai-budget";
import { qualitySuggestionIds } from "./quality-cost";

export const siteInputSchema = z.object({
  name: z.string().trim().min(1),
  platform: z.enum(accountPlatforms),
  url: z.string().trim().optional().default(""),
  account: z.string().trim().optional().default(""),
  memo: z.string().trim().optional().default(""),
  status: z.enum(["active", "paused", "needs_login"]).optional().default("needs_login"),
  preset: z.record(z.string(), z.unknown()).optional().default({}),
});

const timeOfDayPattern = /^\d{2}:\d{2}$/;

export const scheduleTimeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily"), time: z.string().regex(timeOfDayPattern) }),
  z.object({ type: z.literal("once"), at: z.string().datetime() }),
  z.object({
    type: z.literal("weekly"),
    time: z.string().regex(timeOfDayPattern),
    /** 0 = Sunday … 6 = Saturday. */
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  }),
  z.object({
    type: z.literal("monthly"),
    time: z.string().regex(timeOfDayPattern),
    /** 1–31; a day past a short month resolves to that month's last day. */
    days: z.array(z.number().int().min(1).max(31)).min(1).max(31),
  }),
  z.object({
    type: z.literal("interval"),
    everyMinutes: z.number().int().min(5).max(43_200),
    anchor: z.string().datetime().optional(),
  }),
]);

export const scheduleInputSchema = z.object({
  playbookId: z.enum(playbookIds),
  accountId: z.string().trim().optional(),
  enabled: z.boolean().optional().default(true),
  scheduleTimes: z.array(scheduleTimeSchema).min(1),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

export const runInputSchema = z.object({
  playbookId: z.enum(playbookIds),
  accountId: z.string().trim().optional(),
  scheduleId: z.string().trim().optional(),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

export const contentGenerateSchema = z.object({
  topic: z.string().trim().min(1),
  keywords: z.string().trim().optional().default(""),
  maxWords: z.number().int().min(50).max(aiWritingWordCountMax).optional().default(300),
  language: z.string().trim().optional().default("简体中文"),
  prompt: z.string().trim().optional().default(""),
  type: z.string().trim().optional().default("post"),
  agentId: z.string().trim().optional(),
  // Extended writing config used by the article-creation page.
  positioningId: z.string().trim().optional().default(""),
  /**
   * The brand profile (品牌资料) this run writes as (CI-P2-02 / CI-P2-03). The same contract as the
   * wizard's `config.brandId`: an empty string means "none selected", so a client that does not send
   * the field keeps working and injects no brand context, and an id that names nothing is still no
   * brand - never a fallback to another one.
   */
  brandId: z.string().trim().max(60).optional().default(""),
  /**
   * The topic (选题) this run is writing about (CI-P2-01 / CI-P2-03). Unlike the wizard's field of the
   * same name - where the text already travelled as material and the id is only provenance - this one is
   * *read*: the route loads the row, so the topic's own description, keywords and source reach the
   * prompt and its source page may feed the image resolver.
   */
  topicId: z.string().trim().max(60).optional().default(""),
  /**
   * The research material (研究素材) this run is written from (CI-P3-01). Like `topicId`, this one is
   * *read*: the route loads the row, so the material's own text reaches the prompt and its source page
   * may feed the image resolver - the browser sends an id, never a copy of the text. An empty string is
   * every client that predates the field, and an id that names nothing contributes nothing.
   */
  researchMaterialId: z.string().trim().max(60).optional().default(""),
  /**
   * Whether this run also reads the material's stored 研究提炼 (CI-P3-03).
   *
   * It is a *permission*, not a claim, and it defaults to `false` so that every client that predates the
   * field - and every run that does not ask - reaches the model with exactly the material text it reached
   * it with before. When it is `true` the route appends the digest (`researchExtractionPromptText`), and
   * the provenance records the version that was appended; when the material has no stored extraction the
   * flag changes nothing and nothing is recorded, because there is nothing to read.
   */
  includeResearchExtraction: z.boolean().optional().default(false),
  knowledgeMode: z.enum(knowledgeModes).optional().default("position"),
  articleStyle: z.enum(articleStyles).optional().default("advertorial"),
  industry: z.enum(industryDomains).optional().default("general"),
  audience: z.enum(audiences).optional().default("unlimited"),
  targetPlatform: z.string().trim().max(60).optional().default(""),
  languageCode: z.enum(outputLanguages).optional(),
  imageStrategy: z.enum(imageStrategies).optional().default("product"),
  imageCount: z.enum(imageCounts).optional().default("few"),
  deAi: z.boolean().optional().default(true),
});

/** PATCH variant without defaults, so a partial update never resets untouched columns. */
export const contentPatchSchema = z.object({
  title: z.string().trim().min(1).optional(),
  body: z.string().optional(),
  postReadyText: z.string().optional(),
  images: z.array(z.string().trim()).max(12).optional(),
  status: z.enum(["draft", "ready", "posted", "failed"]).optional(),
  /** Typesetting theme chosen in the article editor. */
  themeId: z.enum(articleThemeIds).optional(),
});

/**
 * `POST /api/content/[id]/platform-versions` (CI-P2-05). `derive` re-runs the adapter over the base
 * content; `save` stores what the author wrote for that platform. The platform name is checked against
 * `accountPlatforms` in the route, the same list the account dialog and the publish route validate
 * against.
 */
export const platformVersionUpsertSchema = z.object({
  platform: z.string().trim().min(1).max(60),
  mode: z.enum(["derive", "save"]).optional().default("derive"),
  title: z.string().max(2000).optional(),
  body: z.string().max(50000).optional(),
});

/** PATCH edits the text of an existing version; its media and its provenance stay as they are. */
export const platformVersionPatchSchema = z.object({
  platform: z.string().trim().min(1).max(60),
  title: z.string().max(2000).optional(),
  body: z.string().max(50000).optional(),
});

/** Article rewrite modes offered by the “AI 改写” dialog. */
export const articleRewriteModes = ["polish", "platform", "risk", "tone"] as const;
export type ArticleRewriteMode = (typeof articleRewriteModes)[number];

export const articleRewriteStrengths = ["light", "medium", "heavy"] as const;
export type ArticleRewriteStrength = (typeof articleRewriteStrengths)[number];

export const contentRewriteSchema = z.object({
  mode: z.enum(articleRewriteModes),
  industry: z.enum(industryDomains).optional().default("general"),
  strength: z.enum(articleRewriteStrengths).optional().default("medium"),
  styleFeatures: z.string().trim().max(1000).optional().default(""),
  requiredTitle: z.string().trim().max(120).optional().default(""),
  customRequirements: z.string().trim().max(500).optional().default(""),
  bannedWords: z.array(z.string().trim().max(40)).max(200).optional().default([]),
});

export const contentTranslateSchema = z.object({
  targetLanguage: z.string().trim().min(1).max(40),
  /** Editor content to translate; falls back to the stored body when omitted. */
  text: z.string().max(20000).optional(),
  /** Editor title, so the translation matches what the user sees. */
  title: z.string().trim().max(200).optional(),
});

export const aiWritingGenerateSchema = z.object({
  config: z.object({
    materialSource: z.enum(materialSources),
    articleStyle: z.enum(articleStyles),
    industry: z.enum(industryDomains),
    wordCount: z.number().int().min(aiWritingWordCountMin).max(aiWritingWordCountMax),
    audience: z.enum(audiences),
    targetPlatform: z.string().trim().max(60).optional().default(""),
    coreKeywords: z.string().trim().max(aiWritingKeywordsMaxLength).optional().default(""),
    language: z.enum(outputLanguages),
    imageStrategy: z.enum(imageStrategies),
    imageCount: z.enum(imageCounts),
    deAi: z.boolean().optional().default(true),
    knowledgeMode: z.enum(knowledgeModes),
    positioningId: z.string().trim().optional().default(""),
    /**
     * The brand profile (品牌资料) this run writes as (CI-P2-02). Like `positioningId`, an empty
     * string means "none selected": a client that does not send the field keeps working and injects
     * no brand context, and the id is never a way to reach another brand's data.
     */
    brandId: z.string().trim().max(60).optional().default(""),
  }),
  topics: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        source: z.string().trim().max(60).optional().default(""),
        url: z.string().trim().max(600).optional().default(""),
      }),
    )
    .max(30)
    .optional()
    .default([]),
  productIds: z.array(z.string().trim().min(1)).max(30).optional().default([]),
  freeText: z.string().trim().max(8000).optional().default(""),
  /**
   * The topic (选题) this run is writing about, when the user arrived from the topic list
   * (CI-P2-01). It is provenance, not material: the text already travelled as `freeText`, and this id
   * is what lets the stored article and the topic point at each other.
   */
  topicId: z.string().trim().max(60).optional().default(""),
});

/**
 * The knowledge-index request body (CI-EMB-01, D10).
 *
 * The task's own schema (`knowledgeEmbeddingRequestSchema`) is what the executor reads back out of the stored
 * run, and this is the shape the HTTP entry accepts - deliberately the same fields, with the same defaults, so a
 * caller's payload is stored as it was sent rather than as this layer reinterpreted it.
 */
export const knowledgeEmbeddingCreateSchema = z.object({
  /** `stale` fills what is missing or outdated; `rebuild` recomputes every record - the model-migration path. */
  scope: z.enum(knowledgeEmbeddingScopes).optional().default("stale"),
  /** The records to index; an empty list means every knowledge record. */
  recordIds: z.array(z.string().trim().min(1)).max(500).optional().default([]),
  /** Pin the embedding model; absent means the runtime's `embedding` route decides. */
  model: z.string().trim().max(200).optional(),
  providerId: z.string().trim().max(60).optional(),
  batchSize: z.number().int().min(1).max(64).optional().default(knowledgeEmbeddingBatchSize),
  /** The caller's exactly-once key: a second submission with the same key reuses the first task. */
  idempotencyKey: z.string().trim().max(120).optional(),
});

export const contentCreateSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string().optional().default(""),
  postReadyText: z.string().optional().default(""),
  type: z.string().trim().optional().default("article"),
  /**
   * The origin the 来源 column shows (CI-SC-01). The canvas entry points record `mindmap` /
   * `whiteboard`; an empty value means "no recorded origin" and the list keeps reading that as
   * 手动录入, so nothing changes for the callers that never send it.
   */
  source: z.string().trim().max(40).optional().default(""),
  sourceUrls: z.array(z.string().trim().url()).optional().default([]),
  images: z.array(z.string().trim()).optional().default([]),
  /** Stored video file name; only used by video content items. */
  videoPath: z.string().trim().optional().default(""),
});

export const importUrlSchema = z.object({
  url: z.string().trim().url(),
  maxWords: z.number().int().min(50).max(1000).optional().default(300),
  language: z.string().trim().optional().default("简体中文"),
  rewrite: z.boolean().optional().default(true),
});

export const localAgentSettingsSchema = z.object({
  runtimeMode: z.enum(["local"]).catch("local").optional(),
  textProvider: z.enum(["gemini", "groq", "openai", "openrouter"]).optional(),
  imageProvider: z.enum(["gemini", "openai"]).optional(),
  geminiKey: z.string().optional(),
  groqKey: z.string().optional(),
  openAIKey: z.string().optional(),
  openRouterKey: z.string().optional(),
  // Image credentials are stored under their own provider refs, never the text provider's
  // (CI-AI-IMG-CONFIG-02, Q1/Q2).
  openAIImageKey: z.string().optional(),
  geminiImageKey: z.string().optional(),
  geminiModel: z.string().trim().optional(),
  groqModel: z.string().trim().optional(),
  openAIBaseUrl: z.string().trim().url().optional(),
  // An OpenAI-compatible image endpoint that is independent of the text one. The empty string is a
  // valid value ("not configured") and never falls back to `openAIBaseUrl` (Q4).
  openAIImageBaseUrl: z.union([z.string().trim().url(), z.literal("")]).optional(),
  openAIModel: z.string().trim().optional(),
  openRouterBaseUrl: z.string().trim().url().optional(),
  openRouterModel: z.string().trim().optional(),
  geminiImageModel: z.string().trim().optional(),
  openAIImageModel: z.string().trim().optional(),
  openAIImageSize: z.string().trim().min(1).optional(),
  agentPermissions: z.object({
    browserStep: z.enum(["auto", "confirm"]).optional(),
    browserPostContent: z.enum(["auto", "confirm"]).optional(),
    generateImage: z.enum(["auto", "confirm"]).optional(),
    generatePostContent: z.enum(["auto", "confirm"]).optional(),
    schedulePost: z.enum(["auto", "confirm"]).optional(),
  }).optional(),
});

const optionalHexColorSchema = z.string().trim().refine(
  (value) => value === "" || /^#[0-9a-f]{6}$/i.test(value),
  "Expected a six-digit hex color",
);

export const brandSettingsSchema = z.object({
  name: z.string().trim().max(120).optional().default(""),
  description: z.string().trim().max(4000).optional().default(""),
  targetAudience: z.string().trim().max(2000).optional().default(""),
  voice: z.string().trim().max(2000).optional().default(""),
  colors: z.object({
    primary: optionalHexColorSchema.optional().default(""),
    accent: optionalHexColorSchema.optional().default(""),
    background: optionalHexColorSchema.optional().default(""),
  }).optional().default({ primary: "", accent: "", background: "" }),
  logoPath: z.string().trim().max(1000).optional(),
});

export const promptSettingsSchema = z.object({
  systemPrompt: z.string().trim().max(12000).optional().default(""),
});

export const productInputSchema = z.object({
  name: z.string().trim().min(1),
  brand: z.string().trim().optional().default(""),
  description: z.string().trim().optional().default(""),
  category: z.string().trim().optional().default(""),
  keywords: z.array(z.string().trim()).optional().default([]),
  price: z.string().trim().optional().default(""),
  imagePath: z.string().trim().optional().default(""),
  linkUrl: z.string().trim().optional().default(""),
  status: z.enum(["active", "archived"]).optional().default("active"),
});

/**
 * PATCH variant. Fields are plain optionals (no `.default()`), because calling
 * `.partial()` on a defaulted schema re-applies the defaults for absent keys and
 * would silently overwrite the untouched columns.
 */
export const productPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  brand: z.string().trim().optional(),
  description: z.string().trim().optional(),
  category: z.string().trim().optional(),
  keywords: z.array(z.string().trim()).optional(),
  price: z.string().trim().optional(),
  imagePath: z.string().trim().optional(),
  linkUrl: z.string().trim().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

/** A topic the user adds by hand, imports from a hot-topic list, or edits later (CI-P2-01). */
export const topicInputSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().optional().default(""),
  keywords: z.array(z.string().trim()).max(30).optional().default([]),
  source: z.string().trim().max(60).optional().default("manual"),
  sourceUrl: z.string().trim().max(600).optional().default(""),
  status: z.enum(topicStatuses).optional().default("active"),
});

/**
 * PATCH variant. `contentItemId` is deliberately absent: which article a topic produced is written by
 * the generation entry alone (`linkTopicContentItem`), never by a payload the browser sends.
 */
export const topicPatchSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  keywords: z.array(z.string().trim()).max(30).optional(),
  source: z.string().trim().max(60).optional(),
  sourceUrl: z.string().trim().max(600).optional(),
  status: z.enum(topicStatuses).optional(),
});

/**
 * One brand profile (品牌资料, CI-P2-02 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The six fields the card asks for, and nothing else: 品牌名称 / 简介 / 目标受众 / 语气 / 关键词 /
 * 禁用表达. `keywords` and `bannedWords` are list-shaped, stored as JSON like `products.keywords_json`.
 */
export const brandInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4000).optional().default(""),
  targetAudience: z.string().trim().max(2000).optional().default(""),
  tone: z.string().trim().max(2000).optional().default(""),
  keywords: z.array(z.string().trim()).max(30).optional().default([]),
  bannedWords: z.array(z.string().trim()).max(50).optional().default([]),
});

/** PATCH variant without defaults, so a partial edit never resets untouched columns. */
export const brandPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(4000).optional(),
  targetAudience: z.string().trim().max(2000).optional(),
  tone: z.string().trim().max(2000).optional(),
  keywords: z.array(z.string().trim()).max(30).optional(),
  bannedWords: z.array(z.string().trim()).max(50).optional(),
});

export const knowledgeBaseInputSchema = z.object({
  title: z.string().trim().min(1),
  content: z.string().optional().default(""),
  category: z.enum(knowledgeBaseCategories).optional().default("other"),
  weight: z.enum(knowledgeBaseWeights).optional().default("medium"),
  enabled: z.boolean().optional().default(true),
  origin: z.enum(knowledgeBaseOrigins).optional().default("manual"),
  tags: z.array(z.string().trim()).optional().default([]),
  sourceUrl: z.string().trim().optional().default(""),
  fileName: z.string().trim().optional().default(""),
  positionId: z.string().trim().optional().default(""),
});

/** PATCH variant without defaults, so a partial update never resets untouched columns. */
export const knowledgeBasePatchSchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.string().optional(),
  category: z.enum(knowledgeBaseCategories).optional(),
  weight: z.enum(knowledgeBaseWeights).optional(),
  enabled: z.boolean().optional(),
  origin: z.enum(knowledgeBaseOrigins).optional(),
  tags: z.array(z.string().trim()).optional(),
  sourceUrl: z.string().trim().optional(),
  fileName: z.string().trim().optional(),
  positionId: z.string().trim().optional(),
});

/** "Smart import" payload: free-form text the AI structures into a knowledge entry. */
export const knowledgeBaseSmartImportSchema = z.object({
  content: z.string().trim().min(1),
  positionId: z.string().trim().optional().default(""),
});

/** "Import from product library" payload. */
export const knowledgeBaseProductImportSchema = z.object({
  positionId: z.string().trim().optional().default(""),
  productIds: z.array(z.string().trim().min(1)).optional().default([]),
});

/**
 * One research material the user adds or edits by hand (CI-P3-01 of
 * `docs/coolpilot-capability-integration-plan.md`).
 *
 * `status` is deliberately absent, on purpose and for the same reason `topicPatchSchema` has no
 * `contentItemId`: what happened to a source is the outcome of a *read*, not something a form may
 * assert. The route derives the honest case (a note with text is `ready`, a source URL nobody has read
 * yet is `draft`) and only the fetch entry ever writes `empty` / `failed` - so no client can post a
 * "读取成功" a read did not produce.
 */
export const researchMaterialInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  /**
   * No default here on purpose: the route reads an omitted kind off the payload (a source url with no kind
   * is a link, a body with no url is a note), which a schema default would shadow by filling the field in
   * before the route ever sees it.
   */
  kind: z.enum(researchMaterialKinds).optional(),
  content: z.string().max(200_000).optional().default(""),
  sourceUrl: z.string().trim().max(600).optional().default(""),
  tags: z.array(z.string().trim()).max(30).optional().default([]),
});

/** PATCH variant without defaults, so a partial edit never resets untouched columns. */
export const researchMaterialPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(researchMaterialKinds).optional(),
  content: z.string().max(200_000).optional(),
  sourceUrl: z.string().trim().max(600).optional(),
  tags: z.array(z.string().trim()).max(30).optional(),
});

/** "Get dataset list" payload used by the Dify connection drawer. */
export const difyDatasetListSchema = z.object({
  apiBase: z.string().trim().url(),
  apiKey: z.string().trim().min(1),
});

export const difyConnectionInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  apiBase: z
    .string()
    .trim()
    .url()
    .refine((value) => value.startsWith("https://"), { message: "HTTPS required" }),
  apiKey: z.string().trim().optional().default(""),
  knowledgeIds: z.array(z.string().trim().min(1)).max(4).optional().default([]),
  publicConfirmed: z.boolean().optional().default(false),
  scopes: z.array(z.enum(difyScopes)).optional().default([]),
  positionId: z.string().trim().optional().default(""),
  insufficientMode: z.enum(difyInsufficientModes).optional().default("knowledge_first"),
  scoreThreshold: z.number().int().min(0).max(100).optional().default(45),
  enabled: z.boolean().optional().default(false),
});

/** PATCH variant without defaults, so a partial update never resets untouched columns. */
export const difyConnectionPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  apiBase: z
    .string()
    .trim()
    .url()
    .refine((value) => value.startsWith("https://"), { message: "HTTPS required" })
    .optional(),
  apiKey: z.string().trim().optional(),
  knowledgeIds: z.array(z.string().trim().min(1)).max(4).optional(),
  publicConfirmed: z.boolean().optional(),
  scopes: z.array(z.enum(difyScopes)).optional(),
  positionId: z.string().trim().optional(),
  insufficientMode: z.enum(difyInsufficientModes).optional(),
  scoreThreshold: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});

export const publishInputSchema = z.object({
  accountIds: z.array(z.string().trim().min(1)).min(1),
  title: z.string().optional().default(""),
  /** Empty text is valid: video platforms accept a title-only upload. */
  text: z.string().optional().default(""),
  imagePath: z.string().optional().default(""),
  /** Local video file forwarded to platforms that expose a video upload control. */
  videoPath: z.string().optional().default(""),
  publish: z.boolean().optional().default(true),
  contentType: z.string().trim().optional().default(""),
  method: z.string().trim().optional().default(""),
  terminal: z.string().trim().optional().default(""),
  contentItemId: z.string().trim().optional(),
});

export const publishRecordPatchSchema = z.object({
  status: z.enum(publishRecordStatuses).optional(),
  url: z.string().trim().optional(),
  message: z.string().optional(),
  publishedAt: z.number().int().optional(),
});

export const imageGenerateSchema = z.object({
  prompt: z.string().trim().min(1),
});

export const imageDeleteSchema = z.object({
  fileNames: z.array(z.string().trim().min(1)).min(1).max(200),
});

export const imageFromUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .refine((value) => /^https?:\/\//i.test(value), "Only http(s) image links are supported"),
  /** Tried when the original host is unreachable (e.g. a Bing thumbnail). */
  fallbackUrl: z
    .string()
    .trim()
    .refine((value) => value === "" || /^https?:\/\//i.test(value), "Only http(s) image links are supported")
    .optional(),
});

export const browserInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mouse"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    event: z.enum(["mousePressed", "mouseReleased", "mouseMoved"]),
    button: z.enum(["left", "right", "middle"]).optional(),
    clickCount: z.number().int().optional(),
    /** CDP buttons bitmask; 1 marks a left-button drag (for text selection). */
    buttons: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("wheel"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    deltaX: z.number().optional().default(0),
    deltaY: z.number().optional().default(0),
  }),
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("key"),
    key: z.string().min(1),
    code: z.string().optional(),
    keyCode: z.number().int().optional(),
    /** CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8 (for bold/copy/paste/home/end…). */
    modifiers: z.number().int().optional(),
  }),
]);

const positionPlatformOverrideSchema = z.object({
  platform: z.string().trim().min(1).max(60),
  tone: z.enum(positionTones).or(z.literal("")).optional().default(""),
  wordCount: z.string().trim().max(12).optional().default(""),
  style: z.enum(positionStyles).or(z.literal("")).optional().default(""),
  topicAngle: z.string().trim().max(500).optional().default(""),
});

export const positionStoreListingSchema = z.object({
  emoji: z.string().trim().max(8).optional().default("🐑"),
  category: z.enum(appStoreCategories).optional().default(appStoreCategories[0]),
  tagline: z.string().trim().max(120).optional().default(""),
  sampleQuestion: z.string().trim().max(200).optional().default(""),
  status: z.enum(positionStoreStatuses).optional().default("none"),
  testScore: z.number().int().min(0).max(100).optional().default(0),
  publishedAt: z.number().int().optional(),
});

export const positionDraftSchema = z.object({
  name: z.string().trim().max(60).optional().default(""),
  description: z.string().trim().max(500).optional().default(""),
  targetAudience: z.string().trim().max(200).optional().default(""),
  contentDirection: z.string().trim().max(120).optional().default(""),
  toneStyle: z.string().trim().max(500).optional().default(""),
  personaRole: z.string().trim().max(2000).optional().default(""),
  personaSeeds: z.string().trim().max(6000).optional().default(""),
  writingGuide: z.string().trim().max(2000).optional().default(""),
  bannedWords: z.array(z.string().trim().max(40)).max(200).optional().default([]),
  antiAiDetection: z.boolean().optional().default(true),
  knowledgeHotspotBalance: z.number().int().min(0).max(100).optional().default(50),
  aiFreedom: z.number().int().min(0).max(100).optional().default(50),
  allowKnowledgeReuse: z.boolean().optional().default(true),
  cooldownDays: z.number().int().min(0).max(365).optional().default(7),
  maxUses: z.number().int().min(0).max(9999).optional().default(0),
  platformOverrides: z.array(positionPlatformOverrideSchema).max(60).optional().default([]),
  rssSources: z.array(z.string().trim().max(500)).max(200).optional().default([]),
  store: positionStoreListingSchema.optional(),
});

export const positionCreateSchema = positionDraftSchema.partial({ name: true });

export const positionGenerateSchema = z.object({
  prompt: z.string().trim().min(1).max(300),
});

export const positionPublishSchema = z.object({
  emoji: z.string().trim().max(8).optional().default("🐑"),
  category: z.enum(appStoreCategories).optional().default(appStoreCategories[0]),
  tagline: z.string().trim().max(120).optional().default(""),
  sampleQuestion: z.string().trim().max(200).optional().default(""),
  runTest: z.boolean().optional().default(true),
});

/** Manual metric correction for a single publish record. */
export const metricPatchSchema = z.object({
  views: z.number().int().min(0).optional(),
  likes: z.number().int().min(0).optional(),
  comments: z.number().int().min(0).optional(),
  shares: z.number().int().min(0).optional(),
  favorites: z.number().int().min(0).optional(),
  followsDelta: z.number().int().optional(),
  completionRate: z.number().min(0).max(100).nullable().optional(),
  metricStatus: z.enum(metricStatuses).optional(),
});

/** Trigger scope for a manual metric sync. */
export const metricSyncSchema = z.object({
  accountId: z.string().trim().optional(),
  platform: z.string().trim().optional(),
  publishRecordId: z.string().trim().optional(),
});

/** Scope for a manual account-health (风控) scan; empty means every account. */
export const accountHealthScanSchema = z.object({
  accountIds: z.array(z.string().trim().min(1)).max(200).optional(),
});

export const metricSettingsSchema = z.object({
  autoRefreshEnabled: z.boolean().optional(),
  refreshSamplingHours: z.array(z.number().int().min(1).max(8760)).max(24).optional(),
  perAccountThrottleMs: z.number().int().min(0).max(60_000).optional(),
});

/** Persisted state of the manual model-gateway sync (see 系统 / 模型管理). */
export const modelGatewaySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  endpoint: z.string().trim().url().optional(),
  models: z.array(z.string().trim().min(1).max(200)).max(4000).optional(),
  source: z.string().trim().max(300).optional(),
  syncedAt: z.number().int().min(0).nullable().optional(),
  status: z.enum(["never", "ok", "error"]).optional(),
  message: z.string().trim().max(1000).optional(),
});

/** POST body for the 系统 / 模型管理 gateway actions. */
export const modelGatewayActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    enabled: z.boolean().optional(),
    endpoint: z.string().trim().url().optional(),
    /** Masked values (`****1234`) are echoed back by the UI and must be ignored. */
    cookie: z.string().max(4000).optional(),
  }),
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("reset") }),
]);

export const metricInsightRequestSchema = z.object({
  publishRecordId: z.string().trim().min(1),
});

/**
 * AI runtime payloads (系统 / 模型管理). The protocol / capability vocabularies are
 * mirrored from `features/ai-runtime/contracts.ts`; keep the literals in sync there.
 */
export const aiModelProtocolSchema = z.enum(["openai-compatible", "gemini", "anthropic"]);

export const aiModelCapabilitySchema = z.enum([
  "chat",
  "reasoning",
  "vision",
  "audio_input",
  "audio_output",
  "tool_calling",
  "structured_output",
  "image_generation",
  "video_generation",
  "text_to_speech",
  "speech_to_text",
  "embedding",
  "rerank",
]);

export const aiProviderActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    providerId: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(80).optional(),
    region: z.enum(["global", "cn"]).optional(),
    protocol: aiModelProtocolSchema.optional(),
    baseUrl: z.string().trim().max(500).optional(),
    /**
     * One key per line (commas and semicolons work too). Masked values (`****1234`)
     * echoed back by the UI are ignored, so a re-save cannot overwrite a real key.
     */
    apiKey: z.string().max(20_000).optional(),
    enabled: z.boolean().optional(),
    endpointEnabled: z.boolean().optional(),
    docsUrl: z.string().trim().max(500).optional(),
    apiKeyUrl: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal("test"), providerId: z.string().trim().min(1).max(60) }),
  z.object({ action: z.literal("delete"), providerId: z.string().trim().min(1).max(60) }),
  /** Manual credential lifecycle: clear a cooldown, take a key out of rotation, put it back. */
  z.object({
    action: z.literal("key"),
    providerId: z.string().trim().min(1).max(60),
    keyId: z.string().trim().min(1).max(300),
    keyAction: z.enum(["reset", "disable", "enable"]),
  }),
]);

/** `enabled` toggles callability, `capability` overrides a probed/guessed capability. */
export const aiModelPatchSchema = z.object({
  modelRowIds: z.array(z.string().trim().min(1).max(300)).min(1).max(2000).optional(),
  enabled: z.boolean().optional(),
  capability: z
    .object({ modelRowId: z.string().trim().min(1).max(300), capability: aiModelCapabilitySchema, supported: z.boolean() })
    .optional(),
  defaultFor: z
    .object({ capability: aiModelCapabilitySchema, modelRowId: z.union([z.string().trim().min(1).max(300), z.null()]) })
    .optional(),
});

export const aiModelSyncSchema = z.object({ providerId: z.string().trim().min(1).max(60) });

export const aiModelProbeSchema = z.object({
  modelRowId: z.string().trim().min(1).max(300),
  capability: aiModelCapabilitySchema,
});

/**
 * The three payloads of 研究提炼 (CI-P3-03 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * `researchExtractionCreateSchema` is a *request*: the material id travels in the path, so only the
 * caller's optional dedupe key is read from the body - an empty body and an unknown field are the same
 * request, which is what keeps a client that predates the key working.
 *
 * `researchExtractionEditSchema` is the user's edit of a stored result, and it is built from the very
 * schema the model answers (`researchExtractionOutputSchema`): the same field names, the same limits, the
 * same item shapes. A patch therefore cannot introduce a field the record does not have - and it cannot
 * be empty either, because "保存" with nothing changed is not an edit.
 */
export const researchExtractionCreateSchema = z.object({
  idempotencyKey: z.string().trim().max(120).optional().default(""),
});

export const researchExtractionEditSchema = researchExtractionOutputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "an edit must change at least one field" });

export const researchExtractionTopicSchema = z.object({
  /** Which `topicSuggestions` entry to turn into a topic, by index - the only thing that identifies one. */
  index: z.number().int().min(0).max(99),
});

export const aiChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: z.string().max(200_000).default(""),
        images: z.array(z.string().max(20_000_000)).max(8).optional(),
      }),
    )
    .min(1)
    .max(200),
  model: z.string().trim().max(200).optional(),
  providerId: z.string().trim().max(60).optional(),
  capability: aiModelCapabilitySchema.optional(),
  systemPrompt: z.string().max(20_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(200_000).optional(),
  json: z.boolean().optional(),
  /** Troubleshooting switch: use a key the pool would skip (cooling down / marked invalid). */
  forceUnhealthyCredential: z.boolean().optional(),
});

/**
 * A ceiling rather than a judgement about what a model may cost: it is there so a misplaced decimal
 * point, or a pasted integer, is refused instead of being charged. 1,000,000 per million tokens is
 * a thousand per token - no published rate is anywhere near it.
 */
const aiPriceMaxRate = 1_000_000;

/**
 * Ten years is longer than any rate card anyone has published, so a timestamp beyond it is a typo -
 * seconds where milliseconds were meant, or a year typed into a date field - rather than a plan.
 * Evaluated once at import: this bound only has to be roughly right, and a fixed one keeps a test
 * from depending on when it ran.
 */
const aiPriceMaxEffectiveFrom = Date.now() + 10 * 365 * 86_400_000;

/**
 * CI-P7-01-05: one row of the price catalog, as the models page (and any future importer) hands it
 * over.
 *
 * This schema decides *format*: which dimensions and units exist, which currencies are accepted,
 * how long a version may be, how far ahead a price may take effect. What a row has to *mean* - that
 * a token row states both its rates, that a unit row names one of the units it is billed in, that
 * an all-zero row has to be declared free - is asserted by `createAiModelPrice`, so the rule holds
 * for every writer rather than only for the one that has a form in front of it.
 *
 * Money fields are deliberately *not* defaulted here: a rate that was not stated must reach the
 * repository as "not stated" (absent), where it is refused, instead of arriving as a 0 that reads
 * like a free model.
 */
export const aiModelPriceInputSchema = z.object({
  providerId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^\S+$/, "a provider id carries no whitespace"),
  /** `*` prices every model of that provider that has no row of its own. */
  modelId: z.string().trim().min(1).max(128).optional().default("*"),
  meteredKind: z.enum(aiUsageMeteredKinds).optional().default("text"),
  /** Required: the currency is copied onto every ledger row this price costs. */
  currency: z.enum(aiPriceCurrencies),
  inputPerMillion: z.number().finite().min(0).max(aiPriceMaxRate).optional(),
  outputPerMillion: z.number().finite().min(0).max(aiPriceMaxRate).optional(),
  cachedInputPerMillion: z.number().finite().min(0).max(aiPriceMaxRate).nullable().optional(),
  unitPrice: z.number().finite().min(0).max(aiPriceMaxRate).nullable().optional(),
  unitLabel: z.union([z.enum(aiUsageUnitLabels), z.literal("")]).optional().default(""),
  declaredFree: z.boolean().optional().default(false),
  /** Required: a snapshot whose revision is blank cannot say which catalog it came from. */
  priceVersion: z.string().trim().min(1).max(64),
  source: z.enum(aiPriceSources).optional().default("manual"),
  effectiveFrom: z.number().int().min(0).max(aiPriceMaxEffectiveFrom).optional(),
  notes: z.string().trim().max(500).optional().default(""),
});

/**
 * CI-P7-03: the budget the user sets for AI spending, and what should happen when a call would
 * cross it.
 *
 * `monthlyLimit: null` is "no ceiling stated" and is deliberately **not** defaulted to 0: a 0 limit
 * would read as "spend nothing", which is a decision nobody made. `currency` comes from the same
 * closed list the price catalog uses, because a limit is only comparable with costs quoted in the
 * currency it was written in - and this database holds no exchange rate to convert with.
 *
 * Every field is required here (no defaults), with **one deliberate exception**: `strategy`
 * (CI-P7-03-C1). It defaults to `balanced` because that is the semantics every row written before the
 * field existed was actually running under - so a body from a client that does not know the field (an
 * older packaged app, a stale tab) still saves, and saves the four settings it does know, instead of
 * being rejected outright. The cost of that choice is stated rather than hidden: this endpoint replaces
 * the whole row, so such a body also returns the tier to `balanced`. It cannot *enable* a tier nobody
 * asked for - the default is the shipped behaviour - but a user who picked `cost-saving` in a newer
 * client and then saved from an older one would have to pick it again.
 */
export const aiBudgetSettingsSchema = z.object({
  policy: z.enum(aiBudgetPolicies),
  monthlyLimit: z.number().finite().min(0).max(aiPriceMaxRate).nullable(),
  currency: z.enum(aiPriceCurrencies),
  unknownCostPolicy: z.enum(aiBudgetUnknownCostPolicies),
  strategy: z.enum(aiBudgetStrategies).default("balanced"),
});

/**
 * CI-P7-03: what one not-yet-sent call is expected to cost, as the 预算与预估 tab asks it.
 *
 * `inputText` is capped rather than unbounded: the estimate only counts characters, and a body the
 * size of a book would be a caller mistake rather than an estimate. Nothing here is stored or logged
 * - the text is measured and dropped, which is why the answer carries counts and amounts but never
 * the text back.
 *
 * CI-P7-03-D2 added `capability` to this boundary as an *optional* field. `previewAiBudgetCall` has
 * taken one since CI-P7-03 and uses it for the one thing it decides here - which route to pre-resolve
 * when no model is named - but the endpoint could not pass one on, so an image estimate was priced
 * against whichever chat model came first in the provider order. Absent keeps exactly the old
 * behaviour (`chat`), so nothing that already calls this endpoint changes its answer; a caller that
 * knows what it is about to call states it (`image_generation` for the 配图 path).
 */
export const aiCostEstimateRequestSchema = z.object({
  providerId: z.string().trim().max(64).optional().default(""),
  modelId: z.string().trim().max(128).optional().default(""),
  capability: aiModelCapabilitySchema.optional(),
  meteredKind: z.enum(aiUsageMeteredKinds).optional().default("text"),
  inputText: z.string().max(200_000).optional().default(""),
  inputTokens: z.number().int().min(0).max(50_000_000).optional(),
  maxOutputTokens: z.number().int().min(1).max(aiPriceMaxRate).nullable().optional().default(null),
  quantity: z.number().finite().min(0).max(1_000_000).nullable().optional().default(null),
});

/**
 * CI-P7-04-03: which suggestion the 质量与优化 tab asks to apply.
 *
 * Only the id travels. Which *tier* it means, and whether its premise still holds, is decided on the
 * server when the request arrives - so a page cannot name a strategy the recommendation logic would not
 * have named, and a suggestion whose basis disappeared between the read and the click is refused
 * (`409`) instead of being applied on a stale reading.
 */
export const aiQualitySuggestionRequestSchema = z.object({
  suggestionId: z.enum(qualitySuggestionIds),
});

/**
 * 营销线索与成交 (CI-LEAD-01). Amounts arrive as **minor units**: the console parses the typed text with
 * `parseDealAmountInput` (`@/lib/leads`) and sends an integer, so no float reaches the database and the
 * server never rounds money.
 *
 * The cross-field rules (成交必须带币种；非成交状态不得携带成交记录；清除成交必须显式) are **not** expressed
 * here on purpose: they live in `resolveMarketingLeadDeal`, which `@/db/repositories/leads` runs against
 * the stored row on every write. One rule, one place, and a test can call it without a database.
 */
const marketingLeadDealFields = {
  dealAmountMinor: z.number().int().min(0).max(9_000_000_000_000).nullable().optional(),
  dealCurrency: z.string().trim().max(8).optional(),
  dealClosedAt: z.number().int().min(0).nullable().optional(),
  dealNote: z.string().trim().max(1000).optional(),
  /** 显式清除已记录的成交；把线索改回非成交状态的同一次写入必须带上它。 */
  dealCleared: z.boolean().optional(),
};

/** A new lead. Only 客户称呼 is required - 联系方式、来源平台、关联内容都可以之后再补。 */
export const marketingLeadCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  contact: z.string().trim().max(120).optional().default(""),
  sourcePlatform: z.string().trim().max(40).optional().default(""),
  contentItemId: z.string().trim().max(60).nullable().optional(),
  publishRecordId: z.string().trim().max(60).nullable().optional(),
  status: z.enum(marketingLeadStatuses).optional(),
  note: z.string().trim().max(1000).optional().default(""),
  ...marketingLeadDealFields,
});

/** A patch: every field is optional, and an absent field keeps what the row already stores. */
export const marketingLeadUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  contact: z.string().trim().max(120).optional(),
  sourcePlatform: z.string().trim().max(40).optional(),
  contentItemId: z.string().trim().max(60).nullable().optional(),
  publishRecordId: z.string().trim().max(60).nullable().optional(),
  status: z.enum(marketingLeadStatuses).optional(),
  note: z.string().trim().max(1000).optional(),
  ...marketingLeadDealFields,
});
