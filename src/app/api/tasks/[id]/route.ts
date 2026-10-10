import { fail, ok } from "@/lib/api";
import { findTaskView, listTaskLogs } from "@/lib/tasks/task-library";
import { isTaskKind, taskKinds } from "@/lib/tasks/task-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One task of any of the three systems, with its unified log view (CI-P1-02-03/04):
 *
 *   GET /api/tasks/<id>?kind=agent -> { task: TaskView, logs: TaskLogEntry[] }
 *
 * `kind` is optional because task ids are `nanoid`s, so a bare id is looked up across `runs`,
 * `agent_runtime_runs` and `schedules` in that order. The answer always carries the row's own status
 * literal next to the canonical one. A schedule has no log table of its own, so its `logs` are empty
 * and its runs are the entries to read.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== null && !isTaskKind(kind)) {
    return fail("Unknown task kind", 400, { kind, allowed: taskKinds });
  }

  const task = await findTaskView(id, kind ?? undefined);
  if (!task) return fail("Task not found", 404, { id });
  return ok({ task, logs: await listTaskLogs(task.kind, task.id) });
}
