import { z } from "zod";

/**
 * Local-first backup format.
 *
 * A backup is one JSON document holding every row of every local table, so the
 * user can archive or move their workspace without any cloud service involved.
 * This module intentionally has no database imports: the file format, the
 * validation rules and the identifier escaping are pure functions so they can be
 * unit tested and shared by the export route, the restore route and the UI.
 */

export const BACKUP_FORMAT = "coolpilot-backup";
/**
 * Formats this build still restores. A file exported under the previous product name stays
 * importable, and `parseBackupDocument` rewrites it to `BACKUP_FORMAT` so callers only ever
 * see the current value.
 */
export const LEGACY_BACKUP_FORMATS = ["meowus-backup"] as const;
export const BACKUP_VERSION = 1;
/** Upload cap for `/api/backup/restore`; text-heavy workspaces stay well below this. */
export const BACKUP_MAX_RESTORE_BYTES = 64 * 1024 * 1024;

/** Every value kept in a backup is a JSON scalar; the schema has no blob columns. */
export type BackupCell = string | number | boolean | null;

export type BackupTableRows = Record<string, Array<Record<string, BackupCell>>>;

export type BackupSnapshot = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  /** Product that produced the file; informational only. */
  app: string;
  tables: BackupTableRows;
};

export type BackupRestoreMode = "replace" | "merge";

export type BackupTableSummary = {
  name: string;
  rows: number;
};

export type BackupTableReport = {
  /** Rows removed before importing (replace mode only). */
  deleted: number;
  /** Rows written from the backup. */
  inserted: number;
  /** Rows dropped because none of their columns exist in this build. */
  skipped: number;
};

export type BackupRestoreReport = {
  mode: BackupRestoreMode;
  restoredAt: number;
  totalRows: number;
  tables: Record<string, BackupTableReport>;
  /** Tables present in the file but unknown to this build. */
  unknownTables: string[];
};

const backupCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** Shape of a backup document as read from disk. Unknown tables are kept for reporting. */
export const backupSnapshotSchema = z.object({
  // A file written under the previous product name stays importable: the value is accepted and
  // normalised on read, so everything downstream only ever sees `BACKUP_FORMAT`.
  format: z.enum([BACKUP_FORMAT, ...LEGACY_BACKUP_FORMATS]).transform((): typeof BACKUP_FORMAT => BACKUP_FORMAT),
  version: z.number().int().min(1),
  createdAt: z.string(),
  app: z.string().optional().default(""),
  tables: z.record(z.string(), z.array(z.record(z.string(), backupCellSchema))),
});

/** POST body of `/api/backup/restore`. */
export const backupRestoreRequestSchema = z.object({
  mode: z.enum(["replace", "merge"]).optional().default("replace"),
  snapshot: backupSnapshotSchema,
});

export type BackupParseFailure = "invalid_json" | "invalid_document" | "unsupported_version";

export type BackupParseResult =
  | { ok: true; snapshot: BackupSnapshot }
  | { ok: false; reason: BackupParseFailure };

/**
 * Parses a downloaded backup file. Written as a result object (instead of
 * throwing) so the restore route can answer with a precise error code.
 */
export function parseBackupDocument(text: string): BackupParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  const result = backupSnapshotSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: "invalid_document" };
  }
  if (result.data.version > BACKUP_VERSION) {
    return { ok: false, reason: "unsupported_version" };
  }

  return {
    ok: true,
    snapshot: {
      format: BACKUP_FORMAT,
      version: result.data.version,
      createdAt: result.data.createdAt,
      app: result.data.app,
      tables: result.data.tables,
    },
  };
}

/** Converts a raw SQLite value into a JSON-safe backup cell. */
export function normalizeBackupCell(value: unknown): BackupCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  // Blobs and other exotic values are dropped instead of corrupting the file.
  return null;
}

/** Quotes a trusted identifier (table/column name) for raw SQL. */
export function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function summarizeBackupTables(tables: BackupTableRows): BackupTableSummary[] {
  return Object.entries(tables)
    .map(([name, rows]) => ({ name, rows: rows.length }))
    .sort((left, right) => right.rows - left.rows || left.name.localeCompare(right.name));
}

export function countBackupRows(tables: BackupTableRows) {
  return summarizeBackupTables(tables).reduce((total, table) => total + table.rows, 0);
}

/** `20261008-1530` — sortable, filename-safe and timezone-explicit. */
export function backupFileStamp(at: Date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`,
    `${pad(at.getHours())}${pad(at.getMinutes())}`,
  ].join("-");
}

export function backupFileName(at: Date | string | number = new Date()) {
  const date = at instanceof Date ? at : new Date(at);
  return `coolpilot-backup-${backupFileStamp(Number.isNaN(date.getTime()) ? new Date() : date)}.json`;
}
