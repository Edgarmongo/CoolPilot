import { describe, expect, it } from "vitest";
import { composeTranslationLayout, toParagraphs, type TranslationParts } from "./translation-layouts";

const parts: TranslationParts = {
  sourceTitle: "中文标题",
  sourceParagraphs: ["第一段中文", "第二段中文"],
  targetTitle: "English title",
  targetParagraphs: ["First paragraph", "Second paragraph"],
};

describe("toParagraphs", () => {
  it("splits on blank lines and trims every block", () => {
    expect(toParagraphs("  a \n\n b\n\n\n c ")).toEqual(["a", "b", "c"]);
  });
});

describe("composeTranslationLayout", () => {
  it("stacked keeps the original, then appends the whole translation", () => {
    const { title, html } = composeTranslationLayout("stacked", parts);
    expect(title).toBe("中文标题");
    expect(html).toBe(
      "<h1>中文标题</h1><p>第一段中文</p><p>第二段中文</p><hr>" +
        "<h1>English title</h1><p>First paragraph</p><p>Second paragraph</p>",
    );
  });

  it("interleaved puts each translation right under its source paragraph", () => {
    const { title, html } = composeTranslationLayout("interleaved", parts);
    expect(title).toBe("中文标题");
    expect(html).toBe(
      "<h1>中文标题</h1><p>English title</p>" +
        "<p>第一段中文</p><p>First paragraph</p>" +
        "<p>第二段中文</p><p>Second paragraph</p>",
    );
  });

  it("replace keeps only the translation", () => {
    const { title, html } = composeTranslationLayout("replace", parts);
    expect(title).toBe("English title");
    expect(html).toBe("<h1>English title</h1><p>First paragraph</p><p>Second paragraph</p>");
  });

  it("falls back to whichever title exists", () => {
    expect(composeTranslationLayout("replace", { ...parts, targetTitle: "   " }).title).toBe("中文标题");
    expect(composeTranslationLayout("stacked", { ...parts, sourceTitle: "" }).title).toBe("English title");
  });

  it("keeps every paragraph when the two sides have different counts", () => {
    const stacked = composeTranslationLayout("stacked", { ...parts, targetParagraphs: ["only one"] });
    expect(stacked.html).toContain("<p>第二段中文</p>");
    expect(stacked.html).toContain("<p>only one</p>");

    const interleaved = composeTranslationLayout("interleaved", { ...parts, targetParagraphs: ["only one"] });
    expect(interleaved.html).toContain("<p>第二段中文</p>");
    expect(interleaved.html).toContain("<p>only one</p>");
  });

  it("escapes html coming from either side", () => {
    const { html } = composeTranslationLayout("interleaved", {
      sourceTitle: "<b>x</b>",
      sourceParagraphs: ["<script>alert(1)</script>"],
      targetTitle: "",
      targetParagraphs: ["<i>y</i>"],
    });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;i&gt;y&lt;/i&gt;");
  });
});
