import type { ContentItem } from "@/lib/types";

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
 */
export function mergeContentMetadata(
  current: Record<string, unknown>,
  patch: { images?: string[]; metadata?: Record<string, unknown> },
): Record<string, unknown> {
  return {
    ...current,
    ...(patch.images ? { images: patch.images } : {}),
    ...(patch.metadata ?? {}),
  };
}
