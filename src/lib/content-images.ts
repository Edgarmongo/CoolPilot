import type { ContentItem } from "@/lib/types";
import {
  contentImageAssetsKey,
  mergeContentImageAssets,
  toStoredImageReference,
} from "@/lib/content-image-assets";

/**
 * Ordered image list for a content item. `metadata.images` is the source of
 * truth (the first entry is the cover) and `imagePath` mirrors the cover for the
 * publish pipeline. Drafts saved before the list was persisted can end up with
 * an empty list but a set cover, so fall back to `imagePath` instead of
 * reporting no images.
 */
export function contentImageList(item: Pick<ContentItem, "imagePath" | "metadata">): string[] {
  const value = item.metadata?.images;
  const list = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
  if (list.length > 0) return list;
  return item.imagePath ? [item.imagePath] : [];
}

/**
 * Merges a content update into an item's metadata. `images` and extra keys such
 * as `themeId` are written independently, so patching one no longer drops the
 * other.
 *
 * C4: this is the one place an editor save passes through, so it is also where a stored image is
 * reduced to the single shape the workspace stores (a bare file name, or the untouched remote URL of a
 * reference with no local copy) and where its provenance in `metadata.imageAssets` is kept in step with
 * the list. Pre-C4 items hold the other shapes; their entries normalize here on the next save instead of
 * needing a migration, and an unusable entry is preserved as it was rather than dropped.
 */
export function mergeContentMetadata(
  current: Record<string, unknown>,
  patch: { images?: string[]; metadata?: Record<string, unknown> },
): Record<string, unknown> {
  const images = patch.images?.map(toStoredImageReference);
  return {
    ...current,
    ...(images
      ? {
          images,
          [contentImageAssetsKey]: mergeContentImageAssets(current[contentImageAssetsKey], images),
        }
      : {}),
    ...(patch.metadata ?? {}),
  };
}

