import type { AgentToolDefinition } from "@/lib/agent/contracts";
import { findTaskView } from "@/lib/tasks/task-library";
import {
  videoRenderInputSchema,
  videoRenderOutputSchema,
  videoRenderTaskLookup,
  type VideoRenderFailureCode,
} from "./video-render";
import { runVideoRenderTask, type VideoRenderTaskFailure } from "./video-render-task";
import { installedVideoRenderer } from "./video-renderer";

/**
 * CI-P1-04-03: the render tool of `docs/coolpilot-integration-contracts.md` §3.2, registered through
 * the CI-P1-03 thin media registry (`src/lib/tools/media-tools.ts`) - there is no second registry.
 *
 * It answers with a **real task id**: `runVideoRenderTask()` creates a `runs` row, really executes it,
 * and this tool reports the canonical status CI-P1-02's view gave that row back. `callTool()` then
 * resolves the same id through `findTaskView()` before it leaves the entry, so the id a caller receives
 * is provably queryable at `GET /api/tasks/<id>` (`lookup` is that address).
 *
 * **A failed render throws.** The task row and its log stay behind as the diagnostic record, but the call
 * does not come back `ok: true` with a failed status inside `data`, because a caller that reads only the
 * envelope would then read a failed render as a success. The thrown message carries the task id and the
 * refusal code, which is also how CI-P1-03 answers a tool whose work really failed.
 *
 * The tool needs approval (`requiresApproval`): it writes files into the workspace `videos/` section and
 * a task row. The thin context grants no permission automatically, so an unapproved call stops at
 * `APPROVAL_REQUIRED` before anything is created.
 */

export const videoRenderToolName = "video_render";

/**
 * A render task that did not succeed. The task exists and keeps its own log - this error only carries the
 * task id and the code to the caller, so nobody has to guess what happened.
 */
export class VideoRenderTaskError extends Error {
  readonly taskId: string;
  readonly code: VideoRenderFailureCode;

  constructor(taskId: string, failure: VideoRenderTaskFailure) {
    // The refusal's own message already opens with its code (`describeVideoRenderFailure`), so the code is
    // not repeated here; the task id and the address of its log are what this error adds.
    super(
      `Video render task ${taskId} failed: ${failure.message} Its log is at ${videoRenderTaskLookup(taskId)}.`,
    );
    this.name = "VideoRenderTaskError";
    this.taskId = taskId;
    this.code = failure.code;
  }
}

export const videoRenderTool: AgentToolDefinition<
  typeof videoRenderInputSchema,
  typeof videoRenderOutputSchema
> = {
  name: videoRenderToolName,
  description:
    "Create and run a video render task from a template and workspace material, returning the real task id and the artifacts it produced. The installed renderer packages existing material; it does not encode frames. Writes files and a task record.",
  inputSchema: videoRenderInputSchema,
  outputSchema: videoRenderOutputSchema,
  requiresApproval: () => true,
  async execute(input) {
    const { run, outcome } = await runVideoRenderTask(input);
    if (outcome.kind !== "succeeded") {
      throw new VideoRenderTaskError(
        run.id,
        outcome.kind === "failed"
          ? outcome.failure
          : { code: "RENDER_FAILED", message: `the task was not run: ${outcome.reason}` },
      );
    }
    // The canonical status is read back from the task view rather than re-derived here: CI-P1-02 owns
    // that mapping, and a second copy of it would be a second answer.
    const task = await findTaskView(run.id);
    if (!task) {
      throw new Error(`The render task ${run.id} appeared in no task view right after it finished.`);
    }
    return {
      taskId: task.id,
      taskStatus: task.status,
      taskRawStatus: task.rawStatus,
      lookup: videoRenderTaskLookup(task.id),
      template: outcome.template,
      renderer: { name: installedVideoRenderer.name, encoded: installedVideoRenderer.encoded },
      artifacts: outcome.artifacts,
      videoBytes: outcome.videoBytes,
      notes: outcome.notes,
    };
  },
};
