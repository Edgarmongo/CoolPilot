import { describe, expect, it } from "vitest";
import { IMAGE_FILE_EXTENSIONS, artifactImageUrl, resolveArtifactImageSrc } from "./artifact-image-url";

/**
 * The resolver contract of A02 (`docs/p1-card-01-acceptance.md`).
 *
 * Before this file the rule lived in five identical copies inside client components
 * (`articles-workspace`, `ai-writing-step-output`, `article-editor`, `posts-composer`,
 * `content/library`) and had no test at all, while `artifactImageUrl` next to it was only ever
 * exercised through route tests. Two things are pinned here:
 *
 *  1. the **supported set** - an empty reference, a bare file name, an absolute local path and a
 *     remote URL - which is the four-input compatibility set the card promises;
 *  2. the **URL shape**, byte for byte. `article-editor` writes that exact string into
 *     `content_items.body` when an image is inserted, so stored articles already carry it and a
 *     different shape would split the data into two generations.
 *
 * The cases at the end are *records*, not promises: they describe what the current code happens to
 * answer for inputs outside the supported set, so that a later change to them is a deliberate
 * decision rather than a silent one. They deliberately assert today's behaviour instead of an
 * ideal one - see the acceptance note for why `file://`, `?query`, directory-relative paths and the
 * app's own URL are not part of the contract.
 */

describe("artifact image url", () => {
  it("keeps the stored URL shape, byte for byte", () => {
    expect(artifactImageUrl("cover.png")).toBe("/api/agent/artifacts?file=cover.png");
    expect(artifactImageUrl("writing-1700000000000-abc.png")).toBe(
      "/api/agent/artifacts?file=writing-1700000000000-abc.png",
    );
    // The client resolver is the same shape, which is what makes the five call sites exchangeable.
    expect(resolveArtifactImageSrc("cover.png")).toBe(artifactImageUrl("cover.png"));
  });

  it("answers an empty reference with an empty src", () => {
    expect(resolveArtifactImageSrc()).toBe("");
    expect(resolveArtifactImageSrc("")).toBe("");
  });

  it("turns a bare file name into the artifacts URL", () => {
    expect(resolveArtifactImageSrc("cover.png")).toBe("/api/agent/artifacts?file=cover.png");
  });

  it("reduces an absolute local path to its base name", () => {
    expect(resolveArtifactImageSrc("C:\\app\\data\\artifacts\\cover.png")).toBe(
      "/api/agent/artifacts?file=cover.png",
    );
    expect(resolveArtifactImageSrc("C:/app/data/artifacts/cover.png")).toBe("/api/agent/artifacts?file=cover.png");
    expect(resolveArtifactImageSrc("\\\\srv\\share\\artifacts\\cover.png")).toBe(
      "/api/agent/artifacts?file=cover.png",
    );
    expect(resolveArtifactImageSrc("/var/data/artifacts/cover.png")).toBe("/api/agent/artifacts?file=cover.png");
    expect(resolveArtifactImageSrc("/cover.png")).toBe("/api/agent/artifacts?file=cover.png");
  });

  it("passes a remote URL through untouched", () => {
    expect(resolveArtifactImageSrc("https://cdn.example.com/og/a.png")).toBe("https://cdn.example.com/og/a.png");
    expect(resolveArtifactImageSrc("https://cdn.example.com/a.png?w=1")).toBe("https://cdn.example.com/a.png?w=1");
    expect(resolveArtifactImageSrc("http://example.com/a.png")).toBe("http://example.com/a.png");
    // The scheme test is case-insensitive, and the value itself is never re-cased.
    expect(resolveArtifactImageSrc("HTTPS://EXAMPLE.COM/A.png")).toBe("HTTPS://EXAMPLE.COM/A.png");
  });

  it("encodes the base name, never the directory", () => {
    expect(resolveArtifactImageSrc("my cover 图.png")).toBe("/api/agent/artifacts?file=my%20cover%20%E5%9B%BE.png");
    expect(resolveArtifactImageSrc("C:\\dir\\a&b#c.png")).toBe("/api/agent/artifacts?file=a%26b%23c.png");
  });

  it("does not inspect the extension and does not trim", () => {
    // The resolver only answers "which address", so it must not start filtering by extension here -
    // `notes.txt` below is a case that its callers, not the resolver, are the ones to refuse.
    expect(resolveArtifactImageSrc("anim.gif")).toBe("/api/agent/artifacts?file=anim.gif");
    expect(resolveArtifactImageSrc("notes.txt")).toBe("/api/agent/artifacts?file=notes.txt");
    // No trimming, by decision (Q4): a name with padding stays whatever was stored.
    expect(resolveArtifactImageSrc(" cover.png ")).toBe("/api/agent/artifacts?file=%20cover.png%20");
  });

  it("records, without promising, the inputs outside the supported set", () => {
    // Q6: not part of the contract, only today's behaviour.
    expect(resolveArtifactImageSrc("b/c.png")).toBe("/api/agent/artifacts?file=c.png");
    expect(resolveArtifactImageSrc("file:///c:/x/a.png")).toBe("/api/agent/artifacts?file=a.png");
    expect(resolveArtifactImageSrc("a.png?x=1")).toBe("/api/agent/artifacts?file=a.png%3Fx%3D1");
    // A traversal attempt loses everything up to the last separator, so no path escapes the route.
    expect(resolveArtifactImageSrc("..\\..\\credential-vault.json")).toBe(
      "/api/agent/artifacts?file=credential-vault.json",
    );
  });

  it("records the app's own URL as an unsupported input", () => {
    // Q3: feeding a stored `/api/agent/artifacts?file=` URL back in is not supported and
    // double-encodes the parameter. Frozen as a boundary, not fixed in this card.
    expect(resolveArtifactImageSrc("/api/agent/artifacts?file=x.png")).toBe(
      "/api/agent/artifacts?file=artifacts%3Ffile%3Dx.png",
    );
  });

  it("freezes the served extension set as the baseline it is today", () => {
    // The library lists and serves these five, and since F1 (`docs/p1-card-01-defect-f1-f3-plan.md`)
    // the artifacts route maps all five as well - the set and the route's content-type map agree
    // again. A change here has to be deliberate and carries this line with it.
    expect([...IMAGE_FILE_EXTENSIONS].sort()).toEqual([".gif", ".jpeg", ".jpg", ".png", ".webp"]);
  });
});
