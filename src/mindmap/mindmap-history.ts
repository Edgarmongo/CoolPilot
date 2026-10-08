import { useReducer } from "react";
import type { MindMapNode } from "./mindmap-types";

export const MINDMAP_HISTORY_LIMIT = 80;

export type MindMapHistoryState = {
  root: MindMapNode;
  past: MindMapNode[];
  future: MindMapNode[];
};

export type MindMapHistoryAction =
  | { type: "commit"; root: MindMapNode }
  | { type: "replace"; root: MindMapNode }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; root: MindMapNode };

/** Pure reducer backing undo/redo. `commit` records history, `replace` does not. */
export function mindMapHistoryReducer(
  state: MindMapHistoryState,
  action: MindMapHistoryAction,
): MindMapHistoryState {
  switch (action.type) {
    case "commit": {
      if (action.root === state.root) return state;
      return {
        root: action.root,
        past: [...state.past, state.root].slice(-MINDMAP_HISTORY_LIMIT),
        future: [],
      };
    }
    case "replace": {
      if (action.root === state.root) return state;
      return { ...state, root: action.root };
    }
    case "undo": {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return {
        root: previous,
        past: state.past.slice(0, -1),
        future: [state.root, ...state.future].slice(0, MINDMAP_HISTORY_LIMIT),
      };
    }
    case "redo": {
      if (!state.future.length) return state;
      const next = state.future[0];
      return {
        root: next,
        past: [...state.past, state.root].slice(-MINDMAP_HISTORY_LIMIT),
        future: state.future.slice(1),
      };
    }
    case "reset":
      return { root: action.root, past: [], future: [] };
    default:
      return state;
  }
}

export function createMindMapHistoryState(root: MindMapNode): MindMapHistoryState {
  return { root, past: [], future: [] };
}

export function useMindMapHistory(root: MindMapNode) {
  return useReducer(mindMapHistoryReducer, root, createMindMapHistoryState);
}
