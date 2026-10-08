import { describe, expect, it } from "vitest";
import {
  buildMindMapLinkPath,
  computeMindMapLayout,
  MINDMAP_H_GAP,
  type MindMapLayout,
  type MindMapMeasure,
} from "./mindmap-layout";
import { createMindMapNode } from "./mindmap-model";
import type { MindMapNode } from "./mindmap-types";

/** Deterministic measure: every character is 10px wide, boxes are 20px tall. */
const measure: MindMapMeasure = (content: string, { isRoot }) => ({
  width: content.length * 10 + (isRoot ? 4 : 0),
  height: isRoot ? 30 : 20,
});

function nodeOf(layout: MindMapLayout, node: MindMapNode) {
  return layout.nodes.find((entry) => entry.id === node.id)!;
}

describe("mind map layout", () => {
  it("places a lone root at the origin", () => {
    const root = createMindMapNode("root");
    const layout = computeMindMapLayout(root, measure);

    expect(layout.nodes).toHaveLength(1);
    expect(layout.links).toHaveLength(0);
    expect(nodeOf(layout, root)).toMatchObject({ x: 0, y: 0, side: "root", depth: 0 });
    expect(layout.bounds).toMatchObject({ minX: 0, minY: 0, width: 44, height: 30 });
  });

  it("alternates the root's children left and right in balanced mode", () => {
    const root = createMindMapNode("root", [
      createMindMapNode("a"),
      createMindMapNode("b"),
      createMindMapNode("c"),
    ]);
    const layout = computeMindMapLayout(root, measure, "balanced");

    expect(nodeOf(layout, root.children[0]).side).toBe("right");
    expect(nodeOf(layout, root.children[1]).side).toBe("left");
    expect(nodeOf(layout, root.children[2]).side).toBe("right");
    expect(nodeOf(layout, root.children[0]).x).toBeGreaterThan(nodeOf(layout, root).x);
    expect(nodeOf(layout, root.children[1]).x).toBeLessThan(nodeOf(layout, root).x);
    expect(layout.links).toHaveLength(3);
  });

  it("keeps every branch on the right in right mode", () => {
    const root = createMindMapNode("root", [
      createMindMapNode("a", [createMindMapNode("a1")]),
      createMindMapNode("b"),
    ]);
    const layout = computeMindMapLayout(root, measure, "right");

    expect(nodeOf(layout, root.children[0]).side).toBe("right");
    expect(nodeOf(layout, root.children[1]).side).toBe("right");
    expect(nodeOf(layout, root.children[0].children[0]).side).toBe("right");
    expect(nodeOf(layout, root).x).toBeLessThan(nodeOf(layout, root.children[0]).x);
  });

  it("stacks siblings vertically with the configured gap", () => {
    const root = createMindMapNode("root", [createMindMapNode("a"), createMindMapNode("b")]);
    const layout = computeMindMapLayout(root, measure, "right");
    const first = nodeOf(layout, root.children[0]);
    const second = nodeOf(layout, root.children[1]);

    expect(first.x).toBe(second.x);
    expect(second.y - (first.y + first.height)).toBe(14);
    expect(first.x - (nodeOf(layout, root).x + nodeOf(layout, root).width)).toBe(MINDMAP_H_GAP);
  });

  it("hides children of a collapsed node and flags the hidden count", () => {
    const root = createMindMapNode("root", [createMindMapNode("a", [createMindMapNode("a1")])]);
    const collapsed: MindMapNode = {
      ...root,
      children: [{ ...root.children[0], collapsed: true }],
    };
    const layout = computeMindMapLayout(collapsed, measure);

    const branch = nodeOf(layout, collapsed.children[0]);
    expect(branch).toMatchObject({ collapsed: true, childCount: 1, hasHiddenChildren: true });
    expect(layout.nodes).toHaveLength(2);
    expect(layout.links).toHaveLength(1);
  });

  it("reports a bounding box that contains every node", () => {
    const root = createMindMapNode("root", [
      createMindMapNode("a", [createMindMapNode("a1")]),
      createMindMapNode("b"),
    ]);
    const layout = computeMindMapLayout(root, measure);

    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(layout.bounds.minX);
      expect(node.y).toBeGreaterThanOrEqual(layout.bounds.minY);
      expect(node.x + node.width).toBeLessThanOrEqual(layout.bounds.maxX);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.bounds.maxY);
    }
    expect(layout.bounds.width).toBeGreaterThan(0);
    expect(layout.bounds.height).toBeGreaterThan(0);
  });

  it("emits a directional cubic link path between the facing edges", () => {
    const path = buildMindMapLinkPath(10, 20, 110, 60);
    expect(path).toBe("M 10 20 C 60 20, 60 60, 110 60");

    const root = createMindMapNode("root", [createMindMapNode("child")]);
    const layout = computeMindMapLayout(root, measure, "right");
    expect(layout.links[0].path.startsWith("M ")).toBe(true);
    expect(layout.links[0].fromId).toBe(root.id);
    expect(layout.links[0].toId).toBe(root.children[0].id);
  });
});
