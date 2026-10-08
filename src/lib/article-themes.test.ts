import { describe, expect, it } from "vitest";
import {
  articleCharacterCount,
  articleThemeCss,
  buildArticleExportHtml,
  decorateArticleHtml,
  ensureArticleHtml,
  findArticleTheme,
  htmlToPlainText,
  plainTextToHtml,
  type ArticleThemeId,
} from "./article-themes";

describe("article themes", () => {
  it("wraps plain paragraphs and detects markdown-ish prefixes", () => {
    const html = plainTextToHtml("# Title\n\n- one\n- two\n\n1. first\n\nBody line");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>first</li></ol>");
    expect(html).toContain("<p>Body line</p>");
  });

  it("escapes html characters in plain text", () => {
    expect(plainTextToHtml("<script>alert('x')</script>")).toContain("&lt;script&gt;");
  });

  it("keeps existing html untouched", () => {
    expect(ensureArticleHtml("<p>hi</p>")).toBe("<p>hi</p>");
    expect(ensureArticleHtml("hi")).toBe("<p>hi</p>");
    expect(ensureArticleHtml("   ")).toBe("");
  });

  it("flattens html to plain text", () => {
    expect(htmlToPlainText("<h1>Title</h1><p>Some <strong>bold</strong> text</p>")).toBe("Title\n\nSome bold text");
  });

  it("counts characters ignoring whitespace and tags", () => {
    expect(articleCharacterCount("<p>你 好 world</p>")).toBe(7);
  });

  it("inlines theme styles for export", () => {
    const theme = findArticleTheme("lapis");
    const decorated = decorateArticleHtml("<h2>Heading</h2><p>Body</p>", theme);
    expect(decorated).toContain(`color:${theme.accent}`);
    expect(decorated).toContain("<p style=");
    expect(buildArticleExportHtml("<p>Body</p>", theme, "My Title")).toContain("<h1");
  });

  it("adds no styling at all for the default theme", () => {
    const theme = findArticleTheme("default");
    const html = '<h2>Heading</h2><p>Body</p><img src="a.png"><blockquote>quote</blockquote>';
    expect(articleThemeCss(theme)).toBe("");
    expect(decorateArticleHtml(html, theme)).toBe(html);
    expect(buildArticleExportHtml(html, theme)).toBe(html);
    expect(buildArticleExportHtml(html, theme, "My Title")).toBe(`<h1>My Title</h1>${html}`);
  });

  it("gives each decorated theme a distinct heading treatment", () => {
    const h1Of = (id: ArticleThemeId) =>
      /\.article-theme h1\{([^}]*)\}/.exec(articleThemeCss(findArticleTheme(id)))?.[1] ?? "";
    const decorated: ArticleThemeId[] = ["orangeheart", "rainbow", "lapis", "pie", "maize", "purple"];

    expect(decorated.every((id) => h1Of(id).length > 0)).toBe(true);
    // The shapes really are structural, not just recoloured text.
    expect(h1Of("rainbow")).toContain("border-bottom:3px solid");
    expect(h1Of("lapis")).toContain("border-bottom:3px double");
    expect(h1Of("pie")).toContain("border:2px solid");
    expect(h1Of("maize")).toContain("border-top:3px solid");
    expect(h1Of("orangeheart")).toContain("border-radius:999px");
    expect(h1Of("purple")).toContain("background:#9333ea");

    // Even with the colours removed every shape stays different.
    const shapes = decorated.map((id) => h1Of(id).replace(/#[0-9a-f]{3,6}/gi, ""));
    expect(new Set(shapes).size).toBe(decorated.length);
  });

  it("falls back to the default theme for unknown ids", () => {
    expect(findArticleTheme("nope").id).toBe("default");
    expect(findArticleTheme(undefined).id).toBe("default");
  });
});
