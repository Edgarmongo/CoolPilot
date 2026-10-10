import { describe, expect, it } from "vitest";
import { brandContextSummary, brandMatchesQuery } from "./brands";
import type { BrandRecord } from "./types";

/**
 * The client-safe brand helpers of CI-P2-02 (`docs/coolpilot-capability-integration-plan.md`).
 *
 * Both are pure: the workspace filters the list it already fetched, and the wizard shows what a
 * selection will inject before the user generates. Neither reads the database, which is what keeps
 * them testable without one.
 */

const brand: BrandRecord = {
  id: "brand-1",
  name: "绿源海鲜",
  description: "深海捕捞，急冻锁鲜",
  targetAudience: "注重食材的年轻家庭",
  tone: "亲切具体，少用夸张词",
  keywords: ["冷链", "有机"],
  bannedWords: ["最便宜", "包治百病"],
  createdAt: 1,
  updatedAt: 2,
};

const labels = { audience: "受众", tone: "语气", keywords: "关键词", banned: "禁用" };

describe("brand list search", () => {
  it("matches on every field the list shows", () => {
    for (const query of ["绿源", "急冻", "年轻家庭", "亲切", "冷链", "包治"]) {
      expect(brandMatchesQuery(brand, query)).toBe(true);
    }
    expect(brandMatchesQuery(brand, "不存在的品牌")).toBe(false);
  });

  it("ignores case and surrounding spaces, and answers true for an empty query", () => {
    expect(brandMatchesQuery({ ...brand, name: "Clipversity" }, " clipv ")).toBe(true);
    expect(brandMatchesQuery(brand, "   ")).toBe(true);
  });
});

describe("brand context summary", () => {
  it("shows the four fields that reach the prompt, and joins them with the caller's labels", () => {
    expect(brandContextSummary(brand, labels)).toBe(
      "受众：注重食材的年轻家庭 · 语气：亲切具体，少用夸张词 · 关键词：冷链、有机 · 禁用：最便宜、包治百病",
    );
  });

  it("stays label-driven, so the caller's language decides the words", () => {
    const english = { audience: "Audience", tone: "Tone", keywords: "Keywords", banned: "Banned" };
    expect(brandContextSummary({ ...brand, keywords: [] }, english)).toBe(
      "Audience：注重食材的年轻家庭 · Tone：亲切具体，少用夸张词 · Banned：最便宜、包治百病",
    );
  });

  it("says nothing when the brand would inject nothing", () => {
    const blank: BrandRecord = {
      ...brand,
      targetAudience: "  ",
      tone: "",
      keywords: [],
      bannedWords: [],
    };
    expect(brandContextSummary(blank, labels)).toBe("");
  });
});
