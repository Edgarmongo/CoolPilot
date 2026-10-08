import { restoreBackupSnapshot } from "@/db/repositories/backup";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { BACKUP_MAX_RESTORE_BYTES, BACKUP_VERSION, backupRestoreRequestSchema } from "@/lib/backup";

export const runtime = "nodejs";

/**
 * Restores a JSON backup produced by `/api/backup/export`.
 *
 * The body is `{ mode, snapshot }`: the UI reads and validates the picked file
 * with `parseBackupDocument` so a malformed file never reaches the database, and
 * the server re-validates it here before writing anything.
 */
export async function POST(request: Request) {
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > BACKUP_MAX_RESTORE_BYTES) {
    return fail("INVALID_PAYLOAD", 413, { reason: "too_large", limit: BACKUP_MAX_RESTORE_BYTES });
  }

  const parsed = await parseJson(request, backupRestoreRequestSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }

  const { mode, snapshot } = parsed.data;
  if (snapshot.version > BACKUP_VERSION) {
    return fail("INVALID_PAYLOAD", 400, {
      reason: "unsupported_version",
      supported: BACKUP_VERSION,
      received: snapshot.version,
    });
  }

  try {
    return ok(await restoreBackupSnapshot(snapshot, mode));
  } catch (error) {
    return failFromError(error);
  }
}
