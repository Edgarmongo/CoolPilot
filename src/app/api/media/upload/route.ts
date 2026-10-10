import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { fail, ok } from "@/lib/api";
import {
  MAX_MEDIA_BYTES,
  MEDIA_FILE_PREFIX,
  MEDIA_SOURCE_EXTENSIONS,
  isTranscriptionSourceName,
  mediaFileUrl,
  mediaFileExtension,
  transcriptionSourceKind,
} from "@/lib/media-library";
import { ensureMediaRoot } from "@/lib/paths";

export const runtime = "nodejs";

/**
 * Imports one audio or video file into the workspace's `media/` section (CI-P3-02).
 *
 * The route decides three things and nothing else: the file is a media file this build can read
 * (`isTranscriptionSourceName`), it is not larger than `MAX_MEDIA_BYTES`, and it is not empty. Every
 * decision is made **before** a byte lands, so a refused import leaves the section exactly as it was -
 * no half file, no empty directory (the write below is what initializes `media/`, P5-B0-2.5).
 *
 * The stored name is `media-<timestamp>-<random><ext>`, which is the prefix `@/lib/media-artifact-ref`
 * reads to answer `source: "uploaded"`; the user's own file name is not stored, because a name is not
 * provenance and a user-supplied name is not a safe path component.
 *
 * The address comes back as a workspace URL (`/api/media?file=`), never as a filesystem path: nothing
 * this route answers can be turned into "read an arbitrary file on this machine".
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("INVALID_PAYLOAD", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("INVALID_PAYLOAD", 400);
  if (!isTranscriptionSourceName(file.name)) {
    return fail("UNSUPPORTED_MEDIA", 400, { accepted: MEDIA_SOURCE_EXTENSIONS });
  }
  if (file.size <= 0) return fail("INVALID_PAYLOAD", 400);
  if (file.size > MAX_MEDIA_BYTES) return fail("MEDIA_TOO_LARGE", 413, { maxBytes: MAX_MEDIA_BYTES });

  const extension = mediaFileExtension(file.name);
  const createdAt = Date.now();
  const fileName = `${MEDIA_FILE_PREFIX}${createdAt}-${nanoid(8)}${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(ensureMediaRoot(), fileName), buffer);
  return ok(
    {
      fileName,
      url: mediaFileUrl(fileName),
      size: buffer.length,
      createdAt,
      kind: transcriptionSourceKind(fileName),
    },
    { status: 201 },
  );
}
