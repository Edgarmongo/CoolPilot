import path from "node:path";
import { generateImageFile } from "@/lib/agent/image-generation";
import { fail, ok, parseJson } from "@/lib/api";
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
    return fail(error instanceof Error ? error.message : "Image generation failed", 500);
  }
}

/** Removes the selected images from the library. */
export async function DELETE(request: Request) {
  const parsed = await parseJson(request, imageDeleteSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const deleted = await deleteArtifactImageFiles(parsed.data.fileNames);
  return ok({ deleted });
}

