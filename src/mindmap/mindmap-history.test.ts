import { describe, expect, it } from "vitest";
import {
  createMindMapHistoryState,
  MINDMAP_HISTORY_LIMIT,
  mindMapHistoryReducer,
  type MindMapHistoryAction,
} from "./mindmap-history";
import { createMindMapNode } from "./mindmap-model";

const a = createMindMapNode("a");
const b = createMindMapNode("b");
const c = createMindMapNode("c");

function run(...actions: MindMapHistoryAction[]) {
  return actions.reduce(mindMapHistoryReducer, createMindMapHistoryState(a));
}

describe("mind map history", () => {
  it("starts with a single entry and no history", () => {
    const state = createMindMapHistoryState(a);
    expect(state).toEqual({ root: a, past: [], future: [] });
  });

  it("records commits and ignores identical roots", () => {
    const state = run({ type: "commit", root: b }, { type: "commit", root: b });
    expect(state.root).toBe(b);
    expect(state.past).toEqual([a]);
    expect(mindMapHistoryReducer(state, { type: "commit", root: b })).toBe(state);
  });

  it("replaces the root without touching history", () => {
    const state = run({ type: "commit", root: b }, { type: "replace", root: c });
    expect(state).toMatchObject({ root: c, past: [a], future: [] });
    expect(state.past).toEqual([a]);
    expect(mindMapHistoryReducer(state, { type: "replace", root: c })).toBe(state);
  });

  it("undoes and redoes in order, clearing the redo stack on commit", () => {
    let state = run({ type: "commit", root: b }, { type: "commit", root: c });
    expect(state).toMatchObject({ root: c, past: [a, b] });

    state = mindMapHistoryReducer(state, { type: "undo" });
    expect(state).toMatchObject({ root: b, past: [a], future: [c] });

    state = mindMapHistoryReducer(state, { type: "redo" });
    expect(state).toMatchObject({ root: c, past: [a, b], future: [] });

    state = mindMapHistoryReducer(
      mindMapHistoryReducer(state, { type: "undo" }),
      { type: "commit", root: a },
    );
    expect(state.future).toEqual([]);
  });

  it("no-ops when there is nothing to undo or redo", () => {
    const state = createMindMapHistoryState(a);
    expect(mindMapHistoryReducer(state, { type: "undo" })).toBe(state);
    expect(mindMapHistoryReducer(state, { type: "redo" })).toBe(state);
  });

  it("resets the tree and clears both stacks", () => {
    const state = run({ type: "commit", root: b }, { type: "undo" }, { type: "reset", root: c });
    expect(state).toEqual({ root: c, past: [], future: [] });
  });

  it("caps the stored history", () => {
    let state = createMindMapHistoryState(a);
    const nodes = Array.from({ length: MINDMAP_HISTORY_LIMIT + 10 }, (_, index) =>
      createMindMapNode(`n${index}`),
    );
    for (const node of nodes) {
      state = mindMapHistoryReducer(state, { type: "commit", root: node });
    }
    expect(state.past).toHaveLength(MINDMAP_HISTORY_LIMIT);
    expect(state.root).toBe(nodes[nodes.length - 1]);
  });
});
