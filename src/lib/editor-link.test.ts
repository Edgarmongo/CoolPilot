import { describe, expect, it } from "vitest";
import { articleEditorHref, articleEditorParam, articleEditorPath, readArticleEditorTarget } from "./editor-link";

/** A stand-in for Next's read-only search params: only `get` is part of the contract. */
function searchOf(query: string) {
  const params = new URLSearchParams(query);
  return { get: (name: string) => params.get(name) };
}

describe("article editor deep link", () => {
  it("prefixes the list route with the locale and carries the content id", () => {
    expect(articleEditorHref("zh-cn", "abc123")).toBe("/zh-cn/creation/articles?edit=abc123");
    expect(articleEditorHref("zh-hk", "abc123")).toBe("/zh-hk/creation/articles?edit=abc123");
    expect(articleEditorHref("en", "abc123")).toBe("/en/creation/articles?edit=abc123");
  });

  it("encodes an id that would otherwise be read as more of the query", () => {
    expect(articleEditorHref("en", "a b&c=d")).toBe("/en/creation/articles?edit=a%20b%26c%3Dd");
  });

  it("links to the plain list when there is no id to open", () => {
    expect(articleEditorHref("en", "")).toBe(`/en${articleEditorPath}`);
    expect(articleEditorHref("en", "   ")).toBe(`/en${articleEditorPath}`);
  });

  it("reads the requested id, and nothing at all from a URL that does not ask", () => {
    expect(readArticleEditorTarget(searchOf("?edit=abc123"))).toBe("abc123");
    expect(readArticleEditorTarget(searchOf("?edit=%20abc123%20"))).toBe("abc123");
    expect(readArticleEditorTarget(searchOf("?page=2"))).toBe("");
    expect(readArticleEditorTarget(searchOf("?edit="))).toBe("");
    expect(readArticleEditorTarget(searchOf(""))).toBe("");
    expect(readArticleEditorTarget(null)).toBe("");
    expect(readArticleEditorTarget(undefined)).toBe("");
  });

  it("round-trips an id through its own link", () => {
    const href = articleEditorHref("zh-cn", "a b&c=d");
    expect(readArticleEditorTarget(searchOf(href.slice(href.indexOf("?"))))).toBe("a b&c=d");
    expect(href.startsWith(`/zh-cn${articleEditorPath}?${articleEditorParam}=`)).toBe(true);
  });
});
