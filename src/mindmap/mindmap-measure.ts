import type { MindMapMeasure, MindMapMeasureContext } from "./mindmap-layout";

/** Font stack shared by the canvas, on-screen nodes and the exported SVG. */
export const MINDMAP_FONT_FAMILY =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif";

/**
 * Build a text measure backed by an off-screen canvas so topic boxes fit their
 * content. Derived from the mounted document per the workspace DOM guidelines.
 */
export function createMindMapMeasure(ownerDocument: Document): MindMapMeasure {
  const canvas = ownerDocument.createElement("canvas");
  const context = canvas.getContext("2d");
  return (content: string, { isRoot, childCount }: MindMapMeasureContext) => {
    const fontPx = isRoot ? 15 : 14;
    const paddingX = isRoot ? 16 : 12;
    const paddingY = isRoot ? 10 : 8;
    const lineHeight = isRoot ? 22 : 20;
    const text = content.length ? content : " ";

    let textWidth = text.length * fontPx * 0.62;
    if (context) {
      context.font = `${fontPx}px ${MINDMAP_FONT_FAMILY}`;
      textWidth = context.measureText(text).width;
    }

    const badgeWidth = childCount > 0 ? 22 : 0;
    const minWidth = isRoot ? 84 : 56;
    return {
      width: Math.ceil(Math.max(minWidth, textWidth + paddingX * 2 + badgeWidth)),
      height: lineHeight + paddingY * 2,
    };
  };
}
