export const playbookIds = [
  "topic_article_generator",
  "ai_prompt_proxy",
  "article_scraper_rewriter",
  "ai_url_extractor",
  "topic_search_writer",
  "threads_auto_post",
  "threads_compose_post",
] as const;

export type PlaybookId = (typeof playbookIds)[number];

export const runStatuses = [
  "queued",
  "running",
  "success",
  "warning",
  "failed",
  "cancelled",
] as const;

export type RunStatus = (typeof runStatuses)[number];

export const scheduleTimeTypes = ["once", "daily", "weekly", "monthly", "interval"] as const;

export type ScheduleTimeType = (typeof scheduleTimeTypes)[number];

/**
 * One recurrence rule of a schedule. A schedule keeps a list of them and the
 * next run is the earliest occurrence across every rule.
 *
 * - `once`      a single absolute moment (`at` is an ISO timestamp)
 * - `daily`     every day at `time` (`HH:MM`, local)
 * - `weekly`    every listed `weekdays` (0 = Sunday … 6 = Saturday) at `time`
 * - `monthly`   every listed `days` (1–31) at `time`; a day beyond a short
 *               month's length falls back to that month's last day
 * - `interval`  every `everyMinutes` minutes, anchored on `anchor` when given
 */
export type ScheduleTime =
  | { type: "daily"; time: string }
  | { type: "once"; at: string }
  | { type: "weekly"; time: string; weekdays: number[] }
  | { type: "monthly"; time: string; days: number[] }
  | { type: "interval"; everyMinutes: number; anchor?: string };

export const accountPlatforms = [
  "头条号",
  "百家号",
  "微信公众号",
  "抖音",
  "小红书",
  "知乎",
  "哔哩哔哩",
  "微博",
  "企鹅号",
  "快手",
  "视频号",
  "淘宝光合",
  "搜狐号",
  "大鱼号",
  "快传号",
  "豆瓣",
  "CSDN",
  "简书",
  "Threads",
  "Facebook",
  "Instagram",
  "LinkedIn",
  "YouTube",
  "TikTok",
  "WordPress",
  "InnoShop",
  "PbootCMS",
  "Other",
] as const;

export type AccountPlatform = (typeof accountPlatforms)[number];

export type AccountStatus = "active" | "paused" | "needs_login";

export type ContentStatus = "draft" | "ready" | "posted" | "failed";

export interface AccountRecord {
  id: string;
  name: string;
  platform: AccountPlatform;
  url: string;
  account: string;
  profilePath: string;
  memo: string;
  status: AccountStatus;
  preset: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ContentItem {
  id: string;
  title: string;
  body: string;
  postReadyText: string;
  sourceUrls: string[];
  imagePath?: string;
  metadata: Record<string, unknown>;
  status: ContentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ContentPage {
  items: ContentItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ScheduleRecord {
  id: string;
  playbookId: PlaybookId;
  accountId?: string;
  enabled: boolean;
  scheduleTimes: ScheduleTime[];
  params: Record<string, unknown>;
  status: "scheduled" | "queued" | "running" | "posted" | "failed" | "missed" | "cancelled";
  contentItemId?: string;
  publishAuthorized: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface RunRecord {
  id: string;
  playbookId: PlaybookId;
  accountId?: string;
  scheduleId?: string;
  scheduledFor?: number;
  status: RunStatus;
  params: Record<string, unknown>;
  resultMessage: string;
  artifactPath?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  updatedAt: number;
}

export interface RunEventRecord {
  id: string;
  runId: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
  data?: Record<string, unknown>;
  createdAt: number;
}

export const publishRecordStatuses = [
  "queued",
  "running",
  "published",
  "drafted",
  "failed",
  "cancelled",
] as const;

export type PublishRecordStatus = (typeof publishRecordStatuses)[number];

export const publishRecordTypes = ["article", "post", "video", "image"] as const;

export type PublishRecordType = (typeof publishRecordTypes)[number];

export const publishRecordMethods = ["manual", "scheduled", "auto"] as const;

export type PublishRecordMethod = (typeof publishRecordMethods)[number];

export const publishRecordTerminals = ["local"] as const;

export type PublishRecordTerminal = (typeof publishRecordTerminals)[number];

// One row per platform account targeted by a publish action. Mirrors the
// reference console's publish log: platform, title, type, status, link, time.
export interface PublishRecord {
  id: string;
  accountId?: string;
  accountName: string;
  platform: string;
  title: string;
  contentType: string;
  status: PublishRecordStatus;
  url: string;
  method: string;
  terminal: string;
  message: string;
  contentItemId?: string;
  publishedAt?: number;
  createdAt: number;
  updatedAt: number;
  // Latest normalized engagement metrics ("数据状态" row), refreshed by the
  // metrics collector. Mirrors the reference console's content-ranking columns.
  views: number;
  likes: number;
  comments: number;
  shares: number;
  favorites: number;
  followsDelta: number;
  completionRate?: number;
  metricStatus: MetricStatus;
  metricsSyncedAt?: number;
  metricsSource?: MetricSource;
}

export const usageRecordStatuses = ["success", "failed"] as const;

export type UsageRecordStatus = (typeof usageRecordStatuses)[number];

export const usageRangeDays = [7, 30, 90] as const;

export type UsageRangeDays = (typeof usageRangeDays)[number];

// One row per AI generation call. Mirrors the reference console's usage stats:
// per-model article counts plus input/output token and word-character totals.
export interface UsageRecord {
  id: string;
  provider: string;
  model: string;
  kind: string;
  status: UsageRecordStatus;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  wordCount: number;
  accountId?: string;
  contentItemId?: string;
  createdAt: number;
}

export interface UsageModelSummary {
  provider: string;
  model: string;
  articles: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  wordCount: number;
  avgWords: number;
  avgTokens: number;
}

export interface UsageTotals {
  articles: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  wordCount: number;
  avgWords: number;
  avgTokens: number;
}

export interface UsageSummary {
  rangeDays: number;
  from: number;
  to: number;
  totals: UsageTotals;
  models: UsageModelSummary[];
}

export type AgentChatRole = "user" | "assistant" | "system" | "tool";
/** Only the local runtime remains; chat messages are always produced locally. */
export type AgentChatMode = "local";
export type AgentToolStatus = "pending" | "running" | "completed" | "failed";
export type AgentCreditType = "llm" | "image";
/** Only the local runtime remains; stored settings always resolve to "local". */
export type AgentRuntimeMode = "local";
export type AgentRunStatus = "queued" | "running" | "paused" | "success" | "failed" | "cancelled";
export type LocalAIProvider = "gemini" | "groq" | "openai" | "openrouter";
export type LocalImageProvider = "gemini" | "openai";
export type AgentPermissionMode = "auto" | "confirm";

export interface AgentPermissions {
  browserStep: AgentPermissionMode;
  browserPostContent: AgentPermissionMode;
  generateImage: AgentPermissionMode;
  generatePostContent: AgentPermissionMode;
  schedulePost: AgentPermissionMode;
}

export interface LocalAgentSettings {
  runtimeMode: AgentRuntimeMode;
  textProvider: LocalAIProvider;
  imageProvider: LocalImageProvider;
  geminiModel: string;
  groqModel: string;
  openAIBaseUrl: string;
  openAIModel: string;
  openRouterBaseUrl: string;
  openRouterModel: string;
  geminiImageModel: string;
  openAIImageModel: string;
  openAIImageSize: string;
  agentPermissions: AgentPermissions;
}

/** Manual model-gateway sync (off by default; the bundled snapshot stays the fallback). */
export type ModelGatewaySyncStatus = "never" | "ok" | "error";

/** Endpoint that lists every model id the gateway account can call. */
export const defaultModelGatewayEndpoint = "https://quanzil.com/api/user/models";

export interface ModelGatewaySettings {
  /** Feature switch: while off the catalog only serves the bundled snapshot. */
  enabled: boolean;
  endpoint: string;
  /** Model ids captured by the last successful sync; empty means "bundled snapshot only". */
  models: string[];
  /** Label of the active model list (snapshot label or gateway host + path). */
  source: string;
  /** Epoch millis of the last successful sync. */
  syncedAt: number | null;
  status: ModelGatewaySyncStatus;
  /** Failure reason of the last attempt; empty after a successful sync. */
  message: string;
}

export interface BrandSettings {
  name: string;
  description: string;
  targetAudience: string;
  voice: string;
  colors: {
    primary: string;
    accent: string;
    background: string;
  };
  logoPath?: string;
}

export interface PromptSettings {
  systemPrompt: string;
}

export type AgentEventType =
  | "progress"
  | "tool_start"
  | "tool_end"
  | "approval_required"
  | "resume"
  | "error"
  | "final";

export interface AgentRuntimeRecord {
  id: string;
  threadId?: string;
  accountId?: string;
  status: AgentRunStatus;
  mode: AgentChatMode;
  input: Record<string, unknown>;
  state: Record<string, unknown>;
  pendingApproval: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface AgentRuntimeEventRecord {
  id: string;
  agentRunId: string;
  type: AgentEventType;
  message: string;
  data: Record<string, unknown>;
  createdAt: number;
}

export interface AgentChatThreadRecord {
  id: string;
  title: string;
  activeAccountId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentChatMessageRecord {
  id: string;
  threadId: string;
  role: AgentChatRole;
  content: string;
  accountId?: string;
  mode?: AgentChatMode;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface AgentToolCallRecord {
  id: string;
  threadId: string;
  messageId: string;
  name: string;
  status: AgentToolStatus;
  accountId?: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  creditType?: AgentCreditType;
  creditCost?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentChatMessageWithTools extends AgentChatMessageRecord {
  toolCalls: AgentToolCallRecord[];
}

export interface AutomationContext {
  runId: string;
  site?: AccountRecord;
  params: Record<string, unknown>;
  profilePath: string;
  log: (message: string, level?: RunEventRecord["level"]) => Promise<void>;
  checkStop: () => Promise<boolean>;
}

export type ProductStatus = "active" | "archived";

export interface ProductRecord {
  id: string;
  name: string;
  brand: string;
  description: string;
  category: string;
  keywords: string[];
  price: string;
  imagePath: string;
  linkUrl: string;
  status: ProductStatus;
  createdAt: number;
  updatedAt: number;
}

/** Category taxonomy offered by the "Add knowledge" dialog. */
export const knowledgeBaseCategories = [
  "product",
  "industry",
  "brand",
  "faq",
  "formula",
  "reference",
  "other",
] as const;

export type KnowledgeBaseCategory = (typeof knowledgeBaseCategories)[number];

/** Retrieval weight used to rank entries when assembling AI writing references. */
export const knowledgeBaseWeights = ["high", "medium", "low"] as const;

export type KnowledgeBaseWeight = (typeof knowledgeBaseWeights)[number];

/** How an entry entered the base (drives the "Type" column). */
export const knowledgeBaseOrigins = ["manual", "ai", "file", "product"] as const;

export type KnowledgeBaseOrigin = (typeof knowledgeBaseOrigins)[number];

export interface KnowledgeBaseRecord {
  id: string;
  title: string;
  content: string;
  category: KnowledgeBaseCategory;
  weight: KnowledgeBaseWeight;
  enabled: boolean;
  origin: KnowledgeBaseOrigin;
  tags: string[];
  sourceUrl: string;
  fileName: string;
  /** Empty string means the entry is available to every positioning. */
  positionId: string;
  createdAt: number;
  updatedAt: number;
}

/** Content scenarios a Dify dataset may be used for. */
export const difyScopes = ["article", "post", "video"] as const;

export type DifyScope = (typeof difyScopes)[number];

/** Behaviour when a Dify dataset returns no relevant reference. */
export const difyInsufficientModes = ["knowledge_first", "reference_only"] as const;

export type DifyInsufficientMode = (typeof difyInsufficientModes)[number];

export interface DifyConnectionRecord {
  id: string;
  name: string;
  apiBase: string;
  /** Masked preview of the stored key; the raw key never leaves the server. */
  apiKeyMasked: string;
  knowledgeIds: string[];
  publicConfirmed: boolean;
  scopes: DifyScope[];
  /** Empty string means the connection applies to every positioning. */
  positionId: string;
  insufficientMode: DifyInsufficientMode;
  /** 0-100 retrieval similarity threshold. */
  scoreThreshold: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DifyDatasetSummary {
  id: string;
  name: string;
  documentCount: number;
}

/** Preset writing tones offered by the platform-customization tab. */
export const positionTones = ["colloquial", "formal", "humorous", "warm", "authoritative", "story"] as const;

export type PositionTone = (typeof positionTones)[number];

/** Preset writing styles offered by the platform-customization tab. */
export const positionStyles = ["advertorial", "news", "story", "review", "guide", "listicle"] as const;

export type PositionStyle = (typeof positionStyles)[number];

/** Lifecycle of a positioning when shared to the app store. */
export const positionStoreStatuses = ["none", "testing", "published", "rejected"] as const;

export type PositionStoreStatus = (typeof positionStoreStatuses)[number];

/** Shared category taxonomy used by both the storefront filters and the publish dialog. */
export const appStoreCategories = ["content", "tech", "marketing", "life", "hobby", "business", "finance", "trade"] as const;

export type AppStoreCategory = (typeof appStoreCategories)[number];

export interface PositionPlatformOverride {
  /** Target platform (a `AccountPlatform` value, stored as a plain string). */
  platform: string;
  tone: PositionTone | "";
  wordCount: string;
  style: PositionStyle | "";
  topicAngle: string;
}

export interface PositionStoreListing {
  emoji: string;
  category: AppStoreCategory;
  tagline: string;
  sampleQuestion: string;
  status: PositionStoreStatus;
  testScore: number;
  publishedAt?: number;
}

export interface PositionRecord {
  id: string;
  name: string;
  isDefault: boolean;
  description: string;
  targetAudience: string;
  contentDirection: string;
  toneStyle: string;
  personaRole: string;
  personaSeeds: string;
  writingGuide: string;
  bannedWords: string[];
  antiAiDetection: boolean;
  /** 0 = knowledge base first, 100 = hot topics first. */
  knowledgeHotspotBalance: number;
  /** 0 = strict, 100 = free. */
  aiFreedom: number;
  allowKnowledgeReuse: boolean;
  cooldownDays: number;
  maxUses: number;
  platformOverrides: PositionPlatformOverride[];
  rssSources: string[];
  store: PositionStoreListing;
  createdAt: number;
  updatedAt: number;
}

/** Everything that is persisted inside a position's `data_json` payload. */
export type PositionDraft = Omit<PositionRecord, "id" | "isDefault" | "createdAt" | "updatedAt">;

export interface AppStoreAgent {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  description: string;
  category: AppStoreCategory;
  tags: string[];
  official: boolean;
  /** Set for agents published from a local positioning. */
  positionId?: string;
}

export const metricStatuses = ["pending", "collected", "stale", "failed", "dead", "manual"] as const;

/**
 * Collection health of a publish record's metrics:
 * - `pending`   never collected yet
 * - `collected` freshly collected
 * - `stale`     collected but older than the refresh window
 * - `failed`    the last collection attempt failed (login required, DOM miss…)
 * - `dead`      the platform reports the content was removed / not found
 * - `manual`    entered or corrected by hand
 */
export type MetricStatus = (typeof metricStatuses)[number];

export const metricSources = ["browser", "api", "manual"] as const;

export type MetricSource = (typeof metricSources)[number];

/** Append-only per-content metric sample used for growth/trend analysis. */
export interface MetricSnapshot {
  id: string;
  publishRecordId: string;
  accountId?: string;
  platform: string;
  contentItemId?: string;
  capturedAt: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  favorites: number;
  followsDelta: number;
  completionRate?: number;
  /** Platform-specific metrics that do not map onto the canonical columns. */
  extra: Record<string, number>;
  source: MetricSource;
  createdAt: number;
}

/** Append-only account-level sample (follower count over time). */
export interface AccountMetricSnapshot {
  id: string;
  accountId: string;
  platform: string;
  capturedAt: number;
  followers: number;
  postsCount: number;
  extra: Record<string, number>;
  source: MetricSource;
  createdAt: number;
}

export interface MetricTotals {
  posts: number;
  views: number;
  interactions: number;
  followers: number;
  engagementRate: number;
  completionRate: number;
  zeroData: number;
}

export interface PlatformMetricOverview {
  platform: string;
  posts: number;
  views: number;
  interactions: number;
  followers: number;
  lastSyncedAt?: number;
}

/** Aggregated payload behind the board's KPI cards and platform overview. */
export interface MetricOverview {
  rangeDays: number;
  from: number;
  to: number;
  totals: MetricTotals;
  byPlatform: PlatformMetricOverview[];
  statusCounts: Record<MetricStatus, number>;
  lastSyncedAt?: number;
}

export interface MetricSeriesPoint {
  capturedAt: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  favorites: number;
}

export interface MetricSeries {
  publishRecordId: string;
  title: string;
  platform: string;
  accountName: string;
  publishedAt?: number;
  points: MetricSeriesPoint[];
}

/** Opt-in background refresh settings (manual sync is the default). */
export interface MetricsSettings {
  autoRefreshEnabled: boolean;
  refreshSamplingHours: number[];
  perAccountThrottleMs: number;
}

export const metricInsightVerdicts = ["hit", "met", "miss"] as const;

export type MetricInsightVerdict = (typeof metricInsightVerdicts)[number];

/** Structured AI attribution for a single piece of content. */
export interface MetricInsight {
  publishRecordId: string;
  verdict: MetricInsightVerdict;
  summary: string;
  factors: string[];
  suggestions: string[];
  provider?: string;
  model?: string;
  createdAt: number;
}

export interface AppStoreListing {
  agents: AppStoreAgent[];
  categoryCounts: Record<AppStoreCategory, number>;
  total: number;
}
