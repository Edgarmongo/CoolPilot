import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { quoteIdentifier } from "@/lib/backup";
import { dataRoot, ensureDataRoot, normalizeFileUrl } from "@/lib/paths";

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

/**
 * How long a writer waits for the file lock before giving up (CI-P7-03-A).
 *
 * Local-first means several processes can share one file: the app, the worker, and a second app
 * instance. A budget hold is a row now, so those writers contend for real. This is the time a
 * statement waits rather than failing - long enough to outlast an ordinary statement, short enough
 * that a genuinely stuck writer still surfaces as an error instead of hanging the request.
 */
export const sqliteBusyTimeoutMs = 5000;

if (dbUrl.startsWith("file:")) {
  // A file database, and a configured URL may point outside the workspace: this directory is
  // created because the database layer decided it, not because the workspace boundary did.
  const filePath = dbUrl.slice("file:".length);
  mkdirSync(path.dirname(filePath), { recursive: true });
} else {
  // A remote target still means this workspace needs a root: the vault, the sections and the
  // database file the app falls back to all live in it (P5-B0-2.5).
  ensureDataRoot();
}

export const sqlite = createClient({ url: dbUrl });
export const db = drizzle(sqlite, { schema });

let initialized: Promise<void> | null = null;

export function ensureDatabase() {
  initialized ??= initializeDatabase();
  return initialized;
}

async function initializeDatabase() {
  // CI-P7-03-A. A worker and the app can now write the *same* table (a budget hold is a row, not a
  // memory in one process), so a writer that arrives while another one holds the file lock must
  // **wait**, not fail the user's call. Three things keep this honest:
  //
  //  - it is a `file:`-only concern; a remote target does its own serialization and is left alone;
  //  - the value is read back and a database that did not honour it says so out loud, because a
  //    silently-ignored timeout would look exactly like "the lock was never contended";
  //  - it changes no data, so a workspace that cannot set it still starts.
  if (dbUrl.startsWith("file:")) {
    await sqlite.execute(`PRAGMA busy_timeout = ${sqliteBusyTimeoutMs}`);
    const answered = await sqlite.execute(`PRAGMA busy_timeout`);
    const applied = Number(Object.values(answered.rows[0] ?? {})[0]);
    if (applied !== sqliteBusyTimeoutMs) {
      console.warn(
        `[db] busy_timeout: asked for ${sqliteBusyTimeoutMs}ms, the database reports ${applied}.`,
      );
    }
  }

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
    `CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      keywords_json TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      content_item_id TEXT,
      research_material_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS brands (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      target_audience TEXT NOT NULL DEFAULT '',
      tone TEXT NOT NULL DEFAULT '',
      keywords_json TEXT NOT NULL DEFAULT '[]',
      banned_words_json TEXT NOT NULL DEFAULT '[]',
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
    // CI-P3-01. The processing state is a column of its own because none of the existing material
    // stores can express it: see `docs/coolpilot-capability-integration-plan.md` §附录 B-8.
    `CREATE TABLE IF NOT EXISTS research_materials (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      status_message TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      fetched_at INTEGER,
      transcript_json TEXT NOT NULL DEFAULT '',
      extraction_json TEXT NOT NULL DEFAULT '',
      extraction_history_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS knowledge_embeddings (
      id TEXT PRIMARY KEY,
      knowledge_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunking_version TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      chunk_hash TEXT NOT NULL DEFAULT '',
      source_hash TEXT NOT NULL DEFAULT '',
      provider_id TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '',
      dimensions INTEGER NOT NULL DEFAULT 0,
      vector_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    // Recall reads one record's chunks; the task reads every row of a record the same way.
    `CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_knowledge ON knowledge_embeddings(knowledge_id, chunk_index)`,
    // "Which records have vectors for this model" is the question the state column and the task both ask.
    `CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_model ON knowledge_embeddings(model_id, dimensions)`,
    // The stable id is per record, chunk *and model* (D4): a rebuild with another model keeps the previous
    // model's rows beside the new ones instead of overwriting them.
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_embeddings_stable_id ON knowledge_embeddings(knowledge_id, chunk_index, provider_id, model_id)`,
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

    // CI-LEAD-01: 营销线索与成交. The deal columns stay NULL until a deal is really recorded - an
    // amount nobody entered is "not recorded", never 0 - and `deal_currency` is `''` exactly while
    // `deal_amount_minor` is NULL, so a stored number always carries its unit.
    `CREATE TABLE IF NOT EXISTS marketing_leads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      source_platform TEXT NOT NULL DEFAULT '',
      content_item_id TEXT,
      publish_record_id TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      note TEXT NOT NULL DEFAULT '',
      deal_amount_minor INTEGER,
      deal_currency TEXT NOT NULL DEFAULT '',
      deal_closed_at INTEGER,
      deal_note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_marketing_leads_created ON marketing_leads(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_marketing_leads_status_created ON marketing_leads(status, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_marketing_leads_content ON marketing_leads(content_item_id)`,

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
    // CI-P7-01: the AI usage ledger. One row per model attempt, including the attempts that
    // failed and the retries that preceded a winner - neither of which `usage_records` can hold,
    // because that table is written from a route's success branch.
    //
    // `cost_amount` is nullable on purpose: NULL means "no figure can be claimed", and the writer
    // is forbidden from storing 0 as a stand-in for it. `cost_source` names which of the four
    // states the row is in, so a reader never has to guess whether a number is real.
    `CREATE TABLE IF NOT EXISTS ai_usage_ledger (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT 'success',
      provider_id TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '',
      endpoint_id TEXT NOT NULL DEFAULT '',
      credential_label TEXT NOT NULL DEFAULT '',
      attempt_index INTEGER NOT NULL DEFAULT 0,
      task_id TEXT NOT NULL DEFAULT '',
      run_id TEXT NOT NULL DEFAULT '',
      node_id TEXT NOT NULL DEFAULT '',
      parent_usage_id TEXT NOT NULL DEFAULT '',
      output_asset_id TEXT NOT NULL DEFAULT '',
      content_item_id TEXT NOT NULL DEFAULT '',
      metered_kind TEXT NOT NULL DEFAULT 'text',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      completeness TEXT NOT NULL DEFAULT 'unknown',
      quantity_json TEXT NOT NULL DEFAULT '{}',
      cost_amount REAL,
      cost_currency TEXT NOT NULL DEFAULT '',
      cost_source TEXT NOT NULL DEFAULT 'unknown',
      pricing_json TEXT NOT NULL DEFAULT 'null',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    // CI-P7-01: the price catalog. Never edited in place - a new row with a later `effective_from`
    // supersedes an old one, which is what keeps a ledger row's cost restatable only from its own
    // frozen snapshot.
    //
    // CI-P7-01-05: a price row prices exactly one `metered_kind`. The token columns cover the
    // kinds billed per million tokens; `unit_price` + `unit_label` cover the rest, so an image or
    // a second of video is not forced into a token column it was never billed in.
    `CREATE TABLE IF NOT EXISTS ai_model_prices (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL DEFAULT '*',
      metered_kind TEXT NOT NULL DEFAULT 'text',
      currency TEXT NOT NULL DEFAULT 'CNY',
      input_per_million REAL NOT NULL DEFAULT 0,
      output_per_million REAL NOT NULL DEFAULT 0,
      cached_input_per_million REAL,
      unit_price REAL,
      unit_label TEXT NOT NULL DEFAULT '',
      declared_free INTEGER NOT NULL DEFAULT 0,
      price_version TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      effective_from INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_created ON ai_usage_ledger(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_task_created ON ai_usage_ledger(task_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_model_created ON ai_usage_ledger(model_id, created_at)`,
    // CI-P7-03-A: the budget holds that used to live in one process's memory. `held` rows are the
    // ones that count against a period; the status and the period+currency pair are what every read
    // and the admission statement filter on, so both are indexed.
    `CREATE TABLE IF NOT EXISTS ai_budget_reservations (
      id TEXT PRIMARY KEY,
      period_key TEXT NOT NULL,
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      policy TEXT NOT NULL DEFAULT '',
      estimate_kind TEXT NOT NULL DEFAULT '',
      estimate_method TEXT NOT NULL DEFAULT '',
      purpose TEXT NOT NULL DEFAULT '',
      metered_kind TEXT NOT NULL DEFAULT 'text',
      provider_id TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '',
      route_resolved INTEGER NOT NULL DEFAULT 0,
      run_id TEXT NOT NULL DEFAULT '',
      node_id TEXT NOT NULL DEFAULT '',
      task_id TEXT NOT NULL DEFAULT '',
      content_item_id TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'held',
      settle_kind TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      settled_at INTEGER,
      updated_at INTEGER NOT NULL
    )`,
    // CI-P7-03-A: what the gate decided, refusals included. Amounts are NULL when nobody stated one
    // (`limit_amount`, `remaining_amount`), matching the ledger's rule that an unstated figure is
    // never stored as 0.
    `CREATE TABLE IF NOT EXISTS ai_budget_decisions (
      id TEXT PRIMARY KEY,
      at INTEGER NOT NULL,
      gate TEXT NOT NULL,
      status TEXT NOT NULL,
      reasons_json TEXT NOT NULL DEFAULT '[]',
      policy TEXT NOT NULL DEFAULT '',
      unknown_cost_policy TEXT NOT NULL DEFAULT '',
      enforcement TEXT NOT NULL DEFAULT '',
      period_key TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT '',
      limit_amount REAL,
      spent_amount REAL NOT NULL DEFAULT 0,
      spent_is_complete INTEGER NOT NULL DEFAULT 1,
      spent_truncated INTEGER NOT NULL DEFAULT 0,
      reserved_amount REAL NOT NULL DEFAULT 0,
      remaining_amount REAL,
      projected_min REAL,
      projected_max REAL,
      certainty TEXT NOT NULL DEFAULT '',
      estimate_kind TEXT NOT NULL DEFAULT '',
      estimate_method TEXT NOT NULL DEFAULT '',
      estimate_notes_json TEXT NOT NULL DEFAULT '[]',
      estimate_amount_min REAL,
      estimate_amount_max REAL,
      purpose TEXT NOT NULL DEFAULT '',
      run_id TEXT NOT NULL DEFAULT '',
      node_id TEXT NOT NULL DEFAULT '',
      task_id TEXT NOT NULL DEFAULT '',
      content_item_id TEXT NOT NULL DEFAULT '',
      provider_id TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '',
      route_resolved INTEGER NOT NULL DEFAULT 0,
      reservation_id TEXT NOT NULL DEFAULT '',
      reservation_amount REAL,
      reservation_currency TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ai_budget_reservations_live ON ai_budget_reservations(status, period_key, currency, expires_at)`,
    // Per run and per step, which is how the reconciliation reads them.
    `CREATE INDEX IF NOT EXISTS idx_ai_budget_reservations_run ON ai_budget_reservations(run_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_budget_reservations_node ON ai_budget_reservations(node_id, created_at)`,
    // Retention pruning walks this column, and so does "what did the gate decide around then".
    `CREATE INDEX IF NOT EXISTS idx_ai_budget_reservations_created ON ai_budget_reservations(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_budget_decisions_at ON ai_budget_decisions(at)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_budget_decisions_period ON ai_budget_decisions(period_key, at)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_budget_decisions_reservation ON ai_budget_decisions(reservation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_budget_decisions_run ON ai_budget_decisions(run_id, at)`,
  ];

  // Domain rename: migrate a legacy `sites` table to `accounts` (see
  // `renameLegacyAccountsTable` below) and rename the related `site_id` /
  // `site_name` columns. Best-effort; no-ops on fresh databases.
  await renameLegacyAccountsTable();
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
  // CI-P3-02: what a transcription run recorded about the material it produced (source file, engine,
  // segments). Additive and defaulted, so every existing material row keeps meaning exactly what it did.
  await sqlite.execute(`ALTER TABLE research_materials ADD COLUMN transcript_json TEXT NOT NULL DEFAULT ''`).catch(() => undefined);
  // CI-P3-03: the distilled result and the versions it replaced. Additive and defaulted like the
  // transcript column above, so every existing material keeps meaning exactly what it did.
  await sqlite.execute(`ALTER TABLE research_materials ADD COLUMN extraction_json TEXT NOT NULL DEFAULT ''`).catch(() => undefined);
  await sqlite.execute(`ALTER TABLE research_materials ADD COLUMN extraction_history_json TEXT NOT NULL DEFAULT '[]'`).catch(() => undefined);
  // CI-P3-03: which material a topic's idea came from. Empty means "the user's own idea", which is every
  // topic that existed before this column.
  await sqlite.execute(`ALTER TABLE topics ADD COLUMN research_material_id TEXT NOT NULL DEFAULT ''`).catch(() => undefined);
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

  // CI-P7-03-A: the ledger row's link to the budget hold it was admitted under. Additive and
  // defaulted to `''`, so every row written before this column keeps meaning exactly what it did -
  // "this call was not gated", which is true of all of them.
  await sqlite
    .execute(`ALTER TABLE ai_usage_ledger ADD COLUMN budget_reservation_id TEXT NOT NULL DEFAULT ''`)
    .catch(() => undefined);
  // Only after the ALTER above: an index on a column that does not exist yet is an error, not a no-op.
  await sqlite
    .execute(
      `CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_budget_reservation ON ai_usage_ledger(budget_reservation_id)`,
    )
    .catch(() => undefined);

  // CI-P7-05-03: the Marketplace extension a call ran as. Additive and defaulted to `''`, so every
  // row written before this column existed keeps meaning exactly what it did - "this call is not a
  // Marketplace extension call", which is true of all of them.
  await sqlite
    .execute(`ALTER TABLE ai_usage_ledger ADD COLUMN extension_id TEXT NOT NULL DEFAULT ''`)
    .catch(() => undefined);
  // Only after the ALTER above, for the same reason as the index before it.
  await sqlite
    .execute(
      `CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_extension_created ON ai_usage_ledger(extension_id, created_at)`,
    )
    .catch(() => undefined);

  // CI-P7-01-05. Guarded rather than `.catch(() => undefined)`-swallowed: a price index that
  // silently kept its old shape would let two dimensions collide on one key and nobody would ever
  // see it. This reports what it did, and what it could not do (see the function below).
  const priceCatalog = await migrateAiModelPriceCatalog();
  if (priceCatalog.addedColumns.length > 0 || priceCatalog.droppedIndexes.length > 0 || priceCatalog.indexRebuilt) {
    console.log(
      `[db] ai_model_prices: ${priceCatalog.addedColumns.length} column(s) added, ` +
        `${priceCatalog.droppedIndexes.length} index(es) replaced, ` +
        `${priceCatalog.indexRebuilt ? `${priceCatalog.index} rebuilt` : "index unchanged"}.`,
    );
  }

  // Runs last on purpose: by now `accounts` has every column this build declares, so a
  // legacy table that predates one of them still migrates with all of its own columns.
  await absorbLegacyAccountRows();
}

/**
 * P5-B0-1. The accounts table was called `sites` before the domain rename, and real
 * workspaces still hold accounts in it.
 *
 * The migration this replaced was one best-effort `ALTER TABLE sites RENAME TO accounts`
 * wrapped in `.catch(() => undefined)`. SQLite answers `table accounts already exists`
 * the moment `accounts` is present as well, so the rename no-opped, the error was
 * swallowed, and those accounts stayed invisible to every reader in the app - the file
 * backup included, since it walks the drizzle schema and a `sites` table is no part of
 * it. The user's own accounts were left in a table nothing reads.
 *
 * The work is therefore two guarded steps rather than one ignored statement: the rename,
 * which runs only when there is genuinely nothing to merge into, and the copy, which runs
 * after the column migrations so a legacy table that predates a column still fills every
 * column it has. Both are no-ops on a workspace that never had the table.
 */
const LEGACY_ACCOUNTS_TABLE = "sites";
const ACCOUNTS_TABLE = "accounts";

/** Which of the two account tables this workspace has. */
async function accountTables() {
  const result = await sqlite.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?)`,
    args: [LEGACY_ACCOUNTS_TABLE, ACCOUNTS_TABLE],
  });
  return new Set(result.rows.map((row) => String(row.name)));
}

async function tableColumns(table: string) {
  const result = await sqlite.execute({
    sql: `SELECT name FROM pragma_table_info(?)`,
    args: [table],
  });
  return result.rows.map((row) => String(row.name));
}

async function rowCount(table: string) {
  const result = await sqlite.execute(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)}`);
  return Number(result.rows[0]?.total ?? 0);
}

/** The rename half of P5-B0-1: a workspace that only ever had `sites` keeps its rows. */
async function renameLegacyAccountsTable() {
  const tables = await accountTables();
  if (!tables.has(LEGACY_ACCOUNTS_TABLE) || tables.has(ACCOUNTS_TABLE)) return;
  // Not best-effort: a rename that fails here would hide the user's accounts again.
  await sqlite.execute(
    `ALTER TABLE ${quoteIdentifier(LEGACY_ACCOUNTS_TABLE)} RENAME TO ${quoteIdentifier(ACCOUNTS_TABLE)}`,
  );
}

/**
 * The half of P5-B0-1 the rename could never reach: `accounts` exists next to a legacy
 * table that still holds rows.
 *
 * Rows are copied by column name, so a legacy table from before a column was added simply
 * leaves that column at its default, and `INSERT OR IGNORE` keeps the row the app already
 * shows whenever both tables describe the same id. A legacy row is deleted only once it is
 * readable in `accounts`, so a partial copy cannot lose anything, and whatever is left over
 * is reported instead of being dropped by a migration that cannot tell what it is.
 */
async function absorbLegacyAccountRows() {
  const tables = await accountTables();
  if (!tables.has(LEGACY_ACCOUNTS_TABLE)) return;

  const destination = new Set(await tableColumns(ACCOUNTS_TABLE));
  const shared = (await tableColumns(LEGACY_ACCOUNTS_TABLE)).filter((column) =>
    destination.has(column),
  );
  // A table of that name holding something else is not this migration's business.
  if (!shared.includes("id")) return;

  const columns = shared.map(quoteIdentifier).join(", ");
  const source = quoteIdentifier(LEGACY_ACCOUNTS_TABLE);
  const target = quoteIdentifier(ACCOUNTS_TABLE);

  const before = await rowCount(ACCOUNTS_TABLE);
  await sqlite.execute(`INSERT OR IGNORE INTO ${target} (${columns}) SELECT ${columns} FROM ${source}`);
  await sqlite.execute(`DELETE FROM ${source} WHERE id IN (SELECT id FROM ${target})`);

  const moved = (await rowCount(ACCOUNTS_TABLE)) - before;
  const left = await rowCount(LEGACY_ACCOUNTS_TABLE);
  if (moved > 0) {
    console.log(`[db] Moved ${moved} account(s) out of the legacy ${LEGACY_ACCOUNTS_TABLE} table.`);
  }
  if (left > 0) {
    console.warn(
      `[db] ${left} row(s) in the legacy ${LEGACY_ACCOUNTS_TABLE} table could not be read as accounts.`,
    );
  }
}

// ---------------------------------------------------------------------------
// CI-P7-01-05: the price catalog's key gained a billing dimension
// ---------------------------------------------------------------------------

/** The unique key this build wants on the price catalog: one price per dimension per instant. */
export const AI_MODEL_PRICE_INDEX = "idx_ai_model_prices_scope_kind_effective";
/** The key CI-P7-01 shipped, which cannot tell two dimensions apart. */
const LEGACY_AI_MODEL_PRICE_INDEX = "idx_ai_model_prices_scope_effective";
const AI_MODEL_PRICE_INDEX_COLUMNS = ["provider_id", "model_id", "metered_kind", "effective_from"];

/** Columns CI-P7-01-05 adds; `text` is what every row written before it means. */
const AI_MODEL_PRICE_ADDED_COLUMNS: Array<[string, string]> = [
  ["metered_kind", "TEXT NOT NULL DEFAULT 'text'"],
  ["unit_price", "REAL"],
  ["unit_label", "TEXT NOT NULL DEFAULT ''"],
  ["declared_free", "INTEGER NOT NULL DEFAULT 0"],
];

/** One group of rows the new key cannot tell apart. */
export type AiModelPriceDuplicateKey = {
  providerId: string;
  modelId: string;
  meteredKind: string;
  effectiveFrom: number;
  rows: number;
};

/** What the price-catalog migration did, so a caller (or a test) can see the outcome. */
export type AiModelPriceMigrationReport = {
  /** Columns added to a table that predates them; empty on a database this build created. */
  addedColumns: string[];
  index: string;
  /** True when the unique key now covers the dimension. */
  indexRebuilt: boolean;
  droppedIndexes: string[];
  /** Non-empty when the rebuild was refused because these keys collide. */
  duplicateKeys: AiModelPriceDuplicateKey[];
  /** The SQLite message when the index could not be created at all. */
  error: string | null;
};

/** Why the guard exists: two prices in force at one instant are a bug a key should catch. */
function duplicateKeyWarning(key: AiModelPriceDuplicateKey) {
  return `${key.providerId}/${key.modelId}/${key.meteredKind}@${key.effectiveFrom} (${key.rows} rows)`;
}

/** Every index on a table, with the key columns each one covers, in key order. */
async function tableIndexes(table: string) {
  const listed = await sqlite.execute({
    sql: `SELECT name, "unique" AS is_unique FROM pragma_index_list(?)`,
    args: [table],
  });
  const indexes: Array<{ name: string; unique: boolean; columns: string[] }> = [];
  for (const row of listed.rows) {
    const name = String(row.name);
    const info = await sqlite.execute({
      sql: `SELECT name FROM pragma_index_info(?) ORDER BY seqno`,
      args: [name],
    });
    indexes.push({
      name,
      unique: Number(row.is_unique ?? 0) === 1,
      columns: info.rows.map((column) => String(column.name)),
    });
  }
  return indexes;
}

/** Rows the new key would reject, read before anything is dropped. */
async function duplicateAiModelPriceKeys() {
  const result = await sqlite.execute(
    `SELECT provider_id, model_id, metered_kind, effective_from, COUNT(*) AS rows
       FROM ${quoteIdentifier("ai_model_prices")}
      GROUP BY provider_id, model_id, metered_kind, effective_from
     HAVING COUNT(*) > 1`,
  );
  return result.rows.map((row) => ({
    providerId: String(row.provider_id),
    modelId: String(row.model_id),
    meteredKind: String(row.metered_kind),
    effectiveFrom: Number(row.effective_from),
    rows: Number(row.rows),
  }));
}

/**
 * Brings the price catalog up to CI-P7-01-05: a row gains a `metered_kind`, and the unique key
 * gains the same dimension so a text price and an image price for one model can coexist.
 *
 * The work is ordered so the catalog is never left unguarded, and every outcome is named:
 *
 * 1. **Columns first**, each one only when it is actually missing (`pragma_table_info`), so there
 *    is no "duplicate column" error to swallow.
 * 2. **The existing keys are read before anything is touched** (`pragma_index_list` /
 *    `pragma_index_info`), because a rebuild that guesses is how a workspace ends up with an index
 *    nobody meant to create.
 * 3. **Rows that would collide are looked for first.** The new key is strictly weaker than the old
 *    one for `text` rows, so a collision means something outside this build wrote the table; in
 *    that case the old key is kept and the offending rows are printed rather than resolved by
 *    silently dropping one of two competing prices.
 * 4. **The new key is created before the old one is dropped**, so a failure leaves the previous
 *    guarantee in place instead of an unguarded table. The failure is returned *and* logged: a
 *    `.catch(() => undefined)` here would hide exactly the case this card is about.
 *
 * Idempotent: a database that already carries the key reports `indexRebuilt: false` and does
 * nothing.
 */
export async function migrateAiModelPriceCatalog(): Promise<AiModelPriceMigrationReport> {
  const report: AiModelPriceMigrationReport = {
    addedColumns: [],
    index: AI_MODEL_PRICE_INDEX,
    indexRebuilt: false,
    droppedIndexes: [],
    duplicateKeys: [],
    error: null,
  };

  const columns = new Set(await tableColumns("ai_model_prices"));
  for (const [column, definition] of AI_MODEL_PRICE_ADDED_COLUMNS) {
    if (columns.has(column)) continue;
    await sqlite.execute(`ALTER TABLE ai_model_prices ADD COLUMN ${quoteIdentifier(column)} ${definition}`);
    report.addedColumns.push(column);
  }

  // Compared as multisets: uniqueness does not depend on the order a key lists its columns, and
  // this way a SQLite that answers `index_info` in another order is not mistaken for a key that
  // needs rebuilding.
  const wanted = [...AI_MODEL_PRICE_INDEX_COLUMNS].sort().join(",");
  const indexes = await tableIndexes("ai_model_prices");
  const wantedIndex = indexes.find((entry) => entry.name === AI_MODEL_PRICE_INDEX);
  const wantedIsInPlace =
    Boolean(wantedIndex?.unique) && [...(wantedIndex?.columns ?? [])].sort().join(",") === wanted;

  if (wantedIsInPlace) {
    // The key is already right; the one it replaced is then only dead weight.
    if (indexes.some((entry) => entry.name === LEGACY_AI_MODEL_PRICE_INDEX)) {
      await sqlite.execute(`DROP INDEX IF EXISTS ${quoteIdentifier(LEGACY_AI_MODEL_PRICE_INDEX)}`);
      report.droppedIndexes.push(LEGACY_AI_MODEL_PRICE_INDEX);
    }
    return report;
  }

  const duplicates = await duplicateAiModelPriceKeys();
  if (duplicates.length > 0) {
    report.duplicateKeys = duplicates;
    console.error(
      `[db] ai_model_prices holds ${duplicates.length} key(s) that collide once metered_kind is part ` +
        `of the key: ${duplicates.map(duplicateKeyWarning).join(", ")}. ` +
        `The previous index was kept and ${AI_MODEL_PRICE_INDEX} was not created.`,
    );
    return report;
  }

  // A key under this name covering something else is this build's own older attempt: it has to go
  // before the correct one can be created, and the key it replaced is still guarding the table.
  if (wantedIndex) {
    await sqlite.execute(`DROP INDEX IF EXISTS ${quoteIdentifier(AI_MODEL_PRICE_INDEX)}`);
    report.droppedIndexes.push(AI_MODEL_PRICE_INDEX);
  }

  try {
    await sqlite.execute(
      `CREATE UNIQUE INDEX ${quoteIdentifier(AI_MODEL_PRICE_INDEX)} ` +
        `ON ${quoteIdentifier("ai_model_prices")} (${AI_MODEL_PRICE_INDEX_COLUMNS.join(", ")})`,
    );
    report.indexRebuilt = true;
  } catch (error) {
    // Named, not swallowed: a reader of the log can tell which statement failed and why, and the
    // report carries the same message to a test.
    report.error = error instanceof Error ? error.message : String(error);
    console.error(
      `[db] Could not create ${AI_MODEL_PRICE_INDEX}: ${report.error}. ` +
        `The previous key is still in force; two prices for different dimensions cannot coexist until this is resolved.`,
    );
    return report;
  }

  if (indexes.some((entry) => entry.name === LEGACY_AI_MODEL_PRICE_INDEX)) {
    await sqlite.execute(`DROP INDEX IF EXISTS ${quoteIdentifier(LEGACY_AI_MODEL_PRICE_INDEX)}`);
    report.droppedIndexes.push(LEGACY_AI_MODEL_PRICE_INDEX);
  }

  return report;
}
