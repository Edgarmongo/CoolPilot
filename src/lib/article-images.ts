import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { generateImageFile } from "@/lib/agent/image-generation";
import { imageAssetFrom, type ContentImageAsset, type ContentImageAssetExtra } from "@/lib/content-image-assets";
import { ensureArtifactsRoot } from "@/lib/paths";
import { fetchRemoteImageToArtifacts } from "@/lib/remote-image";
import { fetchArticleText } from "@/lib/scraper";
import type { ImageStrategy } from "@/lib/ai-writing";

/**
 * The article image strategy, and the images it resolves as *stored references* (C4).
 *
 * Three sources, one shape: every image this module answers with is either the bare file name of a file
 * the workspace now holds (a copied product photo, a localized remote image, a generation) or - only when
 * the reference has no local copy at all - the untouched remote address. Before C4 the `web` stage handed
 * the remote `og:image` URL on as it was, so the article stored a reference the publish path then dropped
 * silently (`docs/e2e-core-loop-verification.md` §8.1). The C4 direction is the one
 * `docs/creator-workflow-audit.md` §6.3 records: an external image is brought into the workspace at
 * creation time, so content and publishing only ever see a local path.
 *
 * What a stage *cannot* localize is reported, never hidden: `skippedRemoteImages` names the remote
 * addresses that were tried and rejected, and `article-generation.ts` stores them on the item beside the
 * images it did get.
 */

/** AI image generation is slow, so it never produces more than this per run. */
export const maxGeneratedArticleImages = 3;

/** Copies a stored product image into the artifacts dir so the library can serve it. */
export async function copyIntoArtifacts(sourcePath: string) {
  const dir = ensureArtifactsRoot();
  const extension = path.extname(sourcePath).toLowerCase() || ".png";
  const target = path.join(dir, `writing-${Date.now()}-${nanoid(8)}${extension}`);
  await fs.copyFile(sourcePath, target);
  // The stored reference is the file name, never the local path: the path of the machine that produced
  // the article is not part of what the item says about its own image.
  return path.basename(target);
}

/** What the strategy resolved: the stored references, their provenance, and what could not be localized. */
export type ArticleImageResolution = {
  /** Stored references, cover first - exactly what `metadata.images` will hold. */
  images: string[];
  /** One entry per image, same order: identity, origin and (for a generation) the model that made it. */
  assets: ContentImageAsset[];
  /** Remote addresses that were read but could not be brought into the workspace. */
  skippedRemoteImages: string[];
};

/**
 * Resolves the images attached to a generated article, honouring the chosen
 * strategy: product photos first, then the source page's `og:image`, then
 * best-effort AI generation. Every step is failure-tolerant.
 *
 * The web stage is where C4 changes the outcome: the `og:image` is downloaded into `artifacts/` and the
 * article keeps `online-*` file name, with the address it came from kept as the asset's `remoteUrl`. A
 * page whose image cannot be fetched contributes no image and is named in `skippedRemoteImages`, which is
 * a different statement from "the page had no image" and is stored as such.
 */
export async function resolveArticleImages(input: {
  strategy: ImageStrategy;
  target: number;
  productImagePaths: string[];
  sourceUrls: string[];
  title: string;
}): Promise<ArticleImageResolution> {
  const images: string[] = [];
  const assets: ContentImageAsset[] = [];
  const skippedRemoteImages: string[] = [];
  const add = (reference: string, extra?: ContentImageAssetExtra) => {
    if (!reference || images.length >= input.target || images.includes(reference)) return;
    images.push(reference);
    assets.push(imageAssetFrom(reference, extra));
  };
  // Two pages naming the same `og:image` are one image; deduping by address (not by the downloaded file
  // name, which is new on every fetch) is what keeps a second copy from being made.
  const seenRemoteUrls = new Set<string>();

  if (input.strategy === "product" || input.strategy === "mixed") {
    for (const imagePath of input.productImagePaths) {
      if (images.length >= input.target) break;
      if (!imagePath) continue;
      try {
        add(await copyIntoArtifacts(imagePath));
      } catch {
        /* ignore missing files */
      }
    }
  }

  if ((input.strategy === "web" || input.strategy === "mixed") && images.length < input.target) {
    for (const url of input.sourceUrls.slice(0, 3)) {
      if (images.length >= input.target) break;
      let remoteUrl = "";
      try {
        remoteUrl = (await fetchArticleText(url)).imageUrl;
      } catch {
        /* ignore unreachable pages */
      }
      if (!remoteUrl || seenRemoteUrls.has(remoteUrl)) continue;
      seenRemoteUrls.add(remoteUrl);
      try {
        add(await fetchRemoteImageToArtifacts({ url: remoteUrl }), { remoteUrl });
      } catch {
        skippedRemoteImages.push(remoteUrl);
      }
    }
  }

  if ((input.strategy === "ai" || input.strategy === "mixed") && images.length < input.target) {
    const remaining = Math.min(input.target - images.length, maxGeneratedArticleImages);
    for (let index = 0; index < remaining; index += 1) {
      try {
        const generated = await generateImageFile({
          prompt: `为文章《${input.title}》生成一张贴合主题的配图，画面干净、有真实感。`,
        });
        // The model that made this file is recorded here, where it is known: the item's own
        // `metadata.provider/model` describe the *text* call that wrote the article, not the image call.
        add(path.basename(generated.path), { provider: generated.provider, model: generated.model });
      } catch {
        break;
      }
    }
  }

  return { images, assets, skippedRemoteImages };
}

