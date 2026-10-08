import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { generateImageFile } from "@/lib/agent/image-generation";
import { artifactsRoot } from "@/lib/paths";
import { fetchArticleText } from "@/lib/scraper";
import type { ImageStrategy } from "@/lib/ai-writing";

/** AI image generation is slow, so it never produces more than this per run. */
export const maxGeneratedArticleImages = 3;

/** Copies a stored product image into the artifacts dir so the library can serve it. */
export async function copyIntoArtifacts(sourcePath: string) {
  const dir = artifactsRoot();
  await fs.mkdir(dir, { recursive: true });
  const extension = path.extname(sourcePath).toLowerCase() || ".png";
  const target = path.join(dir, `writing-${Date.now()}-${nanoid(8)}${extension}`);
  await fs.copyFile(sourcePath, target);
  return target;
}

/**
 * Resolves the images attached to a generated article, honouring the chosen
 * strategy: product photos first, then the source page's `og:image`, then
 * best-effort AI generation. Every step is failure-tolerant.
 */
export async function resolveArticleImages(input: {
  strategy: ImageStrategy;
  target: number;
  productImagePaths: string[];
  sourceUrls: string[];
  title: string;
}): Promise<string[]> {
  const images: string[] = [];
  const add = (value?: string) => {
    if (value && images.length < input.target && !images.includes(value)) images.push(value);
  };

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
      try {
        add((await fetchArticleText(url)).imageUrl);
      } catch {
        /* ignore unreachable pages */
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
        add(generated.path);
      } catch {
        break;
      }
    }
  }

  return images;
}
