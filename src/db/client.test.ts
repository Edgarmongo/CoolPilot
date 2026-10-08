import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * P5-B0-1: `sites` was the name of the accounts table before the domain rename, and
 * real workspaces still hold accounts in it. The migration that exists today is a
 * single best-effort `ALTER TABLE sites RENAME TO accounts` wrapped in
 * `.catch(() => undefined)`: SQLite rejects it with `table accounts already exists`
 * as soon as `accounts` is present as well, so those accounts stay invisible to
 * every reader in the app - including the backup export, which walks the drizzle
 * schema and therefore never sees a table the schema does not declare.
 *
 * These tests describe what the user owns rather than which statement runs. After
 * the migration, every account that lived in `sites` is readable through the app's
 * own `listAccounts()`, `sites` holds no user data, nothing is duplicated, and the
 * whole thing survives a second run.
 *
 * `@/db/client` reads the database URL when it is first imported and initialises a
 * file exactly once per process, so every scenario builds its own file and reloads
 * the module instead of sharing one module instance.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), "coolpilot-db-client-"));
const previousDbUrl = process.env.SOCIAL_AUTO_POST_DB_URL;
const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;
/** Every `@/db/client` instance this file loaded, so the connections can be released. */
const openedClients: Client[] = [];

/** Keeps `dataRoot()` - and with it the checkout's real `web-data` - out of the test. */
process.env.SOCIAL_AUTO_POST_DATA_DIR = tempDir;

afterAll(async () => {
  // The app never closes its own connection; the test has to, or Windows refuses to
  // remove a file a live SQLite handle still points at.
  for (const client of openedClients) await client.close();
  if (previousDataDir === undefined) delete process.env.SOCIAL_AUTO_POST_DATA_DIR;
  else process.env.SOCIAL_AUTO_POST_DATA_DIR = previousDataDir;
  if (previousDbUrl === undefined) delete process.env.SOCIAL_AUTO_POST_DB_URL;
  else process.env.SOCIAL_AUTO_POST_DB_URL = previousDbUrl;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // A throwaway folder the OS reclaims on its own, like the other temp databases here.
  }
});

/** The accounts table as this build declares it. */
const ACCOUNTS_DDL = `CREATE TABLE accounts (
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
)`;

/**
 * The table a pre-rename install created. `preset_json` arrived through an `ALTER
 * TABLE sites ADD COLUMN`, so the oldest workspaces have the narrow shape.
 */
function legacySitesDdl({ presetJson = true }: { presetJson?: boolean } = {}) {
  const columns = [
    "id TEXT PRIMARY KEY",
    "name TEXT NOT NULL",
    "platform TEXT NOT NULL",
    "url TEXT NOT NULL DEFAULT ''",
    "account TEXT NOT NULL DEFAULT ''",
    "profile_path TEXT NOT NULL DEFAULT ''",
    "memo TEXT NOT NULL DEFAULT ''",
    "status TEXT NOT NULL DEFAULT 'needs_login'",
    "created_at INTEGER NOT NULL",
    "updated_at INTEGER NOT NULL",
  ];
  if (presetJson) columns.push("preset_json TEXT NOT NULL DEFAULT '{}'");
  return `CREATE TABLE sites (${columns.join(", ")})`;
}

type AccountRow = {
  id: string;
  name: string;
  platform: string;
  profilePath: string;
  status: string;
  createdAt: number;
  updatedAt: number;
};

/** The three accounts of the audited workspace, verbatim apart from a synthetic profile root. */
const ORPHANED_ACCOUNTS: AccountRow[] = [
  {
    id: "Th2nOn6cCFEo6Ia8zGkyn",
    name: "CoolSkyAI编程",
    platform: "小红书",
    profilePath: "C:/profiles/Th2nOn6cCFEo6Ia8zGkyn",
    status: "active",
    createdAt: 1791276524345,
    updatedAt: 1791320341672,
  },
  {
    id: "dsaTU2MY7vc6mqW-39RdG",
    name: "头条号",
    platform: "头条号",
    profilePath: "C:/profiles/dsaTU2MY7vc6mqW-39RdG",
    status: "active",
    createdAt: 1791288330953,
    updatedAt: 1791288369586,
  },
  {
    id: "HDHLMbTj3gqnd8n2PnlwN",
    name: "知乎",
    platform: "知乎",
    profilePath: "C:/profiles/HDHLMbTj3gqnd8n2PnlwN",
    status: "active",
    createdAt: 1791348775258,
    updatedAt: 1791348812464,
  },
];

/** The two accounts the same workspace can already see in `accounts`. */
const VISIBLE_ACCOUNTS: AccountRow[] = [
  {
    id: "7P_OM6lD6c2h2EJF61Tg4",
    name: "知乎",
    platform: "知乎",
    profilePath: "C:/profiles/7P_OM6lD6c2h2EJF61Tg4",
    status: "active",
    createdAt: 1791385381896,
    updatedAt: 1791391090931,
  },
  {
    id: "2DBn4yM2Ks5InocOoN333",
    name: "头条号",
    platform: "头条号",
    profilePath: "C:/profiles/2DBn4yM2Ks5InocOoN333",
    status: "active",
    createdAt: 1791413117505,
    updatedAt: 1791413137786,
  },
];

function fileUrl(fileName: string) {
  return `file:${path.join(tempDir, fileName).replace(/\\/g, "/")}`;
}

/** Points the client at `fileName`, then loads it fresh so its migrations run for this test alone. */
async function openDatabase(fileName: string) {
  process.env.SOCIAL_AUTO_POST_DB_URL = fileUrl(fileName);
  vi.resetModules();
  const client = await import("@/db/client");
  openedClients.push(client.sqlite);
  return client;
}

async function insertRows(
  connection: Client,
  table: "accounts" | "sites",
  rows: AccountRow[],
  { presetJson = true }: { presetJson?: boolean } = {},
) {
  for (const row of rows) {
    const columns = ["id", "name", "platform", "url", "account", "profile_path", "memo", "status"];
    const values: Array<string | number> = [
      row.id,
      row.name,
      row.platform,
      "",
      "",
      row.profilePath,
      "",
      row.status,
    ];
    if (presetJson) {
      columns.push("preset_json");
      values.push("{}");
    }
    columns.push("created_at", "updated_at");
    values.push(row.createdAt, row.updatedAt);

    await connection.execute({
      sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      args: values,
    });
  }
}

type Seed = {
  accounts?: AccountRow[];
  sites?: AccountRow[];
  /** `false` writes the oldest shape, the one from before `preset_json` was added. */
  sitesPresetJson?: boolean;
};

/** Writes a workspace the way an older build left it, before this build is ever imported. */
async function seedFile(fileName: string, seed: Seed) {
  const connection = createClient({ url: fileUrl(fileName) });
  try {
    if (seed.accounts) {
      await connection.execute(ACCOUNTS_DDL);
      await insertRows(connection, "accounts", seed.accounts);
    }
    if (seed.sites) {
      const presetJson = seed.sitesPresetJson ?? true;
      await connection.execute(legacySitesDdl({ presetJson }));
      await insertRows(connection, "sites", seed.sites, { presetJson });
    }
  } finally {
    connection.close();
  }
}

async function tableNames(connection: Client) {
  const result = await connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
  return result.rows.map((row) => String(row.name));
}

async function accountRows(connection: Client) {
  const result = await connection.execute(
    "SELECT id, name, platform, profile_path, status, preset_json FROM accounts",
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    platform: String(row.platform),
    profilePath: String(row.profile_path),
    status: String(row.status),
    presetJson: String(row.preset_json),
  }));
}

/**
 * The invariant the old migration broke: an account the user created must not be
 * left sitting in a table the app stopped reading. Counted this way - rather than
 * by asserting the table is gone - so dropping `sites` later stays a free choice.
 */
async function rowsLeftInSites(connection: Client) {
  if (!(await tableNames(connection)).includes("sites")) return 0;
  const result = await connection.execute("SELECT * FROM sites");
  return result.rows.length;
}

function sortedIds(rows: Array<{ id: string }>) {
  return rows.map((row) => row.id).sort();
}

describe("legacy sites table migration", () => {
  it("leaves a workspace that never had the legacy table alone", async () => {
    await seedFile("fresh.db", {});
    const { sqlite, ensureDatabase } = await openDatabase("fresh.db");
    await ensureDatabase();

    expect(await tableNames(sqlite)).toContain("accounts");
    expect(await accountRows(sqlite)).toHaveLength(0);
    expect(await rowsLeftInSites(sqlite)).toBe(0);
  });

  it("renames the legacy table when there is no accounts table to merge into", async () => {
    await seedFile("rename.db", { sites: ORPHANED_ACCOUNTS });
    const { sqlite, ensureDatabase } = await openDatabase("rename.db");
    await ensureDatabase();

    expect(await tableNames(sqlite)).not.toContain("sites");
    const rows = await accountRows(sqlite);
    expect(sortedIds(rows)).toEqual(sortedIds(ORPHANED_ACCOUNTS));
    expect(rows.find((row) => row.id === "Th2nOn6cCFEo6Ia8zGkyn")).toMatchObject({
      name: "CoolSkyAI编程",
      platform: "小红书",
      profilePath: "C:/profiles/Th2nOn6cCFEo6Ia8zGkyn",
      status: "active",
    });
  });

  it("moves accounts stranded in the legacy table into an accounts table that exists", async () => {
    await seedFile("merge.db", { accounts: VISIBLE_ACCOUNTS, sites: ORPHANED_ACCOUNTS });
    const { sqlite, ensureDatabase } = await openDatabase("merge.db");
    await ensureDatabase();

    const expected = sortedIds([...VISIBLE_ACCOUNTS, ...ORPHANED_ACCOUNTS]);
    const rows = await accountRows(sqlite);
    expect(sortedIds(rows)).toEqual(expected);
    expect(rows.find((row) => row.id === "Th2nOn6cCFEo6Ia8zGkyn")?.name).toBe("CoolSkyAI编程");
    expect(await rowsLeftInSites(sqlite)).toBe(0);

    // The app's own read path is what "the user still owns these accounts" means.
    const repository = await import("@/db/repository");
    const visible = await repository.listAccounts();
    expect(sortedIds(visible)).toEqual(expected);
    expect(visible.map((account) => account.name)).toContain("CoolSkyAI编程");
  });

  it("keeps one row when both tables describe the same account id", async () => {
    const shared = ORPHANED_ACCOUNTS[2];
    await seedFile("conflict.db", {
      accounts: [{ ...shared, name: "知乎 (kept)", updatedAt: shared.updatedAt + 1 }],
      sites: ORPHANED_ACCOUNTS,
    });
    const { sqlite, ensureDatabase } = await openDatabase("conflict.db");
    await ensureDatabase();

    const rows = await accountRows(sqlite);
    const matches = rows.filter((row) => row.id === shared.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.name).toBe("知乎 (kept)");
    expect(sortedIds(rows)).toEqual(sortedIds(ORPHANED_ACCOUNTS));
    expect(await rowsLeftInSites(sqlite)).toBe(0);
  });

  it("fills the default of a column the legacy table predates", async () => {
    await seedFile("narrow.db", {
      accounts: VISIBLE_ACCOUNTS,
      sites: ORPHANED_ACCOUNTS,
      sitesPresetJson: false,
    });
    const { sqlite, ensureDatabase } = await openDatabase("narrow.db");
    await ensureDatabase();

    const migrated = (await accountRows(sqlite)).find((row) => row.id === "Th2nOn6cCFEo6Ia8zGkyn");
    expect(migrated).toMatchObject({ name: "CoolSkyAI编程", presetJson: "{}" });
    expect(await rowsLeftInSites(sqlite)).toBe(0);
  });

  it("changes nothing when the migration runs again", async () => {
    await seedFile("repeat.db", { accounts: VISIBLE_ACCOUNTS, sites: ORPHANED_ACCOUNTS });
    const first = await openDatabase("repeat.db");
    await first.ensureDatabase();
    await first.ensureDatabase();
    const afterFirstRun = sortedIds(await accountRows(first.sqlite));

    // A later launch of the same install loads the module again against the same file.
    const second = await openDatabase("repeat.db");
    await second.ensureDatabase();

    expect(sortedIds(await accountRows(second.sqlite))).toEqual(afterFirstRun);
    expect(await rowsLeftInSites(second.sqlite)).toBe(0);
  });
});
