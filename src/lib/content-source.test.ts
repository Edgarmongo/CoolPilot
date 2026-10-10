import { describe, expect, it } from "vitest";
import { contentSourceKey } from "./content-source";

/**
 * The 来源 column of 文章创作 (CI-SC-01).
 *
 * This mapping used to live inside `articles-workspace.tsx` as a local `articleSourceKey()`, which made
 * every origin a thing only a browser could check. Moving it here changed no reader and no label - the
 * cases below are the six readings it has always had, plus the two canvas origins it gained.
 */
describe("content source label", () => {
  it("reads the canvas origins first, so an export is never called 手动录入", () => {
    expect(contentSourceKey({ source: "mindmap" })).toBe("arSourceMindmap");
    expect(contentSourceKey({ source: "whiteboard" })).toBe("arSourceWhiteboard");
  });

  it("keeps 选题 above the wizard, the order CI-P2-01 introduced", () => {
    expect(contentSourceKey({ topicId: "topic-1", aiWriting: true })).toBe("arSourceTopic");
  });

  it("reads the wizard's own marker", () => {
    expect(contentSourceKey({ aiWriting: true })).toBe("arSourceWizard");
  });

  it("reads a URL import and a topic run off generationType", () => {
    expect(contentSourceKey({ generationType: "url-rewrite" })).toBe("arSourceUrl");
    expect(contentSourceKey({ generationType: "topic" })).toBe("arSourceAi");
  });

  it("reads anything unrecorded as 手动录入, including an absent metadata object", () => {
    expect(contentSourceKey({})).toBe("arSourceManual");
    expect(contentSourceKey(null)).toBe("arSourceManual");
    expect(contentSourceKey(undefined)).toBe("arSourceManual");
    expect(contentSourceKey({ source: "   " })).toBe("arSourceManual");
    // An origin written by a future card is *not* guessed at: the column says 手动录入 rather than
    // inventing a label for something this build does not know.
    expect(contentSourceKey({ source: "future-canvas" })).toBe("arSourceManual");
  });
});
