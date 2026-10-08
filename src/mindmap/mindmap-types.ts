/**
 * Data model for the in-app mind map. It intentionally mirrors the shape used by
 * the `blink-mind` engine (an immutable tree of topics) but is expressed as a
 * plain, serialisable JSON structure so it can be persisted to IndexedDB and
 * round-tripped through Markdown / JSON without pulling in React 16-era
 * dependencies that are incompatible with this app.
 */

/** A single topic (node) of the mind map. */
export type MindMapNode = {
  id: string;
  content: string;
  /** When true the node keeps its children in the model but hides them on canvas. */
  collapsed?: boolean;
  children: MindMapNode[];
};

/** Layout direction: balanced grows on both sides, right grows only to the right. */
export type MindMapDirection = "balanced" | "right";

/** Serialisable document used for persistence and import/export. */
export type MindMapDocument = {
  version: 1;
  root: MindMapNode;
  themeId: string;
  direction: MindMapDirection;
};

/** Pan / zoom transform of the canvas viewport (screen translation + zoom factor). */
export type MindMapView = {
  scale: number;
  tx: number;
  ty: number;
};

export const MINDMAP_DOCUMENT_VERSION = 1 as const;
