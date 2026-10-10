import { toMediaAssetRef, type MediaAssetRoot, type MediaAssetRef } from "@/lib/media-artifact-ref";

/**
 * Image identity and provenance for a content item (C4 of `docs/creator-workflow-audit.md`).
 *
 * The audit's finding (F-C0-5) was that `metadata.images` holds three kinds of value - an absolute local
 * path, a remote `og:image` URL and a bare file name - and that four clients re-derived a URL from them.
 * C4 answers that with one identity and one resolver:
 *
 *  1. **One stored shape.** What is written back to `metadata.images` is the *stored reference*:
 *     a bare file name for anything the workspace serves itself, the untouched `http(s)` URL for a
 *     reference that has no local copy. A local path, an app URL (`/api/agent/artifacts?file=x.png`) and
 *     a bare name are the same image, so they normalize to the same string.
 *  2. **Identity is the file name.** `media-artifact-ref.ts` already derives the rest (root, kind, mime
 *     type, origin) from the name and the root, so no asset table and no second vocabulary is added
 *     here. The ledger's `output_asset_id` is the absolute path of the same file, which makes
 *     `imageAssetLedgerKey()` the join between "the article shows this image" and "this call produced it".
 *  3. **A value that cannot be normalized is kept, not dropped.** Normalizing must never delete a
 *     reference the user stored; an unusable reference is reported as `source: "unknown"` and stored
 *     as it was (same rule as `media-artifact-ref.ts`'s `url: ""` sentinel).
 *
 * Provenance lives under `metadata.imageAssets`, one entry per stored image in the same order as
 * `metadata.images` (cover first), so "which images does this item hold, where did each come from and
 * which model made it" is answered by one read of the item - after saving, refreshing and reopening.
 * Provider/model are *never* guessed: they are recorded only by the writer that performed the generation
 * (`article-images.ts`, `updateContentItemImage()`), never derived from the text model the item names.
 */
export const contentImageAssetsKey = "imageAssets";

/**
 * Remote references that could not be brought into the workspace at creation time.
 *
 * A failed localization must not be indistinguishable from "there was no remote image": the article is
 * stored with fewer images, and the URLs that were skipped stay on the item so the outcome is traceable
 * instead of silently forgotten.
 */
export const contentImageFailuresKey = "imageLocalizationFailures";

/** One image as the item holds it: the stored reference plus what is known about its origin. */
export type ContentImageAsset = {
  /** Exactly what `metadata.images` holds for this entry. */
  reference: string;
  /** The addressing key; empty for a reference with no local file. */
  fileName: string;
  root: MediaAssetRoot;
  kind: MediaAssetRef["kind"];
  mimeType: string;
  /** `generated` / `uploaded` / `copied` / `remote` / `unknown` - the vocabulary of the reference layer. */
  source: MediaAssetRef["source"];
  /** True when CoolPilot holds no local copy of this reference. */
  external: boolean;
  /** Where an external reference points; also kept for a localized remote image (its original address). */
  remoteUrl?: string;
  /** The image model that produced the file, when the writer that generated it knew. */
  provider?: string;
  model?: string;
};

export type ContentImageAssetExtra = {
  remoteUrl?: string;
  provider?: string;
  model?: string;
};

/**
 * The stored reference for a value a writer received: a bare file name when the workspace can serve it,
 * the original string when it is a reference to somebody else's copy.
 *
 * An empty value stays empty (an empty entry is not an image); nothing is trimmed, matching the frozen
 * sibling `resolveArtifactImageSrc()`.
 */
export function toStoredImageReference(value: string): string {
  if (!value) return "";
  const ref = toMediaAssetRef(value);
  if (ref.fileName) return ref.fileName;
  return value;
}

/** One asset entry: the stored reference plus everything derivable from it and known about its origin. */
export function imageAssetFrom(value: string, extra: ContentImageAssetExtra = {}): ContentImageAsset {
  const ref = toMediaAssetRef(value);
  const remoteUrl = extra.remoteUrl ?? ref.remoteUrl;
  return {
    reference: toStoredImageReference(value),
    fileName: ref.fileName,
    root: ref.root,
    kind: ref.kind,
    mimeType: ref.mimeType,
    source: ref.source,
    // `external` is the reference layer's own answer ("this points at somebody else's copy"). An
    // unparsable reference is left `external: false` with `source: "unknown"`, because neither claim
    // about it could be supported.
    external: ref.external,
    ...(remoteUrl ? { remoteUrl } : {}),
    ...(extra.provider ? { provider: extra.provider } : {}),
    ...(extra.model ? { model: extra.model } : {}),
  };
}

/** The join key between an image on an item and the ledger row that produced it. */
export function imageAssetLedgerKey(asset: Pick<ContentImageAsset, "fileName" | "remoteUrl" | "reference">): string {
  return asset.fileName || asset.remoteUrl || asset.reference;
}

function isAsset(value: unknown): value is ContentImageAsset {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ContentImageAsset>;
  return typeof entry.reference === "string" && typeof entry.fileName === "string";
}

/**
 * The provenance an item already holds.
 *
 * Items stored before C4 have no `imageAssets` at all, and that is not an error: their images still
 * resolve. `readContentImageAssets()` therefore answers an empty list, and the next write adds the
 * provenance for them (`mergeContentImageAssets()`).
 */
export function readContentImageAssets(metadata: Record<string, unknown> | undefined): ContentImageAsset[] {
  const value = metadata?.[contentImageAssetsKey];
  return Array.isArray(value) ? value.filter(isAsset) : [];
}

/**
 * The provenance list for a set of stored references, ordered like the references.
 *
 * Existing entries win for the facts history already recorded (where a file came from and which model
 * made it do not change because the list was re-saved), while an `extra` passed by the writer that just
 * performed the generation fills in what is new. A reference with no entry gets one derived from its own
 * name, which is how a pre-C4 image gains identity without a migration.
 */
export function mergeContentImageAssets(
  current: unknown,
  references: string[],
  extras: Record<string, ContentImageAssetExtra> = {},
): ContentImageAsset[] {
  const previous = readContentImageAssets({ [contentImageAssetsKey]: current });
  const byKey = new Map(previous.map((asset) => [imageAssetLedgerKey(asset), asset]));
  const merged: ContentImageAsset[] = [];
  for (const reference of references) {
    if (!reference) continue;
    const derived = imageAssetFrom(reference, extras[reference]);
    const key = imageAssetLedgerKey(derived);
    const existing = byKey.get(key);
    if (!existing) {
      merged.push(derived);
      continue;
    }
    // History wins for identity and origin; the new write only fills a blank it can fill.
    const provider = derived.provider ?? existing.provider;
    const model = derived.model ?? existing.model;
    const remoteUrl = derived.remoteUrl ?? existing.remoteUrl;
    merged.push({
      ...existing,
      reference: derived.reference,
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(remoteUrl ? { remoteUrl } : {}),
    });
  }
  return merged;
}

/**
 * The `images` / `imageAssets` pair a writer stores, so no caller has to remember the two-key rule.
 *
 * `imageAssets` is written only when there is at least one image: an item with no images keeps the
 * metadata it has always had (`{ type, images: [] }`), which is what existing callers and tests read.
 */
export function storedImagePatch(
  references: string[],
  extras: Record<string, ContentImageAssetExtra> = {},
): { images: string[]; [contentImageAssetsKey]?: ContentImageAsset[] } {
  const images = references.map(toStoredImageReference).filter(Boolean);
  const assets = mergeContentImageAssets(undefined, images, extras);
  return assets.length > 0 ? { images, [contentImageAssetsKey]: assets } : { images };
}
