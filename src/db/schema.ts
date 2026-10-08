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
