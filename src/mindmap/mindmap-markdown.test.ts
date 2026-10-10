import { describe, expect, it } from "vitest";
import { markdownToMindMap, mindMapToMarkdown } from "./mindmap-markdown";
import { createMindMapNode } from "./mindmap-model";

describe("mind map markdown", () => {
  it("builds a tree from heading levels", () => {
    const root = markdownToMindMap(
      ["# 短视频运营", "## 内容策划", "### 选题方法", "### 脚本结构", "## 拍摄制作"].join("\n"),
      "fallback",
    );

    expect(root.content).toBe("短视频运营");
    expect(root.children.map((child) => child.content)).toEqual(["内容策划", "拍摄制作"]);
    expect(root.children[0].children.map((child) => child.content)).toEqual(["选题方法", "脚本结构"]);
  });

  it("treats skipped heading levels as nested children", () => {
    const root = markdownToMindMap("# A\n### B\n# C", "fallback");
    expect(root.children.map((child) => child.content)).toEqual(["B", "C"]);
  });

  it("prefers headings over indented lists", () => {
    const root = markdownToMindMap("# Root\n- bullet\n### Deep", "fallback");
    expect(root.content).toBe("Root");
    expect(root.children.map((child) => child.content)).toEqual(["Deep"]);
  });

  it("falls back to indented lists", () => {
    const root = markdownToMindMap(
      ["中心主题", "  分支一", "    子项", "  分支二"].join("\n"),
      "fallback",
    );

    expect(root.content).toBe("中心主题");
    expect(root.children.map((child) => child.content)).toEqual(["分支一", "分支二"]);
    expect(root.children[0].children.map((child) => child.content)).toEqual(["子项"]);
  });

  it("strips bullet markers from indented lists", () => {
    const root = markdownToMindMap("- 中心\n  - 一\n  - 二", "fallback");
    expect(root.content).toBe("中心");
    expect(root.children.map((child) => child.content)).toEqual(["一", "二"]);
  });

  it("unwraps AI output that arrives inside a code fence", () => {
    const fenced = ["Sure, here is your mind map:", "```markdown", "# Root", "## Branch", "```"].join("\n");
    const root = markdownToMindMap(fenced, "fallback");
    expect(root.content).toBe("Root");
    expect(root.children.map((child) => child.content)).toEqual(["Branch"]);
  });

  it("falls back to a single topic for empty input", () => {
    expect(markdownToMindMap("", "中心主题").content).toBe("中心主题");
    expect(markdownToMindMap("   \n  ", "中心主题").content).toBe("中心主题");
  });

  it("round-trips through headings and clamps deep levels", () => {
    const deep = createMindMapNode("l0", [
      createMindMapNode("l1", [createMindMapNode("l2", [createMindMapNode("l3")])]),
    ]);
    const markdown = mindMapToMarkdown(deep);
    expect(markdown.split("\n")).toEqual(["# l0", "## l1", "### l2", "#### l3"]);

    const restored = markdownToMindMap(markdown, "fallback");
    expect(restored.content).toBe("l0");
    expect(restored.children[0].children[0].children[0].content).toBe("l3");

    expect(mindMapToMarkdown(deep, 2).split("\n")).toEqual(["# l0", "## l1", "## l2", "## l3"]);
  });

  it("can leave the root out for the article hand-off (CI-SC-01)", () => {
    const root = createMindMapNode("l0", [createMindMapNode("l1", [createMindMapNode("l2")])]);

    // The article carries the root as its title, so the body starts at the branches - and because the
    // levels shift up by one, a three-level outline still fits in `#`–`###`.
    expect(mindMapToMarkdown(root, 3, false).split("\n")).toEqual(["# l1", "## l2"]);
    // The default is untouched, which is what keeps 汇出 Markdown and the AI round-trip as they were.
    expect(mindMapToMarkdown(root, 3).split("\n")).toEqual(["# l0", "## l1", "### l2"]);
  });
});
