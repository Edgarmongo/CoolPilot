import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getRun, listRunEvents } from "@/db/repository";
import { ok } from "@/lib/api";
import { videosRoot } from "@/lib/paths";
import { getTaskView } from "@/lib/tasks/task-library";
import { runEventsToTaskLogs } from "@/lib/tasks/task-view";
import {
  isRenderArtifactFileName,
  renderArtifactContentType,
  videoRenderArtifactFiles,
  videoRenderArtifacts,
  videoRenderEncoded,
} from "@/lib/videos/video-render-artifacts";
import { videoRenderPlaybookId } from "@/lib/videos/video-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CI-P1-04, sub-item P1-04-07: one render package, and the bytes of one of its artifacts.
 *
 *   GET /api/videos/renders/<id>                 -> { task, artifacts, encoded }
 *   GET /api/videos/renders/<id>?file=<name>     -> that artifact's bytes
 *
 * The `?file=` half is what makes a package's subtitle and metadata sidecars readable at all: they land
 * in the workspace `videos/` section as real files, but `/api/videos` refuses any non-video extension by
 * design (it is the *library's* route), so before this card the two sidecars had no address.
 *
 * Three rules this route keeps, because it is a file reader:
 *
 * 1. **It serves only files the task itself reported.** The allowlist is not the directory - it is the
 *    task's own log (`videoRenderArtifactFiles`). A name the log never mentioned is not served, so a
 *    render route cannot be turned into a reader of arbitrary workspace files.
 * 2. **The name is a file name, not a path.** `path.basename(name) === name` is required (that is what
 *    `isRenderArtifactFileName` answers), the read is rooted at `videosRoot()`, and the route never
 *    creates that directory - a read leaves the workspace as it found it.
 * 3. **A task that is not a render task is not found.** `GET` on any other run id, or on an id that names
 *    nothing, is a 404 rather than an empty package: this route describes render tasks and nothing else.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = await getRun(id);
  if (!run || run.playbookId !== videoRenderPlaybookId) {
    return new Response("Not found", { status: 404 });
  }

  const logs = runEventsToTaskLogs(id, await listRunEvents(id));
  const requested = new URL(request.url).searchParams.get("file") ?? "";

  if (!requested) {
    return ok({
      task: await getTaskView("playbook", id),
      artifacts: videoRenderArtifacts(id, logs),
      encoded: videoRenderEncoded(logs),
    });
  }

  const files = videoRenderArtifactFiles(logs);
  const served = [files.video, files.subtitles, files.metadata].filter(
    (name): name is string => name !== null,
  );
  if (!served.includes(requested) || !isRenderArtifactFileName(requested)) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(videosRoot(), requested);
  let size: number;
  try {
    size = (await fs.stat(filePath)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": renderArtifactContentType(requested),
      "Content-Length": String(size),
      // A package is the user's own work in their own workspace; nothing about it is cacheable by a
      // shared cache, and a re-render of the same id would change the bytes.
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${requested}"`,
    },
  });
}
