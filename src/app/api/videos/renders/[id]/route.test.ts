import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * CI-P1-04-07: one render package, and the bytes of one of its artifacts.
 *
 * This is the half of the card that makes a package's `.srt` and `.json` sidecars readable at all. They
 * are real files in `<workspace>/videos`, but `/api/videos` is the *library's* route and refuses every
 * non-video extension by design, so before this route they had no address: the CI-P1-01 artifact model
 * reported `url: ""` for them.
 *
 * Everything here runs a **real** render first, then asks this route for the files it names - because the
 * route's central rule is an allowlist, and an allowlist can only be pinned against files that exist:
 *
 * 1. only a file the task itself reported is served, so the material the package was made from (which is
 *    in the same folder and is named in the task's own log) is emphatically *not* served;
 * 2. a name is a file name, not a path, so a traversal is refused even when it names a real file;
 * 3. a task that is not a render task is not found at all.
 *
 * `@/db/client` resolves its database URL once, when it is first imported, so the throwaway workspace is
 * put in the environment before any module of the app is loaded.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), "coolpilot-render-route-"));
const workspace = path.join(tempDir, "web-data");

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;
const previousDbUrl = process.env.SOCIAL_AUTO_POST_DB_URL;
process.env.SOCIAL_AUTO_POST_DATA_DIR = workspace;
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path
  .join(workspace, "social-auto-post.db")
  .replace(/\\/g, "/")}`;

const videosDir = path.join(workspace, "videos");
const materialBytes = "real-video-bytes";

let repository: typeof import("@/db/repository");
let sqlite: typeof import("@/db/client").sqlite;
let videoTask: typeof import("@/lib/videos/video-render-task");
let route: typeof import("./route");

const request = {
  template: { id: "existing_video_package" },
  materials: { video: "clip.mp4" },
  params: { captions: [{ startMs: 0, endMs: 1_000, text: "hello" }] },
};

beforeAll(async () => {
  repository = await import("@/db/repository");
  ({ sqlite } = await import("@/db/client"));
  videoTask = await import("@/lib/videos/video-render-task");
  route = await import("./route");
  await repository.listRuns(1);
});

beforeEach(async () => {
  await sqlite.execute("DELETE FROM run_events");
  await sqlite.execute("DELETE FROM runs");
  rmSync(videosDir, { recursive: true, force: true });
  mkdirSync(videosDir, { recursive: true });
  writeFileSync(path.join(videosDir, "clip.mp4"), materialBytes);
});

afterAll(async () => {
  await sqlite.close();
  if (previousDataDir === undefined) delete process.env.SOCIAL_AUTO_POST_DATA_DIR;
  else process.env.SOCIAL_AUTO_POST_DATA_DIR = previousDataDir;
  if (previousDbUrl === undefined) delete process.env.SOCIAL_AUTO_POST_DB_URL;
  else process.env.SOCIAL_AUTO_POST_DB_URL = previousDbUrl;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // A throwaway folder the OS reclaims on its own.
  }
});

/** One request against the route: the id as the router passes it, and the optional `?file=`. */
function call(id: string, file?: string) {
  const suffix = file === undefined ? "" : `?file=${encodeURIComponent(file)}`;
  return route.GET(new Request(`http://localhost/api/videos/renders/${encodeURIComponent(id)}${suffix}`), {
    params: Promise.resolve({ id }),
  });
}

/** A real package, so the assertions below are about files that exist. */
async function render() {
  const { run, outcome } = await videoTask.runVideoRenderTask(request);
  if (outcome.kind !== "succeeded") throw new Error("the probe render was expected to succeed");
  const subtitles = outcome.artifacts.subtitles;
  if (!subtitles) throw new Error("the probe render was expected to write a subtitle track");
  return { run, video: outcome.artifacts.video, subtitles, metadata: outcome.artifacts.metadata };
}

describe("GET /api/videos/renders/[id]", () => {
  it("answers an id that names nothing, and a task that is not a render task, with 404", async () => {
    const other = await repository.createRun({ playbookId: "article_scraper_rewriter" });
    if (!other) throw new Error("the probe run was expected to be created");

    expect((await call("does-not-exist")).status).toBe(404);
    expect((await call(other.id)).status).toBe(404);
    // Even with a `?file=`, a task that is not a render task is not a file server.
    expect((await call(other.id, "clip.mp4")).status).toBe(404);
  });

  it("describes one package: the canonical task view and its three artifacts", async () => {
    const { run, subtitles } = await render();

    const response = await call(run.id);
    const { data } = await response.json();

    expect(response.status).toBe(200);
    expect(data.task).toMatchObject({ id: run.id, type: "video_render", status: "succeeded" });
    expect(data.encoded).toBe(false);
    expect(data.artifacts.map((artifact: { slot: string }) => artifact.slot)).toEqual([
      "video",
      "subtitles",
      "metadata",
    ]);
    expect(data.artifacts[1].url).toBe(
      `/api/videos/renders/${run.id}?file=${encodeURIComponent(subtitles.fileName)}`,
    );
  });

  it("streams the subtitle sidecar as the SRT document the renderer wrote", async () => {
    const { run, subtitles } = await render();

    const response = await call(run.id, subtitles.fileName);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-subrip; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${subtitles.fileName}"`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("1\n00:00:00,000 --> 00:00:01,000\nhello\n");
  });

  it("streams the metadata sidecar as the package's own account of itself", async () => {
    const { run, video, subtitles, metadata } = await render();

    const response = await call(run.id, metadata.fileName);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(JSON.parse(await response.text())).toMatchObject({
      taskId: run.id,
      template: { id: "existing_video_package" },
      renderer: { name: "existing-video-package", encoded: false },
      artifacts: { video: video.fileName, subtitles: subtitles.fileName },
    });
  });

  it("streams the deliverable with the library's content type and the material's own bytes", async () => {
    const { run, video } = await render();

    const response = await call(run.id, video.fileName);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-length")).toBe(String(materialBytes.length));
    expect(await response.text()).toBe(materialBytes);
  });

  it("refuses a name the task never reported - including the material it was made from", async () => {
    const { run } = await render();

    // `clip.mp4` sits in the same folder, is a real video, and the task's own log names it - as the
    // *material* of the package (the `materials` stage), which is not a product of it.
    expect((await call(run.id, "clip.mp4")).status).toBe(404);
    expect((await call(run.id, "notes.txt")).status).toBe(404);
    expect((await call(run.id, "render-does-not-exist.mp4")).status).toBe(404);
  });

  it("refuses a path, a traversal and another task's artifact", async () => {
    const first = await render();
    const second = await render();

    // A real file at the workspace root, which a traversal would reach if the name were treated as a path.
    writeFileSync(path.join(workspace, "credential-vault.json"), "secrets");
    expect((await call(first.run.id, "../credential-vault.json")).status).toBe(404);
    expect((await call(first.run.id, "..\\credential-vault.json")).status).toBe(404);
    expect((await call(first.run.id, `videos/${first.video.fileName}`)).status).toBe(404);
    // The same, once the traversal has been normalised away by a client - still not a render artifact.
    expect((await call(first.run.id, "credential-vault.json")).status).toBe(404);

    // A second package's sidecar is a legitimate artifact of that package, and of no other.
    expect((await call(first.run.id, second.subtitles.fileName)).status).toBe(404);
    expect((await call(second.run.id, second.subtitles.fileName)).status).toBe(200);
  });

  it("answers 404 for an artifact the log names but the disk no longer holds, and writes nothing", async () => {
    const { run, subtitles } = await render();
    rmSync(path.join(videosDir, subtitles.fileName));

    const response = await call(run.id, subtitles.fileName);

    expect(response.status).toBe(404);
    // A read leaves the workspace as it found it: serving never re-creates what it serves.
    expect(existsSync(path.join(videosDir, subtitles.fileName))).toBe(false);
    expect(existsSync(videosDir)).toBe(true);
  });
});

