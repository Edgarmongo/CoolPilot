import { describe, expect, it } from "vitest";
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
    expect(
      mergeContentMetadata(
        { type: "article", images: [] },
        { images: ["cover.png"], metadata: { themeId: "modern" } },
      ),
    ).toEqual({ type: "article", images: ["cover.png"], themeId: "modern" });
  });

  it("leaves metadata untouched when neither images nor metadata are patched", () => {
    expect(mergeContentMetadata({ type: "article" }, {})).toEqual({ type: "article" });
  });
});
