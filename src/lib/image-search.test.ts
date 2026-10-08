import { describe, expect, it } from "vitest";
import { parseBingImageHtml } from "./image-search";

function entry(meta: Record<string, string>, style = 'style="height:180px;width:132px"') {
  const encoded = JSON.stringify(meta).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<a class="iusc" ${style} m="${encoded}" href="/images/search?view=detailV2"></a>`;
}

describe("parseBingImageHtml", () => {
  it("extracts url, thumbnail, title and source page", () => {
    const html = `<div>${entry({
      mid: "ABC123",
      murl: "https://example.com/photo.png",
      turl: "https://tse1.mm.bing.net/th?id=AAA&pid=15.1",
      t: "Java logo",
      purl: "https://example.com/page",
    })}</div>`;

    expect(parseBingImageHtml(html)).toEqual([
      {
        id: "ABC123",
        url: "https://example.com/photo.png",
        thumbUrl: "https://tse1.mm.bing.net/th?id=AAA&pid=15.1",
        title: "Java logo",
        sourceUrl: "https://example.com/page",
      },
    ]);
  });

  it("decodes html entities inside the embedded json including &amp; in urls", () => {
    const html = entry({ murl: "https://example.com/a.png", turl: "https://tse.mm.bing.net/x?a=1&b=2" });
    const [image] = parseBingImageHtml(html);
    expect(image.url).toBe("https://example.com/a.png");
    expect(image.thumbUrl).toBe("https://tse.mm.bing.net/x?a=1&b=2");
  });

  it("falls back to the full url for the thumbnail and the url as id", () => {
    const [image] = parseBingImageHtml(entry({ murl: "https://example.com/only.png" }));
    expect(image).toEqual({
      id: "https://example.com/only.png",
      url: "https://example.com/only.png",
      thumbUrl: "https://example.com/only.png",
      title: "",
      sourceUrl: "",
    });
  });

  it("deduplicates repeated images and skips malformed or non-http entries", () => {
    const html = [
      entry({ murl: "https://example.com/a.png" }),
      entry({ murl: "https://example.com/a.png" }),
      entry({ murl: "/relative/path.png" }),
      '<a class="iusc" m="{&quot;murl&quot;:&quot;broken"></a>',
    ].join("");

    expect(parseBingImageHtml(html).map((image) => image.url)).toEqual(["https://example.com/a.png"]);
  });

  it("respects the requested limit", () => {
    const html = Array.from({ length: 10 }, (_, index) => entry({ murl: `https://example.com/${index}.png` })).join("");
    expect(parseBingImageHtml(html, 3)).toHaveLength(3);
  });

  it("returns an empty list when the markup has no results", () => {
    expect(parseBingImageHtml("<html><body>no results</body></html>")).toEqual([]);
  });
});
