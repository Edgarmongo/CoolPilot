import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * CI-P1-04-03: the render task against a real database, which is where the card's central claim is
 * decided - **a render task is a task of the existing task system**.
 *
 * `video-renderer.test.ts` pins what the adapter writes; this file pins what the task does with it:
 *
 * - the task is a `runs` row of type `video_render`, so CI-P1-02's own view (`findTaskView`) reports its
 *   canonical status, its `resultUrl`, its progress from its own log and its real timestamps;
 * - a failure is recorded **on the task** with the refusal's code and no render at all - never a success;
 * - a task that already reached a terminal status is not rendered a second time;
 * - a `queued` render task is cancellable through CI-P1-02's cancellation rule before it runs.
 *
 * `@/db/client` resolves its database URL once, when it is first imported, so the throwaway workspace is
 * put in the environment before any module of the app is loaded, exactly like `src/lib/tasks/
 * task-library.test.ts`.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), "coolpilot-video-task-"));
const workspace = path.join(tempDir, "CoolPilot", "web-data");

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
let tasks: typeof import("@/lib/tasks/task-library");
let videoTask: typeof import("./video-render-task");

beforeAll(async () => {
  repository = await import("@/db/repository");
  ({ sqlite } = await import("@/db/client"));
  tasks = await import("@/lib/tasks/task-library");
  videoTask = await import("./video-render-task");
  // Migrations run on the first repository call, exactly like the app's first request.
  await repository.listRuns(1);
  mkdirSync(videosDir, { recursive: true });
});

beforeEach(() => {
  // Each test starts from a workspace the previous test's renders cannot leak into: what a test leaves
  // behind is part of what it asserts.
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

/** Everything the render wrote, so a test can say what it left behind. */
function renderedFiles() {
  return readdirSync(videosDir).filter((name) => name !== "clip.mp4").sort();
}

const request = {
  template: { id: "existing_video_package" },
  materials: { video: "clip.mp4" },
  params: { captions: [{ startMs: 0, endMs: 1_000, text: "hello" }] },
};

describe("render task", () => {
  it("creates a real task the unified view can report, with the deliverable as its result", async () => {
    const { run, outcome } = await videoTask.runVideoRenderTask(request);

    expect(outcome.kind).toBe("succeeded");
    if (outcome.kind !== "succeeded") return;
    expect(run.playbookId).toBe("video_render");
    expect(outcome.run.status).toBe("success");
    expect(outcome.run.artifactPath).toBe(outcome.artifacts.video.url);

    const view = await tasks.findTaskView(run.id);
    expect(view).toMatchObject({
      id: run.id,
      kind: "playbook",
      type: "video_render",
      status: "succeeded",
      rawStatus: "success",
      progress: 100,
      resultUrl: outcome.artifacts.video.url,
    });
    expect(view?.startedAt).toBeGreaterThan(0);
    expect(view?.finishedAt).toBeGreaterThan(0);
    expect(view?.input).toMatchObject({ template: { id: "existing_video_package" } });

    const logs = await tasks.listTaskLogs("playbook", run.id);
    expect(logs.map((entry) => entry.stage)).toEqual([
      "run",
      "materials",
      "video",
      "subtitles",
      "package",
      "done",
    ]);
    expect(logs.at(-1)?.message).toContain("Video render succeeded");
    expect(logs.at(-1)?.data).toMatchObject({
      resultUrl: outcome.artifacts.video.url,
      renderer: { name: "existing-video-package", encoded: false },
    });

    // The deliverable really is on disk, with the material's own bytes.
    expect(readFileSync(path.join(videosDir, outcome.artifacts.video.fileName), "utf8")).toBe(materialBytes);
    expect(renderedFiles()).toEqual(
      [outcome.artifacts.video.fileName, outcome.artifacts.metadata.fileName, outcome.artifacts.subtitles?.fileName]
        .filter((name): name is string => Boolean(name))
        .sort(),
    );
  });

  it("records a refusal on the task, writes nothing and never claims success", async () => {
    const { run, outcome } = await videoTask.runVideoRenderTask({
      ...request,
      materials: { video: "gone.mp4" },
    });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.failure.code).toBe("MATERIAL_NOT_FOUND");
    expect(outcome.run.status).toBe("failed");

    const view = await tasks.findTaskView(run.id);
    expect(view?.status).toBe("failed");
    expect(view?.error?.code).toBe("RUN_FAILED");
    expect(view?.error?.message).toContain("MATERIAL_NOT_FOUND");
    // No stage ever reported progress, so progress is `null` - the contract's "unknown", never `0`.
    expect(view?.progress).toBeNull();
    expect(view?.resultUrl).toBeUndefined();
    expect(renderedFiles()).toEqual([]);
  });

  it("runs a task that already reached a terminal status only once", async () => {
    const { run } = await videoTask.runVideoRenderTask(request);
    const rendered = renderedFiles();

    const again = await videoTask.executeVideoRenderTask(run.id);

    expect(again.kind).toBe("skipped");
    expect(again.kind === "skipped" ? again.reason : "").toContain("success");
    expect(renderedFiles()).toEqual(rendered);
  });

  it("lets a queued render task be cancelled before it runs", async () => {
    const queued = await videoTask.createVideoRenderTask(request);
    expect(queued.status).toBe("queued");

    const cancelled = await tasks.cancelTask("playbook", queued.id);

    expect(cancelled?.cancelled).toBe(true);
    expect((await tasks.findTaskView(queued.id))?.status).toBe("cancelled");
    // A cancelled task is terminal: the executor refuses it instead of rendering anyway.
    expect((await videoTask.executeVideoRenderTask(queued.id)).kind).toBe("skipped");
    expect(renderedFiles()).toEqual([]);
  });

  it("fails a queued row whose parameters are not a render request at all", async () => {
    const junk = await videoTask.createVideoRenderTask({ template: { id: "existing_video_package" } });

    const outcome = await videoTask.executeVideoRenderTask(junk.id);

    expect(outcome.kind).toBe("failed");
    expect(outcome.kind === "failed" ? outcome.failure.code : "").toBe("REQUEST_INVALID");
    expect((await tasks.findTaskView(junk.id))?.status).toBe("failed");
    expect(renderedFiles()).toEqual([]);
  });

  it("refuses to execute a task that is not a render task", async () => {
    const other = await repository.createRun({ playbookId: "article_scraper_rewriter" });
    if (!other) throw new Error("the probe run was expected to be created");

    await expect(videoTask.executeVideoRenderTask(other.id)).rejects.toThrow(/not a video render task/);
  });

  it("renders a queued row through the worker's own dispatch", async () => {
    const { processRun } = await import("@/worker/runner");
    const queued = await videoTask.createVideoRenderTask(request);

    await processRun(queued);

    const view = await tasks.findTaskView(queued.id);
    expect(view?.status).toBe("succeeded");
    expect(renderedFiles()).toEqual(expect.arrayContaining([expect.stringMatching(/^render-.*\.mp4$/)]));
    // The deliverable's address is in the task's own log on this path too. (`runs.artifact_path` is written
    // by the tool path; `processRun`'s final status write does not carry one - see the card's delivery
    // record, "已知限制 1".)
    const logs = await tasks.listTaskLogs("playbook", queued.id);
    const done = logs.find((entry) => entry.stage === "done");
    expect(done?.data.resultUrl).toMatch(/^\/api\/videos\?file=render-/);
  });
});

