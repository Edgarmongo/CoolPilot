import { describe, expect, it } from "vitest";
import {
  addChildNode,
  addSiblingNode,
  canMoveNode,
  cloneMindMap,
  countNodes,
  createMindMap,
  createMindMapNode,
  findNode,
  findParent,
  flattenNodes,
  isDescendant,
  moveNode,
  removeNode,
  toggleCollapsed,
  updateNode,
} from "./mindmap-model";

/** root ─ one ─ two / root ─ three */
function sample() {
  const root = createMindMapNode("root", [
    createMindMapNode("one", [createMindMapNode("two")]),
    createMindMapNode("three"),
  ]);
  return root;
}

describe("mind map model", () => {
  it("creates unique ids for every node", () => {
    const a = createMindMapNode("a");
    const b = createMindMapNode("b");
    expect(a.id).not.toBe(b.id);
    expect(createMindMap("topic")).toMatchObject({ content: "topic", children: [] });
  });

  it("deep clones without sharing structure", () => {
    const root = sample();
    const clone = cloneMindMap(root);
    expect(clone).toEqual(root);
    expect(clone).not.toBe(root);
    expect(clone.children[0]).not.toBe(root.children[0]);
    expect(clone.children[0].children[0]).not.toBe(root.children[0].children[0]);
  });

  it("finds nodes and their parents by id", () => {
    const root = sample();
    const two = root.children[0].children[0];
    expect(findNode(root, two.id)).toBe(two);
    expect(findNode(root, "missing")).toBeNull();
    expect(findParent(root, two.id)).toBe(root.children[0]);
    expect(findParent(root, root.id)).toBeNull();
    expect(isDescendant(root, two.id)).toBe(true);
    expect(isDescendant(root, "missing")).toBe(false);
  });

  it("rebuilds only the path to an updated node", () => {
    const root = sample();
    const two = root.children[0].children[0];
    const next = updateNode(root, two.id, (node) => ({ ...node, content: "renamed" }));

    expect(findNode(next, two.id)?.content).toBe("renamed");
    expect(next).not.toBe(root);
    expect(next.children[0]).not.toBe(root.children[0]);
    // The untouched sibling subtree keeps its identity.
    expect(next.children[1]).toBe(root.children[1]);
    expect(updateNode(root, "missing", (node) => node)).toBe(root);
  });

  it("appends children and reveals a collapsed parent", () => {
    const original = sample();
    const parentId = original.children[0].id;
    const collapsed = toggleCollapsed(original, parentId);
    expect(findNode(collapsed, parentId)?.collapsed).toBe(true);

    const { root: next, id } = addChildNode(collapsed, parentId, "child");
    expect(findNode(next, parentId)?.collapsed).toBe(false);
    expect(findNode(next, id)).toMatchObject({ content: "child", children: [] });
  });

  it("inserts siblings right after the anchor, falling back to a child for the root", () => {
    const root = sample();
    const three = root.children[1];
    const { root: next, id } = addSiblingNode(root, three.id, "four");
    expect(next.children.map((child) => child.content)).toEqual(["one", "three", "four"]);
    expect(findNode(next, id)?.content).toBe("four");

    const { root: fromRoot } = addSiblingNode(root, root.id, "extra");
    expect(fromRoot.children.map((child) => child.content)).toEqual(["one", "three", "extra"]);
  });

  it("removes subtrees but never the root", () => {
    const root = sample();
    const next = removeNode(root, root.children[0].id);
    expect(next.children.map((child) => child.content)).toEqual(["three"]);
    expect(removeNode(root, root.id)).toBe(root);
    expect(removeNode(root, "missing")).toBe(root);
  });

  it("reparents on drag and rejects invalid moves", () => {
    const root = sample();
    const one = root.children[0];
    const three = root.children[1];

    const moved = moveNode(root, three.id, one.id);
    expect(moved.children.map((child) => child.content)).toEqual(["one"]);
    expect(findNode(moved, one.id)?.children.map((child) => child.content)).toEqual(["two", "three"]);

    // Root, self, own descendant and current parent are all no-ops.
    expect(moveNode(root, root.id, three.id)).toBe(root);
    expect(moveNode(root, one.id, one.id)).toBe(root);
    expect(moveNode(root, one.id, one.children[0].id)).toBe(root);
    expect(moveNode(root, one.children[0].id, one.id)).toBe(root);
  });

  it("exposes the same validity rules through canMoveNode", () => {
    const root = sample();
    const one = root.children[0];
    const two = one.children[0];
    const three = root.children[1];

    // A sibling can be re-parented onto another branch (roots cannot move).
    expect(canMoveNode(root, three.id, one.id)).toBe(true);
    expect(canMoveNode(root, three.id, two.id)).toBe(true);
    // The root, self, descendants, the current parent and unknown ids are refused.
    expect(canMoveNode(root, root.id, three.id)).toBe(false);
    expect(canMoveNode(root, one.id, one.id)).toBe(false);
    expect(canMoveNode(root, one.id, two.id)).toBe(false);
    expect(canMoveNode(root, two.id, one.id)).toBe(false);
    expect(canMoveNode(root, three.id, "missing")).toBe(false);
    expect(canMoveNode(root, "missing", one.id)).toBe(false);
  });

  it("counts nodes and flattens in pre-order with depth and parent", () => {
    const root = sample();
    expect(countNodes(root)).toBe(4);

    const flat = flattenNodes(root);
    expect(flat.map((entry) => entry.node.content)).toEqual(["root", "one", "two", "three"]);
    expect(flat.map((entry) => entry.depth)).toEqual([0, 1, 2, 1]);
    expect(flat[0].parentId).toBeNull();
    expect(flat[3].parentId).toBe(root.id);
  });
});
