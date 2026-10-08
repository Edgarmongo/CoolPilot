import { createBackupSnapshot } from "@/db/repositories/backup";
import { backupFileName } from "@/lib/backup";

export const runtime = "nodejs";

/**
 * Local data portability: downloads every local table as one JSON file so the
 * user owns their workspace. Nothing ever leaves the device.
 */
export async function GET() {
  const snapshot = await createBackupSnapshot();
  const body = JSON.stringify(snapshot, null, 2);

  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${backupFileName(snapshot.createdAt)}"`,
      "Content-Length": String(Buffer.byteLength(body)),
      "Cache-Control": "no-store",
    },
  });
}
