import type { MindMapLayout } from "./mindmap-layout";
import { MINDMAP_FONT_FAMILY } from "./mindmap-measure";
import { mindMapDepthFill, type MindMapTheme } from "./mindmap-theme";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type MindMapSvgOptions = {
  padding?: number;
};

/**
 * Render the layout to a standalone SVG string with inline attributes, so it can
 * be downloaded directly or rasterised into a PNG without any external CSS.
 */
export function buildMindMapSvg(
  layout: MindMapLayout,
  theme: MindMapTheme,
  options: MindMapSvgOptions = {},
): { markup: string; width: number; height: number } {
  const padding = options.padding ?? 48;
  const { bounds, nodes, links } = layout;
  const width = Math.ceil(bounds.width + padding * 2);
  const height = Math.ceil(bounds.height + padding * 2);
  const viewX = Math.round((bounds.minX - padding) * 10) / 10;
  const viewY = Math.round((bounds.minY - padding) * 10) / 10;

  const linkMarkup = links
    .map(
      (link) =>
        `<path d="${link.path}" fill="none" stroke="${theme.linkStroke}" stroke-width="2" stroke-linecap="round"/>`,
    )
    .join("");

  const nodeMarkup = nodes
    .map((node) => {
      const isRoot = node.depth === 0;
      const fill = isRoot ? theme.rootFill : mindMapDepthFill(theme, node.depth);
      const stroke = isRoot ? theme.rootStroke : theme.nodeStroke;
      const textColor = isRoot ? theme.rootText : theme.nodeText;
      const fontSize = isRoot ? 15 : 14;
      const centerX = node.x + node.width / 2;
      const centerY = node.y + node.height / 2;
      const badge = node.hasHiddenChildren
        ? `<circle cx="${node.x + node.width - 12}" cy="${centerY}" r="8" fill="${theme.badgeBackground}"/>` +
          `<text x="${node.x + node.width - 12}" y="${centerY}" font-family="${MINDMAP_FONT_FAMILY}" font-size="11" font-weight="600" fill="${theme.badgeText}" text-anchor="middle" dominant-baseline="central">${node.childCount}</text>`
        : "";
      return (
        `<g>` +
        `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>` +
        `<text x="${centerX}" y="${centerY}" font-family="${MINDMAP_FONT_FAMILY}" font-size="${fontSize}" fill="${textColor}" text-anchor="middle" dominant-baseline="central">${escapeXml(node.content)}</text>` +
        badge +
        `</g>`
      );
    })
    .join("");

  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewX} ${viewY} ${width} ${height}">` +
    `<rect x="${viewX}" y="${viewY}" width="${width}" height="${height}" fill="${theme.background}"/>` +
    linkMarkup +
    nodeMarkup +
    `</svg>`;

  return { markup, width, height };
}
