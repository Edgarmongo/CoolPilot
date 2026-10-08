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
} from "./types";

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
});

export const contentCreateSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string().optional().default(""),
  postReadyText: z.string().optional().default(""),
  type: z.string().trim().optional().default("article"),
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
  geminiModel: z.string().trim().optional(),
  groqModel: z.string().trim().optional(),
  openAIBaseUrl: z.string().trim().url().optional(),
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

