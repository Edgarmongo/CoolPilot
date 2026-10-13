import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { videoRenderToolPath } from "@/lib/videos/video-render-artifacts";

/**
 * CI-P1-04-07: the read model a screen renders the video render surface from.
 *
 * The card's claim is "a render can be created, and the files it produced can be reached". So this file
 * runs a **real** render task against a throwaway workspace and then reads the route: what it pins is
 * that the three files the renderer wrote (deliverable, `.srt`, `.json`) each arrive with an address, and
 * that a task which is not a render task is never reported as a render.
 *
 * `@/db/client` resolves its database URL once, when it is first imported, so the throwaway workspace is
 * put in the environment before any module of the app is loaded - the same rule
 * `src/lib/videos/video-render-task.test.ts` follows.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), "coolpilot-renders-route-"));
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

/** A render request the installed renderer can satisfy; captions included so all three files exist. */
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
  // Migrations run on the first repository call, exactly like the app's first request.
  await repository.listRuns(1);
});

beforeEach(async () => {
  // A throwaway database and workspace, reset per test, so "how many renders" means what it says.
  await sqlite.execute("DELETE FROM run_events");
  await sqlite.execute("DELETE FROM runs");
  rmSync(videosDir, { recursive: true, force: true });
  mkdirSync(videosDir, { recursive: true });
  writeFileSync(path.join(videosDir, "clip.mp4"), materialBytes);
});

afterAll(async () => {
  // The app never closes its own connection; Windows refuses to remove a file a live handle holds.
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

type RenderEntry = {
  task: { id: string; type: string; status: string };
  artifacts: { slot: string; fileName: string; kind: string; mimeType: string; url: string }[];
  encoded: boolean | null;
};

type TemplateEntry = {
  id: string;
  version: number;
  description: string;
  materials: string[];
  params: string[];
};

const list = (query = "") => route.GET(new Request(`http://localhost/api/videos/renders${query}`));

async function read(query = "") {
  const response = await list(query);
  const body = await response.json();
  return { response, templates: body.data.templates as TemplateEntry[], renders: body.data.renders as RenderEntry[] };
}

/** Two runs created in the same millisecond tie on `created_at`; a few ms apart they cannot. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("GET /api/videos/renders", () => {
  it("offers the templates the build publishes, before any render has run", async () => {
    const { response, templates, renders } = await read();

    expect(response.status).toBe(200);
    expect(renders).toEqual([]);
    expect(templates).toEqual([
      {
        id: "existing_video_package",
        version: expect.any(Number),
        description: expect.any(String),
        materials: ["video", "cover"],
        params: ["title", "captions", "subtitles"],
      },
    ]);
  });

  it("reports a render with the three artifacts its own log recorded", async () => {
    const { run, outcome } = await videoTask.runVideoRenderTask(request);
    if (outcome.kind !== "succeeded") throw new Error("the probe render was expected to succeed");
    const video = outcome.artifacts.video;
    const subtitles = outcome.artifacts.subtitles;
    const metadata = outcome.artifacts.metadata;
    if (!subtitles) throw new Error("the probe render was expected to write a subtitle track");

    const { renders } = await read();

    expect(renders).toHaveLength(1);
    expect(renders[0].task).toMatchObject({ id: run.id, type: "video_render", status: "succeeded" });
    // The installed renderer copies the material; it never encodes a frame, and it says so.
    expect(renders[0].encoded).toBe(false);
    expect(renders[0].artifacts).toEqual([
      {
        slot: "video",
        fileName: video.fileName,
        kind: "video",
        mimeType: "video/mp4",
        // The deliverable is an ordinary stored video, so it keeps the library's own address.
        url: `/api/videos?file=${encodeURIComponent(video.fileName)}`,
      },
      {
        slot: "subtitles",
        fileName: subtitles.fileName,
        kind: "subtitle",
        mimeType: "application/x-subrip; charset=utf-8",
        url: `/api/videos/renders/${run.id}?file=${encodeURIComponent(subtitles.fileName)}`,
      },
      {
        slot: "metadata",
        fileName: metadata.fileName,
        kind: "document",
        mimeType: "application/json; charset=utf-8",
        url: `/api/videos/renders/${run.id}?file=${encodeURIComponent(metadata.fileName)}`,
      },
    ]);
  });

  it("names the write entry exactly as the registry registers the tool", async () => {
    // Two spellings of one fact: this path is what the screen POSTs to, and the registry's own name is the
    // path the route serves. The screen cannot import the tool module (it would pull `node:fs` into the
    // browser bundle), so the agreement is pinned here instead of being assumed.
    const { videoRenderToolName } = await import("@/lib/videos/video-render-tool");
    expect(videoRenderToolPath).toBe(`/api/tools/${videoRenderToolName}`);
  });

  it("does not report a task that is not a render task", async () => {
    const other = await repository.createRun({ playbookId: "article_scraper_rewriter" });
    if (!other) throw new Error("the probe run was expected to be created");

    const { renders } = await read();

    expect(renders).toEqual([]);
  });

  it("reports a failed render as a failed render, with no artifacts and no invented encoding", async () => {
    const { run } = await videoTask.runVideoRenderTask({
      ...request,
      materials: { video: "gone.mp4" },
    });

    const { renders } = await read();

    expect(renders).toHaveLength(1);
    expect(renders[0].task).toMatchObject({ id: run.id, status: "failed" });
    expect(renders[0].artifacts).toEqual([]);
    // The log records no `encoded` fact for a render that never reached its deliverable stage, and an
    // absent fact is reported as "unknown" - never as a `false` the task never said.
    expect(renders[0].encoded).toBeNull();
  });

  it("answers the newest render first and honours the limit it was given", async () => {
    const first = await videoTask.runVideoRenderTask(request);
    await tick();
    const second = await videoTask.runVideoRenderTask(request);

    const all = await read();
    expect(all.renders.map((render) => render.task.id)).toEqual([second.run.id, first.run.id]);

    const limited = await read("?limit=1");
    expect(limited.renders.map((render) => render.task.id)).toEqual([second.run.id]);

    // A limit that is not a usable number is the default, never an empty answer or an unbounded scan.
    expect((await read("?limit=nonsense")).renders).toHaveLength(2);
    expect((await read("?limit=0")).renders).toHaveLength(2);
  });
});

