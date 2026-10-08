import { cloneMindMap } from "./mindmap-model";
import {
  MINDMAP_DOCUMENT_VERSION,
  type MindMapDirection,
  type MindMapDocument,
  type MindMapNode,
} from "./mindmap-types";

const DEFAULT_THEME_ID = "classic";

export function serializeMindMapDocument(document: MindMapDocument): string {
  return JSON.stringify(document, null, 2);
}

function isMindMapNode(value: unknown): value is MindMapNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  if (typeof node.id !== "string" || typeof node.content !== "string") return false;
  if (node.collapsed !== undefined && typeof node.collapsed !== "boolean") return false;
  if (!Array.isArray(node.children)) return false;
  return node.children.every(isMindMapNode);
}

function normalizeDirection(value: unknown): MindMapDirection {
  return value === "right" ? "right" : "balanced";
}

/**
 * Parse a stored or imported document. Accepts a full document, a `{ root }`
 * wrapper or a bare node, and always returns a defensive deep clone.
 */
export function parseMindMapDocument(input: unknown): MindMapDocument | null {
  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;

  const record = data as Record<string, unknown>;
  const root = isMindMapNode(record.root)
    ? (record.root as MindMapNode)
    : isMindMapNode(record)
      ? (record as unknown as MindMapNode)
      : null;
  if (!root) return null;

  return {
    version: MINDMAP_DOCUMENT_VERSION,
    root: cloneMindMap(root),
    themeId: typeof record.themeId === "string" ? record.themeId : DEFAULT_THEME_ID,
    direction: normalizeDirection(record.direction),
  };
}
