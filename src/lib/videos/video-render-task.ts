import { appendRunEvent, createRun, getRun, updateRunStatus } from "@/db/repository";
import type { RunRecord } from "@/lib/types";
import {
  VideoRenderFailure,
  resolveVideoRenderInput,
  videoRenderPlaybookId,
  type VideoRenderFailureCode,
} from "./video-render";
import {
  installedVideoRenderer,
  videoRenderStageCount,
  type VideoRenderArtifacts,
  type VideoRenderLogEntry,
} from "./video-renderer";

/**
 * CI-P1-04-03: the render task as a task of the existing task system.
 *
 * A render task is one row of `runs` with `playbook_id = video_render`. That is the whole storage
 * design, and it is deliberate: `runs` is what CI-P1-02 already turns into the canonical `TaskView`, so
 * a render task arrives with a real id, a real status, real progress (from its own `run_events`), a real
 * error summary, a real `resultUrl` and a real cancellation rule - without a render table, a render
 * status word or a second task list.
 *
 * Two writers use this module and neither has its own copy of the logic:
 *
 * - the tool entry (`POST /api/tools/video_render`) creates the row and executes it inside the call, and
 *   reports the terminal state it observed;
 * - the worker (`pnpm worker`, `processRun`) executes a row it claimed - which is the only thing that can
 *   happen to a `queued` row created through `POST /api/runs`.
 *
 * Execution is synchronous because the installed renderer is: it copies and packages files the workspace
 * already holds, in milliseconds. Nothing here fabricates an asynchronous job to look like a long task -
 * the row is created, really runs, and ends at a status that describes what happened.
 *
 * The one thing this file cannot do is make two concurrent executions of the same row impossible: the
 * repository offers no compare-and-set claim, and adding one would change a shared contract. The window
 * is a single tool call, and a second execution of an already-terminal row is refused by the guard below.
 */

export type VideoRenderTaskFailure = { code: VideoRenderFailureCode; message: string };

export type VideoRenderTaskOutcome =
  | {
      kind: "succeeded";
      run: RunRecord;
      /** The identity that was actually rendered: `{ id, version }` with the version this build runs. */
      template: { id: string; version: number };
      artifacts: VideoRenderArtifacts;
      videoBytes: number;
      notes: string[];
    }
  | { kind: "failed"; run: RunRecord; failure: VideoRenderTaskFailure }
  /** The row was already terminal when this executor got it; nothing was rendered again. */
  | { kind: "skipped"; run: RunRecord; reason: string };

/**
 * Creates the render task. The request is stored exactly as it arrived (`runs.params_json` is the
 * request, not the effective parameters - the executor applies the template's defaults when it runs), so
 * a task's own record shows what the caller actually asked for.
 */
export async function createVideoRenderTask(input: Record<string, unknown>): Promise<RunRecord> {
  const run = await createRun({ playbookId: videoRenderPlaybookId, params: input });
  if (!run) {
    // `createRun()` answers `RunRecord | null`; a null here means the row it just inserted is gone, and
    // no caller should receive a task id it cannot look up.
    throw new Error("The video render task was created but could not be read back.");
  }
  return run;
}

/** What the task log carries for one renderer line: the stage, the explicit progress and the facts. */
function runEventData(entry: VideoRenderLogEntry) {
  return {
    stage: entry.stage,
    ...(entry.progress ? { current: entry.progress.current, total: entry.progress.total } : {}),
    ...(entry.data ?? {}),
  };
}

/**
 * Executes one render task: validates the stored request, runs the renderer, and writes the terminal
 * status - `success` with the deliverable's address as the task's result, or `failed` with the refusal's
 * own code. A refusal is recorded on the task, never swallowed, and never reported as a success.
 */
export async function executeVideoRenderTask(runId: string): Promise<VideoRenderTaskOutcome> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Video render task "${runId}" does not exist.`);
  if (run.playbookId !== videoRenderPlaybookId) {
    throw new Error(`Task "${runId}" is a "${run.playbookId}" task, not a video render task.`);
  }
  if (run.status !== "queued" && run.status !== "running") {
    return { kind: "skipped", run, reason: `the task already reached "${run.status}"` };
  }

  const log = async (entry: VideoRenderLogEntry) => {
    await appendRunEvent(run.id, entry.message, entry.level ?? "info", runEventData(entry));
  };

  // Claiming writes `running`, which is what gives the task view a real `startedAt`.
  await updateRunStatus(run.id, "running");

  try {
    const request = resolveVideoRenderInput(run.params);
    const result = await installedVideoRenderer.render(request, { taskId: run.id, log });
    const message =
      `Video render succeeded: "${result.artifacts.video.fileName}" (${result.videoBytes} bytes, `
      + `renderer ${installedVideoRenderer.name}, encoded: ${installedVideoRenderer.encoded})`;
    await updateRunStatus(run.id, "success", message, result.artifacts.video.url);
    await appendRunEvent(run.id, message, "success", {
      stage: "done",
      current: videoRenderStageCount,
      total: videoRenderStageCount,
      resultUrl: result.artifacts.video.url,
      renderer: { name: installedVideoRenderer.name, encoded: installedVideoRenderer.encoded },
      artifacts: {
        video: result.artifacts.video.fileName,
        cover: result.artifacts.cover?.fileName ?? null,
        subtitles: result.artifacts.subtitles?.fileName ?? null,
        metadata: result.artifacts.metadata.fileName,
      },
      notes: result.notes,
    });
    return {
      kind: "succeeded",
      run: (await getRun(run.id)) ?? run,
      template: request.templateRef,
      artifacts: result.artifacts,
      videoBytes: result.videoBytes,
      notes: result.notes,
    };
  } catch (error) {
    const failure =
      error instanceof VideoRenderFailure
        ? { code: error.code, message: error.message }
        : {
            code: "RENDER_FAILED" as VideoRenderFailureCode,
            message: `RENDER_FAILED: ${error instanceof Error ? error.message : String(error)}`,
          };
    await updateRunStatus(run.id, "failed", failure.message);
    await appendRunEvent(run.id, failure.message, "error", { stage: "error", code: failure.code });
    return { kind: "failed", run: (await getRun(run.id)) ?? run, failure };
  }
}

/** The whole task in one call: create it, run it, and hand back both the row and the outcome. */
export async function runVideoRenderTask(input: Record<string, unknown>) {
  const run = await createVideoRenderTask(input);
  return { run, outcome: await executeVideoRenderTask(run.id) };
}

