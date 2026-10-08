import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { getLocalAgentSettings } from "@/db/repositories/settings";
import { aiRuntime } from "@/features/ai-runtime";
import { AppError } from "@/lib/app-errors";
import { preferredImageProvider, withLegacyCompatibility } from "@/lib/ai/compat";
import { artifactsRoot } from "@/lib/paths";

/**
 * Image generation facade over `aiRuntime` (phase P2 of `docs/generate-migration.md`, G3).
 *
 * The split is deliberate: the runtime owns *how* the image is produced (provider, endpoint,
 * model, key rotation, failover), this module owns *where it lands* (artifacts directory,
 * file naming) - exactly the boundary a model layer must not cross.
 */

const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function extensionFor(mimeType: string) {
  return imageExtensions[mimeType.toLowerCase()] ?? "png";
}

async function writeBase64Image(base64: string, extension = "png") {
  const outDir = artifactsRoot();
  await fs.mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, `agent-image-${Date.now()}-${nanoid(8)}.${extension}`);
  await fs.writeFile(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

export async function generateImageFile(input: { prompt: string; provider?: "gemini" | "openai" }) {
  const settings = await getLocalAgentSettings().catch(() => null);
  // The legacy `provider` argument (or `settings.imageProvider`) was a hard choice: the old
  // code never fell over to the other image provider, so this stays a pin, not a preference.
  const providerId = await preferredImageProvider(input.provider);
  const response = await withLegacyCompatibility({
    providerIds: async () => [providerId],
    namedProvider: async () => providerId,
    run: () =>
      aiRuntime.generateImage({
        prompt: input.prompt,
        providerId,
        size: settings?.openAIImageSize,
      }),
  });

  const [image] = response.images;
  if (!image?.base64) {
    throw new AppError("MODEL_UPSTREAM_NO_CONTENT", {
      status: 502,
      message: `${response.providerId} returned no image data`,
      details: { providerId: response.providerId, model: response.model },
    });
  }

  return {
    provider: response.providerId,
    model: response.model,
    path: await writeBase64Image(image.base64, extensionFor(image.mimeType)),
  };
}

