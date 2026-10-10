import { fail, ok, parseJson } from "@/lib/api";
import { findTaskView } from "@/lib/tasks/task-library";
import { isTranscriptionFailure, transcriptionRunRequestSchema } from "@/lib/transcription/transcription";
import {
  createTranscriptionTask,
  listTranscriptionTasks,
  startTranscriptionTask,
  transcriptionTaskLookup,
} from "@/lib/transcription/transcription-task";
import { resolveTranscriptionSource } from "@/lib/transcription/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The transcription entry of CI-P3-02 of `docs/coolpilot-capability-integration-plan.md` (P3-02-01/02).
 *
 *   GET  /api/transcription -> { tasks: TaskView[] }  (newest activity first)
 *   POST /api/transcription -> { taskId, lookup, reused, started, task }
 *
 * **`GET` is a read of the existing task system, not a table of its own.** The rows are the workspace's
 * `media_transcription` playbook runs, through the same `listTaskViews()` the queue, the calendar and
 * `GET /api/tasks/<id>` read - so a transcription task shows up in the task console with real progress
 * and a real error, and this route cannot disagree with it.
 *
 * **`POST` creates the task and starts it**, because a transcript takes minutes and the request may not
 * be held open for it. That is what the two flags in the answer say:
 *
 * - `reused` - an earlier submission (same `idempotencyKey`, or a run still in flight for the same file)
 *   was returned instead of a second row being created.
 * - `started` - this call began the execution **in this process**. `false` with an in-flight task means
 *   something already is running it (this route's own set, or a worker that claimed the row), and the
 *   caller's job is the same either way: poll `lookup`.
 *
 * The media file is resolved **before** a task is created, so "that file is not here" is an answer to
 * this request rather than a task row that fails a second later. The check is `resolveTranscriptionSource()`
 * - the same function the executor runs - so the route refuses nothing the task would have accepted, and
 * the executor still holds the last word for a file that disappears in between.
 */
export async function GET() {
  return ok({ tasks: await listTranscriptionTasks() });
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, transcriptionRunRequestSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const body = parsed.data;

  try {
    // Read-only and writes nothing: it only decides whether this request is answerable at all.
    await resolveTranscriptionSource({ root: body.sourceRoot, fileName: body.sourceFileName });
  } catch (error) {
    if (isTranscriptionFailure(error)) {
      return fail("INVALID_PAYLOAD", 400, { code: error.code, message: error.message });
    }
    throw error;
  }

  const { run, reused } = await createTranscriptionTask(body);
  const inFlight = run.status === "queued" || run.status === "running";
  const started = inFlight ? startTranscriptionTask(run.id) : false;
  // The view is read back from the task system rather than composed here: the status a caller polls is
  // the one CI-P1-02 gave that row, including the `running` the execution above may already have written.
  const task = (await findTaskView(run.id)) ?? null;

  return ok({ taskId: run.id, lookup: transcriptionTaskLookup(run.id), reused, started, task }, {
    status: reused ? 200 : 201,
  });
}
