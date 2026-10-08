import type { MindMapNode } from "./mindmap-types";

let idCounter = 0;

/** Session-unique, non-cryptographic id for a mind-map node. */
export function createMindMapId(): string {
  idCounter += 1;
  return `mm-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** Create a standalone node (children default to empty). */
export function createMindMapNode(content: string, children: MindMapNode[] = []): MindMapNode {
  return { id: createMindMapId(), content, children };
}

/** Create a fresh single-topic mind map. */
export function createMindMap(rootContent: string): MindMapNode {
  return createMindMapNode(rootContent, []);
}

function cloneNode(node: MindMapNode): MindMapNode {
  return { ...node, children: node.children.map(cloneNode) };
}

/** Deep clone so persisted / imported structures are never mutated in place. */
export function cloneMindMap(node: MindMapNode): MindMapNode {
  return cloneNode(node);
}

/** Depth-first lookup by id. */
export function findNode(root: MindMapNode, id: string): MindMapNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** Parent of the node with the given id, or null for the root (or missing ids). */
export function findParent(root: MindMapNode, id: string): MindMapNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

/** True when `nodeId` is the ancestor itself or lives anywhere below it. */
export function isDescendant(ancestor: MindMapNode, nodeId: string): boolean {
  if (ancestor.id === nodeId) return true;
  return ancestor.children.some((child) => isDescendant(child, nodeId));
}

/** Replace a single node in the tree using `updater`, rebuilding only the path. */
export function updateNode(
  root: MindMapNode,
  id: string,
  updater: (node: MindMapNode) => MindMapNode,
): MindMapNode {
  if (root.id === id) return updater(root);
  let changed = false;
  const children = root.children.map((child) => {
    const next = updateNode(child, id, updater);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
}

/** Append a new child topic under `parentId`. */
export function addChildNode(
  root: MindMapNode,
  parentId: string,
  content: string,
): { root: MindMapNode; id: string } {
  const node = createMindMapNode(content);
  const next = updateNode(root, parentId, (parent) => ({
    ...parent,
    collapsed: false,
    children: [...parent.children, node],
  }));
  return { root: next, id: node.id };
}

/** Add a sibling after `nodeId`; when the node is the root the child is appended to it. */
export function addSiblingNode(
  root: MindMapNode,
  nodeId: string,
  content: string,
): { root: MindMapNode; id: string } {
  const node = createMindMapNode(content);
  const parent = findParent(root, nodeId);
  if (!parent) {
    return addChildNode(root, nodeId, content);
  }
  const next = updateNode(root, parent.id, (current) => {
    const index = current.children.findIndex((child) => child.id === nodeId);
    const children = [...current.children];
    children.splice(index + 1, 0, node);
    return { ...current, collapsed: false, children };
  });
  return { root: next, id: node.id };
}

/** Remove `id` (and its subtree). The root cannot be removed. */
export function removeNode(root: MindMapNode, id: string): MindMapNode {
  if (root.id === id) return root;
  const parent = findParent(root, id);
  if (!parent) return root;
  return updateNode(root, parent.id, (current) => ({
    ...current,
    children: current.children.filter((child) => child.id !== id),
  }));
}

/** Flip the collapsed state of a node. */
export function toggleCollapsed(root: MindMapNode, id: string): MindMapNode {
  return updateNode(root, id, (node) => ({ ...node, collapsed: !node.collapsed }));
}

/**
 * Whether `sourceId` may be re-parented under `targetId`. Rejects the root, the
 * node itself, one of its own descendants and its current parent (a no-op move).
 * Shared by the drag interaction for drop-target highlighting and by `moveNode`.
 */
export function canMoveNode(root: MindMapNode, sourceId: string, targetId: string): boolean {
  if (sourceId === root.id || sourceId === targetId) return false;
  const source = findNode(root, sourceId);
  const target = findNode(root, targetId);
  if (!source || !target) return false;
  if (isDescendant(source, targetId)) return false;
  const parent = findParent(root, sourceId);
  return parent?.id !== targetId;
}

/**
 * Drag-to-reparent: move `sourceId` (with its subtree) under `targetId`.
 * No-ops when the move is invalid (root, self, own descendant, already a child).
 */
export function moveNode(root: MindMapNode, sourceId: string, targetId: string): MindMapNode {
  if (!canMoveNode(root, sourceId, targetId)) return root;

  const source = findNode(root, sourceId)!;
  const removed = removeNode(root, sourceId);
  return updateNode(removed, targetId, (target) => ({
    ...target,
    collapsed: false,
    children: [...target.children, source],
  }));
}

/** Total number of topics including the root. */
export function countNodes(root: MindMapNode): number {
  return 1 + root.children.reduce((total, child) => total + countNodes(child), 0);
}

export type FlatMindMapNode = {
  node: MindMapNode;
  depth: number;
  parentId: string | null;
};

/** Pre-order flatten used by the outline panel and node navigation. */
export function flattenNodes(root: MindMapNode, depth = 0, parentId: string | null = null): FlatMindMapNode[] {
  const result: FlatMindMapNode[] = [{ node: root, depth, parentId }];
  for (const child of root.children) {
    result.push(...flattenNodes(child, depth + 1, root.id));
  }
  return result;
}
