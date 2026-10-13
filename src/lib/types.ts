import type { TranscriptMetadata } from "@/lib/transcription/transcription";
import type { ResearchExtractionRecord } from "@/lib/research-extraction/extraction";

export const playbookIds = [
  "topic_article_generator",
  "ai_prompt_proxy",
  "article_scraper_rewriter",
  "ai_url_extractor",
  "topic_search_writer",
  "threads_auto_post",
  "threads_compose_post",
  // CI-P1-04: the video render task is a playbook run, so it appears in the unified task view with the
  // rest of the long tasks instead of needing a task table of its own. The executor lives in
  // `src/lib/videos/video-render-task.ts` and is dispatched by `src/worker/runner.ts`.
  "video_render",
  // CI-P3-02: the same shape for a transcript. `src/lib/transcription/transcription-task.ts` owns it, the
  // worker dispatches it, and the read path is `GET /api/tasks/<id>` - no transcription table.
  "media_transcription",
  // CI-P3-03: the same shape for a distillation. `src/lib/research-extraction/extraction-task.ts` owns
  // it, the worker dispatches it, and `GET /api/tasks/<id>` reads it - no extraction table.
  "research_extraction",
  // CI-EMB-01: the same shape for the knowledge index. `src/lib/knowledge-embedding/embedding-task.ts`
  // owns it, the worker dispatches it, and `GET /api/tasks/<id>` reads it - the vectors live in
  // `knowledge_embeddings`, which is a data table rather than a task table.
  "knowledge_embedding",
] as const;

export type PlaybookId = (typeof playbookIds)[number];

export const runStatuses = [
  "queued",
  "running",
  "success",
  "warning",
  "failed",
  "cancelled",
  /**
   * CI-P7-03-B: the budget stopped the run *between* steps. Nothing is in flight, the steps that
   * finished are kept, and a resume re-checks the budget and continues from them. It is a state, not a
   * failure: a run that is going to continue is not a run that failed.
   */
  "paused",
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

// ---------------------------------------------------------------------------
// 内容生命周期与日历 (CI-P2-04)
//
// The lifecycle stage is a *read* over four status vocabularies that already exist and are not being
// replaced: `content_items.status`, `schedules.status` (+ `enabled`), `runs.status` and
// `publish_records.status`. No column, table or migration is added, and the frozen C2 publish
// contract is untouched - a schedule is still "a plan to run a playbook", not evidence of a publish.
//
// The two axes stay separate on purpose (P2-04-07): `contentStatus` is what the content item *is*,
// while `plan` / `executions` / `publish` describe its way to a platform. A publish row that merely
// exists (`queued` / `running` / `drafted`) is never reported as a success.
// ---------------------------------------------------------------------------
export const contentLifecycleStages = ["draft", "pending", "scheduled", "publishing", "published", "failed"] as const;

export type ContentLifecycleStage = (typeof contentLifecycleStages)[number];

/** One planned publish occurrence of a content item: an occurrence of a content-linked schedule. */
export interface ContentLifecyclePlan {
  at: number;
  scheduleId: string;
  playbookId: PlaybookId;
  accountId?: string;
  accountName: string;
  platform: string;
  /** False when the schedule is paused: the occurrence is still shown, but it is not going to run. */
  enabled: boolean;
  /** True when the rule expands to more than one occurrence inside the queried window. */
  repeating: boolean;
}

/** Publish outcome per target: `records` counts every row, `published` only the successful ones. */
export interface ContentLifecyclePlatform {
  /** `accountId`, else the platform name, else `''` for a record that named neither. */
  key: string;
  accountId?: string;
  accountName: string;
  platform: string;
  records: number;
  published: number;
  lastStatus: PublishRecordStatus;
  lastAt: number;
  url: string;
}

export interface ContentLifecyclePublishRollup {
  records: number;
  byStatus: Record<PublishRecordStatus, number>;
  platforms: ContentLifecyclePlatform[];
  /** The most recent row whatever its status: what the last attempt on this content actually did. */
  latest: {
    id: string;
    status: PublishRecordStatus;
    at: number;
    platform: string;
    accountName: string;
    url: string;
    title: string;
  } | null;
  /** True when records exist but not one of them says the content reached a platform. */
  hasOnlyUnfinishedRecords: boolean;
}

export interface ContentLifecycleRow {
  contentItemId: string;
  /** False when the id no longer resolves: the row is kept because the records still exist. */
  contentFound: boolean;
  title: string;
  contentType: string;
  /** `content_items.status` verbatim, or `null` when the item is gone - never a publish status. */
  contentStatus: ContentStatus | null;
  stage: ContentLifecycleStage;
  createdAt: number | null;
  updatedAt: number | null;
  /** Earliest plan occurrence inside the queried window; `null` when the window holds none. */
  plan: ContentLifecyclePlan | null;
  /** Occurrences of content-linked schedules inside the window (paused ones included). */
  planCount: number;
  /** The subset of `planCount` whose schedule is enabled - these are the ones that will run. */
  enabledPlanCount: number;
  executions: {
    runs: number;
    failedRuns: number;
    lastStatus: string;
    lastAt: number | null;
  };
  publish: ContentLifecyclePublishRollup;
}

export interface ContentLifecycleFilters {
  stage: ContentLifecycleStage | "";
  platform: string;
  contentItemId: string;
}

export interface ContentLifecyclePlanSummary {
  /** Content items in this answer that have at least one occurrence inside the window. */
  plannedInWindow: number;
  /** Of those, the ones whose plan is paused. */
  pausedPlan: number;
  /** Content items whose records say they reached a platform. */
  published: number;
  /** Content items with records that do not say any platform accepted them. */
  unpublishedRecords: number;
}

export interface ContentLifecyclePayload {
  range: {
    from: number;
    to: number;
    /** `query` when `?from`/`?to` were honoured, `default` when the fallback window was used. */
    source: "query" | "default";
    /** True when a requested window was longer than the maximum and had to be shortened. */
    clamped: boolean;
  };
  filters: ContentLifecycleFilters;
  scan: {
    /** Ids the plan/run/record readers named; the union with the explicitly requested one. */
    referencedContent: number;
    /** Ids that no longer resolve to a content item. */
    missingContent: number;
    schedules: number;
    runs: number;
    runsLimit: number;
    publishRecords: number;
    publishRecordsLimit: number;
    /** True when a reader hit its own ceiling, so the answer is a window and not the whole library. */
    truncated: boolean;
  };
  summary: {
    matched: number;
    total: number;
    byStage: Record<ContentLifecycleStage, number>;
  } & ContentLifecyclePlanSummary;
  /** Distinct platforms seen in the answer, for the view's own filter. */
  platforms: string[];
  offset: number;
  limit: number;
  hasMore: boolean;
  rows: ContentLifecycleRow[];
}

/* ------------------------------------------------------------------------------------------------
 * 多平台内容模型 (CI-P2-05)
 *
 * The base content item stays what it is: platform-agnostic `title` / `body` / `postReadyText` /
 * `imagePath` with its media in `metadata` (`images`, `videoPath`). A *platform version* is derived
 * from that base and stored beside it in the same `metadata_json` blob under `platformVersions`, the
 * way `type`, `images`, `themeId` and the research links already are. Nothing in this card adds a
 * table, a column or a migration, and the existing backup/export (which carries `metadata_json`)
 * carries the versions with their item.
 *
 * Two separations are the point of the model:
 *
 *  - **base vs product** (A1): the base is edited by the author and shared; a version is a rendition
 *    of it for one platform, produced by the adapter in `src/lib/platform-content.ts`, and the two are
 *    never the same object.
 *  - **content vs history** (A2): producing a version is not publishing, and no field here records a
 *    platform outcome. `publish_records` stays the only history, and its `(contentItemId, platform)`
 *    is what a version keys off, so a record still points at the rendition it published.
 * ---------------------------------------------------------------------------------------------- */

/**
 * How the publish path reaches a platform's composer, read off the profile that serves it. The route
 * is `runConfiguredCreatePost` (`src/lib/browser-preview-session.ts`): navigate to `publishPageUrl`
 * when there is one, click `newPostSelectors`, then treat the page as the composer.
 *
 *  - `new-post` - a platform-specific profile with its own "new post" entry (小红书, 大鱼号, 快传号,
 *    淘宝光合): the path lands on the platform's page and clicks that entry.
 *  - `direct-url` - a platform-specific profile whose publish URL already is the composer (视频号's
 *    uploader, 知乎's `zhuanlan.zhihu.com/write` editor) - both come with `newPostSelectors: []`.
 *  - `generic` - no platform-specific profile: no navigation, and the shared generic 发布/写文章 entry
 *    is clicked on whatever page is open.
 *
 * Deliberately *not* "video uploader vs article editor": that distinction is recorded nowhere in
 * `PlatformPublishProfile`, and `videoFirstProfile` and `articleEditorProfile` produce the same shape
 * (`newPostSelectors: []` plus a publish URL), so the adapter does not guess it (P2-05-06).
 */
export const platformComposerEntries = ["new-post", "direct-url", "generic"] as const;
export type PlatformComposerEntry = (typeof platformComposerEntries)[number];

/**
 * Where a video can go on a platform, from the two profile fields `uploadVideoToComposer` reads:
 *
 *  - `video-tab-then-input` - the profile lists a tab that reveals the uploader (小红书), so the path
 *    clicks it before it looks for the file input.
 *  - `file-input` - no tab: the path goes straight to a file input that takes a video.
 *  - `not-supported` - the profile lists no video file input, so a video cannot be handed over.
 *
 * No built-in entry takes `not-supported` today (all three profile builders spread `genericProfile`,
 * which carries the file inputs). The value exists because the adapter has to answer it rather than
 * carry a video the page would never receive.
 */
export const platformVideoRoutes = ["video-tab-then-input", "file-input", "not-supported"] as const;
export type PlatformVideoRoute = (typeof platformVideoRoutes)[number];

/**
 * What the adaptation layer knows about one platform, and nothing more. Every value is derived from
 * code that already exists - `src/lib/publish-profiles.ts` for what the publish path does on the page,
 * `src/lib/post-format.ts` for the only text formatter CoolPilot runs:
 *
 *  - `composerEntry` and `videoRoute` read the profile's own fields the way the publish path reads them.
 *  - `titleField` / `bodyField` come from `titleSelectors` / `contentSelectors`, which are the only way
 *    the publish path fills a title or a body. Threads is the one platform it fills no title for.
 *  - `textLimit` / `titleLimit` are the budgets CoolPilot's own formatter enforces. `null` means "this
 *    layer does not limit the field" - **not** "the platform allows unlimited text". A platform's real
 *    limit that CoolPilot does not enforce is unknown here and is never guessed (P2-05-06).
 *
 * Two profile fields are deliberately absent because no publish path reads them:
 * `imageInputSelectors` (the cover branch of `runConfiguredCreatePost` picks `input[type="file"]`
 * itself, so a per-platform image claim would be a claim about a field nothing consults) and
 * `videoUploadWaitMs` (a wait, not a property of the content).
 */
export interface PlatformContentProfile {
  platform: string;
  /** True when `publish-profiles.ts` has a platform-specific entry; false is the shared generic fallback. */
  supported: boolean;
  composerEntry: PlatformComposerEntry;
  /** True when the publish path can fill a title field on this platform. */
  titleField: boolean;
  /** True when the publish path can fill a body field on this platform. */
  bodyField: boolean;
  videoRoute: PlatformVideoRoute;
  /** Body budget CoolPilot's own formatter applies, in UTF-16 units, or `null`. */
  textLimit: number | null;
  /** Title budget CoolPilot's own formatter applies, or `null`. */
  titleLimit: number | null;
}

/** `derived` = produced by the adapter; `edited` = the author changed it by hand. */
export const platformContentVersionSources = ["derived", "edited"] as const;
export type PlatformContentVersionSource = (typeof platformContentVersionSources)[number];

/**
 * What the adapter changed, so a version can explain itself instead of looking like the base text.
 * A note is never a claim about a platform: it says what *this* layer did.
 */
export const platformContentAdaptationCodes = [
  "text-normalized",
  "text-truncated",
  "text-not-offered",
  "title-normalized",
  "title-truncated",
  "title-not-offered",
  "media-not-included",
] as const;
export type PlatformContentAdaptationCode = (typeof platformContentAdaptationCodes)[number];

export interface PlatformContentAdaptation {
  code: PlatformContentAdaptationCode;
  /** Present on the truncation codes: the budget that was applied. */
  limit?: number;
  /** Present on the truncation codes: the length before the cut. */
  originalLength?: number;
}

/** One platform's rendition of one content item. */
export interface PlatformContentVersion {
  platform: string;
  /** The title this platform gets, or `""` when its profile offers no title field (`title-not-offered`). */
  title: string;
  body: string;
  /** The base item's cover: every publish path hands it over, so no platform is left without one. */
  imagePath: string;
  /** Local video path, or `""` when the platform's profile takes no video (`media-not-included`). */
  videoPath: string;
  source: PlatformContentVersionSource;
  adaptations: PlatformContentAdaptation[];
  /**
   * Fingerprint of the base title/text this version was taken from (P2-05-04). When it no longer
   * matches the base, the base moved on and the version is stale - it is reported and kept, never
   * silently refreshed.
   *
   * A fingerprint rather than a timestamp on purpose: `updateContentItem` bumps the item's `updatedAt`
   * on *every* metadata write (writing this very version included), so a timestamp could not tell "the
   * author changed the text" apart from "we stored an image list".
   */
  baseFingerprint: string;
  createdAt: number;
  updatedAt: number;
}

/** What `GET /api/content/[id]/platform-versions` answers: the base, the adapters, the versions. */
export interface PlatformContentVersionPayload {
  contentItemId: string;
  base: {
    title: string;
    body: string;
    postReadyText: string;
    imagePath: string;
    images: string[];
    videoPath: string;
    /** The base's fingerprint right now: a version whose own fingerprint differs is stale. */
    fingerprint: string;
    updatedAt: number;
  };
  profiles: PlatformContentProfile[];
  versions: PlatformContentVersion[];
  /**
   * Entries stored under `platformVersions` that this build cannot read (a newer shape, hand-edited
   * JSON). They are counted so the view can say so, and they are preserved untouched on write.
   */
  unreadable: number;
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

// ---------------------------------------------------------------------------
// AI usage ledger (CI-P7-01)
//
// `usage_records` above answers "how many tokens did this article cost?". The ledger
// answers the questions that need one row per *attempt* instead of one row per successful
// generation: which provider really signed the call, what a retry cost, what failed, how
// long it took, which business task it belonged to, and what money that adds up to.
//
// The two are deliberately separate. `usage_records` keeps its exact meaning (the 用量统计
// page reads it), and the ledger starts empty rather than back-filling claims nobody measured.
// ---------------------------------------------------------------------------

/** How one attempt ended. `interrupted` is a call whose transport died before an answer arrived. */
export const aiUsageOutcomes = ["success", "failed", "interrupted"] as const;

export type AiUsageOutcome = (typeof aiUsageOutcomes)[number];

/**
 * What produced the money figure on a ledger row. The amount alone never says which of these
 * it is, and the difference matters: a computed cost is our arithmetic, a provider-reported
 * cost is the vendor's own number, and `unpriced` means the call really happened but no price
 * is known for that model - which is not the same statement as "it was free".
 */
export const aiUsageCostSources = [
  /** The vendor answered with the charge itself. Rare; the only truly "actual" figure. */
  "provider-reported",
  /** Usage x the price snapshot stored on this row. The normal case. */
  "computed",
  /** The call happened, usage is known, but no price is on file for this provider+model. */
  "unpriced",
  /** Nothing was measured (a failed attempt), so there is no usage to price at all. */
  "unknown",
] as const;

export type AiUsageCostSource = (typeof aiUsageCostSources)[number];

/**
 * How much of the real usage this row actually saw, on the dimension the row is billed on.
 *
 * `reported` - the billed amount was measured: the provider's usage object for a token-metered row
 *              (even if it says zero), or the row's own `quantity` for a kind priced per image,
 *              second or character.
 * `partial`  - the call was interrupted, so what arrived may be less than what was billed.
 * `unknown`  - nothing measurable arrived: a failure, a provider that does not report, or a non-token
 *              row whose amount was not written as a number.
 *
 * Which of the two `reported` readings applies is decided by `usageCompletenessFor()` in
 * `@/lib/ai-usage-ledger`, so a call site never has to remember the rule itself (CI-P7-05-01).
 */
export const aiUsageCompletenessValues = ["reported", "partial", "unknown"] as const;

export type AiUsageCompleteness = (typeof aiUsageCompletenessValues)[number];

/**
 * Why a row cannot state a figure at all (CI-P7-05-04).
 *
 * `cost_source` says *which* state a row is in; it cannot say *why* the figure is missing - and the
 * blanks `computeUsageCost()` itself distinguishes are not the same situation: a missing catalog
 * price is fixed by recording one, a provider that reports no usage is fixed by nothing, and a call
 * site that wrote its units under a key this dimension does not price is a wiring mistake worth
 * seeing on the screen.
 *
 * Every value is derived from the row's own stored evidence, by `meteringReasonFor()` in
 * `@/lib/ai-metering`, and never from the page, the purpose, the model name or the extension id. A
 * blank whose evidence does not support one of these answers gets `not-recorded` instead of a
 * plausible guess - which is also what every row written before this reading existed gets, because
 * the ledger stores the evidence and nothing is backfilled.
 *
 * Like `aiUsageCostSources`, this list may only ever grow: rows already written name one of these.
 */
export const aiUsageMeteringReasons = [
  /** No price is in force for this provider+model+dimension. Recording one makes the figure stateable. */
  "no-price-for-dimension",
  /** A price answered, but it prices another dimension - its rate is not this row's rate. */
  "price-kind-mismatch",
  /** The price row states no unit rate, so there is nothing for the amount to multiply. */
  "price-unit-unspecified",
  /** A token-metered call that succeeded and reported no usage object at all. */
  "usage-not-reported",
  /** A non-token call that recorded no amount for the very unit its dimension is priced in. */
  "quantity-not-recorded",
  /** A non-token call whose amount was written under a unit this dimension does not price. */
  "quantity-unit-mismatch",
  /** A non-token call whose amount for this dimension is not a usable number. */
  "quantity-unusable",
  /** The request did not succeed, so nothing about its usage ever arrived. */
  "attempt-failed",
  /** The transport died mid-call: what arrived may be less than what was billed. */
  "call-interrupted",
  /** The row carries no evidence for a reason - every row written before this reading existed. */
  "not-recorded",
] as const;

export type AiUsageMeteringReason = (typeof aiUsageMeteringReasons)[number];

/** What was metered. Text is counted in tokens; the other kinds are not, and are stored in `quantityJson`. */
export const aiUsageMeteredKinds = ["text", "image", "video", "speech", "embedding", "agent"] as const;

export type AiUsageMeteredKind = (typeof aiUsageMeteredKinds)[number];

/**
 * The unit a per-unit price is quoted in (CI-P7-01-05).
 *
 * A price is meaningless without its dimension: "0.35" is neither a token rate nor an image price
 * until the unit says which. The token columns on a price row answer this for text, and these
 * labels answer it for everything else.
 */
export const aiUsageUnitLabels = ["image", "second", "character", "call"] as const;

export type AiUsageUnitLabel = (typeof aiUsageUnitLabels)[number];

/**
 * Which units each kind may be priced per. An empty list means the kind is token-metered and is
 * priced by the token columns alone.
 *
 * This is what stops a text price from ever costing an image: a row only prices the kind it was
 * written for, and a kind only accepts the units it is actually billed in.
 */
export const aiUsageKindUnits: Record<AiUsageMeteredKind, readonly AiUsageUnitLabel[]> = {
  // Priced per million tokens: input / output / cached input.
  text: [],
  // Embeddings are billed on input tokens only; there is no output side to price.
  embedding: [],
  image: ["image"],
  video: ["second"],
  // Speech is billed per character by most vendors and per second of audio by the rest.
  speech: ["character", "second"],
  agent: ["call"],
};

/** True for the kinds whose price lives in the token columns rather than in `unitPrice`. */
export function aiUsageKindIsTokenMetered(kind: AiUsageMeteredKind) {
  return aiUsageKindUnits[kind].length === 0;
}

/**
 * The currencies a price may be quoted in (CI-P7-01-05).
 *
 * A closed list rather than free text: the currency is copied onto every ledger row the price
 * costs, so a typo would not be a cosmetic mistake - it would be a cost figure in a currency
 * nobody can convert. The list may only ever grow, because rows already written name one of these.
 */
export const aiPriceCurrencies = ["CNY", "USD", "EUR", "HKD", "TWD", "JPY", "GBP"] as const;

export type AiPriceCurrency = (typeof aiPriceCurrencies)[number];

/**
 * Where a price's numbers came from. `manual` is a person typing what their provider charges,
 * `provider-doc` a published rate card, `imported` a machine translation of the vendor's own list.
 *
 * None of these makes a ledger figure "the actual charge": only a charge the vendor itself reported
 * does, which is what `provider-reported` means in `aiUsageCostSources`.
 */
export const aiPriceSources = ["manual", "provider-doc", "imported"] as const;

export type AiPriceSource = (typeof aiPriceSources)[number];

export interface AiUsageTokens {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Tokens served from the prompt cache, when the provider prices them differently. */
  cachedInputTokens: number;
  /** Reasoning tokens, when the provider reports them apart from the output. */
  reasoningTokens: number;
}

/**
 * The price that was in force when the row was written, copied onto the row.
 *
 * Copying rather than referencing is the point: editing a price tomorrow must not restate what
 * yesterday's call cost. `priceVersion` names the catalog revision the copy came from.
 */
export interface AiUsagePricingBasis {
  /**
   * Which dimension this price costs. Copied from the catalog row so the frozen snapshot still
   * says what it was for, and so a price written for one kind can never be applied to another.
   */
  meteredKind: AiUsageMeteredKind;
  currency: string;
  /** Per million tokens. Zero on the kinds that are not token-metered - they price by `unitPrice`. */
  inputPerMillion: number;
  outputPerMillion: number;
  /** Absent when the provider does not price cached input separately. */
  cachedInputPerMillion?: number;
  /** The price per `unitLabel` for the kinds the token columns cannot price. Absent on token rows. */
  unitPrice?: number;
  unitLabel?: AiUsageUnitLabel;
  priceVersion: string;
  source: string;
}

export interface AiUsageLedgerEntry {
  id: string;
  /** Which business call this was: `article`, `knowledge`, `profile`, `extraction`, `agent`… */
  purpose: string;
  outcome: AiUsageOutcome;
  /** Provider that *actually signed* the request, which is not always the one the user picked. */
  providerId: string;
  modelId: string;
  endpointId: string;
  /** Masked key label (`****1234`). Never the key itself. */
  credentialLabel: string;
  /**
   * The position of this request in its call: 0 is the first request the call sent, and the row
   * with the highest index is the one whose answer the caller used. A retry is therefore *a row
   * after the first*, not a row before a winner - and the index alone cannot say why it happened
   * (a rotated key, a demoted model and a self-correction all look the same). Read the predecessor
   * through `parentUsageId` to tell them apart instead of inferring from the number.
   */
  attemptIndex: number;
  /** Business identity, empty when the caller declared none. */
  taskId: string;
  runId: string;
  nodeId: string;
  /** The attempt this one retried, when it is a retry. */
  parentUsageId: string;
  /** The media artifact or content item this call produced, when it produced one. */
  outputAssetId: string;
  contentItemId: string;
  /**
   * The Marketplace extension this call ran as (CI-P7-05-03), in the storefront's own id space
   * (`position-<id>` for a published position listing, or a built-in catalogue agent's id).
   *
   * Empty is the honest answer for the great majority of calls - a chat answer, a transcription,
   * an image, a rewrite ran as no listing - and for a call whose entry named no published listing
   * and no catalogue agent. Nothing is derived from the purpose or the model to fill it in: an
   * invented attribution would make "which extension spent this" look answered.
   */
  extensionId: string;
  /**
   * The budget hold this request was admitted under (CI-P7-03-A), empty when it was not gated.
   *
   * It is the link between the gate's own record (`ai_budget_reservations`) and what this row states
   * the call cost, so "what was held" and "what was spent" are compared by joining an id instead of
   * being guessed from a purpose and a timestamp.
   */
  budgetReservationId: string;
  meteredKind: AiUsageMeteredKind;
  tokens: AiUsageTokens;
  completeness: AiUsageCompleteness;
  /** Modality-specific units (image count/resolution, video seconds, speech characters). */
  quantityJson: string;
  /** `null` when no cost can be claimed. Never `0` as a stand-in for "unknown". */
  costAmount: number | null;
  costCurrency: string;
  costSource: AiUsageCostSource;
  pricing: AiUsagePricingBasis | null;
  durationMs: number;
  /** The failure this attempt hit, empty on success. */
  errorSummary: string;
  createdAt: number;
}

/** One row of the price catalog. `resolveModelPrice()` reads the newest effective row. */
export interface AiModelPrice {
  id: string;
  providerId: string;
  /** `*` means "any model of this provider", used as the fallback when no exact row matches. */
  modelId: string;
  /** Which dimension this row prices. A `text` row can never cost an `image` call. */
  meteredKind: AiUsageMeteredKind;
  currency: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
  /** Per `unitLabel`; absent (NULL) on the token-metered rows that do not use it. */
  unitPrice?: number;
  /** `''` on token rows, otherwise the unit `unitPrice` is quoted in. */
  unitLabel: AiUsageUnitLabel | "";
  /**
   * True when every zero on this row is a deliberate price ("this model is free"), not a field
   * nobody filled in. A row is only allowed to be all-zero when it says so (CI-P7-01-05).
   */
  declaredFree: boolean;
  priceVersion: string;
  source: string;
  effectiveFrom: number;
  notes: string;
  createdAt: number;
}

/**
 * A catalog row as the page reads it, with the one thing a browser cannot work out for itself:
 * whether this row is the one the **server** would cost a call with right now.
 *
 * The server marks it rather than the page, because the server is the side that writes the ledger -
 * "in force" has to mean the instant the recorder would ask about, not whatever clock the browser
 * happens to have.
 */
export interface AiModelPriceView extends AiModelPrice {
  inForce: boolean;
}

export interface AiUsageLedgerTotals {
  attempts: number;
  successes: number;
  failures: number;
  interrupted: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  /** Sum of the rows whose cost is a real figure (`computed` or `provider-reported`). */
  costAmount: number;
  /** Attempts whose money cannot be stated, broken out so a partial figure is never read as the total. */
  unpricedAttempts: number;
  /** Attempts that were never measured at all (failures), likewise broken out. */
  unmeasuredAttempts: number;
  /** Every attempt in the window had a stateable cost - only then is `costAmount` a total. */
  costIsComplete: boolean;
}

export interface AiUsageLedgerGroup {
  key: string;
  label: string;
  attempts: number;
  totalTokens: number;
  costAmount: number;
  hasUnpricedAttempts: boolean;
}

/**
 * How many attempts carried each `cost_source` (CI-P7-02).
 *
 * The headline money figure never says which of the four states produced it, and the difference is
 * the whole point: a computed figure is our arithmetic over a price snapshot, a provider-reported
 * one is the vendor's own charge, and `unpriced` / `unknown` are rows where no figure may be stated
 * at all. A reader that wants to say "this much of the bill is estimated" needs these counts, so
 * they are counted here rather than guessed from the total.
 */
export interface AiUsageLedgerCostSourceCount {
  source: AiUsageCostSource;
  attempts: number;
  /** Sum of the rows of this source that stated a figure; `null` when none did. Never 0 as a stand-in. */
  costAmount: number | null;
}

/**
 * Money kept apart per currency.
 *
 * Ledger rows carry the currency of the price snapshot that cost them. Adding a CNY row to a USD
 * one would produce a number in no currency at all, and there is no exchange rate in this database
 * to convert with - so the totals are per currency and the page shows them that way.
 */
export interface AiUsageLedgerCurrencyTotal {
  /** The currency on the priced rows. `''` is a row whose figure arrived without one. */
  currency: string;
  amount: number;
  /** How many rows this amount covers. */
  attempts: number;
}

/** One local-calendar day of ledger activity, for the cost trend. */
export interface AiUsageLedgerDayPoint {
  /**
   * Start-of-day timestamp of that day on this machine's calendar - the same rule
   * `usageRangeStart` uses, so a day bucket and a window cannot mean different things.
   */
  dayStart: number;
  attempts: number;
  totalTokens: number;
  /** Only the rows that could state a figure. */
  costAmount: number;
  /** Rows that could not, so a day is never read as a cheap day when it was an unknown one. */
  unpricedAttempts: number;
}

export interface AiUsageLedgerSummary {
  from: number;
  to: number;
  totals: AiUsageLedgerTotals;
  byPurpose: AiUsageLedgerGroup[];
  byModel: AiUsageLedgerGroup[];
  /** Attempts per `cost_source`, in the vocabulary's own order (CI-P7-02). */
  byCostSource: AiUsageLedgerCostSourceCount[];
  /** Amounts per currency. Never one number across currencies (CI-P7-02). */
  costByCurrency: AiUsageLedgerCurrencyTotal[];
  /** Per local day, oldest first (CI-P7-02). */
  byDay: AiUsageLedgerDayPoint[];
}

/**
 * Why a metered dimension has no accurate reading of its own in this installation (CI-P7-05-04).
 *
 * This is a fact about the *runtime*, not about a row, and it is the one thing the ledger cannot
 * state about itself: a dimension nothing ever writes is silently absent from a list of rows, and
 * "absent" is exactly what the card forbids. So the reason a dimension cannot be read is declared
 * beside the code that would have to write it (`aiMeteredKindProducers` in `@/lib/ai-metering`) and
 * is shown even when the window holds not a single row of that dimension.
 */
export const aiUsageMeteringGaps = [
  /** No call path in this runtime can produce a row of this dimension at all. */
  "no-runtime-path",
  /** The dimension has no rows of its own: its spend is metered as the text rows of its calls. */
  "metered-through-text",
] as const;

export type AiUsageMeteringGap = (typeof aiUsageMeteringGaps)[number];

/**
 * 计量覆盖 (CI-P7-05-04): one metered dimension, as this installation can really read it.
 *
 * The counts are the window's own rows, split with the vocabulary that already exists - measured
 * means `computed` / `provider-reported`, and the two blank states keep their own columns rather
 * than being added into one "unaccounted" number. `reasons` are the reasons those blank rows
 * actually carry, deduped: an empty list beside a non-zero blank count is itself a reading (the
 * rows predate the reason vocabulary).
 *
 * `gap` is the dimension's own declaration, and it is reported even when `attempts` is 0, so a
 * dimension this runtime cannot meter is named instead of missing.
 */
export interface AiUsageMeteringCoverage {
  kind: AiUsageMeteredKind;
  /** How many of the window's rows this dimension billed. */
  attempts: number;
  /** Rows that stated a figure (`computed` / `provider-reported`). */
  measuredAttempts: number;
  /** Rows that could not, in the ledger's own two states. */
  unpricedAttempts: number;
  unmeasuredAttempts: number;
  /** The reasons this dimension's unstated rows carry, deduped and sorted; `[]` when none do. */
  reasons: AiUsageMeteringReason[];
  /** A price is in force for this dimension right now (`markInForceModelPrices`). */
  priced: boolean;
  /** Why this installation cannot meter the dimension accurately; `''` when it can. */
  gap: AiUsageMeteringGap | "";
}

/**
 * What the AI 成本与质量优化中心's first page reads (CI-P7-02).
 *
 * One request carries both readings of the same window on purpose: the ledger's per-attempt money
 * view and the older `usage_records` view of what was actually delivered. They answer different
 * questions ("what did we send" vs "what did we get"), and the page compares them - so fetching them
 * through separate calls would only invite the two halves to describe different windows.
 */
export interface AiCostCenterPayload {
  range: number;
  ledger: AiUsageLedgerSummary;
  /** The 用量统计 figures, kept as helper indicators instead of being dropped (CI-P7-02). */
  usage: UsageSummary;
  catalog: {
    meteredKinds: AiUsageMeteredKind[];
    /** The dimensions that already have a price in force - a call in any other kind is `unpriced`. */
    pricedKinds: AiUsageMeteredKind[];
    /**
     * 计量覆盖 (CI-P7-05-04): every dimension, always, with what the window's rows of it could
     * state and - for a row that could state nothing - why. Built from the same rows as `ledger`
     * above, so the two cannot describe different windows.
     */
    metering: AiUsageMeteringCoverage[];
  };
}

// ---------------------------------------------------------------------------
// 调用明细与追溯 (CI-P7-02-04 / CI-P7-02-05)
//
// One attempt is one row. Retries are rows of their own - never merged into the winner - and the
// reason a retry happened is read from the *predecessor row* (`parentUsageId`), never inferred from
// `attemptIndex`: a rotated key, a demoted model and a self-correction all have an index above 0.
// ---------------------------------------------------------------------------

/**
 * How one request relates to the request before it in the same call.
 *
 * `unresolved-predecessor` is the honest fourth answer: the row says it followed another one, but
 * that other row is not in the scanned window, so which kind of retry it was cannot be stated.
 */
export const aiUsageCallRetryKinds = [
  "first-request",
  "self-correction",
  "after-failed-request",
  "unresolved-predecessor",
] as const;

export type AiUsageCallRetryKind = (typeof aiUsageCallRetryKinds)[number];

/** The predecessor row, as read - not as guessed from an index. */
export interface AiUsageCallPredecessor {
  id: string;
  attemptIndex: number;
  outcome: AiUsageOutcome;
  providerId: string;
  modelId: string;
  endpointId: string;
  credentialLabel: string;
}

/** Which recorded identity fields differ between a retry and the request it followed. */
export const aiUsageCallRetryChanges = ["provider", "model", "endpoint", "credential"] as const;

export type AiUsageCallRetryChange = (typeof aiUsageCallRetryChanges)[number];

export interface AiUsageCallRetry {
  kind: AiUsageCallRetryKind;
  /** The predecessor's id as it is recorded on this row, empty on a call's first request. */
  parentUsageId: string;
  /** The predecessor itself, `null` when it is outside the scanned window. */
  parent: AiUsageCallPredecessor | null;
  /** True when a predecessor was recorded but could not be read - never reported as "no retry". */
  parentOutsideScan: boolean;
  /** Facts read off the two rows; the *reason* for a retry is not recorded anywhere. */
  changed: AiUsageCallRetryChange[];
}

/** One call - every request it sent, including the ones that failed - as a single money statement. */
export interface AiUsageCallGroupInfo {
  /** The id of the call's first request. */
  rootId: string;
  /** How many requests this call sent (within the rows the answer covers). */
  attempts: number;
  failedRequests: number;
  /** This row's position in the call, lowest first. */
  index: number;
  /** Only the requests that stated a figure; unpriced / unmeasured ones are counted below. */
  costByCurrency: AiUsageLedgerCurrencyTotal[];
  unpricedAttempts: number;
  unmeasuredAttempts: number;
  costIsComplete: boolean;
}

/** A content item a ledger row points at, resolved. `found: false` means the pointed-at id is gone. */
export interface AiUsageCallContentTrace {
  id: string;
  title: string;
  status: string;
  found: boolean;
}

/** The business task a call belonged to, resolved through the task library (P7-02-05). */
export interface AiUsageCallTaskTrace {
  id: string;
  /** `playbook` / `agent` / `schedule` - the task library's own kinds. */
  kind: string;
  type: string;
  status: string;
  /** The literal the source row holds, kept so a mapping never hides what was stored. */
  rawStatus: string;
}

/** Which recorded field the task identity came from, so an empty one stays visible. */
export const aiUsageCallTaskRefs = ["taskId", "runId"] as const;

export type AiUsageCallTaskRef = (typeof aiUsageCallTaskRefs)[number];

/**
 * 内容 → 业务任务 → 执行节点 → 模型调用 (CI-P7-02-05).
 *
 * Every field is copied from the row or resolved from a real record; nothing is filled in. An id
 * that no record holds is reported as missing rather than as a plausible-looking label.
 */
export interface AiUsageCallTrace {
  contentItemId: string;
  /** `null` when the row names no content item. */
  content: AiUsageCallContentTrace | null;
  taskId: string;
  runId: string;
  nodeId: string;
  outputAssetId: string;
  /** Which field the task was found through - `null` when neither names a task. */
  taskRef: AiUsageCallTaskRef | null;
  task: AiUsageCallTaskTrace | null;
}

/** One request, in full: the ledger row itself plus what can be read out of it and its neighbours. */
export interface AiUsageCallView {
  entry: AiUsageLedgerEntry;
  /** Modality units (`quantityJson`), parsed; `{}` when the row recorded none. */
  quantity: Record<string, unknown>;
  retry: AiUsageCallRetry;
  group: AiUsageCallGroupInfo;
  trace: AiUsageCallTrace;
  /**
   * Why this request's figure is missing (CI-P7-05-04), or `''` when the row stated one.
   *
   * Decided on the server from the row alone (`meteringReasonFor`), so the page never re-derives the
   * rule and a reason cannot be invented for a row that does not support one.
   */
  reason: AiUsageMeteringReason | "";
}

/** The filters the 调用明细 view applies; every empty value means "no filter". */
export interface AiCostCenterCallFilters {
  purpose: string;
  outcome: AiUsageOutcome | "";
  costSource: AiUsageCostSource | "";
  /** `providerId::modelId`, the same key the overview groups by. */
  model: string;
  /** Only the requests that were not their call's first. */
  retryOnly: boolean;
  contentItemId: string;
  taskId: string;
  /**
   * The Marketplace extension a request ran as (CI-P7-05-03). An empty value means no filter, so
   * "the unattributed rows" cannot be asked for by this field - the breakdown's own bucket is
   * where they are read.
   */
  extensionId: string;
}

/** 单篇内容成本 (CI-P7-02-05): what one content item's calls added up to. */
export interface AiUsageCallContentCost {
  /** `''` collects the rows that named no content item - shown as unclassified, never dropped. */
  contentItemId: string;
  content: AiUsageCallContentTrace | null;
  attempts: number;
  totalTokens: number;
  costByCurrency: AiUsageLedgerCurrencyTotal[];
  unpricedAttempts: number;
  unmeasuredAttempts: number;
  costIsComplete: boolean;
  /** The business tasks and execution nodes this content's calls came from, both sorted. */
  taskIds: string[];
  nodeIds: string[];
}

/**
 * 节点级调用成本 (CI-P7-05-02): one execution node's requests inside one run.
 *
 * A node bucket is a **partition** of its run's rows - every row lands in exactly one, and the rows
 * that recorded no node are kept as a bucket of their own (`''`, shown as unclassified) instead of
 * being folded into a named node. That is what makes a run's total reconcilable: the node figures add
 * up to it because they are the same rows, each counted once.
 */
export interface AiUsageRunNodeCost {
  /** `''` collects the run's rows that recorded no node - shown as unclassified, never dropped. */
  nodeId: string;
  attempts: number;
  /** Requests whose outcome was `failed`. */
  failures: number;
  /** Requests cut short. Kept apart from `failures` because the ledger keeps them apart. */
  interrupted: number;
  /** Requests that repeated an earlier one in their call - a position fact, not a reason. */
  retries: number;
  /** Repeats whose predecessor is not among the rows this answer read, so the chain cannot be stated. */
  unresolvedRetries: number;
  totalTokens: number;
  costByCurrency: AiUsageLedgerCurrencyTotal[];
  unpricedAttempts: number;
  unmeasuredAttempts: number;
  costIsComplete: boolean;
}

/**
 * 一次执行的总成本与失败重试成本 (CI-P7-05-02): one run's requests, added up.
 *
 * `costByCurrency` is the sum over the run's rows and nothing else, so it can be checked against
 * them by hand (and equals the sum of `nodes`). `retryCostByCurrency` and `failureCostByCurrency`
 * are **readings of the same rows, not additions to them**: one says how much of the money went to
 * requests that repeated an earlier one, the other how much went to requests that did not succeed.
 * A row can be both, so the two are never added together - doing so would bill one request twice.
 *
 * A request that failed may still have been billed, so its tokens and its cost are counted where the
 * row stated them; a row that stated no figure makes the corresponding reading a lower bound and is
 * reported through its own `unpricedAttempts` / `unmeasuredAttempts`, never as a 0.
 */
export interface AiUsageRunCost {
  /** `''` collects the rows that recorded no run - shown as unclassified, never dropped. */
  runId: string;
  attempts: number;
  failures: number;
  interrupted: number;
  /** Requests that repeated an earlier one in their call, whatever the reason. */
  retries: number;
  /** Repeats whose predecessor is outside the rows this answer read. */
  unresolvedRetries: number;
  totalTokens: number;
  /** The run's accounted amount, per currency: the sum over its rows, retries included. */
  costByCurrency: AiUsageLedgerCurrencyTotal[];
  unpricedAttempts: number;
  unmeasuredAttempts: number;
  costIsComplete: boolean;
  /** Money spent on requests that repeated an earlier one of their call. */
  retryCostByCurrency: AiUsageLedgerCurrencyTotal[];
  /** Rows behind `retryCostByCurrency` that stated no figure, so that reading is a lower bound. */
  retryUnpricedAttempts: number;
  retryUnmeasuredAttempts: number;
  retryCostIsComplete: boolean;
  /** Money spent on requests whose outcome was not `success` (failed or interrupted). */
  failureCostByCurrency: AiUsageLedgerCurrencyTotal[];
  failureUnpricedAttempts: number;
  failureUnmeasuredAttempts: number;
  failureCostIsComplete: boolean;
  /** The most recent request of the run, so the list reads newest activity first. */
  lastAt: number;
  /** The purposes this run's requests were made for, sorted. */
  purposes: string[];
  nodes: AiUsageRunNodeCost[];
}

/**
 * 按 Marketplace 扩展归属的成本 (CI-P7-05-03): one group per extension the window's calls ran as.
 *
 * The figures are the run reader's own (`AiUsageRunCost`), read over the rows that named this
 * extension instead of over the rows of one run, so the same three disciplines hold without being
 * restated: the group total is the sum over its rows, the retry reading and the failure reading are
 * two views of the same rows and are never added into a third figure, and a row that stated no
 * figure turns its reading into a lower bound through its own `unpricedAttempts` /
 * `unmeasuredAttempts` rather than into a cheaper total.
 *
 * `''` collects the rows that named no extension - shown as unattributed, never dropped - because
 * "this call ran as no listing" is a fact about the money that a list of attributed amounts alone
 * would hide. The provenance lists (`taskIds` / `runIds` / `contentItemIds` / `nodeIds`) say which
 * execution spent the extension's money; they are ids the rows really carry, not a name resolved
 * for display.
 */
export interface AiUsageExtensionCost {
  /** `''` collects the rows that named no extension - shown as unattributed, never dropped. */
  extensionId: string;
  attempts: number;
  failures: number;
  interrupted: number;
  /** Requests that repeated an earlier one in their call, whatever the reason. */
  retries: number;
  /** Repeats whose predecessor is outside the rows this answer read. */
  unresolvedRetries: number;
  totalTokens: number;
  /** The extension's accounted amount, per currency: the sum over its rows, retries included. */
  costByCurrency: AiUsageLedgerCurrencyTotal[];
  unpricedAttempts: number;
  unmeasuredAttempts: number;
  costIsComplete: boolean;
  /** Money spent on requests that repeated an earlier one of their call. */
  retryCostByCurrency: AiUsageLedgerCurrencyTotal[];
  retryUnpricedAttempts: number;
  retryUnmeasuredAttempts: number;
  retryCostIsComplete: boolean;
  /** Money spent on requests whose outcome was not `success` (failed or interrupted). */
  failureCostByCurrency: AiUsageLedgerCurrencyTotal[];
  failureUnpricedAttempts: number;
  failureUnmeasuredAttempts: number;
  failureCostIsComplete: boolean;
  /** The most recent request that ran as this extension, so the list reads newest activity first. */
  lastAt: number;
  /** The purposes its requests were made for, sorted. */
  purposes: string[];
  /** The business task of each request (`taskId`, else the run it was sent from), sorted and deduped. */
  taskIds: string[];
  /** The automation / agent runs that spent this extension's money, sorted. */
  runIds: string[];
  /** The execution nodes that spent it, sorted. */
  nodeIds: string[];
  /** The content items it produced or was charged for, sorted. */
  contentItemIds: string[];
}

/** What the 调用明细 tab reads (CI-P7-02-04 / 05). */
export interface AiCostCenterCallsPayload {
  range: number;
  from: number;
  to: number;
  filters: AiCostCenterCallFilters;
  scan: {
    /** Rows read out of the window. */
    rows: number;
    /** The read's ceiling, so a page can tell a full scan from a truncated one. */
    limit: number;
    /** True when the read hit its ceiling and older rows in the window were not looked at. */
    truncated: boolean;
    /** True when some identity could not be resolved because the lookup budget was spent. */
    traceCapped: boolean;
  };
  /** How many attempts the filters matched (not how many are on this page). */
  matched: number;
  /** The matched set added up, so the page never quotes the window's total as the filter's. */
  totals: AiUsageLedgerTotals;
  /** The matched set's money per currency - a CNY figure is never added to a USD one. */
  matchedCostByCurrency: AiUsageLedgerCurrencyTotal[];
  offset: number;
  limit: number;
  hasMore: boolean;
  calls: AiUsageCallView[];
  /** Per-content cost, computed over the window's rows so it does not move with the table's filters. */
  byContent: AiUsageCallContentCost[];
  /**
   * Per-run and per-node cost (CI-P7-05-02), likewise computed over the window's rows. A row that
   * recorded no run keeps its own unclassified group, and a run's node figures add up to its total
   * because both are the same rows - so the headline can be checked against the detail.
   */
  byRun: AiUsageRunCost[];
  /**
   * Per-extension cost (CI-P7-05-03), likewise computed over the window's rows. The rows that named
   * no extension keep their own unattributed group, and each group says which tasks, runs, nodes and
   * content items spent it - the attribution the card asks for, read rather than guessed.
   */
  byExtension: AiUsageExtensionCost[];
  /** The filter choices the window's data actually offers, so a filter is never offered empty. */
  options: {
    purposes: string[];
    outcomes: AiUsageOutcome[];
    costSources: AiUsageCostSource[];
    models: Array<{ key: string; label: string }>;
    /** The extension ids this window's rows named, sorted; empty ids are not an option. */
    extensions: string[];
  };
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
  /**
   * Base URL of the OpenAI-compatible *image* service, independent of the text one
   * (CI-AI-IMG-CONFIG-02, decision Q1/Q4). Empty means "not configured": the image path never
   * inherits `openAIBaseUrl`, so a text-only endpoint such as DeepSeek cannot silently receive
   * image requests.
   */
  openAIImageBaseUrl: string;
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

/** `active` topics are the ones being worked on; `archived` ones keep their history (P2-01-01). */
export type TopicStatus = "active" | "archived";

export interface TopicRecord {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  /** Where the idea came from: `manual`, a hot-topic platform name, or anything the user typed. */
  source: string;
  sourceUrl: string;
  status: TopicStatus;
  /**
   * The article generated from this topic (`null` until one is). The wizard's entry writes it
   * (P2-01-05), so the topic list can hand the article back to the editor.
   */
  contentItemId: string | null;
  /**
   * The research material this topic was distilled from (CI-P3-03); `""` when the idea is the user's own.
   *
   * It is provenance, not material: a topic created from a 选题建议 records where the idea came from, and
   * the article generated from the topic carries its own `metadata.topicId`. Nothing reads this column to
   * inject text into a prompt - a suggestion is not a source fact.
   */
  researchMaterialId: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * One brand profile (品牌资料, CI-P2-02). The writing wizard selects one and the generation entry
 * injects it; `updatedAt` doubles as the version an article records (`metadata.brandVersion`), which
 * is how an edit made *after* a generation stays visible on the article.
 */
export interface BrandRecord {
  id: string;
  name: string;
  description: string;
  targetAudience: string;
  tone: string;
  keywords: string[];
  bannedWords: string[];
  createdAt: number;
  updatedAt: number;
}

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

/**
 * One stored chunk vector of a knowledge record (CI-EMB-01, D2=b/D11).
 *
 * The knowledge record stays the business entity a user edits; this is its *retrieval unit*, and the two
 * are deliberately different tables. A record therefore has many of these, each with:
 *
 * - a **stable id** (`<knowledgeId>#<chunkIndex>`), so re-embedding the same body updates the rows in place
 *   instead of growing the index - which is also what makes a retried task idempotent;
 * - the **chunking version** and both hashes (`sourceHash` over the whole record's contributing fields,
 *   `chunkHash` over this chunk's own text), so "is this vector still valid" is a comparison rather than a
 *   timestamp guess;
 * - the **identity of the model that produced it** (provider, model, dimensions) beside the vector itself,
 *   so vectors of two models can never be mixed into one similarity (D4);
 * - the vector as JSON, because this build stores no vector extension and computes similarity in memory.
 */
export interface KnowledgeEmbeddingChunkRecord {
  id: string;
  knowledgeId: string;
  /** The chunk's position in its record, which is half of the stable id and what recall reports. */
  chunkIndex: number;
  chunkingVersion: string;
  /** The chunk's own text - the retrieval unit, never the UI's `content.slice(0, 300)` preview. */
  text: string;
  chunkHash: string;
  sourceHash: string;
  providerId: string;
  modelId: string;
  dimensions: number;
  vector: number[];
  createdAt: number;
  updatedAt: number;
}

/** Where a research material's text came from (CI-P3-01; `audio`/`video` added by CI-P3-02). */
export const researchMaterialKinds = ["text", "url", "file", "audio", "video"] as const;

export type ResearchMaterialKind = (typeof researchMaterialKinds)[number];

/**
 * What has really happened to a research material's source (CI-P3-01).
 *
 * The four states are the card's own list, and none of them may be inferred from an empty `content`:
 * `draft` is a source nobody has read yet, `ready` a page (or file) that was read, `empty` a read that
 * found no usable text, `failed` a read that did not succeed. A record that says `failed` never carries
 * text pretending to be that page's 正文.
 */
export const researchMaterialStatuses = ["draft", "ready", "empty", "failed"] as const;

export type ResearchMaterialStatus = (typeof researchMaterialStatuses)[number];
/**
 * One research material (研究素材, CI-P3-01): a text note, a web page, or an imported file, kept so a
 * generation can read its text.
 *
 * The source and its text are two fields on purpose. `sourceUrl` is where the material came from and
 * `content` is what was actually read (or typed); a record whose page could not be read has a url, no
 * text, and the status that says so.
 */
export interface ResearchMaterialRecord {
  id: string;
  title: string;
  kind: ResearchMaterialKind;
  content: string;
  sourceUrl: string;
  status: ResearchMaterialStatus;
  /** Why the last read ended the way it did (`HTTP 404`, `读取成功但没有正文`, ...); empty when there is nothing to explain. */
  statusMessage: string;
  /** The source page's `og:image` found while reading; empty when none was found. */
  imageUrl: string;
  /** The imported file's name, for `kind: "file"`. */
  fileName: string;
  tags: string[];
  /** When the source was last read successfully; `null` until one was. */
  fetchedAt: number | null;
  /**
   * What a transcription run recorded about this material (CI-P3-02), or `null` when this material did
   * not come from one. It is deliberately structured rather than a string: the console reads the
   * engine's segments out of it to show a timestamped transcript beside the editable text.
   */
  transcript: TranscriptMetadata | null;
  /**
   * The current 研究提炼 of this material (CI-P3-03), or `null` when nobody has distilled it yet.
   *
   * It is deliberately structured rather than a string: the console reads the summary, the points, the
   * facts with their original excerpts and the model's topic suggestions out of it, and it decides
   * "已核实" from the material's own text rather than from anything stored here.
   */
  extraction: ResearchExtractionRecord | null;
  /** The versions this extraction replaced, newest first; empty when this is the only one. */
  extractionHistory: ResearchExtractionRecord[];
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

/**
 * A budget hold as it is stored and read back (CI-P7-03-A).
 *
 * `amount` is a **ceiling** - the highest figure the estimate could reach - and never what the call
 * spent; the money is the ledger row's `costAmount`, and the two are compared in the reconciliation
 * rather than merged here. `settledAt` is `null` while the hold is live, which is the real answer
 * rather than a 0.
 */
export interface AiBudgetReservation {
  id: string;
  periodKey: string;
  periodStart: number;
  periodEnd: number;
  currency: string;
  amount: number;
  policy: string;
  estimateKind: string;
  estimateMethod: string;
  purpose: string;
  meteredKind: AiUsageMeteredKind;
  providerId: string;
  modelId: string;
  routeResolved: boolean;
  /** Which run and step the hold belongs to; empty when the caller declared none. */
  runId: string;
  nodeId: string;
  taskId: string;
  contentItemId: string;
  /** The process instance that took the hold. A fact about who, never a claim about liveness. */
  owner: string;
  status: AiBudgetReservationStatus;
  /** `released` when the call reported back, `expired` when its TTL passed, `''` while held. */
  settleKind: string;
  createdAt: number;
  expiresAt: number;
  settledAt: number | null;
  updatedAt: number;
}

/** `held` is live and counts against the period; the other two do not. */
export type AiBudgetReservationStatus = "held" | "settled" | "expired";

/** Which gate spoke: one model request, or a playbook step before its request exists. */
export type AiBudgetDecisionGate = "call" | "node";

/** The three verdicts a decision can carry. `off` means the user turned the budget off entirely. */
export type AiBudgetDecisionStatus = "off" | "allowed" | "blocked";

/**
 * One stored decision - what the gate saw and what it said, refusals included.
 *
 * It stores only what a decision is made of: reason codes, amounts and counts. No prompt, no
 * response and no credential is part of a decision, and the nullable amounts are the honest "nobody
 * stated one" (`null`), never a 0 that would read as a figure.
 */
export interface AiBudgetDecisionRecord {
  id: string;
  /** The gate's own clock rather than the insert time: it belongs to the instant it decided about. */
  at: number;
  gate: AiBudgetDecisionGate;
  status: AiBudgetDecisionStatus;
  reasons: string[];
  policy: string;
  unknownCostPolicy: string;
  enforcement: string;
  periodKey: string;
  currency: string;
  limitAmount: number | null;
  spentAmount: number;
  spentIsComplete: boolean;
  spentTruncated: boolean;
  reservedAmount: number;
  remainingAmount: number | null;
  projectedMin: number | null;
  projectedMax: number | null;
  certainty: string;
  estimateKind: string;
  estimateMethod: string;
  estimateNotes: string[];
  estimateAmountMin: number | null;
  estimateAmountMax: number | null;
  purpose: string;
  runId: string;
  nodeId: string;
  taskId: string;
  contentItemId: string;
  providerId: string;
  modelId: string;
  routeResolved: boolean;
  /** The hold this verdict took; empty when it took none, which is why nothing was held. */
  reservationId: string;
  reservationAmount: number | null;
  reservationCurrency: string;
  createdAt: number;
}

/**
 * What the holds and the ledger say about each other, per hold (CI-P7-03-A).
 *
 * This vocabulary exists so "the budget record and the AI ledger agree" is a statement a reader can
 * check, and so the ways they *disagree* have names instead of being averaged away:
 */
export type AiBudgetReconciliationVerdict =
  /** The hold is still live: its call has not reported back yet. */
  | "held"
  /** The TTL passed and no ledger row links to it: nothing was ever sent, so nothing was spent. */
  | "expired-unspent"
  /** The TTL passed but ledger rows do link to it: the call did happen and its process died. */
  | "expired-with-ledger"
  /** Released, but no ledger row links to it. The reconciler cannot tell "nothing was sent" from
   * "the ledger write failed" - which is why this is its own verdict rather than a 0. */
  | "no-ledger"
  /** Linked rows exist and at least one of them states no figure: the sum is a floor. */
  | "ledger-unknown"
  /** Linked rows were billed in another currency than the hold's: nothing was subtracted. */
  | "currency-mismatch"
  /** The linked rows state less than the hold: the hold was a real ceiling. */
  | "under-reserved"
  /** The linked rows state **more** than the hold: the estimate was short. */
  | "over-reserved"
  /** The linked rows state exactly the hold. */
  | "matched";

/** The ledger's side of one hold, as a join rather than a guess. */
export interface AiBudgetReconciliationLedger {
  /** How many ledger rows name this hold. */
  rows: number;
  /** Their stated money, in the hold's currency; `null` when not one of them stated a figure. */
  statedAmount: number | null;
  /** Rows that state no figure because the catalog has no price for them. */
  unpricedRows: number;
  /** Rows that state no figure because nothing arrived to charge for (`unknown`). */
  unmeasuredRows: number;
  otherCurrencyRows: number;
  otherCurrencies: string[];
}

export interface AiBudgetReconciliationRow {
  reservationId: string;
  purpose: string;
  runId: string;
  nodeId: string;
  taskId: string;
  contentItemId: string;
  meteredKind: AiUsageMeteredKind;
  providerId: string;
  modelId: string;
  periodKey: string;
  currency: string;
  /** The stored status. */
  status: AiBudgetReservationStatus;
  /**
   * True when the hold has expired - either its row says `expired` (a sweep marked it) or its TTL has
   * passed and nothing has marked it yet. Every reader treats the second as expired from that instant,
   * so the stored status may lag while this flag cannot.
   */
  expired: boolean;
  reservedAmount: number;
  createdAt: number;
  expiresAt: number;
  settledAt: number | null;
  settleKind: string;
  ledger: AiBudgetReconciliationLedger;
  verdict: AiBudgetReconciliationVerdict;
}

export interface AiBudgetReconciliationTotals {
  reservations: number;
  /** Holds that are live right now (not expired), by their ceiling. */
  heldAmount: number;
  /** Ceilings of the holds whose calls reported back. */
  settledAmount: number;
  /** Ceilings of the holds whose TTL passed. */
  expiredAmount: number;
  /** What the linked ledger rows state, in the holds' own currencies added per currency. */
  ledgerStatedByCurrency: Record<string, number>;
  /** How many holds ended in each verdict. Every verdict appears, including the zeroes. */
  verdicts: Record<AiBudgetReconciliationVerdict, number>;
}

/** One reconciliation read: the rows, and the sums over them. */
export interface AiBudgetReconciliation {
  /** The window that was read, `null` when the caller stated none (then it is "everything kept"). */
  from: number | null;
  to: number | null;
  rows: AiBudgetReconciliationRow[];
  totals: AiBudgetReconciliationTotals;
  /** True when the row ceiling cut the answer short, so the totals are a floor. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// 营销线索与成交 (CI-LEAD-01)
//
// The business end of the chain: a publish record says what reached a platform, a metric snapshot says
// how many people saw it, and this vocabulary is how the app records what a person did next - got in
// touch, and (maybe) bought. The status set is closed and deliberately small: it is a follow-up state,
// not a sales pipeline, and nothing here is inferred from a platform name or a follower count.
// ---------------------------------------------------------------------------
export const marketingLeadStatuses = ["new", "following", "won", "closed"] as const;

/** 待跟进 / 跟进中 / 已成交 / 已关闭. */
export type MarketingLeadStatus = (typeof marketingLeadStatuses)[number];

export interface MarketingLeadRecord {
  id: string;
  /** 客户称呼. */
  name: string;
  /** 联系方式, optional and free text (a phone number, a WeChat id, an email). */
  contact: string;
  /** 来源平台 exactly as the user typed it; `''` when they did not say. */
  sourcePlatform: string;
  /** The content this lead came from; `null` when unlinked - never guessed. */
  contentItemId: string | null;
  /** The publish record it came from; `null` when it did not arrive through one. */
  publishRecordId: string | null;
  status: MarketingLeadStatus;
  note: string;
  /** Won amount in minor units; `null` = 未记录, which is not 0. */
  dealAmountMinor: number | null;
  /** The unit of `dealAmountMinor`; `''` exactly while it is `null`. */
  dealCurrency: string;
  dealClosedAt: number | null;
  dealNote: string;
  createdAt: number;
  updatedAt: number;
}

/** One currency's contribution to the won total: amounts are never added across currencies. */
export interface MarketingLeadAmountTotal {
  currency: string;
  amountMinor: number;
  deals: number;
}

/** Per-content conversion: what a content produced, and how much of it closed. */
export interface MarketingLeadContentTotal {
  contentItemId: string;
  /** The content's title, or `''` when the id no longer resolves (the leads still count). */
  title: string;
  leads: number;
  won: number;
  amounts: MarketingLeadAmountTotal[];
}

export interface MarketingLeadSummary {
  total: number;
  /** Every status appears, including the zeroes - a 0 here means "none", not "unknown". */
  byStatus: Record<MarketingLeadStatus, number>;
  /** 待跟进 + 跟进中. */
  open: number;
  won: number;
  /** 已成交 with no amount ever recorded: counted here, never added to a total as 0. */
  wonWithoutAmount: number;
  /** Won amounts per currency, biggest first. Empty when nothing was recorded. */
  amounts: MarketingLeadAmountTotal[];
  byContent: MarketingLeadContentTotal[];
  /** Leads linked to no content at all: counted separately instead of being dropped. */
  unattributed: { leads: number; won: number };
}

/** A link a lead names, resolved for display; a row that is gone is simply absent from the payload. */
export interface MarketingLeadLink {
  id: string;
  title: string;
}

/** `GET /api/leads`: the rows, the sums over them, and the links they name. */
export interface MarketingLeadPayload {
  leads: MarketingLeadRecord[];
  summary: MarketingLeadSummary;
  /** Only the content ids the leads name, resolved. */
  contents: MarketingLeadLink[];
  /** Only the publish record ids the leads name, resolved with the platform they went to. */
  publishes: Array<MarketingLeadLink & { platform: string; url: string }>;
}

