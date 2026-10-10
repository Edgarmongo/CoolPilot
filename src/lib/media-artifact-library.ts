import fs from "node:fs/promises";
import type { MediaAssetRef, MediaAssetRoot } from "@/lib/media-artifact-ref";
import { toMediaAssetRef } from "@/lib/media-artifact-ref";
import { artifactsRoot, brandLogosRoot, mediaRoot, productImagesRoot, videosRoot } from "@/lib/paths";

/**
 * The read side of the unified media reference (CI-P1-01-04/06).
 *
 * It walks the five roots `src/lib/paths.ts` defines and describes what is there. The accessors are the
 * **resolving** ones, never the `ensure*` ones (P5-B0-2.5): listing a workspace that has no `uploads/`
 * section must answer "nothing there" without bringing the section into existence, which is exactly what
 * a `GET` is allowed to do.
 *
 * A file whose reference cannot be served yet is still listed - `url: ""` says so - because hiding it
 * would turn "no route serves this root" into "the file does not exist", which is a different and
 * false statement.
 */
const MEDIA_ROOTS: Array<{ root: MediaAssetRoot; directory: () => string }> = [
  { root: "artifacts", directory: artifactsRoot },
  { root: "videos", directory: videosRoot },
  { root: "media", directory: mediaRoot },
  { root: "product-images", directory: productImagesRoot },
  { root: "brand-logos", directory: brandLogosRoot },
];

/** Every media file in the workspace, ordered by root (as declared above) and then by file name. */
export async function listMediaAssets(): Promise<MediaAssetRef[]> {
  const assets: MediaAssetRef[] = [];
  for (const { root, directory } of MEDIA_ROOTS) {
    const entries = await fs.readdir(directory(), { withFileTypes: true }).catch(() => []);
    const names = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    for (const fileName of names) {
      const ref = toMediaAssetRef(fileName, { root });
      if (ref.fileName) assets.push(ref);
    }
  }
  return assets;
}
