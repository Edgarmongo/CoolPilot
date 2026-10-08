/**
 * Board -> Markdown serialisation used by the "export to content library" flow.
 *
 * The plait element shapes are duck-typed on purpose: this module stays free of
 * runtime `@plait/*` imports so it can run (and be unit tested) in a plain node
 * environment.
 */
import type { PlaitElement } from '@plait/core';

/** User visible labels; the hosting app injects localised values. */
export type BoardMarkdownLabels = {
  /** Placeholder for a topic/shape without text. */
  emptyTopic: string;
  /** Heading for the shapes/texts that are not part of a mind map. */
  standaloneSection: string;
  textElement: string;
  shapeElement: string;
  imageElement: string;
};

export const DEFAULT_BOARD_MARKDOWN_LABELS: BoardMarkdownLabels = {
  emptyTopic: '（未命名）',
  standaloneSection: '畫布元素',
  textElement: '文字',
  shapeElement: '圖形',
  imageElement: '圖片',
};

const MIND_ELEMENT_TYPES = ['mind', 'mindmap', 'mind_child'];
const MAX_HEADING_LEVEL = 6;
const BULLET_INDENT = '  ';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const isMindElement = (value: unknown): value is UnknownRecord =>
  isRecord(value) && typeof value.type === 'string' && MIND_ELEMENT_TYPES.includes(value.type);

/** Flatten a slate node (paragraph, leaf, nested children) into plain text. */
export const extractText = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (!isRecord(node)) return '';
  if (typeof node.text === 'string') return node.text;
  return extractText(node.children);
};

const mindTopicText = (element: UnknownRecord, labels: BoardMarkdownLabels): string => {
  const data = isRecord(element.data) ? element.data : undefined;
  return extractText(data?.topic).trim() || labels.emptyTopic;
};

/**
 * Mind maps become a heading outline: one `#` per level, falling back to
 * indented bullets once the deepest Markdown heading level is reached.
 */
const appendMindLines = (
  element: UnknownRecord,
  level: number,
  lines: string[],
  labels: BoardMarkdownLabels,
) => {
  const text = mindTopicText(element, labels);
  if (level <= MAX_HEADING_LEVEL) {
    lines.push(`${'#'.repeat(level)} ${text}`);
  } else {
    lines.push(`${BULLET_INDENT.repeat(level - MAX_HEADING_LEVEL - 1)}- ${text}`);
  }
  const children = Array.isArray(element.children) ? element.children : [];
  children.forEach((child) => {
    if (isMindElement(child)) {
      appendMindLines(child, level + 1, lines, labels);
    }
  });
};

/** Text/shape/image elements that live outside a mind map become bullet points. */
const buildStandaloneLine = (
  element: UnknownRecord,
  labels: BoardMarkdownLabels,
): string | null => {
  const imageUrl = typeof element.url === 'string' ? element.url.trim() : '';
  if (!imageUrl && element.type === 'image') {
    return null;
  }
  if (element.type === 'image' && imageUrl) {
    return `- ${labels.imageElement}: ${imageUrl}`;
  }
  const text = extractText(element.text).trim();
  if (!text) {
    return null;
  }
  const label = typeof element.shape === 'string' ? labels.shapeElement : labels.textElement;
  return `- ${label}: ${text}`;
};

/**
 * Serialise the whole board (mind maps first, then loose shapes/texts/images)
 * into a Markdown document. Returns an empty string for an empty board.
 */
export const boardToMarkdown = (
  elements: readonly PlaitElement[] | undefined | null,
  labels: BoardMarkdownLabels = DEFAULT_BOARD_MARKDOWN_LABELS,
): string => {
  const mindSections: string[] = [];
  const standaloneLines: string[] = [];

  (elements ?? []).forEach((element) => {
    if (!isRecord(element)) return;
    if (isMindElement(element)) {
      const lines: string[] = [];
      appendMindLines(element, 1, lines, labels);
      mindSections.push(lines.join('\n'));
      return;
    }
    const line = buildStandaloneLine(element, labels);
    if (line) {
      standaloneLines.push(line);
    }
  });

  const sections = [...mindSections];
  if (standaloneLines.length) {
    sections.push([`# ${labels.standaloneSection}`, '', ...standaloneLines].join('\n'));
  }
  return sections.join('\n\n').trim();
};
