import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteArtifactImageFiles, listArtifactImageFiles } from "./image-library";

let dataDir = "";

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "coolpilot-images-"));
  process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;
  await fs.mkdir(path.join(dataDir, "artifacts"), { recursive: true });
});

afterEach(async () => {
  delete process.env.SOCIAL_AUTO_POST_DATA_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("image library", () => {
  it("lists only image files from the artifacts directory", async () => {
    const artifacts = path.join(dataDir, "artifacts");
    await fs.writeFile(path.join(artifacts, "a.png"), "x");
    await fs.writeFile(path.join(artifacts, "b.jpg"), "x");
    await fs.writeFile(path.join(artifacts, "note.txt"), "x");

    expect((await listArtifactImageFiles()).sort()).toEqual(["a.png", "b.jpg"]);
  });

  it("deletes the requested images and reports them", async () => {
    const artifacts = path.join(dataDir, "artifacts");
    await fs.writeFile(path.join(artifacts, "a.png"), "x");
    await fs.writeFile(path.join(artifacts, "b.png"), "x");

    expect(await deleteArtifactImageFiles(["a.png"])).toEqual(["a.png"]);
    expect(await listArtifactImageFiles()).toEqual(["b.png"]);
  });

  it("ignores path traversal, unsupported extensions and unknown names", async () => {
    const artifacts = path.join(dataDir, "artifacts");
    await fs.writeFile(path.join(artifacts, "safe.png"), "x");
    await fs.writeFile(path.join(dataDir, "secret.png"), "x");

    const deleted = await deleteArtifactImageFiles(["../secret.png", "safe.txt", "missing.png"]);

    expect(deleted).toEqual(["missing.png"]);
    expect(await listArtifactImageFiles()).toEqual(["safe.png"]);
    await expect(fs.access(path.join(dataDir, "secret.png"))).resolves.toBeUndefined();
  });
});
