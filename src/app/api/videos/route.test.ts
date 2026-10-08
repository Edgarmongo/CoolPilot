import fs from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

/**
 * P5-B0-2.5: the video library lives in `<workspace>/videos`, and reading it used to create that
 * folder: `videosRoot()` resolved the path and made the directory in the same call, so simply
 * opening the video library in a workspace that has no videos left an empty `videos/` behind.
 * Listing and streaming are reads, so they resolve the section and leave it missing.
 */

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;

let workspace = "";

function pinWorkspace() {
  workspace = fs.mkdtempSync(path.join(tmpdir(), "coolpilot-videos-route-"));
  process.env.SOCIAL_AUTO_POST_DATA_DIR = workspace;
}

pinWorkspace();
const { GET } = await import("./route");

const listing = () => GET(new Request("http://localhost/api/videos"));

function stream(file: string, headers?: Record<string, string>) {
  return GET(
    new Request(`http://localhost/api/videos?file=${encodeURIComponent(file)}`, { headers }),
  );
}

describe("GET /api/videos", () => {
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  afterAll(() => {
    if (previousDataDir === undefined) delete process.env.SOCIAL_AUTO_POST_DATA_DIR;
    else process.env.SOCIAL_AUTO_POST_DATA_DIR = previousDataDir;
  });

  it("lists the videos stored in the workspace and nothing else", async () => {
    fs.mkdirSync(path.join(workspace, "videos"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "videos", "clip.mp4"), "video-bytes");
    fs.writeFileSync(path.join(workspace, "videos", "notes.txt"), "not-a-video");

    const { data } = await (await listing()).json();

    expect(data.videos.map((entry: { fileName: string }) => entry.fileName)).toEqual(["clip.mp4"]);
  });

  it("streams a stored video, including the range a client asks for", async () => {
    fs.mkdirSync(path.join(workspace, "videos"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "videos", "clip.mp4"), "video-bytes");

    const full = await stream("clip.mp4");
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/mp4");
    expect(await full.text()).toBe("video-bytes");

    const ranged = await stream("clip.mp4", { range: "bytes=0-4" });
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe("video");
  });

  it("answers a listing and a missing video without initializing the workspace", async () => {
    const { data } = await (await listing()).json();
    expect(data.videos).toEqual([]);
    expect((await stream("clip.mp4")).status).toBe(404);
    expect((await stream("../credential-vault.json")).status).toBe(404);

    expect(fs.existsSync(workspace)).toBe(false);
  });
});
