import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  url: text("url").notNull().default(""),
  account: text("account").notNull().default(""),
  profilePath: text("profile_path").notNull().default(""),
  memo: text("memo").notNull().default(""),
  status: text("status").notNull().default("needs_login"),
  presetJson: text("preset_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const contentItems = sqliteTable("content_items", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default(""),
  body: text("body").notNull().default(""),
  postReadyText: text("post_ready_text").notNull().default(""),
  sourceUrlsJson: text("source_urls_json").notNull().default("[]"),
  imagePath: text("image_path").notNull().default(""),
  metadataJson: text("metadata_json").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const schedules = sqliteTable("schedules", {
  id: text("id").primaryKey(),
  playbookId: text("playbook_id").notNull(),
  accountId: text("account_id"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  scheduleTimesJson: text("schedule_times_json").notNull().default("[]"),
  paramsJson: text("params_json").notNull().default("{}"),
  status: text("status").notNull().default("scheduled"),
  contentItemId: text("content_item_id"),
  publishAuthorized: integer("publish_authorized", { mode: "boolean" }).notNull().default(false),
  lastRunAt: integer("last_run_at"),
  nextRunAt: integer("next_run_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  playbookId: text("playbook_id").notNull(),
  accountId: text("account_id"),
  scheduleId: text("schedule_id"),
  scheduledFor: integer("scheduled_for"),
  status: text("status").notNull().default("queued"),
  paramsJson: text("params_json").notNull().default("{}"),
  resultMessage: text("result_message").notNull().default(""),
  artifactPath: text("artifact_path").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
  updatedAt: integer("updated_at").notNull(),
});

export const runEvents = sqliteTable("run_events", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  dataJson: text("data_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
});

export const chatThreads = sqliteTable("chat_threads", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default(""),
  activeAccountId: text("active_account_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull().default(""),
  accountId: text("account_id"),
  mode: text("mode"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
});

export const chatToolCalls = sqliteTable("chat_tool_calls", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  messageId: text("message_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("pending"),
  accountId: text("account_id"),
  inputJson: text("input_json").notNull().default("{}"),
  outputJson: text("output_json").notNull().default("{}"),
  creditType: text("credit_type"),
  creditCost: integer("credit_cost"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull().default("{}"),
  updatedAt: integer("updated_at").notNull(),
});

export const agentRuntimeRuns = sqliteTable("agent_runtime_runs", {
  id: text("id").primaryKey(),
  threadId: text("thread_id"),
  accountId: text("account_id"),
  status: text("status").notNull().default("queued"),
  mode: text("mode").notNull().default("local"),
  inputJson: text("input_json").notNull().default("{}"),
  stateJson: text("state_json").notNull().default("{}"),
  pendingApprovalJson: text("pending_approval_json").notNull().default("{}"),
  resultJson: text("result_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const agentRuntimeEvents = sqliteTable("agent_runtime_events", {
  id: text("id").primaryKey(),
  agentRunId: text("agent_run_id").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull().default(""),
  dataJson: text("data_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
});

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  brand: text("brand").notNull().default(""),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default(""),
  keywordsJson: text("keywords_json").notNull().default("[]"),
  price: text("price").notNull().default(""),
  imagePath: text("image_path").notNull().default(""),
  linkUrl: text("link_url").notNull().default(""),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * A topic (选题) is the thing a creator writes *about*, kept before any article exists
 * (CI-P2-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * `content_item_id` is the association the card asks for (P2-01-05): the article produced from this
 * topic, once the wizard has generated one. It is nullable because a topic is useful before it has
 * ever been written about, and it follows `schedules.content_item_id`'s shape - one column naming the
 * content it belongs to - rather than a second join table.
 */
export const topics = sqliteTable("topics", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  keywordsJson: text("keywords_json").notNull().default("[]"),
  /** Where the idea came from: `manual`, `hot_topic`, or a platform name the user typed. */
  source: text("source").notNull().default("manual"),
  sourceUrl: text("source_url").notNull().default(""),
  /** `active` | `archived` - archive instead of delete, so the history stays readable. */
  status: text("status").notNull().default("active"),
  contentItemId: text("content_item_id"),
  /**
   * The research material a *suggestion* this topic came from belongs to (CI-P3-03).
   *
   * Empty for every topic a user or a hot-topic source created, which is why it is a plain defaulted
   * column: a topic that came from a distillation records where the idea came from, and the article
   * generated from the topic keeps its own `metadata.topicId` - the two links are what make
   * 「文章 → 选题 → 素材」 answerable without a second copy of any text.
   */
  researchMaterialId: text("research_material_id").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const brands = sqliteTable("brands", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  targetAudience: text("target_audience").notNull().default(""),
  /** How the brand sounds (语气): free text, handed to the model as a voice constraint. */
  tone: text("tone").notNull().default(""),
  keywordsJson: text("keywords_json").notNull().default("[]"),
  bannedWordsJson: text("banned_words_json").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const knowledgeBase = sqliteTable("knowledge_base", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  category: text("category").notNull().default("other"),
  weight: text("weight").notNull().default("medium"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  origin: text("origin").notNull().default("manual"),
  tagsJson: text("tags_json").notNull().default("[]"),
  sourceUrl: text("source_url").notNull().default(""),
  fileName: text("file_name").notNull().default(""),
  positionId: text("position_id").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * The knowledge index: one row per chunk of one knowledge record (CI-EMB-01, D2=b/D11).
 *
 * `knowledge_base` stays the business entity a user edits; this table is what a semantic query reads. Three
 * columns carry the rules the card is about:
 *
 * - `source_hash` is the identity of the record's *content* (title, body, category, tags, plus the chunking
 *   and input-template versions). A row whose hash differs from the record's current one is stale: it may
 *   still exist and still answer a query from its own model, and no reader may treat it as current.
 * - `provider_id`/`model_id`/`dimensions` identify the model that produced the vector. Vectors of two models
 *   are never compared (D4), so a model change is a rebuild rather than a silent mismatch.
 * - `vector_json` is the vector itself. SQLite gets no vector extension here; similarity is computed in
 *   memory by `cosineSimilarity()`, which is why the row also states the dimension it must be compared at.
 *
 * `id` is stable (`<knowledge_id>#<chunk_index>`), which is what makes a re-embedding an update rather than
 * an append, and what makes a retried task produce one index rather than two.
 */
export const knowledgeEmbeddings = sqliteTable("knowledge_embeddings", {
  id: text("id").primaryKey(),
  knowledgeId: text("knowledge_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  /** The chunking rule that produced this row (`knowledgeChunkingVersion`). */
  chunkingVersion: text("chunking_version").notNull(),
  text: text("text").notNull(),
  /** SHA-256 of this chunk's own text. */
  chunkHash: text("chunk_hash").notNull(),
  /** SHA-256 of the record's contributing fields and both template versions. */
  sourceHash: text("source_hash").notNull(),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  dimensions: integer("dimensions").notNull(),
  vectorJson: text("vector_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const difyConnections = sqliteTable("dify_connections", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  apiBase: text("api_base").notNull().default(""),
  apiKey: text("api_key").notNull().default(""),
  knowledgeIdsJson: text("knowledge_ids_json").notNull().default("[]"),
  publicConfirmed: integer("public_confirmed", { mode: "boolean" }).notNull().default(false),
  scopesJson: text("scopes_json").notNull().default("[]"),
  positionId: text("position_id").notNull().default(""),
  insufficientMode: text("insufficient_mode").notNull().default("knowledge_first"),
  scoreThreshold: integer("score_threshold").notNull().default(45),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const publishRecords = sqliteTable("publish_records", {
  id: text("id").primaryKey(),
  accountId: text("account_id"),
  accountName: text("account_name").notNull().default(""),
  platform: text("platform").notNull().default(""),
  title: text("title").notNull().default(""),
  contentType: text("content_type").notNull().default(""),
  status: text("status").notNull().default("queued"),
  url: text("url").notNull().default(""),
  method: text("method").notNull().default(""),
  terminal: text("terminal").notNull().default(""),
  message: text("message").notNull().default(""),
  contentItemId: text("content_item_id"),
  publishedAt: integer("published_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  // Latest normalized engagement metrics, refreshed by the metrics collector.
  views: integer("views").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  shares: integer("shares").notNull().default(0),
  favorites: integer("favorites").notNull().default(0),
  followsDelta: integer("follows_delta").notNull().default(0),
  completionRate: real("completion_rate"),
  metricStatus: text("metric_status").notNull().default("pending"),
  metricsSyncedAt: integer("metrics_synced_at"),
  metricsSource: text("metrics_source"),
});

export const metricSnapshots = sqliteTable("metric_snapshots", {
  id: text("id").primaryKey(),
  publishRecordId: text("publish_record_id").notNull(),
  accountId: text("account_id"),
  platform: text("platform").notNull().default(""),
  contentItemId: text("content_item_id"),
  capturedAt: integer("captured_at").notNull(),
  views: integer("views").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  shares: integer("shares").notNull().default(0),
  favorites: integer("favorites").notNull().default(0),
  followsDelta: integer("follows_delta").notNull().default(0),
  completionRate: real("completion_rate"),
  extraJson: text("extra_json").notNull().default("{}"),
  source: text("source").notNull().default("browser"),
  createdAt: integer("created_at").notNull(),
});

export const accountMetricSnapshots = sqliteTable("account_metric_snapshots", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  platform: text("platform").notNull().default(""),
  capturedAt: integer("captured_at").notNull(),
  followers: integer("followers").notNull().default(0),
  postsCount: integer("posts_count").notNull().default(0),
  extraJson: text("extra_json").notNull().default("{}"),
  source: text("source").notNull().default("browser"),
  createdAt: integer("created_at").notNull(),
});

/**
 * A marketing lead and its outcome (营销线索与成交, `CI-LEAD-01`).
 *
 * The missing half of the business chain: `publish_records` says a content reached a platform and
 * `metric_snapshots` says how many people saw it, but nothing said whether a person got in touch or
 * bought anything. This table is that record and nothing more - it is **not** a CRM (no contact
 * directory, no pipeline automation), the same line the 开发清单 draws for `P2-06`.
 *
 * Four decisions worth naming:
 *
 * 1. **A lead is linked to what produced it by id, and the link may be absent.** `content_item_id` /
 *    `publish_record_id` follow the shape `schedules.content_item_id` chose (nullable), because a lead
 *    that arrived offline is a real lead - it is shown as 未关联内容 instead of being attached to a
 *    content the user never chose.
 * 2. **成交金额 is nullable and stored in minor units.** `NULL` means "not recorded", which is not 0:
 *    the summary counts those deals separately instead of pretending they were worth nothing, and
 *    minor units keep a sum exact (`1200.50` is `120050`, no float arithmetic over money).
 * 3. **An amount carries its currency.** `deal_currency` is `''` only while no amount is recorded, so a
 *    stored number is never an amount without a unit and two currencies are never added together.
 * 4. **跟进状态 is a closed vocabulary** (`marketingLeadStatuses`, `@/lib/leads`) and 已成交 is the state
 *    a deal belongs to: `updateMarketingLead` refuses to move a lead that recorded a deal out of `won`
 *    unless the same call clears it, so no write silently deletes an amount or a closing date.
 */
export const marketingLeads = sqliteTable("marketing_leads", {
  id: text("id").primaryKey(),
  /** 客户称呼. */
  name: text("name").notNull(),
  /** 联系方式, optional: a lead the user has no phone or WeChat for is still a lead. */
  contact: text("contact").notNull().default(""),
  /** 来源平台, free text - leads arrive from places this app never published to. */
  sourcePlatform: text("source_platform").notNull().default(""),
  contentItemId: text("content_item_id"),
  publishRecordId: text("publish_record_id"),
  /** `new` / `following` / `won` / `closed` - see `marketingLeadStatuses`. */
  status: text("status").notNull().default("new"),
  note: text("note").notNull().default(""),
  /** Sum in minor units; `NULL` = 未记录 (never 0). */
  dealAmountMinor: integer("deal_amount_minor"),
  /** ISO-ish code, `''` while `deal_amount_minor` is NULL. */
  dealCurrency: text("deal_currency").notNull().default(""),
  dealClosedAt: integer("deal_closed_at"),
  dealNote: text("deal_note").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const usageRecords = sqliteTable("usage_records", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default(""),
  model: text("model").notNull().default(""),
  kind: text("kind").notNull().default("article"),
  status: text("status").notNull().default("success"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  wordCount: integer("word_count").notNull().default(0),
  accountId: text("account_id"),
  contentItemId: text("content_item_id"),
  createdAt: integer("created_at").notNull(),
});

/**
 * Model runtime (Model Gateway) tables.
 *
 * Vocabulary: a *provider* is a vendor (OpenAI, 通义千问…), an *endpoint* is one
 * callable base URL of that vendor plus the credential that signs it, and a *model*
 * is one model id reachable through that endpoint. Capabilities are separate rows so
 * the runtime can answer "which model can do VISION + TOOL_CALLING?".
 *
 * `endpoint_id` is never NULL: SQLite treats NULLs as distinct in a UNIQUE index, so
 * "unbound endpoint" uses the empty string instead.
 */
export const aiModelProviders = sqliteTable("ai_model_providers", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull().unique(),
  name: text("name").notNull(),
  region: text("region").notNull().default("global"),
  docsUrl: text("docs_url").notNull().default(""),
  apiKeyUrl: text("api_key_url").notNull().default(""),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  source: text("source").notNull().default("seeded"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const aiModelEndpoints = sqliteTable("ai_model_endpoints", {
  id: text("id").primaryKey(),
  endpointId: text("endpoint_id").notNull().unique(),
  providerId: text("provider_id").notNull(),
  name: text("name").notNull().default(""),
  protocol: text("protocol").notNull(),
  baseUrl: text("base_url").notNull().default(""),
  credentialRef: text("credential_ref").notNull().default(""),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(true),
  status: text("status").notNull().default("unknown"),
  lastCheckAt: integer("last_check_at"),
  lastCheckMessage: text("last_check_message").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const aiModels = sqliteTable("ai_models", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(),
  endpointId: text("endpoint_id").notNull().default(""),
  modelId: text("model_id").notNull(),
  displayName: text("display_name").notNull().default(""),
  modelType: text("model_type").notNull().default("unknown"),
  contextWindow: integer("context_window"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  source: text("source").notNull().default("catalog"),
  syncedAt: integer("synced_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const aiModelCapabilities = sqliteTable("ai_model_capabilities", {
  id: text("id").primaryKey(),
  modelRowId: text("model_row_id").notNull(),
  capability: text("capability").notNull(),
  supported: integer("supported", { mode: "boolean" }).notNull().default(true),
  source: text("source").notNull().default("MODEL_CATALOG"),
  confidence: real("confidence").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const aiModelPreferences = sqliteTable("ai_model_preferences", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull().default("default"),
  capability: text("capability").notNull().default(""),
  modelRowId: text("model_row_id").notNull().default(""),
  providerId: text("provider_id").notNull().default(""),
  modelId: text("model_id").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const aiSyncRecords = sqliteTable("ai_sync_records", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(),
  endpointId: text("endpoint_id").notNull().default(""),
  status: text("status").notNull().default("ok"),
  modelCount: integer("model_count").notNull().default(0),
  message: text("message").notNull().default(""),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at").notNull(),
});

export const aiProbeResults = sqliteTable("ai_probe_results", {
  id: text("id").primaryKey(),
  modelRowId: text("model_row_id").notNull(),
  capability: text("capability").notNull(),
  status: text("status").notNull().default("ok"),
  latencyMs: integer("latency_ms").notNull().default(0),
  message: text("message").notNull().default(""),
  probedAt: integer("probed_at").notNull(),
});

/**
 * Key health inside one credential (spec §5). A row is identified by
 * `(credential_ref, fingerprint)`, where `fingerprint` is a SHA-256 of the secret: the
 * runtime can remember a key's cooldown and failure history without ever storing it.
 */
export const aiCredentialKeys = sqliteTable("ai_credential_keys", {
  id: text("id").primaryKey(),
  credentialRef: text("credential_ref").notNull(),
  providerId: text("provider_id").notNull().default(""),
  fingerprint: text("fingerprint").notNull(),
  label: text("label").notNull().default(""),
  masked: text("masked").notNull().default(""),
  status: text("status").notNull().default("unknown"),
  cooldownUntil: integer("cooldown_until"),
  lastCheckAt: integer("last_check_at"),
  lastUsedAt: integer("last_used_at"),
  useCount: integer("use_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const positions = sqliteTable("positions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  dataJson: text("data_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Research materials (研究素材, CI-P3-01 of `docs/coolpilot-capability-integration-plan.md`): the third
 * kind of input a generation reads besides a topic and a brand.
 *
 * `status` is the column `knowledge_base` does not have, and the reason this is a table of its own: it
 * says what *actually happened* when someone tried to read the source, so 「尚未抓取」/「读取失败」/
 * 「没有正文」 can be shown and stored as they are instead of being guessed from an empty `content`.
 * `fetched_at` is null until a read succeeded, and `image_url` is whatever `og:image` the read found -
 * a source-page image, never a downloaded file.
 */
export const researchMaterials = sqliteTable("research_materials", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  /** `text` / `url` / `file`. */
  kind: text("kind").notNull().default("text"),
  content: text("content").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  /** `draft` (not read yet) / `ready` / `empty` / `failed`. */
  status: text("status").notNull().default("draft"),
  statusMessage: text("status_message").notNull().default(""),
  imageUrl: text("image_url").notNull().default(""),
  fileName: text("file_name").notNull().default(""),
  tagsJson: text("tags_json").notNull().default("[]"),
  fetchedAt: integer("fetched_at"),
  /**
   * What a transcription run recorded about this material (CI-P3-02): the source file, the engine and
   * model that recognised it, the language, the duration and the engine's segments. Empty for every
   * material that did not come from a transcription, which is what keeps this column from having to be
   * read as "unknown" - `''` means "no transcription", and a JSON body means one happened.
   */
  transcriptJson: text("transcript_json").notNull().default(""),
  /**
   * The current 研究提炼 (CI-P3-03): the digest a distillation run produced from this material, plus
   * which version of the material it read and which model wrote it.
   *
   * `''` means "no extraction on this material", which is a different statement from "the extraction is
   * empty" - an empty result is refused by the run (`EXTRACTION_EMPTY`) instead of being stored. The
   * column is written only by `saveResearchExtraction()`, which never touches `content`, `status` or
   * `transcript_json`: the original text and the transcript stay exactly what they were.
   */
  extractionJson: text("extraction_json").notNull().default(""),
  /**
   * The versions this one replaced, newest first, capped by `researchExtractionHistoryLimit`.
   *
   * It exists so "第 2 版是从第 1 版改来的" is a fact of the record rather than a claim: regenerating
   * pushes the current version in here instead of overwriting it out of existence, and the versions a
   * user only *edited* never enter it (an edit is not a new generation).
   */
  extractionHistoryJson: text("extraction_history_json").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * The AI usage ledger (CI-P7-01): one row per model *attempt*, not per successful generation.
 *
 * `usage_records` above counts finished work. The ledger exists because the questions a cost
 * centre has to answer cannot be answered from a table that only hears about successes:
 * what a retry cost, which provider actually signed the call after a failover, how long it
 * took, which business task it belonged to, and what money it adds up to.
 *
 * Three columns carry the honesty rules, and they are deliberately not defaults a writer can
 * forget:
 * - `cost_amount` is NULL whenever no figure can be claimed. It is never 0 standing in for
 *   "unknown" - `cost_source` says which of the four states this row is in.
 * - `completeness` records how much of the real usage was seen, so a provider that reports
 *   nothing is stored as `unknown` rather than as zeros.
 * - `pricing_json` is a *copy* of the price that was in force, so editing a price tomorrow
 *   cannot restate what yesterday's call cost.
 *
 * The business identity columns (`task_id`, `run_id`, `node_id`, `parent_usage_id`,
 * `output_asset_id`, `extension_id`) are empty strings rather than NULL, matching the convention
 * already used for `ai_model_endpoints.endpoint_id`: SQLite treats NULLs as distinct in a UNIQUE
 * index, and an empty string lets "no task declared" be an ordinary value.
 */
export const aiUsageLedger = sqliteTable("ai_usage_ledger", {
  id: text("id").primaryKey(),
  /** `article` / `knowledge` / `profile` / `extraction` / `agent` / `chat-title` … */
  purpose: text("purpose").notNull().default(""),
  /** `success` / `failed` / `interrupted`. */
  outcome: text("outcome").notNull().default("success"),
  /** The provider that really signed the request, which is not always the one the user picked. */
  providerId: text("provider_id").notNull().default(""),
  modelId: text("model_id").notNull().default(""),
  /** The endpoint the call went out through, so a failover is visible as a different endpoint. */
  endpointId: text("endpoint_id").notNull().default(""),
  /** Masked key label (`****1234`). The key itself never reaches this table. */
  credentialLabel: text("credential_label").notNull().default(""),
  /** 0 for the first attempt on a call; 1, 2… for the attempts that preceded the winner. */
  attemptIndex: integer("attempt_index").notNull().default(0),
  taskId: text("task_id").notNull().default(""),
  runId: text("run_id").notNull().default(""),
  nodeId: text("node_id").notNull().default(""),
  /** The attempt this one retried, when it is a retry. */
  parentUsageId: text("parent_usage_id").notNull().default(""),
  /** The artifact or content item this call produced, when it produced one. */
  outputAssetId: text("output_asset_id").notNull().default(""),
  contentItemId: text("content_item_id").notNull().default(""),
  /**
   * The Marketplace extension this call ran as (CI-P7-05-03), in the storefront's own id space:
   * `position-<id>` for a published position listing, or the built-in catalogue's own agent id.
   *
   * Empty is a real answer and the honest default: most calls are not made as a listing (a chat
   * answer, a transcription, an image, a rewrite), and a call whose entry selected no published
   * listing and no catalogue agent is stored as unattributed rather than given a plausible id.
   * Which id a call may state is decided in one place (`@/lib/marketplace-attribution`).
   */
  extensionId: text("extension_id").notNull().default(""),
  /**
   * The budget hold (CI-P7-03-A) this request was admitted under, empty when it was not gated.
   *
   * This is the *link* between the two records of one call - the hold the gate took before sending
   * and the money the row below states afterwards - so reconciliation is a join on an id rather than
   * a guess from (purpose, run, node, time). An empty value is a real answer: every row written
   * before this column existed, and every call the gate did not hold anything for.
   */
  budgetReservationId: text("budget_reservation_id").notNull().default(""),
  /** `text` / `image` / `video` / `speech` / `embedding` / `agent`. */
  meteredKind: text("metered_kind").notNull().default("text"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  /**
   * How much of the real usage was seen, on the dimension this row is billed on: `reported`
   * (the billed amount was measured - a usage object for a token row, this row's own quantity for
   * an image/second/character row), `partial` (interrupted), `unknown` (nothing arrived).
   * NEVER inferred from zero tokens or from a zero quantity.
   */
  completeness: text("completeness").notNull().default("unknown"),
  /** Modality-specific units for the kinds that are not token-metered. */
  quantityJson: text("quantity_json").notNull().default("{}"),
  /** NULL, never 0, when no cost can be claimed. */
  costAmount: real("cost_amount"),
  costCurrency: text("cost_currency").notNull().default(""),
  /** `provider-reported` / `computed` / `unpriced` / `unknown`. */
  costSource: text("cost_source").notNull().default("unknown"),
  /** The frozen price snapshot this row was costed with; `'null'` when it was not costed. */
  pricingJson: text("pricing_json").notNull().default("null"),
  durationMs: integer("duration_ms").notNull().default(0),
  errorSummary: text("error_summary").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

/**
 * The price catalog (CI-P7-01). `resolveModelPrice()` reads the newest row that is already
 * effective for a provider+model, falling back to the provider's `*` row.
 *
 * A row is never edited to change a price: a new row with a later `effective_from` is added,
 * which is what makes "what did this cost in March?" answerable from the ledger's own snapshots.
 */
export const aiModelPrices = sqliteTable("ai_model_prices", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(),
  /** `*` means "any model of this provider"; used when no exact row matches. */
  modelId: text("model_id").notNull().default("*"),
  /**
   * Which dimension this row prices (CI-P7-01-05). Rows written before the column existed are
   * `text`: that is the only thing the catalog could price at the time.
   */
  meteredKind: text("metered_kind").notNull().default("text"),
  /** ISO 4217 code. The ledger stores the currency it was costed in, not the one shown today. */
  currency: text("currency").notNull().default("CNY"),
  inputPerMillion: real("input_per_million").notNull().default(0),
  outputPerMillion: real("output_per_million").notNull().default(0),
  /** NULL when the provider does not price cached input separately. */
  cachedInputPerMillion: real("cached_input_per_million"),
  /** Price per `unit_label`; NULL on the token-metered rows, which do not use it. */
  unitPrice: real("unit_price"),
  /** `''` on token rows, otherwise the unit `unit_price` is quoted in. */
  unitLabel: text("unit_label").notNull().default(""),
  /** True when this row's zeros are a deliberate "free", not an unstated price. */
  declaredFree: integer("declared_free", { mode: "boolean" }).notNull().default(false),
  /** The catalog revision this row belongs to; copied onto every ledger row it costs. */
  priceVersion: text("price_version").notNull().default(""),
  /** Where the numbers came from: `manual` / `provider-doc` / `imported`. */
  source: text("source").notNull().default("manual"),
  effectiveFrom: integer("effective_from").notNull(),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

/**
 * A budget hold, persisted (CI-P7-03-A).
 *
 * Before this table, "the calls in flight" were a `Map` in one process: a second process (a worker
 * beside a dev server, or the same app restarted) kept its own holds, so two of them could each pass
 * a check against the same free budget and together overshoot. The hold now lives in the database
 * every process reads, which is what makes the next process *see* it.
 *
 * The rules this table is shaped by:
 *
 * - **One hold, one row, one status.** `held` is live; `settled` means the call reported back;
 *   `expired` means its TTL passed and it was reaped. A row is never deleted while it is `held`.
 * - **A hold is a ceiling, not a cost.** It is `aiBudgetReservationAmount(estimate)` - the highest
 *   figure the estimate could reach - and it is deliberately *not* what the call spent. What the call
 *   spent is the ledger row's own `cost_amount`, and the two are compared by
 *   `reconcileAiBudgetReservations` rather than conflated here.
 * - **TTL, not a heartbeat.** `aiBudgetReservationTtlMs` after `created_at` the hold stops counting
 *   from the instant `expires_at` passes, whether or not anything has reaped it yet. A crash therefore
 *   over-reserves for at most that long and can never under-reserve.
 * - **`owner` is a fact, not a liveness check.** It records which process instance took the hold.
 *   Nothing infers that a process is dead - a restart cannot know that - so recovery is the TTL and
 *   the shared row, never a guess.
 */
export const aiBudgetReservations = sqliteTable("ai_budget_reservations", {
  id: text("id").primaryKey(),
  /** The calendar month the hold counts against (`budgetPeriodOf`), so a reader needs no re-derivation. */
  periodKey: text("period_key").notNull(),
  /** The half-open window the period's ledger rows are read from, frozen onto the row. */
  periodStart: integer("period_start").notNull(),
  periodEnd: integer("period_end").notNull(),
  /** The currency of `amount` and of the limit it was compared with. */
  currency: text("currency").notNull(),
  /** The held ceiling. Never 0 and never a stand-in for an unknown cost: those hold nothing. */
  amount: real("amount").notNull(),
  /** The policy in force when the hold was taken, for the audit of a refusal that came later. */
  policy: text("policy").notNull().default(""),
  /** `estimate` when a figure was held; kept so a reader can tell which estimate the ceiling came from. */
  estimateKind: text("estimate_kind").notNull().default(""),
  estimateMethod: text("estimate_method").notNull().default(""),
  purpose: text("purpose").notNull().default(""),
  meteredKind: text("metered_kind").notNull().default("text"),
  providerId: text("provider_id").notNull().default(""),
  modelId: text("model_id").notNull().default(""),
  /** True when the provider/model came from `resolveRoute`, so a later mismatch is explainable. */
  routeResolved: integer("route_resolved", { mode: "boolean" }).notNull().default(false),
  /** Business identity: which run and step this hold belongs to, empty when the caller declared none. */
  runId: text("run_id").notNull().default(""),
  nodeId: text("node_id").notNull().default(""),
  taskId: text("task_id").notNull().default(""),
  contentItemId: text("content_item_id").notNull().default(""),
  /** Which process instance took the hold. Informational; no "is it alive" claim is made anywhere. */
  owner: text("owner").notNull().default(""),
  /** `held` / `settled` / `expired`. */
  status: text("status").notNull().default("held"),
  /** Why it stopped being `held`: `released` (the call reported back) / `expired` (the TTL passed). */
  settleKind: text("settle_kind").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  settledAt: integer("settled_at"),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Every budget decision the gate made (CI-P7-03-A), refusals included.
 *
 * A refusal used to exist only for as long as one 402 response: the arithmetic behind it was gone by
 * the time anyone asked "why did this run stop". This table is that answer, and it is written for
 * *both* outcomes - an `allowed` row is what makes a later refusal explainable ("the budget had room
 * at 10:00 and none at 10:04" is a comparison of two of these rows).
 *
 * What it stores is only what a decision is made of: reason codes, amounts, counts and the period.
 * No prompt, no response, no credential and no key ever reaches this table - the estimate records the
 * *length* of an input and forgets the text.
 *
 * `limit_amount` and `remaining_amount` are nullable on purpose: "no ceiling stated" is a NULL, never
 * a 0, exactly as the ledger refuses to store an unstated cost as 0.
 */
export const aiBudgetDecisions = sqliteTable("ai_budget_decisions", {
  id: text("id").primaryKey(),
  /** The gate's own clock, not the insert time: a decision belongs to the instant it decided about. */
  at: integer("at").notNull(),
  /** `call` (one model request) or `node` (a step of a playbook, before its request exists). */
  gate: text("gate").notNull(),
  /** `off` / `allowed` / `blocked`. */
  status: text("status").notNull(),
  reasonsJson: text("reasons_json").notNull().default("[]"),
  policy: text("policy").notNull().default(""),
  unknownCostPolicy: text("unknown_cost_policy").notNull().default(""),
  enforcement: text("enforcement").notNull().default(""),
  periodKey: text("period_key").notNull(),
  currency: text("currency").notNull().default(""),
  /** NULL when no ceiling is stated - the same absence the settings hold. */
  limitAmount: real("limit_amount"),
  spentAmount: real("spent_amount").notNull().default(0),
  spentIsComplete: integer("spent_is_complete", { mode: "boolean" }).notNull().default(true),
  spentTruncated: integer("spent_truncated", { mode: "boolean" }).notNull().default(false),
  reservedAmount: real("reserved_amount").notNull().default(0),
  remainingAmount: real("remaining_amount"),
  projectedMin: real("projected_min"),
  projectedMax: real("projected_max"),
  certainty: text("certainty").notNull().default(""),
  estimateKind: text("estimate_kind").notNull().default(""),
  estimateMethod: text("estimate_method").notNull().default(""),
  estimateNotesJson: text("estimate_notes_json").notNull().default("[]"),
  estimateAmountMin: real("estimate_amount_min"),
  estimateAmountMax: real("estimate_amount_max"),
  purpose: text("purpose").notNull().default(""),
  runId: text("run_id").notNull().default(""),
  nodeId: text("node_id").notNull().default(""),
  taskId: text("task_id").notNull().default(""),
  contentItemId: text("content_item_id").notNull().default(""),
  providerId: text("provider_id").notNull().default(""),
  modelId: text("model_id").notNull().default(""),
  routeResolved: integer("route_resolved", { mode: "boolean" }).notNull().default(false),
  /** The hold this verdict took, empty when it took none (an unknown cost holds nothing). */
  reservationId: text("reservation_id").notNull().default(""),
  reservationAmount: real("reservation_amount"),
  reservationCurrency: text("reservation_currency").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});
