import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { fail, ok } from "@/lib/api";
import { ensureArtifactsRoot } from "@/lib/paths";

export const runtime = "nodejs";

const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function imageUrl(fileName: string) {
  return `/api/agent/artifacts?file=${encodeURIComponent(fileName)}`;
}

/** Stores an uploaded image in the artifacts dir so the editor can insert it. */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("INVALID_PAYLOAD", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("EMPTY_UPLOAD", 400);

  const extension = path.extname(file.name).toLowerCase() || ".png";
  if (!allowedExtensions.has(extension)) return fail("UNSUPPORTED_IMAGE", 400);

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) return fail("EMPTY_UPLOAD", 400);

  const fileName = `upload-${Date.now()}-${nanoid(8)}${extension}`;
  await fs.writeFile(path.join(ensureArtifactsRoot(), fileName), buffer);
  return ok({ fileName, url: imageUrl(fileName) }, { status: 201 });
}
