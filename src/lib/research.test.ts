import { describe, expect, it } from "vitest";
import {
  derivedResearchStatus,
  isReadableResearchUrl,
  researchMaterialHasText,
  researchMaterialMatchesQuery,
  researchMaterialPromptLimit,
  researchMaterialPromptText,
  researchMaterialSourceUrls,
  researchMaterialWritingHref,
  readResearchMaterialWritingTarget,
} from "./research";
import type { ResearchMaterialRecord } from "./types";

/**
 * The pure half of the research-material module (CI-P3-01 of
 * `docs/coolpilot-capability-integration-plan.md`): what a stored material becomes when it enters a prompt
 * and when it becomes an article's source, plus the one status a create or an edit may derive.
 *
 * These rules are pinned here because they *are* the honesty contract the card asks for: a source is not
 * its text, a page nobody read is not a source of the article, and `empty` / `failed` are outcomes of a read
 * that no payload can state (so nothing here may derive them).
 */

function material(overrides: Partial<ResearchMaterialRecord> = {}): ResearchMaterialRecord {
  return {
    id: "m1",
    title: "夏季冰饮趋势",
    kind: "text",
    content: "",
    sourceUrl: "",
    status: "draft",
    statusMessage: "",
    imageUrl: "",
    fileName: "",
    tags: [],
    fetchedAt: null,
    transcript: null,
    // CI-P3-03: a material nobody has distilled carries no result and no versions.
    extraction: null,
    extractionHistory: [],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("researchMaterialPromptText", () => {
  it("carries the stored text as 正文 and the page as 来源, so the two cannot be confused", () => {
    const text = researchMaterialPromptText(
      material({ kind: "url", sourceUrl: "https://example.com/summer", content: "冰饮最好卖的时候是七点。" }),
    );

    expect(text).toContain("研究素材：夏季冰饮趋势");
    expect(text).toContain("来源：https://example.com/summer");
    expect(text).toContain("正文：\n冰饮最好卖的时候是七点。");
  });

  it("never writes a 正文 a material does not have, so a page nobody read stays unread", () => {
    const neverRead = material({ kind: "url", sourceUrl: "https://example.com/summer" });

    const text = researchMaterialPromptText(neverRead);

    expect(text).toContain("来源：https://example.com/summer");
    expect(text).not.toContain("正文：");
    expect(researchMaterialHasText(neverRead)).toBe(false);
  });

  it("bounds how much of a long material a prompt receives, without touching the record", () => {
    const long = "青".repeat(researchMaterialPromptLimit + 500);

    const text = researchMaterialPromptText(material({ content: long }));

    expect(text.endsWith("青".repeat(researchMaterialPromptLimit))).toBe(true);
    expect(text).not.toContain("青".repeat(researchMaterialPromptLimit + 1));
  });
});

describe("researchMaterialSourceUrls", () => {
  it("offers the source page once the material contributed text", () => {
    expect(
      researchMaterialSourceUrls(material({ kind: "url", sourceUrl: "https://example.com/a", content: "读到的正文" })),
    ).toEqual(["https://example.com/a"]);
  });

  it("offers nothing for a material that contributed no text - the page is not this article's source", () => {
    expect(researchMaterialSourceUrls(material({ kind: "url", sourceUrl: "https://example.com/a" }))).toEqual([]);
    expect(researchMaterialSourceUrls(material({ kind: "url", sourceUrl: "https://example.com/a", content: "   " }))).toEqual([]);
  });

  it("offers nothing for a source the image resolver could not read anyway", () => {
    expect(researchMaterialSourceUrls(material({ sourceUrl: "file:///tmp/a.html", content: "正文" }))).toEqual([]);
    expect(isReadableResearchUrl("file:///tmp/a.html")).toBe(false);
    expect(isReadableResearchUrl(" http://example.com/a ")).toBe(true);
  });
});

describe("derivedResearchStatus", () => {
  it("derives only the two states a payload can honestly state", () => {
    expect(derivedResearchStatus("有正文")).toBe("ready");
    expect(derivedResearchStatus("   ")).toBe("draft");
    expect(derivedResearchStatus("")).toBe("draft");
  });
});

describe("researchMaterialMatchesQuery", () => {
  it("searches every field the user can see", () => {
    const row = material({
      title: "夏季冰饮",
      content: "七点后最好卖",
      sourceUrl: "https://example.com/summer",
      fileName: "summer.txt",
      tags: ["夜市"],
    });

    expect(researchMaterialMatchesQuery(row, "")).toBe(true);
    expect(researchMaterialMatchesQuery(row, "夏季")).toBe(true);
    expect(researchMaterialMatchesQuery(row, "七点")).toBe(true);
    expect(researchMaterialMatchesQuery(row, "summer")).toBe(true);
    expect(researchMaterialMatchesQuery(row, "夜市")).toBe(true);
    expect(researchMaterialMatchesQuery(row, "火锅")).toBe(false);
  });
});

describe("the creation hand-off", () => {
  it("points a material at the creation workspace without carrying its text", () => {
    expect(researchMaterialWritingHref("zh-cn", "m 1")).toBe("/zh-cn/creation/articles?researchMaterialId=m%201");
    expect(researchMaterialWritingHref("en", "m1")).toBe("/en/creation/articles?researchMaterialId=m1");
    expect(researchMaterialWritingHref("en", "  ")).toBe("/en/creation/articles");
  });

  it("reads the target back, and answers an empty string when the url asks for nothing", () => {
    const search = new URLSearchParams("researchMaterialId=m1");

    expect(readResearchMaterialWritingTarget(search)).toBe("m1");
    expect(readResearchMaterialWritingTarget(new URLSearchParams(""))).toBe("");
    expect(readResearchMaterialWritingTarget(null)).toBe("");
  });
});
