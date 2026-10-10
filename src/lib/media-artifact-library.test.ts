import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listMediaAssets } from "./media-artifact-library";

/**
 * The listing half of CI-P1-01: the four roots, the sources, and the two rules that make this safe to
 * call from a `GET` - it must not create a section it finds missing (P5-B0-2.5) and it must not hide a
 * file just because no route serves its root yet (`url: ""` says that instead).
 */
let dataDir = "";

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "coolpilot-media-"));
  process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;
  await fs.mkdir(path.join(dataDir, "artifacts"), { recursive: true });
  await fs.mkdir(path.join(dataDir, "videos"), { recursive: true });
  await fs.mkdir(path.join(dataDir, "uploads", "product-images"), { recursive: true });
});

afterEach(async () => {
  delete process.env.SOCIAL_AUTO_POST_DATA_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("media artifact library", () => {
  it("lists every root with its own kind, source and serving url", async () => {
    await fs.writeFile(path.join(dataDir, "artifacts", "cover.png"), "x");
    await fs.writeFile(path.join(dataDir, "artifacts", "agent-image-1700-abc.png"), "x");
    await fs.writeFile(path.join(dataDir, "artifacts", "online-1700-abc.jpg"), "x");
    await fs.writeFile(path.join(dataDir, "videos", "clip.mp4"), "x");
    await fs.writeFile(path.join(dataDir, "uploads", "product-images", "p.png"), "x");
    // A directory inside a root is not an asset.
    await fs.mkdir(path.join(dataDir, "artifacts", "nested"), { recursive: true });

    const assets = await listMediaAssets();

    expect(assets.map((asset) => [asset.root, asset.fileName, asset.source, asset.url])).toEqual([
      ["artifacts", "agent-image-1700-abc.png", "generated", "/api/agent/artifacts?file=agent-image-1700-abc.png"],
      ["artifacts", "cover.png", "unknown", "/api/agent/artifacts?file=cover.png"],
      ["artifacts", "online-1700-abc.jpg", "remote", "/api/agent/artifacts?file=online-1700-abc.jpg"],
      ["videos", "clip.mp4", "uploaded", "/api/videos?file=clip.mp4"],
      ["product-images", "p.png", "uploaded", ""],
    ]);
  });

  it("answers a missing section with an empty list and does not create it", async () => {
    const assets = await listMediaAssets();

    expect(assets.filter((asset) => asset.root === "brand-logos")).toEqual([]);
    // The whole workspace was empty apart from the two roots and the one uploads section above; the
    // point of the assertion is that listing created nothing new.
    await expect(fs.access(path.join(dataDir, "uploads", "brand-logos"))).rejects.toThrow();
  });

  it("keeps files it cannot serve yet instead of hiding them", async () => {
    await fs.writeFile(path.join(dataDir, "artifacts", "notes.txt"), "x");

    const assets = await listMediaAssets();
    const note = assets.find((asset) => asset.fileName === "notes.txt");

    expect(note).toMatchObject({ kind: "document", root: "artifacts", url: "" });
  });
});
