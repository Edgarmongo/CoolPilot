import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { getLocalAgentSettings } from "@/db/repositories/settings";
import { imageProviderIdFor } from "@/features/ai-settings/provider-registry";
import { aiRuntime, type ImageGenerationResponse } from "@/features/ai-runtime";
import { AppError } from "@/lib/app-errors";
import { beginAiBudgetCall } from "@/lib/ai-budget-guard";
import { recordAiUsageCall, recordAiUsageFailure, type AiUsageCallContext } from "@/lib/ai-usage-ledger-recorder";
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
 * candidate chain is one provider wide (D-P3-2, G3). CI-AI-IMG-CONFIG-03 (C2) only mapped that choice
 * onto the provider that *owns* images - `openai-image` / `gemini-image`, with the image endpoint and the
 * image credential - so the pin still names the same vendor and still never fails over to the other one.
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

export async function generateImageFile(input: {
  prompt: string;
  provider?: "gemini" | "openai";
  /**
   * The content item this image is produced for, when the caller already knows one (the agent's
   * `generate_image_file` tool does). C4: it travels onto this call's ledger rows, which is what lets an
   * image's cost be read back per content item.
   *
   * Absent means the call belongs to no item - the standalone 配图 page - and nothing is guessed in its
   * place: an attribution invented from the prompt or from whoever happens to be editing would be worse
   * than an empty one.
   */
  contentItemId?: string;
  /**
   * The Marketplace listing this image was produced as, when the caller already decided one
   * (CI-P7-05-03 remaining surface). `article-generation.ts` asks `marketplaceExtensionIdOf()` once for
   * the article and hands the answer here, so a cover generated for that article is read under the same
   * listing as the text that asked for it.
   *
   * Absent means the call ran as no listing: the standalone 配图 page, and the agent's own
   * `generate_image_file` tool, which has no listing identity to name (CI-P7-05-03's own record of what
   * is still missing). Nothing is derived here from the prompt, the article title or the page the user
   * happens to be on - this facade records a decision a caller made and never composes an id itself.
   */
  extensionId?: string;
}) {
  const settings = await getLocalAgentSettings().catch(() => null);
  // The legacy `provider` argument (or `settings.imageProvider`) was a hard choice: the old
  // code never fell over to the other image provider, so this stays a pin, not a preference.
  // C2 (CI-AI-IMG-CONFIG-03): the pin names the provider that *owns* images - `openai-image` or
  // `gemini-image` - so the call reaches the image endpoint under the image credential. Pinning the
  // text provider here would sign an image request against whatever the user configured for chat (Q4).
  const providerId = imageProviderIdFor(input.provider ?? settings?.imageProvider ?? "openai");
  // CI-P7-01-04. An image model reports no token usage, so this call is metered by what it produced
  // (`quantity`) and its cost stays NULL until the catalog names an image price - never a 0. The
  // file it lands is the artifact the row points at.
  //
  // CI-P7-05-01: the key in `quantity` is the *price's* own unit label (`aiUsageUnitLabels`, so
  // `image`), which is the exact string `computeUsageCost` looks up to multiply by a per-image rate.
  // A key named after this call site's own plural (`images`) reads as "the amount was not measured"
  // there, and would leave a measured 1-image call unpriced however correct the catalog was.
  //
  // C4: `contentItemId` is carried only when the caller really has one. It is the business half of the
  // row, exactly like the `contentItemId` the article call writes, so an image's cost can be summed per
  // content item afterwards; `outputAssetId` (the path of the file) is the other half, and its file name
  // is the identity `metadata.imageAssets` stores.
  // CI-P7-05-03: `extensionId` is carried exactly the same way and for the same reason - an image the
  // article paid for belongs to the listing the article ran as, and a call with no listing to name
  // carries none rather than borrowing one.
  const usageCall: AiUsageCallContext = {
    purpose: "image",
    meteredKind: "image",
    ...(input.contentItemId?.trim() ? { contentItemId: input.contentItemId.trim() } : {}),
    ...(input.extensionId?.trim() ? { extensionId: input.extensionId.trim() } : {}),
  };

  // CI-P7-03. An image call is gated like a text one, with two differences that are facts about this
  // path rather than choices: the route is pre-resolved for `image_generation` (so an image model's price
  // is what is compared, not a chat model's), and `quantity: 1` states the one image this call will ask
  // for - a per-image price multiplied by nothing would be `usage-basis-unknown`, not a cheaper estimate.
  // A refusal is thrown before the try below, so it writes no ledger row: nothing was sent.
  const budget = await beginAiBudgetCall({
    identity: usageCall,
    purpose: usageCall.purpose,
    capability: "image_generation",
    meteredKind: "image",
    providerId,
    quantity: 1,
  });
  // CI-P7-03-A: the hold's id travels onto this call's ledger rows, so what was held and what
  // was spent are compared by an id instead of correlated by purpose and time.
  usageCall.budgetReservationId = budget.reservationId ?? undefined;
  let response: ImageGenerationResponse;
  try {
    response = await aiRuntime.generateImage({
      prompt: input.prompt,
      providerId,
      size: settings?.openAIImageSize,
    });
  } catch (error) {
    await recordAiUsageFailure(usageCall, error);
    throw error;
  } finally {
    await budget.release();
  }

  const [image] = response.images;
  if (!image?.base64) {
    // The request was answered - and billed - with nothing usable in it, so the row is written
    // before that becomes the caller's error.
    await recordAiUsageCall({ ...usageCall, attempts: response.attempts, quantity: { image: 0 } });
    throw new AppError("MODEL_UPSTREAM_NO_CONTENT", {
      status: 502,
      message: `${response.providerId} returned no image data`,
      details: { providerId: response.providerId, model: response.model },
    });
  }

  const path = await writeBase64Image(image.base64, extensionFor(image.mimeType));
  await recordAiUsageCall({
    ...usageCall,
    attempts: response.attempts,
    outputAssetId: path,
    quantity: { image: response.images.length },
  });

  return {
    provider: response.providerId,
    model: response.model,
    path,
  };
}

