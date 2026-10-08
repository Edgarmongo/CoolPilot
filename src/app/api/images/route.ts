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

