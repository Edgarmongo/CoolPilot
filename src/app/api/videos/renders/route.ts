import { listRunEvents, listRuns } from "@/db/repository";
import { ok } from "@/lib/api";
import { getTaskView } from "@/lib/tasks/task-library";
import { runEventsToTaskLogs } from "@/lib/tasks/task-view";
import {
  videoRenderArtifacts,
  videoRenderEncoded,
  videoRenderTemplateCatalog,
} from "@/lib/videos/video-render-artifacts";
import { videoRenderPlaybookId } from "@/lib/videos/video-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CI-P1-04, sub-item P1-04-07: the read model a screen renders the video render surface from.
 *
 *   GET /api/videos/renders -> { templates, renders }
 *
 * - `templates` is the render registry as a summary (identity, version, and the material/parameter keys
 *   its own schemas declare), so a screen never holds a second copy of a template id. It is computed on
 *   every request for the same reason: adding a template is what makes it appear.
 * - `renders` is the `video_render` tasks this workspace has run, newest first, each with the canonical
 *   task view (CI-P1-02) and **the artifacts that task's own log reports** - including the `.srt` and
 *   `.json` sidecars that had no address before this card.
 *
 * What this route deliberately does not do: it does not plan, render, or reserve a second index of
 * packages. A render is still created through the one existing entry (`POST /api/tools/video_render`),
 * and a package is still described by the task that produced it.
 *
 * The scan is bounded like `listTaskViews()`: the newest 200 runs of every type are read so render tasks
 * are found among them, and at most `limit` are answered. A workspace whose 200 newest runs contain no
 * render task answers an empty list rather than an unbounded scan.
 */
const defaultLimit = 20;
const maxLimit = 100;
const scanLimit = 200;

export async function GET(request: Request) {
  const raw = Number(new URL(request.url).searchParams.get("limit") ?? defaultLimit);
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), maxLimit) : defaultLimit;

  const runs = (await listRuns(scanLimit))
    .filter((run) => run.playbookId === videoRenderPlaybookId)
    .slice(0, limit);

  const renders = await Promise.all(
    runs.map(async (run) => {
      const [task, events] = await Promise.all([getTaskView("playbook", run.id), listRunEvents(run.id)]);
      const logs = runEventsToTaskLogs(run.id, events);
      return { task, artifacts: videoRenderArtifacts(run.id, logs), encoded: videoRenderEncoded(logs) };
    }),
  );

  return ok({
    templates: videoRenderTemplateCatalog(),
    // `getTaskView` answers `null` only for a row that vanished between the list and the read; a package
    // with no task to describe it is not reported as a package.
    renders: renders.filter((render) => render.task !== null),
  });
}
