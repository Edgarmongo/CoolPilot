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

// ---------------------------------------------------------------------------
// CI-P7-01-05: the price catalog's key gained a billing dimension
// ---------------------------------------------------------------------------

/** The table CI-P7-01 shipped: no `metered_kind`, no per-unit price, no free declaration. */
const LEGACY_PRICE_DDL = `CREATE TABLE ai_model_prices (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT '*',
  currency TEXT NOT NULL DEFAULT 'CNY',
  input_per_million REAL NOT NULL DEFAULT 0,
  output_per_million REAL NOT NULL DEFAULT 0,
  cached_input_per_million REAL,
  price_version TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  effective_from INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
)`;

const LEGACY_PRICE_INDEX = "idx_ai_model_prices_scope_effective";

type LegacyPriceRow = {
  id: string;
  providerId: string;
  modelId: string;
  inputPerMillion: number;
  outputPerMillion: number;
  priceVersion: string;
  effectiveFrom: number;
};

/**
 * Writes a price catalog the way an older build left it, before this build is ever imported.
 *
 * `legacyIndex: false` writes the shape two rows of the same provider, model and instant fit into -
 * which is not something this build can produce, and is exactly why the migration checks before it
 * rebuilds anything.
 */
async function seedLegacyPriceCatalog(
  fileName: string,
  rows: LegacyPriceRow[],
  { legacyIndex = true }: { legacyIndex?: boolean } = {},
) {
  const connection = createClient({ url: fileUrl(fileName) });
  try {
    await connection.execute(LEGACY_PRICE_DDL);
    if (legacyIndex) {
      await connection.execute(
        `CREATE UNIQUE INDEX ${LEGACY_PRICE_INDEX} ON ai_model_prices(provider_id, model_id, effective_from)`,
      );
    }
    for (const row of rows) {
      await connection.execute({
        sql: `INSERT INTO ai_model_prices
                (id, provider_id, model_id, currency, input_per_million, output_per_million, price_version, effective_from, created_at)
              VALUES (?, ?, ?, 'CNY', ?, ?, ?, ?, ?)`,
        args: [
          row.id,
          row.providerId,
          row.modelId,
          row.inputPerMillion,
          row.outputPerMillion,
          row.priceVersion,
          row.effectiveFrom,
          row.effectiveFrom,
        ],
      });
    }
  } finally {
    connection.close();
  }
}

async function columnNames(connection: Client, table: string) {
  const result = await connection.execute({ sql: `SELECT name FROM pragma_table_info(?)`, args: [table] });
  return result.rows.map((row) => String(row.name));
}

async function indexNames(connection: Client, table: string) {
  const result = await connection.execute({ sql: `SELECT name FROM pragma_index_list(?)`, args: [table] });
  return result.rows.map((row) => String(row.name));
}

async function indexColumns(connection: Client, index: string) {
  const result = await connection.execute({
    sql: `SELECT name FROM pragma_index_info(?) ORDER BY seqno`,
    args: [index],
  });
  return result.rows.map((row) => String(row.name)).sort();
}

/**
 * The migration is the part of a price catalog a working form cannot demonstrate: a workspace
 * written by the previous build has no `metered_kind` column, and a key that cannot tell a text
 * price from an image price. What matters is not which statements run but what the workspace can do
 * afterwards - read every price it had, hold one price per dimension at one instant, refuse a
 * genuine duplicate - and what it says when it cannot get there.
 */
describe("price catalog migration", () => {
  const legacyDeepseek: LegacyPriceRow = {
    id: "legacy-1",
    providerId: "deepseek",
    modelId: "deepseek-chat",
    inputPerMillion: 2,
    outputPerMillion: 8,
    priceVersion: "2026-01",
    effectiveFrom: 1_700_000_000_000,
  };

  it("reads a catalog written before the dimension existed and gives it the key this build wants", async () => {
    await seedLegacyPriceCatalog("price-legacy.db", [legacyDeepseek]);

    const { sqlite, ensureDatabase, AI_MODEL_PRICE_INDEX } = await openDatabase("price-legacy.db");
    await ensureDatabase();

    // Every row written before the column existed means `text`, and a workspace must not lose it.
    const repository = await import("@/db/repositories/ai-usage-ledger");
    const rows = await repository.listAiModelPrices();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      meteredKind: "text",
      inputPerMillion: 2,
      outputPerMillion: 8,
      priceVersion: "2026-01",
      unitLabel: "",
      declaredFree: false,
    });

    const columns = await columnNames(sqlite, "ai_model_prices");
    expect(columns).toEqual(
      expect.arrayContaining(["metered_kind", "unit_price", "unit_label", "declared_free"]),
    );

    // The key now covers the dimension, and the key it replaced is gone rather than left behind.
    expect(await indexColumns(sqlite, AI_MODEL_PRICE_INDEX)).toEqual([
      "effective_from",
      "metered_kind",
      "model_id",
      "provider_id",
    ]);
    expect(await indexNames(sqlite, "ai_model_prices")).not.toContain(LEGACY_PRICE_INDEX);
  });

  it("holds one price per dimension from one instant once migrated, and still refuses a duplicate", async () => {
    const { effectiveFrom } = legacyDeepseek;
    await seedLegacyPriceCatalog("price-dimensions.db", [legacyDeepseek]);

    const { ensureDatabase } = await openDatabase("price-dimensions.db");
    await ensureDatabase();
    const repository = await import("@/db/repositories/ai-usage-ledger");

    // The row the legacy build wrote is the text price at that instant; an image price for the very
    // same provider, model and instant is a different row, not a collision.
    await repository.createAiModelPrice({
      providerId: "deepseek",
      modelId: "deepseek-chat",
      meteredKind: "image",
      currency: "USD",
      unitPrice: 0.04,
      unitLabel: "image",
      priceVersion: "2026-01",
      effectiveFrom,
    });
    const text = await repository.resolveModelPrice("deepseek", "deepseek-chat", effectiveFrom + 1, "text");
    const image = await repository.resolveModelPrice("deepseek", "deepseek-chat", effectiveFrom + 1, "image");
    expect(text?.priceVersion).toBe("2026-01");
    expect(image?.unitPrice).toBe(0.04);

    // A second text price at that same instant is still a duplicate, and still says so in words.
    await expect(
      repository.createAiModelPrice({
        providerId: "deepseek",
        modelId: "deepseek-chat",
        inputPerMillion: 3,
        outputPerMillion: 9,
        priceVersion: "2026-01b",
        effectiveFrom,
      }),
    ).rejects.toMatchObject({ code: "AI_PRICE_CONFLICT", status: 409 });
  });

  it("refuses to rebuild over rows it cannot tell apart, names them, and drops nothing", async () => {
    const effectiveFrom = 1_700_000_000_000;
    // Two rows a key that includes the dimension cannot tell apart. This build cannot write them,
    // so a table like this was written by something else - and the migration's job is to report
    // that rather than to pick a winner between two competing prices.
    await seedLegacyPriceCatalog(
      "price-duplicates.db",
      [
        { id: "dupe-1", providerId: "dupe", modelId: "m", inputPerMillion: 1, outputPerMillion: 1, priceVersion: "a", effectiveFrom },
        { id: "dupe-2", providerId: "dupe", modelId: "m", inputPerMillion: 2, outputPerMillion: 2, priceVersion: "b", effectiveFrom },
      ],
      { legacyIndex: false },
    );

    const { sqlite, migrateAiModelPriceCatalog, AI_MODEL_PRICE_INDEX } = await openDatabase(
      "price-duplicates.db",
    );
    const report = await migrateAiModelPriceCatalog();

    expect(report.indexRebuilt).toBe(false);
    expect(report.error).toBeNull();
    expect(report.duplicateKeys).toEqual([
      { providerId: "dupe", modelId: "m", meteredKind: "text", effectiveFrom, rows: 2 },
    ]);
    // A key that cannot be created is not replaced by one that pretends the rows are unique.
    expect(await indexNames(sqlite, "ai_model_prices")).not.toContain(AI_MODEL_PRICE_INDEX);

    // Nothing was dropped on the way to that answer: both rows are still there to be looked at.
    const repository = await import("@/db/repositories/ai-usage-ledger");
    expect(await repository.listAiModelPrices()).toHaveLength(2);
  });

  it("changes nothing when the catalog migration runs again", async () => {
    await seedLegacyPriceCatalog("price-repeat.db", [legacyDeepseek]);

    const { sqlite, ensureDatabase, migrateAiModelPriceCatalog, AI_MODEL_PRICE_INDEX } =
      await openDatabase("price-repeat.db");
    await ensureDatabase();
    const columnsAfterFirstRun = await columnNames(sqlite, "ai_model_prices");

    const again = await migrateAiModelPriceCatalog();
    expect(again).toMatchObject({ addedColumns: [], indexRebuilt: false, droppedIndexes: [], error: null });
    expect(await columnNames(sqlite, "ai_model_prices")).toEqual(columnsAfterFirstRun);
    expect(await indexColumns(sqlite, AI_MODEL_PRICE_INDEX)).toEqual([
      "effective_from",
      "metered_kind",
      "model_id",
      "provider_id",
    ]);
  });
});
