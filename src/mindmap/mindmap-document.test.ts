import { describe, expect, it } from "vitest";
import { parseMindMapDocument, serializeMindMapDocument } from "./mindmap-document";
import { createMindMapNode } from "./mindmap-model";

const root = createMindMapNode("root", [createMindMapNode("branch")]);

describe("mind map document", () => {
  it("serialises to indented JSON that parses back", () => {
    const document_ = { version: 1 as const, root, themeId: "ocean", direction: "right" as const };
    const json = serializeMindMapDocument(document_);
    expect(json).toContain('\n  "root"');

    const parsed = parseMindMapDocument(json);
    expect(parsed).toEqual(document_);
  });

  it("accepts a bare node and a { root } wrapper", () => {
    expect(parseMindMapDocument(root)).toMatchObject({ themeId: "classic", direction: "balanced" });
    expect(parseMindMapDocument({ root, themeId: "ocean", direction: "right" })).toMatchObject({
      themeId: "ocean",
      direction: "right",
    });
    expect(parseMindMapDocument(JSON.stringify({ root }))?.root.content).toBe("root");
  });

  it("defaults unknown themes and directions", () => {
    const parsed = parseMindMapDocument({ root, themeId: 42, direction: "sideways" });
    expect(parsed).toMatchObject({ themeId: "classic", direction: "balanced", version: 1 });
  });

  it("rejects anything that is not a node tree", () => {
    expect(parseMindMapDocument(null)).toBeNull();
    expect(parseMindMapDocument("not json")).toBeNull();
    expect(parseMindMapDocument("[1,2,3]")).toBeNull();
    expect(parseMindMapDocument({ root: { id: "x", content: "no children" } })).toBeNull();
    expect(parseMindMapDocument({ root: { ...root, children: [{ id: 1 }] } })).toBeNull();
    expect(parseMindMapDocument({ root: { ...root, collapsed: "yes" } })).toBeNull();
  });

  it("returns a defensive deep clone", () => {
    const parsed = parseMindMapDocument({ root })!;
    expect(parsed.root).toEqual(root);
    expect(parsed.root).not.toBe(root);
    expect(parsed.root.children[0]).not.toBe(root.children[0]);
  });
});
