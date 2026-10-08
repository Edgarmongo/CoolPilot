import type { MindMapDirection, MindMapNode } from "./mindmap-types";

/** Context handed to the measure function so it can size a topic box accurately. */
export type MindMapMeasureContext = {
  depth: number;
  isRoot: boolean;
  collapsed: boolean;
  childCount: number;
};

export type MindMapMeasure = (
  content: string,
  context: MindMapMeasureContext,
) => { width: number; height: number };

export type MindMapSide = "root" | "left" | "right";

export type MindMapLayoutNode = {
  id: string;
  content: string;
  depth: number;
  side: MindMapSide;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  childCount: number;
  hasHiddenChildren: boolean;
};

export type MindMapLayoutLink = {
  id: string;
  fromId: string;
  toId: string;
  path: string;
};

export type MindMapLayoutBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

export type MindMapLayout = {
  nodes: MindMapLayoutNode[];
  links: MindMapLayoutLink[];
  bounds: MindMapLayoutBounds;
};

/** Horizontal gap between a parent and its children. */
export const MINDMAP_H_GAP = 52;
/** Vertical gap between neighbouring subtrees. */
export const MINDMAP_V_GAP = 14;

export function buildMindMapLinkPath(startX: number, startY: number, endX: number, endY: number): string {
  const midX = (startX + endX) / 2;
  const round = (value: number) => Math.round(value * 10) / 10;
  return `M ${round(startX)} ${round(startY)} C ${round(midX)} ${round(startY)}, ${round(midX)} ${round(endY)}, ${round(endX)} ${round(endY)}`;
}

/**
 * Tidy-tree layout for a mind map. Two passes: measure every subtree band
 * bottom-up, then assign coordinates top-down. Balanced direction alternates
 * the root's children left/right; "right" keeps every branch on the right.
 */
export function computeMindMapLayout(
  root: MindMapNode,
  measure: MindMapMeasure,
  direction: MindMapDirection = "balanced",
): MindMapLayout {
  const sizes = new Map<string, { width: number; height: number }>();
  const bandHeights = new Map<string, number>();
  const nodes: MindMapLayoutNode[] = [];
  const links: MindMapLayoutLink[] = [];

  const visibleChildren = (node: MindMapNode): MindMapNode[] => (node.collapsed ? [] : node.children);

  const measureBand = (node: MindMapNode, depth: number): number => {
    const size = measure(node.content, {
      depth,
      isRoot: depth === 0,
      collapsed: Boolean(node.collapsed),
      childCount: node.children.length,
    });
    sizes.set(node.id, size);
    const children = visibleChildren(node);
    let band = size.height;
    if (children.length) {
      let total = 0;
      children.forEach((child, index) => {
        total += measureBand(child, depth + 1);
        if (index < children.length - 1) total += MINDMAP_V_GAP;
      });
      band = Math.max(size.height, total);
    }
    bandHeights.set(node.id, band);
    return band;
  };

  const resolveSide = (parentSide: MindMapSide, index: number): MindMapSide => {
    if (parentSide !== "root") return parentSide;
    if (direction === "right") return "right";
    return index % 2 === 0 ? "right" : "left";
  };

  const place = (node: MindMapNode, depth: number, side: MindMapSide, top: number, x: number): void => {
    const size = sizes.get(node.id)!;
    const band = bandHeights.get(node.id)!;
    const y = top + (band - size.height) / 2;
    nodes.push({
      id: node.id,
      content: node.content,
      depth,
      side,
      x,
      y,
      width: size.width,
      height: size.height,
      collapsed: Boolean(node.collapsed),
      childCount: node.children.length,
      hasHiddenChildren: Boolean(node.collapsed && node.children.length > 0),
    });

    const children = visibleChildren(node);
    if (!children.length) return;

    let childTotal = 0;
    children.forEach((child, index) => {
      childTotal += bandHeights.get(child.id)!;
      if (index < children.length - 1) childTotal += MINDMAP_V_GAP;
    });

    let cursor = top + (band - childTotal) / 2;
    const parentCenterY = y + size.height / 2;
    children.forEach((child, index) => {
      const childSize = sizes.get(child.id)!;
      const childBand = bandHeights.get(child.id)!;
      const childSide = resolveSide(side, index);
      const childX = childSide === "left" ? x - MINDMAP_H_GAP - childSize.width : x + size.width + MINDMAP_H_GAP;
      const childY = cursor + (childBand - childSize.height) / 2;
      const childCenterY = childY + childSize.height / 2;
      const startX = childSide === "left" ? x : x + size.width;
      const endX = childSide === "left" ? childX + childSize.width : childX;
      links.push({
        id: `${node.id}->${child.id}`,
        fromId: node.id,
        toId: child.id,
        path: buildMindMapLinkPath(startX, parentCenterY, endX, childCenterY),
      });
      place(child, depth + 1, childSide, cursor, childX);
      cursor += childBand + MINDMAP_V_GAP;
    });
  };

  measureBand(root, 0);
  place(root, 0, "root", 0, 0);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  if (!nodes.length) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }

  return {
    nodes,
    links,
    bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
  };
}
