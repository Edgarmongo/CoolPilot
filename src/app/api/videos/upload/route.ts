import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { fail, ok } from "@/lib/api";
import { ensureVideosRoot } from "@/lib/paths";
import { MAX_VIDEO_BYTES, isVideoFileName, videoUrl } from "@/lib/video-library";

export const runtime = "nodejs";

/** Stores an uploaded video so the video composer can publish it later. */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("INVALID_PAYLOAD", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("INVALID_PAYLOAD", 400);
  if (!isVideoFileName(file.name)) return fail("UNSUPPORTED_VIDEO", 400);
  if (file.size <= 0) return fail("INVALID_PAYLOAD", 400);
  if (file.size > MAX_VIDEO_BYTES) return fail("VIDEO_TOO_LARGE", 413);

  const extension = path.extname(file.name).toLowerCase();
  const createdAt = Date.now();
  const fileName = `video-${createdAt}-${nanoid(8)}${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(ensureVideosRoot(), fileName), buffer);
  return ok({ fileName, url: videoUrl(fileName), size: buffer.length, createdAt }, { status: 201 });
}
