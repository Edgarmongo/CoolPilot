import { describe, expect, it } from "vitest";
import { ensureArticleHtml } from "@/lib/article-themes";
import { mindMapContentBody, mindMapContentDraft } from "./mindmap-content";
import { createMindMapNode } from "./mindmap-model";

/**
 * The mind map → 文章创作 payload (CI-SC-01).
 *
 * The canvas had no entry into the content pipeline at all, so this module is the whole of the change
 * on that side: it is a pure function, tested here, and the canvas only calls it (`mindmap-canvas.tsx`,
 * `saveToLibrary`). What is pinned is exactly what the article editor will have to live with, so three
 * of the four cases are about the *receiving* end rather than about the tree:
 *
 * 1. the root topic is the article title, never also the body's first heading;
 * 2. the outline stays inside `#`–`###`, because `plainTextToHtml()` - the bridge the editor renders
 *    through - only understands those depths and would show `####` as four literal hashes (`#` deep
 *    headings are asserted through `ensureArticleHtml()`, the real function, not a copy of its regex);
 * 3. a childless root still produces a non-empty body, since `POST /api/content` would reject the
 *    title but would accept an empty article, and an empty article is the worse outcome.
 */
const tree = () =>
  createMindMapNode("短视频运营", [
    createMindMapNode("内容策划", [
      createMindMapNode("选题方法"),
      createMindMapNode("脚本结构", [createMindMapNode("开场三秒")]),
    ]),
    createMindMapNode("发布策略"),
  ]);

describe("mind map content draft", () => {
  it("stores the branches only, so the title and the first heading are not the same words", () => {
    expect(mindMapContentBody(tree()).split("\n")).toEqual([
      "# 内容策划",
      "## 选题方法",
      "## 脚本结构",
      "### 开场三秒",
      "# 发布策略",
    ]);
  });

  it("clamps to the three heading levels the article bridge renders", () => {
    const deep = createMindMapNode("根", [
      createMindMapNode("一", [createMindMapNode("二", [createMindMapNode("三", [createMindMapNode("四")])])]),
    ]);

    expect(mindMapContentBody(deep).split("\n")).toEqual(["# 一", "## 二", "### 三", "### 四"]);

    // `ensureArticleHtml()` is what the editor loads a plain-text body through: h1/h2/h3 come out as
    // real headings, and no `####` survives as text.
    const html = ensureArticleHtml(mindMapContentBody(deep));
    expect(html).toContain("<h1>一</h1>");
    expect(html).toContain("<h2>二</h2>");
    expect(html).toContain("<h3>三</h3>");
    expect(html).not.toContain("#");
  });

  it("falls back to the full outline when the root has no children", () => {
    expect(mindMapContentBody(createMindMapNode("孤零零"))).toBe("# 孤零零");
  });

  it("names the article after the root topic and hands the same text to body and publish", () => {
    const draft = mindMapContentDraft(tree(), "中心主题");
    expect(draft.title).toBe("短视频运营");
    expect(draft.body).toContain("# 内容策划");
    expect(draft.postReadyText).toBe(draft.body);
    expect(draft.type).toBe("article");
    expect(draft.source).toBe("mindmap");
  });

  it("uses the fallback title only for a blank root topic, which the route would reject outright", () => {
    expect(mindMapContentDraft(createMindMapNode("   "), "中心主题").title).toBe("中心主题");
  });
});
