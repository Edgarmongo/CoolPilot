import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { dataRoot, normalizeFileUrl } from "@/lib/paths";

function resolveDatabaseUrl() {
  const configured = process.env.SOCIAL_AUTO_POST_DB_URL?.trim();
  const defaultUrl = `file:${path.join(dataRoot(), "social-auto-post.db")}`;

  if (!configured) {
    return normalizeFileUrl(defaultUrl);
  }

  // Standalone Electron bundles still load `.env.local`; relative file URLs there
  // would incorrectly resolve inside `.next/standalone`. Route those back to the
  // selected runtime data directory instead.
  if (
    process.env.COOLPILOT_ELECTRON === "1" &&
    /^file:(?!\/|[A-Za-z]:[\\/])/.test(configured)
  ) {
    return normalizeFileUrl(defaultUrl);
  }

  return normalizeFileUrl(configured);
}

const dbUrl = resolveDatabaseUrl();

if (dbUrl.startsWith("file:")) {
  const filePath = dbUrl.slice("file:".length);
  mkdirSync(path.dirname(filePath), { recursive: true });
} else {
  dataRoot();
}

export const sqlite = createClient({ url: dbUrl });
export const db = drizzle(sqlite, { schema });

let initialized: Promise<void> | null = null;

export function ensureDatabase() {
  initialized ??= initializeDatabase();
  return initialized;
}

async function initializeDatabase() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      account TEXT NOT NULL DEFAULT '',
      profile_path TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'needs_login',
      preset_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS content_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      post_ready_text TEXT NOT NULL DEFAULT '',
      source_urls_json TEXT NOT NULL DEFAULT '[]',
      image_path TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      playbook_id TEXT NOT NULL,
      account_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      schedule_times_json TEXT NOT NULL DEFAULT '[]',
      params_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'scheduled',
      content_item_id TEXT,
      publish_authorized INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      playbook_id TEXT NOT NULL,
      account_id TEXT,
      schedule_id TEXT,
      scheduled_for INTEGER,
      status TEXT NOT NULL DEFAULT 'queued',
      params_json TEXT NOT NULL DEFAULT '{}',
      result_message TEXT NOT NULL DEFAULT '',
      artifact_path TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      active_account_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      account_id TEXT,
      mode TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS chat_tool_calls (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      account_id TEXT,
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT NOT NULL DEFAULT '{}',
      credit_type TEXT,
      credit_cost INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS agent_runtime_runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT,
      account_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      mode TEXT NOT NULL DEFAULT 'local',
      input_json TEXT NOT NULL DEFAULT '{}',
      state_json TEXT NOT NULL DEFAULT '{}',
      pending_approval_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS agent_runtime_events (
      id TEXT PRIMARY KEY,
      agent_run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      keywords_json TEXT NOT NULL DEFAULT '[]',
      price TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL DEFAULT '',
      link_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS knowledge_base (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'other',
      weight TEXT NOT NULL DEFAULT 'medium',
      enabled INTEGER NOT NULL DEFAULT 1,
      origin TEXT NOT NULL DEFAULT 'manual',
      tags_json TEXT NOT NULL DEFAULT '[]',
      source_url TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      position_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS dify_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      api_base TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      knowledge_ids_json TEXT NOT NULL DEFAULT '[]',
      public_confirmed INTEGER NOT NULL DEFAULT 0,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      position_id TEXT NOT NULL DEFAULT '',
      insufficient_mode TEXT NOT NULL DEFAULT 'knowledge_first',
      score_threshold INTEGER NOT NULL DEFAULT 45,
      enabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS publish_records (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      account_name TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      url TEXT NOT NULL DEFAULT '',
      method TEXT NOT NULL DEFAULT '',
      terminal TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      content_item_id TEXT,
      published_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_runs_status_created ON runs(status, created_at)`,
    `CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'article',
      status TEXT NOT NULL DEFAULT 'success',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      word_count INTEGER NOT NULL DEFAULT 0,
      account_id TEXT,
      content_item_id TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_publish_records_created ON publish_records(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_publish_records_status_created ON publish_records(status, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_usage_records_created ON usage_records(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_usage_records_model_created ON usage_records(model, created_at)`,
    `CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_positions_default_updated ON positions(is_default, updated_at)`,
    `CREATE INDEX IF NOT EXISTS idx_run_events_run_created ON run_events(run_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_schedules_enabled_next ON schedules(enabled, next_run_at)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created ON chat_messages(thread_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_tool_calls_message_created ON chat_tool_calls(message_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_runtime_runs_status_created ON agent_runtime_runs(status, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_runtime_events_run_created ON agent_runtime_events(agent_run_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS metric_snapshots (
      id TEXT PRIMARY KEY,
      publish_record_id TEXT NOT NULL,
      account_id TEXT,
      platform TEXT NOT NULL DEFAULT '',
      content_item_id TEXT,
      captured_at INTEGER NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      favorites INTEGER NOT NULL DEFAULT 0,
      follows_delta INTEGER NOT NULL DEFAULT 0,
      completion_rate REAL,
      extra_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'browser',
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS account_metric_snapshots (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT '',
      captured_at INTEGER NOT NULL,
      followers INTEGER NOT NULL DEFAULT 0,
      posts_count INTEGER NOT NULL DEFAULT 0,
      extra_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'browser',
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_metric_snapshots_record_captured ON metric_snapshots(publish_record_id, captured_at)`,
    `CREATE INDEX IF NOT EXISTS idx_metric_snapshots_captured ON metric_snapshots(captured_at)`,
    `CREATE INDEX IF NOT EXISTS idx_account_metric_snapshots_account_captured ON account_metric_snapshots(account_id, captured_at)`,

    // Model runtime (Model Gateway). `provider_id` is the vendor slug, `endpoint_id`
    // identifies one callable base URL of that vendor, `credential_ref` points at the
    // credential store instead of holding a key. Model ids only exist per endpoint.
    `CREATE TABLE IF NOT EXISTS ai_model_providers (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT 'global',
      docs_url TEXT NOT NULL DEFAULT '',
      api_key_url TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'seeded',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ai_model_endpoints (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL UNIQUE,
      provider_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      protocol TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      credential_ref TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_check_at INTEGER,
      last_check_message TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    // `endpoint_id` defaults to '' instead of NULL: SQLite treats NULLs as distinct
    // inside UNIQUE indexes, which would allow duplicate model rows.
    `CREATE TABLE IF NOT EXISTS ai_models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      endpoint_id TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      model_type TEXT NOT NULL DEFAULT 'unknown',
      context_window INTEGER,
      enabled INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'catalog',
      synced_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_models_identity ON ai_models(provider_id, endpoint_id, model_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider_id, model_type)`,
    `CREATE TABLE IF NOT EXISTS ai_model_capabilities (
      id TEXT PRIMARY KEY,
      model_row_id TEXT NOT NULL,
      capability TEXT NOT NULL,
      supported INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'MODEL_CATALOG',
      confidence REAL NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_model_capabilities_identity ON ai_model_capabilities(model_row_id, capability)`,
    `CREATE TABLE IF NOT EXISTS ai_model_preferences (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'default',
      capability TEXT NOT NULL DEFAULT '',
      model_row_id TEXT NOT NULL DEFAULT '',
      provider_id TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_model_preferences_scope ON ai_model_preferences(scope, capability)`,
    `CREATE TABLE IF NOT EXISTS ai_sync_records (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      endpoint_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ok',
      model_count INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ai_sync_records_provider ON ai_sync_records(provider_id, finished_at)`,
    `CREATE TABLE IF NOT EXISTS ai_probe_results (
      id TEXT PRIMARY KEY,
      model_row_id TEXT NOT NULL,
      capability TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok',
      latency_ms INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      probed_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ai_probe_results_model ON ai_probe_results(model_row_id, capability)`,
    // Key health of the credential layer: one row per (credential_ref, fingerprint).
    // The fingerprint is a SHA-256 of the secret, so the table never holds a key.
    `CREATE TABLE IF NOT EXISTS ai_credential_keys (
      id TEXT PRIMARY KEY,
      credential_ref TEXT NOT NULL,
      provider_id TEXT NOT NULL DEFAULT '',
      fingerprint TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      masked TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'unknown',
      cooldown_until INTEGER,
      last_check_at INTEGER,
      last_used_at INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_credential_keys_ref_fingerprint ON ai_credential_keys(credential_ref, fingerprint)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_credential_keys_status ON ai_credential_keys(status)`,
  ];

  // Domain rename: migrate a legacy `sites` table to `accounts` and rename the
  // related `site_id` / `site_name` columns. Best-effort; no-ops on fresh databases.
  await sqlite.execute(`ALTER TABLE sites RENAME TO accounts`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE schedules RENAME COLUMN site_id TO account_id`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE runs RENAME COLUMN site_id TO account_id`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE publish_records RENAME COLUMN site_id TO account_id`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE publish_records RENAME COLUMN site_name TO account_name`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE usage_records RENAME COLUMN site_id TO account_id`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE chat_threads RENAME COLUMN active_site_id TO active_account_id`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE chat_messages RENAME COLUMN site_id TO account_id`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE chat_tool_calls RENAME COLUMN site_id TO account_id`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE agent_runtime_runs RENAME COLUMN site_id TO account_id`).catch(() => undefined);

  for (const statement of statements) {
    await sqlite.execute(statement);
  }

  await sqlite.execute(`ALTER TABLE content_items ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE schedules ADD COLUMN status TEXT NOT NULL DEFAULT 'scheduled'`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE schedules ADD COLUMN content_item_id TEXT`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE schedules ADD COLUMN publish_authorized INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE runs ADD COLUMN scheduled_for INTEGER`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE accounts ADD COLUMN preset_json TEXT NOT NULL DEFAULT '{}'`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE knowledge_base ADD COLUMN category TEXT NOT NULL DEFAULT 'other'`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE knowledge_base ADD COLUMN weight TEXT NOT NULL DEFAULT 'medium'`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE knowledge_base ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE knowledge_base ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE knowledge_base ADD COLUMN file_name TEXT NOT NULL DEFAULT ''`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE knowledge_base ADD COLUMN position_id TEXT NOT NULL DEFAULT ''`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE products ADD COLUMN brand TEXT NOT NULL DEFAULT ''`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE products ADD COLUMN keywords_json TEXT NOT NULL DEFAULT '[]'`).catch(() => undefined);
  await sqlite.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_schedule_occurrence ON runs(schedule_id, scheduled_for)`).catch(() => undefined);

  // Metric columns on publish_records (added after the table shipped).
  await sqlite.execute(`ALTER TABLE publish_records ADD COLUMN views INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE publish_records ADD COLUMN likes INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE publish_records ADD COLUMN comments INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE publish_records ADD COLUMN shares INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE publish_records ADD COLUMN favorites INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE publish_records ADD COLUMN follows_delta INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE publish_records ADD COLUMN completion_rate REAL`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE publish_records ADD COLUMN metric_status TEXT NOT NULL DEFAULT 'pending'`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE publish_records ADD COLUMN metrics_synced_at INTEGER`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE publish_records ADD COLUMN metrics_source TEXT`).catch(() => undefined);

  // Index on a metric column must run only after the ALTER TABLE above created it.
  await sqlite.execute(`CREATE INDEX IF NOT EXISTS idx_publish_records_metric_status ON publish_records(metric_status)`).catch(() => undefined);
}
