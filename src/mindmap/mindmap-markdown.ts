import { createMindMapNode } from "./mindmap-model";
import type { MindMapNode } from "./mindmap-types";

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const BULLET_PATTERN = /^[-*+]\s+(.*)$/;
const ORDERED_PATTERN = /^\d+[.)]\s+(.*)$/;

function titleFrom(content: string): string {
  const trimmed = content.trim();
  return trimmed.length ? trimmed : "…";
}

/**
 * Drop a wrapping ``` fence (and any prose around it) so AI responses that wrap
 * their outline in a code block still parse cleanly.
 */
function stripCodeFence(markdown: string): string {
  const fenced = /```[^\n]*\n([\s\S]*?)```/.exec(markdown);
  if (fenced) return fenced[1];
  return markdown.replace(/^\s*```[^\n]*$/gm, "");
}

/**
 * Serialise the tree to a Markdown outline (headings), used for export and AI round-trips.
 *
 * `includeRoot` (CI-SC-01) exists for the 文章编辑器 hand-off: that article already carries the root
 * topic as its *title*, so writing the same words again as the body's first `#` heading would show
 * them twice. With `includeRoot: false` the branches start at `#` instead of `##`, which is also what
 * keeps a three-level outline inside `#`–`###` (the only depths `plainTextToHtml()` renders).
 *
 * Both defaults are the behaviour this function has always had, so every existing caller - the JSON /
 * Markdown export, the AI round-trip - is untouched.
 */
export function mindMapToMarkdown(root: MindMapNode, maxHeadingLevel = 6, includeRoot = true): string {
  const lines: string[] = [];
  const walk = (node: MindMapNode, level: number) => {
    const hashes = "#".repeat(Math.min(level + 1, maxHeadingLevel));
    lines.push(`${hashes} ${node.content}`);
    node.children.forEach((child) => walk(child, level + 1));
  };
  if (includeRoot) {
    walk(root, 0);
  } else {
    root.children.forEach((child) => walk(child, 0));
  }
  return lines.join("\n");
}

function buildFromHeadings(markdown: string): MindMapNode | null {
  const headings = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => HEADING_PATTERN.test(line));
  if (!headings.length) return null;

  let root: MindMapNode | null = null;
  const stack: { level: number; node: MindMapNode }[] = [];
  for (const line of headings) {
    const match = HEADING_PATTERN.exec(line);
    if (!match) continue;
    const level = match[1].length;
    const node = createMindMapNode(titleFrom(match[2]));
    if (!root) {
      root = node;
      stack.push({ level, node });
      continue;
    }
    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    const parent = stack.length ? stack[stack.length - 1].node : root;
    parent.children.push(node);
    stack.push({ level, node });
  }
  return root;
}

function buildFromIndentation(markdown: string): MindMapNode | null {
  const entries = markdown
    .split(/\r?\n/)
    .map((raw) => raw.replace(/\t/g, "  "))
    .filter((raw) => raw.trim().length > 0)
    .map((raw) => {
      const indent = raw.match(/^ */)?.[0].length ?? 0;
      const text = raw.trim();
      const bullet = BULLET_PATTERN.exec(text) ?? ORDERED_PATTERN.exec(text);
      return { indent, text: titleFrom(bullet ? bullet[1] : text) };
    });
  if (!entries.length) return null;

  const root = createMindMapNode(entries[0].text);
  const stack: { indent: number; node: MindMapNode }[] = [{ indent: entries[0].indent, node: root }];
  for (const entry of entries.slice(1)) {
    while (stack.length > 1 && entry.indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].node;
    const node = createMindMapNode(entry.text);
    parent.children.push(node);
    stack.push({ indent: entry.indent, node });
  }
  return root;
}

/**
 * Parse a Markdown outline (AI generated or hand written) into a mind map.
 * Heading hierarchies take priority; plain indented lists are used as a fallback.
 */
export function markdownToMindMap(markdown: string, fallbackTitle: string): MindMapNode {
  const text = stripCodeFence(markdown ?? "");
  return (
    buildFromHeadings(text) ??
    buildFromIndentation(text) ??
    createMindMapNode(titleFrom(fallbackTitle || "中心主题"))
  );
}
