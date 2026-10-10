import { describe, expect, it } from "vitest";
import {
  contentImageAssetsKey,
  contentImageFailuresKey,
  imageAssetFrom,
  imageAssetLedgerKey,
  mergeContentImageAssets,
  readContentImageAssets,
  storedImagePatch,
  toStoredImageReference,
} from "./content-image-assets";

/**
 * The image identity contract C4 adds (`docs/creator-workflow-audit.md` §5, C4).
 *
 * Two things are pinned here: a stored image has one shape, whichever shape it arrived in (the audit's
 * F-C0-5 three-value surprise), and the provenance the item keeps answers "what is this image, where did
 * it come from and which model made it" - including the honest answer for a reference nothing can be
 * said about.
 */
describe("content image assets", () => {
  it("reduces every local shape of a reference to its file name", () => {
    // The same image, four ways: bare name, local path, relative path, the app's own serving URL.
    expect(toStoredImageReference("cover.png")).toBe("cover.png");
    expect(toStoredImageReference("C:\\Users\\someone\\web-data\\artifacts\\writing-1-abcd1234.png"))
      .toBe("writing-1-abcd1234.png");
    expect(toStoredImageReference("web-data/artifacts/upload-2-efgh5678.png")).toBe("upload-2-efgh5678.png");
    expect(toStoredImageReference("/api/agent/artifacts?file=agent-image-3-ijkl9012.png"))
      .toBe("agent-image-3-ijkl9012.png");
  });

  it("leaves a reference with no local copy as the address it is", () => {
    expect(toStoredImageReference("https://cdn.example.com/photo.png")).toBe("https://cdn.example.com/photo.png");
    // Nothing to normalize, and nothing invented: the value stays what it was.
    expect(toStoredImageReference("")).toBe("");
    expect(toStoredImageReference("/api/agent/artifacts?file=a/b.png")).toBe("/api/agent/artifacts?file=a/b.png");
    // Not trimmed either, like the frozen `resolveArtifactImageSrc()` next door: a padded name stays what
    // the writer stored, because guessing which spaces were accidental is not this layer's call.
    expect(toStoredImageReference("  padded.png  ")).toBe("  padded.png  ");
  });

  it("reads the origin of a file from the name the writers already give it", () => {
    expect(imageAssetFrom("agent-image-1-abcd1234.png")).toMatchObject({ source: "generated", external: false });
    expect(imageAssetFrom("writing-1-abcd1234.png")).toMatchObject({ source: "copied", external: false });
    expect(imageAssetFrom("upload-1-abcd1234.png")).toMatchObject({ source: "uploaded", external: false });
    expect(imageAssetFrom("online-1-abcd1234.png")).toMatchObject({ source: "remote", external: false });
    expect(imageAssetFrom("cover.png")).toMatchObject({ source: "unknown", external: false });
  });

  it("marks a remote reference external and keeps the address", () => {
    expect(imageAssetFrom("https://cdn.example.com/photo.png")).toMatchObject({
      reference: "https://cdn.example.com/photo.png",
      fileName: "",
      source: "remote",
      external: true,
      remoteUrl: "https://cdn.example.com/photo.png",
    });
  });

  it("reports a reference it cannot read instead of claiming anything about it", () => {
    // No file name could be derived, so nothing is claimed: not local, not remote, not known.
    expect(imageAssetFrom("/api/agent/artifacts?file=a/b.png")).toMatchObject({
      fileName: "",
      source: "unknown",
      external: false,
    });
  });

  it("keeps a localized remote image's original address beside its local file", () => {
    expect(imageAssetFrom("online-1-abcd1234.png", { remoteUrl: "https://cdn.example.com/photo.png" }))
      .toMatchObject({
        fileName: "online-1-abcd1234.png",
        source: "remote",
        external: false,
        remoteUrl: "https://cdn.example.com/photo.png",
      });
  });

  it("records the model the writer that generated the file knew", () => {
    expect(imageAssetFrom("agent-image-1-abcd1234.png", { provider: "openai-image", model: "gpt-image-1" }))
      .toMatchObject({ source: "generated", provider: "openai-image", model: "gpt-image-1" });
    // Never invented: a file nobody generated carries no provider.
    expect(imageAssetFrom("upload-1-abcd1234.png").provider).toBeUndefined();
  });

  it("answers the ledger join key: the file name, or the address when there is no file", () => {
    expect(imageAssetLedgerKey(imageAssetFrom("writing-1-abcd1234.png"))).toBe("writing-1-abcd1234.png");
    expect(imageAssetLedgerKey(imageAssetFrom("https://cdn.example.com/photo.png")))
      .toBe("https://cdn.example.com/photo.png");
  });

  it("reads provenance an item stored, and tolerates an item that has none", () => {
    expect(readContentImageAssets(undefined)).toEqual([]);
    expect(readContentImageAssets({})).toEqual([]);
    // An item written before C4 has no key at all; a malformed entry is ignored, not thrown at a caller.
    expect(readContentImageAssets({ [contentImageAssetsKey]: [{ nope: true }, "x"] })).toEqual([]);
    expect(readContentImageAssets({ [contentImageAssetsKey]: [imageAssetFrom("cover.png")] })).toHaveLength(1);
  });

  it("orders provenance like the image list and keeps what history knows", () => {
    const first = mergeContentImageAssets(undefined, ["writing-1-abcd1234.png"], {
      "writing-1-abcd1234.png": { provider: "openai-image" },
    });
    // Saved again with the model no longer supplied: the recorded origin survives the second write.
    const again = mergeContentImageAssets(first, ["writing-1-abcd1234.png"]);

    expect(again).toEqual(first);
    expect(again[0]).toMatchObject({ reference: "writing-1-abcd1234.png", provider: "openai-image" });
  });

  it("gives an image stored before C4 an identity on the next write", () => {
    // No `imageAssets` key, just the list: the next save derives the provenance from the names.
    const merged = mergeContentImageAssets(undefined, ["writing-1-abcd1234.png", "online-2-efgh5678.png"]);

    expect(merged.map((asset) => asset.source)).toEqual(["copied", "remote"]);
    expect(merged.map((asset) => asset.reference)).toEqual(["writing-1-abcd1234.png", "online-2-efgh5678.png"]);
  });

  it("stores the list and its provenance together, and nothing extra when there is no image", () => {
    const withImages = storedImagePatch(["cover.png"]);
    expect(withImages.images).toEqual(["cover.png"]);
    expect(withImages[contentImageAssetsKey]).toHaveLength(1);

    // An item with no images keeps the metadata shape every pre-C4 caller read (no provenance key).
    expect(storedImagePatch([])).toEqual({ images: [] });
    expect(storedImagePatch(["", ""])).toEqual({ images: [] });
  });

  it("names the key a failed localization is reported under", () => {
    // The key is part of the stored contract, so it is asserted by name rather than by the readers that
    // happen to use it today (the article generator, the URL-import route).
    expect(contentImageFailuresKey).toBe("imageLocalizationFailures");
  });
});
