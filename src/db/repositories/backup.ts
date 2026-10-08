import { getTableColumns, getTableName, isTable, type Table } from "drizzle-orm";
import { ensureDatabase, sqlite } from "@/db/client";
import * as schema from "@/db/schema";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  normalizeBackupCell,
  quoteIdentifier,
  type BackupCell,
  type BackupRestoreMode,
  type BackupRestoreReport,
  type BackupSnapshot,
  type BackupTableRows,
  type BackupTableSummary,
} from "@/lib/backup";
import { PRODUCT_SHORT_NAME } from "@/lib/product-branding";

export type BackupTableDescriptor = {
  name: string;
  columns: string[];
};

/**
 * Every exported drizzle table, discovered from the schema module so a new table
 * is backed up automatically (see the coverage assertion in `backup.test.ts`).
 */
function collectTables(): Table[] {
  const tables: Table[] = [];
  for (const value of Object.values(schema)) {
    if (isTable(value)) tables.push(value);
  }
  return tables;
}

export function backupTableDescriptors(): BackupTableDescriptor[] {
  return collectTables()
    .map((table) => ({
      name: getTableName(table),
      columns: Object.values(getTableColumns(table)).map((column) => column.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Row counts per table, used by the 系统 / 备份 overview card. */
export async function backupTableCounts(): Promise<BackupTableSummary[]> {
  await ensureDatabase();
  const summaries: BackupTableSummary[] = [];
  for (const descriptor of backupTableDescriptors()) {
    const result = await sqlite.execute(
      `SELECT COUNT(*) AS total FROM ${quoteIdentifier(descriptor.name)}`,
    );
    summaries.push({ name: descriptor.name, rows: Number(result.rows[0]?.total ?? 0) });
  }
  return summaries;
}

/**
 * Reads every table into a single serializable snapshot. Columns come from the
 * drizzle schema, so the file stays aligned with the current build.
 */
export async function createBackupSnapshot(): Promise<BackupSnapshot> {
  await ensureDatabase();
  const tables: BackupTableRows = {};

  for (const descriptor of backupTableDescriptors()) {
    const result = await sqlite.execute(`SELECT * FROM ${quoteIdentifier(descriptor.name)}`);
    tables[descriptor.name] = result.rows.map((row) => {
      const entry: Record<string, BackupCell> = {};
      for (const column of descriptor.columns) {
        entry[column] = normalizeBackupCell(row[column]);
      }
      return entry;
    });
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    app: PRODUCT_SHORT_NAME,
    tables,
  };
}

/**
 * Writes a snapshot back into the local database inside one transaction.
 *
 * - `replace` clears the backed-up tables first: the workspace becomes an exact
 *   copy of the file.
 * - `merge` keeps existing rows and ignores rows whose primary key already
 *   exists.
 *
 * Tables missing from the file are never touched, and columns unknown to this
 * build are dropped rather than failing the whole restore.
 */
export async function restoreBackupSnapshot(
  snapshot: BackupSnapshot,
  mode: BackupRestoreMode = "replace",
): Promise<BackupRestoreReport> {
  await ensureDatabase();
  const descriptors = new Map(
    backupTableDescriptors().map((descriptor) => [descriptor.name, descriptor]),
  );
  const report: BackupRestoreReport = {
    mode,
    restoredAt: Date.now(),
    totalRows: 0,
    tables: {},
    unknownTables: [],
  };

  const transaction = await sqlite.transaction("write");
  try {
    for (const [name, rows] of Object.entries(snapshot.tables)) {
      const descriptor = descriptors.get(name);
      if (!descriptor) {
        report.unknownTables.push(name);
        continue;
      }

      const allowed = new Set(descriptor.columns);
      let deleted = 0;
      if (mode === "replace") {
        const cleared = await transaction.execute(`DELETE FROM ${quoteIdentifier(name)}`);
        deleted = Number(cleared.rowsAffected ?? 0);
      }

      let inserted = 0;
      let skipped = 0;
      for (const row of rows) {
        const columns = Object.keys(row).filter((column) => allowed.has(column));
        if (columns.length === 0) {
          skipped += 1;
          continue;
        }

        const values = columns.map((column) => normalizeBackupCell(row[column]));
        const statement = `${mode === "merge" ? "INSERT OR IGNORE" : "INSERT"} INTO ${quoteIdentifier(name)} (${columns
          .map(quoteIdentifier)
          .join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
        const result = await transaction.execute({ sql: statement, args: values });
        // In merge mode `INSERT OR IGNORE` reports 0 affected rows for an existing id,
        // so the report distinguishes real inserts from skipped duplicates.
        if (Number(result.rowsAffected ?? 0) > 0) inserted += 1;
        else skipped += 1;
      }

      report.tables[name] = { deleted, inserted, skipped };
      report.totalRows += inserted;
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  } finally {
    transaction.close();
  }

  return report;
}
