import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { ok } from "@/lib/api";
import {
  isTranscriptionSourceName,
  mediaContentType,
  mediaFileUrl,
  transcriptionSourceKind,
  type StoredMediaSource,
} from "@/lib/media-library";
import { mediaRoot } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The storage route of the workspace's `media/` section (CI-P3-02 of
 * `docs/coolpilot-capability-integration-plan.md`).
 *
 *   GET /api/media                 -> { media: StoredMediaSource[] }   (newest first)
 *   GET /api/media?file=<basename> -> the bytes of that file, `Range` supported
 *
 * It is shaped exactly like `/api/videos` on purpose: a caller reads an imported talk the way it reads
 * any other media file of the workspace, and a browser can seek in it (`Range` -> 206) which is what
 * makes "play the file you are transcribing" possible without a download.
 *
 * Two rules:
 *
 * - **Reading never initializes.** `mediaRoot()` is resolved, not created (P5-B0-2.5), so asking for the
 *   library in a workspace that has none answers "nothing there" and leaves no empty section behind.
 * - **A name is checked twice.** `isTranscriptionSourceName()` decides the extension and
 *   `path.basename(name) === name` refuses a traversal, so `../credential-vault.json` and
 *   `media-1.mp3/../../x` both end as 404 without the root ever being left.
 *
 * A missing or unsupported file is a 404 rather than a 400: from the browser's point of view both are
 * "no such media here", and the listing - which carries a `url` per entry - is what tells the user
 * which names exist.
 */
async function listStoredMedia(): Promise<StoredMediaSource[]> {
  const dir = mediaRoot();
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const entries = await Promise.all(
    names.filter(isTranscriptionSourceName).map(async (fileName) => {
      const stats = await fs.stat(path.join(dir, fileName)).catch(() => null);
      if (!stats?.isFile()) return null;
      return {
        fileName,
        url: mediaFileUrl(fileName),
        size: stats.size,
        createdAt: stats.mtimeMs,
        kind: transcriptionSourceKind(fileName) as StoredMediaSource["kind"],
      };
    }),
  );
  return entries
    .filter((entry): entry is StoredMediaSource => entry !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function fileStream(filePath: string, start?: number, end?: number) {
  return Readable.toWeb(createReadStream(filePath, start === undefined ? {} : { start, end })) as ReadableStream;
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("file") ?? "";
  if (!requested) return ok({ media: await listStoredMedia() });

  const fileName = path.basename(requested);
  if (fileName !== requested || !isTranscriptionSourceName(fileName)) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(mediaRoot(), fileName);
  let size: number;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const contentType = mediaContentType(fileName);
  const range = request.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Number(range[2]) : size - 1;
    if (Number.isNaN(start) || start >= size || end < start) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const safeEnd = Math.min(end, size - 1);
    return new Response(fileStream(filePath, start, safeEnd), {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(safeEnd - start + 1),
        "Content-Range": `bytes ${start}-${safeEnd}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  return new Response(fileStream(filePath), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=300",
    },
  });
}
