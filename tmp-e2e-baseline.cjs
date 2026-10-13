/* eslint-disable @typescript-eslint/no-require-imports -- 临时取证脚本：Node CommonJS 入口只能用 require */

/**
 * CI-P1-05 (集中式端到端验证) 基线快照工具 —— 只读，不写业务数据。
 *
 * 用途：按「先记录基线，再运行写操作」的规则，在每次 E2E 阶段前后取同一组指纹。
 * 用法：node tmp-e2e-baseline.cjs <label>   （label 例：stage1 / e2e01-before / e2e01-after）
 * 输出：stdout JSON（人可读摘要）+ 追加写入 tmp-e2e-baseline-<label>.json
 *
 * 注意：不打开任何写事务；不修改 web-data；仅 SELECT 与目录枚举。
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@libsql/client");
const { execFileSync } = require("node:child_process");

const ROOT = __dirname;
const DB_FILE = path.join(ROOT, "web-data", "social-auto-post.db");
const DATA_DIR = path.join(ROOT, "web-data");

// 与 E2E-01/02/03/04 直接相关的表（先按名枚举；不存在的表记 null，便于发现真实表名变化）。
const FOCUS_TABLES = [
  "content_items",
  "content_assets",
  "publish_records",
  "publish_logs",
  "runs",
  "run_events",
  "schedules",
  "accounts",
  "ai_models",
  "ai_model_capabilities",
  "agent_runtime_runs",
  "agent_sessions",
  "products",
  "knowledge_items",
  "uploaded_files",
  "metrics_snapshots",
];

function countFiles(dir) {
  if (!fs.existsSync(dir)) return null;
  let count = 0;
  let bytes = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        count += 1;
        bytes += fs.statSync(full).size;
      }
    }
  };
  walk(dir);
  return { count, bytes };
}

function statFile(file) {
  if (!fs.existsSync(file)) return null;
  const s = fs.statSync(file);
  return { bytes: s.size, mtime: s.mtime.toISOString() };
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function tableCount(client, table) {
  try {
    const r = await client.execute(`select count(*) as n from ${table}`);
    return Number(r.rows[0].n);
  } catch {
    return null; // 表不存在
  }
}

async function grouped(client, sql) {
  try {
    const r = await client.execute(sql);
    return r.rows.map((row) => JSON.parse(JSON.stringify(row)));
  } catch {
    return null;
  }
}

async function hasColumn(client, table, column) {
  try {
    const r = await client.execute(`pragma table_info(${table})`);
    return r.rows.some((row) => String(row.name) === column);
  } catch {
    return false;
  }
}

async function columnNames(client, table) {
  try {
    const r = await client.execute(`pragma table_info(${table})`);
    return r.rows.map((row) => String(row.name));
  } catch {
    return null;
  }
}

async function main() {
  const label = process.argv[2] || "snapshot";
  const client = createClient({ url: `file:${path.relative(ROOT, DB_FILE).replace(/\\/g, "/")}` });

  // 1) 全表清单 + 行数（用真实表名，避免"我以为是这张表"）
  const allTables = (
    await client.execute("select name from sqlite_master where type='table' order by name")
  ).rows.map((row) => String(row.name));
  const allTableCounts = {};
  for (const table of allTables) allTableCounts[table] = await tableCount(client, table);

  // 2) 关注表（含 null，便于发现名字对不上）
  const tables = {};
  for (const table of FOCUS_TABLES) tables[table] = allTableCounts[table] ?? null;

  // 3) 与 E2E 四块直接相关的分组（列不存在则不臆造）
  const runsByPlaybook = (await hasColumn(client, "runs", "playbook_id"))
    ? await grouped(
        client,
        "select playbook_id, status, count(*) as n from runs group by playbook_id, status order by playbook_id, status",
      )
    : null;
  const contentByStatus = (await hasColumn(client, "content_items", "status"))
    ? await grouped(
        client,
        "select status, count(*) as n from content_items group by status order by status",
      )
    : null;
  const contentByType = (await hasColumn(client, "content_items", "type"))
    ? await grouped(
        client,
        "select type, count(*) as n from content_items group by type order by type",
      )
    : null;
  const publishByStatus = (await hasColumn(client, "publish_records", "status"))
    ? await grouped(
        client,
        "select status, count(*) as n from publish_records group by status order by status",
      )
    : null;
  const publishByPlatform = (await hasColumn(client, "publish_records", "platform"))
    ? await grouped(
        client,
        "select platform, status, count(*) as n from publish_records group by platform, status order by platform, status",
      )
    : null;

  const snapshot = {
    label,
    at: new Date().toISOString(),
    git: {
      head: git(["rev-parse", "--short", "HEAD"]),
      changedEntries: (git(["status", "--porcelain"]) || "").split("\n").filter(Boolean).length,
    },
    db: { file: path.relative(ROOT, DB_FILE), ...statFile(DB_FILE) },
    tableCount: allTables.length,
    tables,
    allTableCounts,
    schemas: {
      content_items: await columnNames(client, "content_items"),
      publish_records: await columnNames(client, "publish_records"),
      publish_logs: await columnNames(client, "publish_logs"),
      runs: await columnNames(client, "runs"),
      run_events: await columnNames(client, "run_events"),
      accounts: await columnNames(client, "accounts"),
    },
    contentByType,
    contentByStatus,
    runsByPlaybook,
    publishByStatus,
    publishByPlatform,
    files: {
      artifacts: countFiles(path.join(DATA_DIR, "artifacts")),
      videos: countFiles(path.join(DATA_DIR, "videos")),
      uploads: countFiles(path.join(DATA_DIR, "uploads")),
      browserProfilesDirs: fs.existsSync(path.join(DATA_DIR, "browser-profiles"))
        ? fs.readdirSync(path.join(DATA_DIR, "browser-profiles")).length
        : null,
    },
    dataDirTopLevel: fs.existsSync(DATA_DIR)
      ? fs
          .readdirSync(DATA_DIR, { withFileTypes: true })
          .map((e) => `${e.isDirectory() ? "d" : "f"}:${e.name}`)
          .sort()
      : null,
  };

  const out = path.join(ROOT, `tmp-e2e-baseline-${label}.json`);
  fs.writeFileSync(out, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(JSON.stringify(snapshot, null, 2));
  console.log(`\n[written] ${path.basename(out)}`);
}

main().catch((error) => {
  console.error("ERR", error);
  process.exitCode = 1;
});
