import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { ok } from "@/lib/api";
import { videosRoot } from "@/lib/paths";
import { isVideoFileName, videoContentType, videoUrl, type StoredVideo } from "@/lib/video-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lists the videos already uploaded into the local library, newest first. */
async function listStoredVideos(): Promise<StoredVideo[]> {
  const dir = videosRoot();
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const entries = await Promise.all(
    names.filter(isVideoFileName).map(async (fileName) => {
      const stats = await fs.stat(path.join(dir, fileName)).catch(() => null);
      if (!stats) return null;
      return { fileName, url: videoUrl(fileName), size: stats.size, createdAt: stats.mtimeMs };
    }),
  );
  return entries
    .filter((entry): entry is StoredVideo => entry !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function fileStream(filePath: string, start?: number, end?: number) {
  return Readable.toWeb(createReadStream(filePath, start === undefined ? {} : { start, end })) as ReadableStream;
}

/** Without `file` returns the library listing; with `file` streams that video. */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("file") ?? "";
  if (!requested) return ok({ videos: await listStoredVideos() });

  const fileName = path.basename(requested);
  if (fileName !== requested || !isVideoFileName(fileName)) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(videosRoot(), fileName);
  let size: number;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const contentType = videoContentType(fileName);
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
