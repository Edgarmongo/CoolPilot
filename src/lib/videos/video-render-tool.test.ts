import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * CI-P1-04-03: the render tool through the CI-P1-03 entry, which is where this card meets the two cards
 * before it.
 *
 * What is pinned here is only what the tool adds to the pipeline `video-render-task.test.ts` already
 * proves:
 *
 * - **approval comes first** - an unapproved call creates no task and writes no file;
 * - **the id it answers with is queryable** - through CI-P1-02's own route (`GET /api/tasks/<id>`), not
 *   just in-process, because that is the promise a caller polls on;
 * - **a failed render is a failed call** - `ok: true` is never returned for a render that did not
 *   succeed, and the task the tool left behind is where the diagnosis lives;
 * - **the call is logged where the caller says it happened** - naming a host task writes the tool-call
 *   record into that task's `run_events`, like every other tool of the registry.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), "coolpilot-video-tool-"));
const workspace = path.join(tempDir, "CoolPilot", "web-data");

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;
const previousDbUrl = process.env.SOCIAL_AUTO_POST_DB_URL;
process.env.SOCIAL_AUTO_POST_DATA_DIR = workspace;
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path
  .join(workspace, "social-auto-post.db")
  .replace(/\\/g, "/")}`;

const videosDir = path.join(workspace, "videos");

let repository: typeof import("@/db/repository");
let sqlite: typeof import("@/db/client").sqlite;
let tools: typeof import("@/lib/tools/tool-library");
let tasks: typeof import("@/lib/tasks/task-library");
let taskRoute: typeof import("@/app/api/tasks/[id]/route");

beforeAll(async () => {
  repository = await import("@/db/repository");
  ({ sqlite } = await import("@/db/client"));
  tools = await import("@/lib/tools/tool-library");
  tasks = await import("@/lib/tasks/task-library");
  taskRoute = await import("@/app/api/tasks/[id]/route");
  await repository.listRuns(1);
});

beforeEach(() => {
  rmSync(videosDir, { recursive: true, force: true });
  mkdirSync(videosDir, { recursive: true });
  writeFileSync(path.join(videosDir, "clip.mp4"), "real-video-bytes");
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

const approved = { approvals: { grantedToolCallId: "call_render_1" } };

const request = {
  template: { id: "existing_video_package" },
  materials: { video: "clip.mp4" },
  params: { captions: [{ startMs: 0, endMs: 1_000, text: "hello" }] },
};

function renderedFiles() {
  return readdirSync(videosDir).filter((name) => name !== "clip.mp4");
}

async function taskCount() {
  return (await repository.listRuns(200)).length;
}

async function readTask(id: string) {
  const response = await taskRoute.GET(new Request(`http://localhost/api/tasks/${id}`), {
    params: Promise.resolve({ id }),
  });
  return { status: response.status, body: await response.json() };
}

describe("video_render through the tool entry", () => {
  it("stops at the approval gate before it creates anything", async () => {
    const before = await taskCount();

    const outcome = await tools.callTool("video_render", request);

    expect(outcome.result.ok).toBe(false);
    expect(outcome.result.ok ? "" : outcome.result.error.code).toBe("APPROVAL_REQUIRED");
    expect(await taskCount()).toBe(before);
    expect(renderedFiles()).toEqual([]);
  });

  it("answers a real task id, and CI-P1-02's own route can read that task", async () => {
    const outcome = await tools.callTool("video_render", request, approved);

    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;
    const data = outcome.result.data as {
      taskId: string;
      taskStatus: string;
      taskRawStatus: string;
      lookup: string;
      renderer: { encoded: boolean };
      artifacts: { video: { fileName: string; url: string } };
    };
    expect(data.taskStatus).toBe("succeeded");
    expect(data.taskRawStatus).toBe("success");
    expect(data.lookup).toBe(`/api/tasks/${data.taskId}`);
    expect(data.renderer.encoded).toBe(false);
    expect(outcome.task).toMatchObject({
      id: data.taskId,
      kind: "playbook",
      status: "succeeded",
      lookup: `/api/tasks/${data.taskId}`,
    });
    // No host was named, so nothing was written into somebody else's log.
    expect(outcome.recorded).toBe(false);

    const answered = await readTask(data.taskId);
    expect(answered.status).toBe(200);
    expect(answered.body.data.task).toMatchObject({
      id: data.taskId,
      kind: "playbook",
      type: "video_render",
      status: "succeeded",
      rawStatus: "success",
      progress: 100,
      resultUrl: data.artifacts.video.url,
    });
    expect(answered.body.data.logs.map((entry: { stage: string }) => entry.stage)).toContain("done");
  });

  it("writes the tool-call record into the host task the caller named", async () => {
    const host = await repository.createRun({ playbookId: "article_scraper_rewriter" });
    if (!host) throw new Error("the host run was expected to be created");

    const outcome = await tools.callTool("video_render", request, { ...approved, taskId: host.id });

    expect(outcome.result.ok).toBe(true);
    expect(outcome.recorded).toBe(true);
    const hostLog = await repository.listRunEvents(host.id);
    const record = hostLog.find((event) => event.message === "Tool video_render completed");
    expect(record?.data).toMatchObject({ stage: "tool", tool: "video_render", status: "completed" });
  });

  it("answers a failed render as a failed call, and leaves the task to inspect", async () => {
    const outcome = await tools.callTool(
      "video_render",
      { ...request, materials: { video: "gone.mp4" } },
      approved,
    );

    expect(outcome.result.ok).toBe(false);
    if (outcome.result.ok) return;
    expect(outcome.result.error.code).toBe("TOOL_FAILED");
    expect(outcome.result.error.message).toContain("MATERIAL_NOT_FOUND");

    // The message names the task, and that task really is there - the diagnosis is not lost with the error.
    const taskId = /task (\S+) failed/.exec(outcome.result.error.message)?.[1] ?? "";
    expect(taskId).not.toBe("");
    const view = await tasks.findTaskView(taskId);
    expect(view).toMatchObject({ type: "video_render", status: "failed" });
    expect(view?.error?.message).toContain("MATERIAL_NOT_FOUND");
    expect(renderedFiles()).toEqual([]);
  });

  it("refuses an invalid request before any task exists", async () => {
    const before = await taskCount();

    const outcome = await tools.callTool("video_render", { template: { id: "existing_video_package" } }, approved);

    expect(outcome.result.ok).toBe(false);
    if (outcome.result.ok) return;
    expect(outcome.result.error.code).toBe("INVALID_INPUT");
    expect(outcome.result.error.details).toMatchObject({ tool: "video_render" });
    expect(await taskCount()).toBe(before);
  });
});

describe("video_render in discovery", () => {
  it("is published with the contract a caller calls it with", () => {
    const listed = tools.listCallableTools().find((tool) => tool.name === "video_render");

    expect(listed?.description).toContain("video render task");
    expect(listed?.inputSchema).not.toBeNull();
    expect(JSON.stringify(listed?.inputSchema)).toContain("existing_video_package");
  });
});

