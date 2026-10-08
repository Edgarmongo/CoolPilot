import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getTableName, isTable } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  LEGACY_BACKUP_FORMATS,
  backupFileName,
  countBackupRows,
  normalizeBackupCell,
  parseBackupDocument,
  quoteIdentifier,
  summarizeBackupTables,
  type BackupSnapshot,
} from "@/lib/backup";

function snapshotOf(tables: BackupSnapshot["tables"]) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: "2026-10-08T00:00:00.000Z",
    app: "CoolPilot",
    tables,
  });
}

describe("backup format", () => {
  it("quotes safe identifiers and rejects anything else", () => {
    expect(quoteIdentifier("accounts")).toBe('"accounts"');
    expect(quoteIdentifier("publish_records")).toBe('"publish_records"');
    expect(() => quoteIdentifier("accounts; DROP TABLE accounts")).toThrow();
    expect(() => quoteIdentifier('weird"name')).toThrow();
    expect(() => quoteIdentifier("1table")).toThrow();
  });

  it("builds sortable file names", () => {
    expect(backupFileName(new Date(2026, 9, 8, 15, 30))).toBe("coolpilot-backup-20261008-1530.json");
    expect(backupFileName("not-a-date")).toMatch(/^coolpilot-backup-\d{8}-\d{4}\.json$/);
  });

  it("normalizes exotic SQLite values to JSON scalars", () => {
    expect(normalizeBackupCell(undefined)).toBeNull();
    expect(normalizeBackupCell(true)).toBe(true);
    expect(normalizeBackupCell(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeBackupCell(BigInt(12))).toBe(12);
    expect(normalizeBackupCell(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("summarizes tables by row count", () => {
    const tables = { runs: [{ id: "b" }], accounts: [{ id: "1" }, { id: "2" }], empty: [] };
    expect(summarizeBackupTables(tables).map((table) => table.name)).toEqual([
      "accounts",
      "runs",
      "empty",
    ]);
    expect(countBackupRows(tables)).toBe(3);
  });

  it("parses a document and flags the failure reasons", () => {
    expect(parseBackupDocument("{ nope").ok).toBe(false);
    expect(parseBackupDocument("[1,2,3]").ok).toBe(false);

    const newer = JSON.parse(snapshotOf({ accounts: [] })) as Record<string, unknown>;
    newer.version = BACKUP_VERSION + 1;
    expect(parseBackupDocument(JSON.stringify(newer))).toEqual({
      ok: false,
      reason: "unsupported_version",
    });

    const parsed = parseBackupDocument(snapshotOf({ accounts: [{ id: "a", name: "Meow" }] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.snapshot.tables.accounts).toEqual([{ id: "a", name: "Meow" }]);
      expect(parsed.snapshot.app).toBe("CoolPilot");
    }
  });

  it("still restores a backup exported under the previous product name", () => {
    const legacy = JSON.parse(snapshotOf({ accounts: [{ id: "a" }] })) as Record<string, unknown>;
    legacy.format = LEGACY_BACKUP_FORMATS[0];
    legacy.app = "Meowus";

    const parsed = parseBackupDocument(JSON.stringify(legacy));

    expect(parsed.ok).toBe(true);
    // Parsed documents always report the current format, whatever the file said.
    if (parsed.ok) {
      expect(parsed.snapshot.format).toBe(BACKUP_FORMAT);
      expect(parsed.snapshot.tables.accounts).toEqual([{ id: "a" }]);
    }
  });
});

/**
 * The round trip needs a throwaway SQLite file, and `@/db/client` reads the DB
 * URL when it is first imported, so the modules are loaded after the env var is
 * pointed at the temp folder.
 */
const tempDir = mkdtempSync(path.join(tmpdir(), "coolpilot-backup-"));
const previousUrl = process.env.SOCIAL_AUTO_POST_DB_URL;
let repo: typeof import("@/db/repository");
let settingsRepo: typeof import("@/db/repositories/settings");
let backupRepo: typeof import("@/db/repositories/backup");
let schemaTableNames: string[] = [];

beforeAll(async () => {
  process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(tempDir, "backup.db").replace(/\\/g, "/")}`;
  repo = await import("@/db/repository");
  settingsRepo = await import("@/db/repositories/settings");
  backupRepo = await import("@/db/repositories/backup");
  // listAccounts triggers initializeDatabase(), which runs the migrations.
  await repo.listAccounts();
  schemaTableNames = [];
  for (const value of Object.values(schema)) {
    if (isTable(value)) schemaTableNames.push(getTableName(value));
  }
});

afterAll(() => {
  if (previousUrl === undefined) {
    delete process.env.SOCIAL_AUTO_POST_DB_URL;
  } else {
    process.env.SOCIAL_AUTO_POST_DB_URL = previousUrl;
  }
});

describe("backup repository", () => {
  it("covers every table declared in the database schema", () => {
    expect(backupRepo.backupTableDescriptors().map((descriptor) => descriptor.name)).toEqual(
      schemaTableNames.sort(),
    );
  });

  it("round-trips a workspace through export and restore", async () => {
    const account = await repo.createAccount({ name: "Meow", platform: "小红书", status: "active" });
    await settingsRepo.updatePromptSettings({ systemPrompt: "hello workspace" });

    const snapshot = await backupRepo.createBackupSnapshot();
    expect(snapshot.format).toBe(BACKUP_FORMAT);
    expect(snapshot.version).toBe(BACKUP_VERSION);
    expect(snapshot.tables.accounts).toHaveLength(1);
    expect(snapshot.tables.accounts[0]).toMatchObject({
      name: "Meow",
      platform: "小红书",
      status: "active",
    });
    expect(snapshot.tables.app_settings?.length).toBeGreaterThan(0);

    const counts = await backupRepo.backupTableCounts();
    expect(counts.map((table) => table.name)).toEqual(
      backupRepo.backupTableDescriptors().map((descriptor) => descriptor.name),
    );
    expect(counts.find((table) => table.name === "accounts")?.rows).toBe(1);

    // Wipe local state so the replace restore has something to rebuild.
    await repo.deleteAccount(account!.id);
    await settingsRepo.updatePromptSettings({ systemPrompt: "changed" });
    expect(await repo.listAccounts()).toHaveLength(0);

    const replaceReport = await backupRepo.restoreBackupSnapshot(snapshot, "replace");
    expect(replaceReport.mode).toBe("replace");
    expect(replaceReport.unknownTables).toEqual([]);
    expect(replaceReport.tables.accounts.inserted).toBe(1);
    expect(replaceReport.totalRows).toBeGreaterThan(0);

    const restored = await repo.listAccounts();
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ id: account!.id, name: "Meow", status: "active" });
    expect((await settingsRepo.getPromptSettings()).systemPrompt).toBe("hello workspace");

    // Merging the same file again must not duplicate rows.
    const mergeReport = await backupRepo.restoreBackupSnapshot(snapshot, "merge");
    expect(mergeReport.tables.accounts).toEqual({ deleted: 0, inserted: 0, skipped: 1 });
    expect(await repo.listAccounts()).toHaveLength(1);
  });
});

