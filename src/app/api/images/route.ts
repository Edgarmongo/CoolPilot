import path from "node:path";
import { generateImageFile } from "@/lib/agent/image-generation";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { artifactImageUrl } from "@/lib/artifact-image-url";
import { deleteArtifactImageFiles, listArtifactImageFiles } from "@/lib/image-library";
import { imageDeleteSchema, imageGenerateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const files = await listArtifactImageFiles();
  const images = files
    .map((file) => ({ fileName: file, url: artifactImageUrl(file) }))
    .sort((a, b) => b.fileName.localeCompare(a.fileName));
  return ok({ images });
}

/**
 * `POST` generates one image and files it as a library entry; `GET`/`DELETE` only read and prune the
 * artifacts directory, and never talk to a provider (batch P3-B-1 of `docs/generate-migration-p3.md`).
 *
 * The boundary this handler keeps - and the reason batch B needed no migration here: the route owns HTTP
 * (payload, status envelope, file name -> URL) and nothing else. `lib/agent/image-generation.ts` owns
 * *where* the image lands (artifacts directory, naming, extension), and `aiRuntime.generateImage()` owns
 * *how* it is produced (the provider pin, model resolution, key rotation, failover). No provider,
 * endpoint, key or model name belongs in this file.
 *
 * P3-C (D1-b) converged the error shape B-1 had frozen: a failure now leaves with the runtime's own code
 * *and* status instead of a flat 500 `UNKNOWN_ERROR`, so a client can tell "no credential is stored"
 * (400) from "the provider is down" (502) from "this provider has no image model" (409) without matching
 * on a sentence. The image path itself is unchanged: the pin, the model resolution, the settings the
 * domain service reads and the file it writes are all exactly what B-1 pinned.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, imageGenerateSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  try {
    const result = await generateImageFile({ prompt: parsed.data.prompt });
    const fileName = path.basename(result.path);
    return ok(
      { fileName, url: artifactImageUrl(fileName), provider: result.provider, model: result.model },
      { status: 201 },
    );
  } catch (error) {
    // D-P3-3 applied here by P3-C: the runtime decides the code *and* the HTTP status (`MODEL_CREDENTIAL_*`
    // 400/429, `MODEL_NOT_CONFIGURED` 503, `MODEL_CAPABILITY_UNAVAILABLE` 409, upstream/no-content 502), and
    // this route passes both on. `UNKNOWN_ERROR`/500 stays for a failure that carries no runtime code -
    // including this route's own `INVALID_PAYLOAD` guard, which returns before the call and never lands here.
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}

/** Removes the selected images from the library. */
export async function DELETE(request: Request) {
  const parsed = await parseJson(request, imageDeleteSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const deleted = await deleteArtifactImageFiles(parsed.data.fileNames);
  return ok({ deleted });
}

