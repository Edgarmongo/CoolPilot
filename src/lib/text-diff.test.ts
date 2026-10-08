import { describe, expect, it } from "vitest";
import { diffChangeCount, diffLines, toDiffLines, toSideBySide } from "./text-diff";

describe("toDiffLines", () => {
  it("trims lines and drops blanks", () => {
    expect(toDiffLines("  第一段 \r\n\n  第二段  ")).toEqual(["第一段", "第二段"]);
  });
});

describe("diffLines", () => {
  it("marks identical text as unchanged", () => {
    const lines = diffLines("第一段\n第二段", "第一段\n第二段");
    expect(lines).toEqual([
      { type: "same", text: "第一段" },
      { type: "same", text: "第二段" },
    ]);
    expect(diffChangeCount(lines)).toBe(0);
  });

  it("detects added paragraphs", () => {
    expect(diffLines("第一段", "第一段\n第二段")).toEqual([
      { type: "same", text: "第一段" },
      { type: "added", text: "第二段" },
    ]);
  });

  it("detects removed paragraphs", () => {
    expect(diffLines("第一段\n第二段", "第一段")).toEqual([
      { type: "same", text: "第一段" },
      { type: "removed", text: "第二段" },
    ]);
  });

  it("reports a rewrite of the same paragraph as a removal plus an addition", () => {
    const lines = diffLines("原文内容", "改写后的内容");
    expect(lines).toEqual([
      { type: "removed", text: "原文内容" },
      { type: "added", text: "改写后的内容" },
    ]);
    expect(diffChangeCount(lines)).toBe(2);
  });

  it("keeps shared paragraphs around an edited one", () => {
    const lines = diffLines("开头\n中间旧\n结尾", "开头\n中间新\n结尾");
    expect(lines.map((line) => `${line.type}:${line.text}`)).toEqual([
      "same:开头",
      "removed:中间旧",
      "added:中间新",
      "same:结尾",
    ]);
  });

  it("treats empty input as fully added or removed", () => {
    expect(diffLines("", "第一段")).toEqual([{ type: "added", text: "第一段" }]);
    expect(diffLines("第一段", "")).toEqual([{ type: "removed", text: "第一段" }]);
  });
});

describe("toSideBySide", () => {
  it("keeps removals on the left and additions on the right", () => {
    const { left, right } = toSideBySide(diffLines("旧内容", "新内容"));
    expect(left).toEqual([{ type: "removed", text: "旧内容" }]);
    expect(right).toEqual([{ type: "added", text: "新内容" }]);
  });

  it("keeps unchanged paragraphs on both sides", () => {
    const { left, right } = toSideBySide(diffLines("共同", "共同"));
    expect(left).toEqual([{ type: "same", text: "共同" }]);
    expect(right).toEqual([{ type: "same", text: "共同" }]);
  });
});
