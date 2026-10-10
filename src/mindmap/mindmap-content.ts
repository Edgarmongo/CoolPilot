import { mindMapToMarkdown } from "./mindmap-markdown";
import type { MindMapNode } from "./mindmap-types";

/**
 * The mind map → 文章创作 hand-off (CI-SC-01).
 *
 * The canvas had no way into the content library at all: 汇出 wrote a file to disk, and the two
 * consumers of `mindMapToMarkdown()` were that export and the AI round-trip. This module turns the
 * edited tree into the one payload the article pipeline already accepts - `POST /api/content` - rather
 * than adding a second write path: that route owns validation, `metadata.type` and `status`.
 *
 * Two facts about the receiving end shape the payload:
 *
 * - `plainTextToHtml()`, the bridge the article editor renders through, only understands `#`–`###`
 *   (`src/lib/article-themes.ts`), while the default export serialises up to `######`. A six-level
 *   outline would reach the editor as literal `####` text, so the draft clamps to three levels.
 * - The article keeps the root topic as its *title*, so the body carries the branches only
 *   (`includeRoot: false`) and the two never repeat each other. A map whose root has no children would
 *   leave the body empty, and an empty article is worse than a repeated heading, so that one case
 *   falls back to the full outline.
 *
 * Nothing here reads or writes storage; it is the payload, and `src/mindmap/mindmap-content.test.ts`
 * pins it.
 */
export const MINDMAP_CONTENT_HEADING_LEVEL = 3;

export interface MindMapContentDraft {
  title: string;
  /** The branch outline, as the article body - the same text a publish would send. */
  body: string;
  postReadyText: string;
  type: "article";
  /** Provenance for the 来源 column; the whiteboard route records `whiteboard` the same way. */
  source: "mindmap";
}

/** The outline an article should store for this map: branches first, full outline only if there are none. */
export function mindMapContentBody(root: MindMapNode, maxHeadingLevel = MINDMAP_CONTENT_HEADING_LEVEL): string {
  const branches = mindMapToMarkdown(root, maxHeadingLevel, false);
  return branches.trim() ? branches : mindMapToMarkdown(root, maxHeadingLevel);
}

/**
 * The `POST /api/content` payload for a mind map. `fallbackTitle` is used only when the root topic is
 * blank, because that route rejects an empty title (`contentCreateSchema.title` is `min(1)`).
 */
export function mindMapContentDraft(root: MindMapNode, fallbackTitle: string): MindMapContentDraft {
  const body = mindMapContentBody(root);
  return {
    title: root.content.trim() || fallbackTitle,
    body,
    postReadyText: body,
    type: "article",
    source: "mindmap",
  };
}
