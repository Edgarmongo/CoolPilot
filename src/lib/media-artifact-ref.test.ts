import { describe, expect, it } from "vitest";
import { artifactImageUrl } from "./artifact-image-url";
import {
  MEDIA_ASSET_ROOTS,
  isMediaAssetRefUsable,
  isMediaAssetRoot,
  toMediaAssetRef,
} from "./media-artifact-ref";

/**
 * The reference contract of CI-P1-01 (contract §1 of `docs/coolpilot-integration-contracts.md`).
 *
 * These cases pin the four things the unified reference promises:
 *
 *  1. **every historical form resolves to the same address** - the bare name, the absolute Windows and
 *     POSIX paths, the app's own artifacts URL and a remote URL are all inputs `content_items` already
 *     holds, and they must not split into two generations of addresses;
 *  2. **idempotence** - feeding a produced `url` back in yields the same reference, which is what makes
 *     it safe to re-resolve stored values on every read;
 *  3. **a remote reference stays visible** (`external: true`, `remoteUrl` kept) instead of collapsing to
 *     an empty string, which is the information the publish path used to lose;
 *  4. **an unusable reference says so** (`url: ""`) rather than throwing or being dropped.
 */
describe("media artifact reference", () => {
  it("resolves every historical reference form to the same local asset", () => {
    const forms = [
      "cover.png",
      "C:\\app\\data\\artifacts\\cover.png",
      "C:/app/data/artifacts/cover.png",
      "/var/data/artifacts/cover.png",
      "artifacts/cover.png",
      "/api/agent/artifacts?file=cover.png",
      "http://127.0.0.1:3000/api/agent/artifacts?file=cover.png",
    ];

    for (const form of forms) {
      expect(toMediaAssetRef(form)).toEqual({
        fileName: "cover.png",
        kind: "image",
        mimeType: "image/png",
        root: "artifacts",
        source: "unknown",
        url: "/api/agent/artifacts?file=cover.png",
        external: false,
      });
    }
  });

  it("is idempotent: feeding a resolved url back in changes nothing", () => {
    const values = [
      "cover.png",
      "C:\\data\\writing-1700-abc.png",
      "online-1700-abc.jpg",
      "/api/videos?file=clip.mp4",
      "https://cdn.example.com/og/a.png",
    ];

    for (const value of values) {
      const once = toMediaAssetRef(value);
      expect(toMediaAssetRef(once.url)).toEqual(once);
    }
  });

  it("keeps a remote reference explicit instead of dropping it", () => {
    const ref = toMediaAssetRef("https://cdn.example.com/og/cover.png?w=1");

    expect(ref).toEqual({
      fileName: "",
      kind: "image",
      mimeType: "image/png",
      root: "artifacts",
      source: "remote",
      url: "https://cdn.example.com/og/cover.png?w=1",
      remoteUrl: "https://cdn.example.com/og/cover.png?w=1",
      external: true,
    });
    expect(isMediaAssetRefUsable(ref)).toBe(true);
  });

  it("classifies a remote reference whose path carries no extension", () => {
    const ref = toMediaAssetRef("https://example.com/image?id=7");

    expect(ref.external).toBe(true);
    expect(ref.kind).toBe("unknown");
    expect(ref.mimeType).toBe("application/octet-stream");
  });

  it("maps kinds and mime types from the extension", () => {
    const cases: Array<[string, string, string]> = [
      ["a.png", "image", "image/png"],
      ["a.jpg", "image", "image/jpeg"],
      ["a.jpeg", "image", "image/jpeg"],
      ["a.webp", "image", "image/webp"],
      ["a.gif", "image", "image/gif"],
      ["a.mp4", "video", "video/mp4"],
      ["a.mov", "video", "video/quicktime"],
      ["a.webm", "video", "video/webm"],
      ["a.m4v", "video", "video/x-m4v"],
      ["a.mp3", "audio", "audio/mpeg"],
      ["a.srt", "subtitle", "application/x-subrip"],
      ["a.txt", "document", "text/plain"],
      ["a.xyz", "unknown", "application/octet-stream"],
    ];

    for (const [fileName, kind, mimeType] of cases) {
      const ref = toMediaAssetRef(fileName);
      expect([fileName, ref.kind, ref.mimeType]).toEqual([fileName, kind, mimeType]);
    }
  });

  it("derives the source from the file-name prefix the writers already use", () => {
    expect(toMediaAssetRef("agent-image-1700-abc.png").source).toBe("generated");
    expect(toMediaAssetRef("writing-1700-abc.png").source).toBe("copied");
    expect(toMediaAssetRef("online-1700-abc.jpg").source).toBe("remote");
    expect(toMediaAssetRef("upload-1700-abc.png").source).toBe("uploaded");
    expect(toMediaAssetRef("cover.png").source).toBe("unknown");
  });

  it("puts a video in the videos root and everything else in artifacts", () => {
    expect(toMediaAssetRef("clip.mp4")).toMatchObject({ root: "videos", url: "/api/videos?file=clip.mp4" });
    expect(toMediaAssetRef("cover.png")).toMatchObject({ root: "artifacts", url: artifactImageUrl("cover.png") });
  });

  it("honours the root hint for the uploads sections, which no bare name can name", () => {
    const product = toMediaAssetRef("p.png", { root: "product-images" });

    expect(product).toMatchObject({ root: "product-images", source: "uploaded", kind: "image", fileName: "p.png" });
    // No route serves `uploads/` by name yet, and the reference says so instead of pretending otherwise.
    expect(product.url).toBe("");
    expect(isMediaAssetRefUsable(product)).toBe(false);
    expect(toMediaAssetRef("logo.png", { root: "brand-logos" }).root).toBe("brand-logos");
  });

  it("reports an unusable reference as unusable instead of throwing or dropping it", () => {
    const unusable = [
      "",
      ".",
      "..",
      "/api/agent/artifacts",
      "/api/agent/artifacts?file=",
      // A separator inside `file=` is refused outright: the serving route would 404 it anyway.
      "/api/agent/artifacts?file=..%2Fsecret.png",
      "/api/agent/artifacts?file=%2Fetc%2Fpasswd.png",
      // The artifacts route serves images only, so a non-image there has no address.
      "/api/agent/artifacts?file=notes.txt",
      "/api/agent/artifacts?file=clip.mp4",
    ];

    for (const value of unusable) {
      const ref = toMediaAssetRef(value);
      expect([value, ref.fileName, ref.url]).toEqual([value, "", ""]);
    }

    // A real file the workspace holds but no route serves: it keeps its name and reports no address,
    // which is a different statement from "unusable input" above.
    const note = toMediaAssetRef("notes.txt");
    expect([note.fileName, note.kind, note.url]).toEqual(["notes.txt", "document", ""]);
  });

  it("cannot escape a root: a traversal path collapses into a base name inside it", () => {
    const ref = toMediaAssetRef("..\\..\\secret.png");

    expect(ref.url).toBe("/api/agent/artifacts?file=secret.png");
    expect(ref.url).not.toContain("..");
    expect(toMediaAssetRef("/api/agent/artifacts?file=..%2F..%2Fsecret.png").url).toBe("");
  });

  it("does not trim, matching the frozen sibling resolver", () => {
    // The padding is part of the stored name, so a padded name with a clean extension still resolves -
    // to an address that only a file actually named ` cover.png` would answer (the route 404s otherwise).
    expect(toMediaAssetRef(" cover.png").url).toBe("/api/agent/artifacts?file=%20cover.png");
    // ` cover.png ` pads the *extension* as well, which is not a served one: no address, and the name is
    // still reported unchanged rather than trimmed into a different file.
    const padded = toMediaAssetRef(" cover.png ");
    expect([padded.fileName, padded.mimeType, padded.url]).toEqual([" cover.png ", "application/octet-stream", ""]);
  });

  it("exposes the root vocabulary and no other", () => {
    // `media` joined the vocabulary in CI-P3-02: the imported audio/video a transcription reads is a
    // workspace section of its own, served by `/api/media?file=`.
    expect([...MEDIA_ASSET_ROOTS]).toEqual(["artifacts", "videos", "media", "product-images", "brand-logos"]);
    expect(isMediaAssetRoot("videos")).toBe(true);
    expect(isMediaAssetRoot("media")).toBe(true);
    expect(isMediaAssetRoot("upload")).toBe(false);
  });
});
