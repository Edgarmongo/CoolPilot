import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { getLocalAgentSettings } from "@/db/repositories/settings";
import { aiRuntime } from "@/features/ai-runtime";
import { AppError } from "@/lib/app-errors";
import { ensureArtifactsRoot } from "@/lib/paths";

/**
 * Image generation facade over `aiRuntime` (phase P2 of `docs/generate-migration.md`, G3; cut off the
 * legacy compat shim in P3-B-3).
 *
 * The split is deliberate: the runtime owns *how* the image is produced (provider, endpoint,
 * model, key rotation, failover), this module owns *where it lands* (artifacts directory,
 * file naming) - exactly the boundary a model layer must not cross.
 *
 * P3-B-3 removed the last legacy edge on this path (`image-generation.ts -> lib/ai/compat.ts`), so two
 * compensations the shim used to apply here are gone by design, not by regression:
 *
 *  - A keyless (or key-revoked) install reads the runtime's own routing sentence - `No model is
 *    configured for this request`, `No configured model has a usable credential for this request` -
 *    where the shim used to answer `Missing openai API key` / `MissingAIKeyError`.
 *  - A pinned provider whose catalog was never synced is simply not routable. The shim ran one bounded
 *    discovery pass inside the failed request (read `/models`, enable what it found, route again); that
 *    cold-start job belongs to the seed (`ensureModelRuntimeSeeded`, D-P3-1), which runs it for every
 *    provider that already holds a key - so a request never syncs anything.
 *
 * What the cut did *not* change is the product decision underneath: the provider (`input.provider`, else
 * `settings.imageProvider`, else `openai`) is a hard pin, passed to the runtime as `providerId`, so the
 * candidate chain is one provider wide (D-P3-2, G3).
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
  // Landing the file is the write that initializes the section: resolving a path no longer creates
  // the directory it points at (P5-B0-2.5).
  const outDir = ensureArtifactsRoot();
  const filePath = path.join(outDir, `agent-image-${Date.now()}-${nanoid(8)}.${extension}`);
  await fs.writeFile(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

export async function generateImageFile(input: { prompt: string; provider?: "gemini" | "openai" }) {
  const settings = await getLocalAgentSettings().catch(() => null);
  // The legacy `provider` argument (or `settings.imageProvider`) was a hard choice: the old
  // code never fell over to the other image provider, so this stays a pin, not a preference.
  const providerId = input.provider ?? settings?.imageProvider ?? "openai";
  const response = await aiRuntime.generateImage({
    prompt: input.prompt,
    providerId,
    size: settings?.openAIImageSize,
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

