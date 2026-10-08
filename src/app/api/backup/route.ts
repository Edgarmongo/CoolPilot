import { backupTableCounts } from "@/db/repositories/backup";
import { ok } from "@/lib/api";
import { BACKUP_FORMAT, BACKUP_VERSION } from "@/lib/backup";
import { resolveAppDataDir } from "@/lib/runtime-config";

export const runtime = "nodejs";

/**
 * Overview for 系统 / 备份: what is stored locally and how much of it. Used by the
 * settings card; the actual download lives at `/api/backup/export`.
 */
export async function GET() {
  const tables = await backupTableCounts();

  return ok({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    dataDir: resolveAppDataDir(),
    tables,
    tableCount: tables.length,
    totalRows: tables.reduce((total, table) => total + table.rows, 0),
  });
}
