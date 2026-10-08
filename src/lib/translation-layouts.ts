/**
 * The three ways a translated article can be laid out next to its original,
 * offered by the 翻译 dialog once a run finishes:
 *
 * - `stacked`     original first, the whole translation appended at the end
 * - `interleaved` every source paragraph followed by its translation
 * - `replace`     the translation only
 *
 * The title follows the very same layout.
 */

export const translationLayouts = ["stacked", "interleaved", "replace"] as const;

export type TranslationLayout = (typeof translationLayouts)[number];

export type TranslationParts = {
  sourceTitle: string;
  sourceParagraphs: string[];
  targetTitle: string;
  targetParagraphs: string[];
};

export type TranslationLayoutResult = {
  /** Title written back to the article record. */
  title: string;
  /** Body HTML written back to the article record. */
  html: string;
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Splits plain text into paragraphs the same way `htmlToPlainText` joins them. */
export function toParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

const paragraph = (text: string) => `<p>${escapeHtml(text)}</p>`;
const heading = (text: string) => `<h1>${escapeHtml(text)}</h1>`;

export function composeTranslationLayout(
  layout: TranslationLayout,
  parts: TranslationParts,
): TranslationLayoutResult {
  const sourceTitle = parts.sourceTitle.trim();
  const targetTitle = parts.targetTitle.trim();
  const source = parts.sourceParagraphs.map((text) => text.trim()).filter(Boolean);
  const target = parts.targetParagraphs.map((text) => text.trim()).filter(Boolean);

  if (layout === "replace") {
    return {
      title: targetTitle || sourceTitle,
      html: [targetTitle ? heading(targetTitle) : "", ...target.map(paragraph)].join(""),
    };
  }

  if (layout === "interleaved") {
    const body: string[] = [];
    const count = Math.max(source.length, target.length);
    for (let index = 0; index < count; index += 1) {
      if (source[index]) body.push(paragraph(source[index]));
      if (target[index]) body.push(paragraph(target[index]));
    }
    return {
      title: sourceTitle || targetTitle,
      html: [sourceTitle ? heading(sourceTitle) : "", targetTitle ? paragraph(targetTitle) : "", ...body].join(""),
    };
  }

  // stacked — the translation becomes one self-contained block at the end
  return {
    title: sourceTitle || targetTitle,
    html: [
      sourceTitle ? heading(sourceTitle) : "",
      ...source.map(paragraph),
      "<hr>",
      targetTitle ? heading(targetTitle) : "",
      ...target.map(paragraph),
    ].join(""),
  };
}
