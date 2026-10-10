import { describe, expect, it } from "vitest";
import { contentImageAssetsKey } from "./content-image-assets";
import { contentImageList, mergeContentMetadata } from "./content-images";

describe("content images", () => {
  it("prefers the stored image list", () => {
    expect(contentImageList({ imagePath: "cover.png", metadata: { images: ["a.png", "b.png"] } }))
      .toEqual(["a.png", "b.png"]);
  });

  it("falls back to the cover path when the list is empty or missing", () => {
    expect(contentImageList({ imagePath: "cover.png", metadata: { images: [] } })).toEqual(["cover.png"]);
    expect(contentImageList({ imagePath: "cover.png", metadata: {} })).toEqual(["cover.png"]);
    expect(contentImageList({ imagePath: "", metadata: { images: [] } })).toEqual([]);
  });

  it("keeps the image list when other metadata is patched in the same update", () => {
    const merged = mergeContentMetadata(
      { type: "article", images: [] },
      { images: ["cover.png"], metadata: { themeId: "modern" } },
    );

    expect(merged).toMatchObject({ type: "article", images: ["cover.png"], themeId: "modern" });
    // C4: the image's identity is written beside the list, so the item says what it holds.
    expect(merged[contentImageAssetsKey]).toEqual([
      expect.objectContaining({ reference: "cover.png", fileName: "cover.png", external: false }),
    ]);
  });

  /**
   * The three shapes `metadata.images` can hold (audit F-C0-5) all become the one shape the item stores:
   * a bare file name when the workspace serves the file itself, the untouched address when it does not.
   */
  it("stores a saved image under one reference, whichever shape it arrived in", () => {
    const merged = mergeContentMetadata(
      { type: "article" },
      {
        images: [
          "cover.png",
          "C:\\Users\\someone\\web-data\\artifacts\\writing-1-abcd1234.png",
          "/api/agent/artifacts?file=upload-2-efgh5678.png",
          "https://cdn.example.com/remote.png",
        ],
      },
    );

    expect(merged.images).toEqual([
      "cover.png",
      "writing-1-abcd1234.png",
      "upload-2-efgh5678.png",
      "https://cdn.example.com/remote.png",
    ]);
    // ...and each one keeps its origin: where it came from, and whether it is a local file at all.
    expect(merged[contentImageAssetsKey]).toEqual([
      expect.objectContaining({ fileName: "cover.png", external: false }),
      expect.objectContaining({ fileName: "writing-1-abcd1234.png", source: "copied", external: false }),
      expect.objectContaining({ fileName: "upload-2-efgh5678.png", source: "uploaded", external: false }),
      expect.objectContaining({
        fileName: "",
        source: "remote",
        external: true,
        remoteUrl: "https://cdn.example.com/remote.png",
      }),
    ]);
  });

  it("keeps a reference it cannot resolve instead of dropping it", () => {
    const merged = mergeContentMetadata({ type: "article" }, { images: ["/api/agent/artifacts?file=a/b.png"] });

    // Not servable, so it is neither rewritten nor thrown away: the item still says what it was given,
    // and the provenance reports that nothing about it is known.
    expect(merged.images).toEqual(["/api/agent/artifacts?file=a/b.png"]);
    expect(merged[contentImageAssetsKey]).toEqual([
      expect.objectContaining({
        reference: "/api/agent/artifacts?file=a/b.png",
        fileName: "",
        source: "unknown",
        external: false,
      }),
    ]);
  });

  it("keeps the origin it already recorded when the same image is saved again", () => {
    const first = mergeContentMetadata({ type: "article" }, { images: ["online-1-abcd1234.png"] });
    const again = mergeContentMetadata(first, { images: ["online-1-abcd1234.png"] });

    expect(again[contentImageAssetsKey]).toEqual(first[contentImageAssetsKey]);
  });

  it("leaves metadata untouched when neither images nor metadata are patched", () => {
    expect(mergeContentMetadata({ type: "article" }, {})).toEqual({ type: "article" });
  });
});
