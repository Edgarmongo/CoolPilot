import { fail, ok } from "@/lib/api";
import {
  listTaskViews,
  reconcileInterruptedTasks,
  reconcileInterruptedTasksOnce,
} from "@/lib/tasks/task-library";
import { isTaskKind, isTaskStatus, taskKinds, taskStatuses } from "@/lib/tasks/task-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The unified task query entry of CI-P1-02-03.
 *
 *   GET  /api/tasks?kind=playbook&status=running&limit=50   -> { tasks: TaskView[], total }
 *   POST /api/tasks                                          -> ReconcileReport
 *
 * The `GET` also carries CI-P1-02-06's "first access to the task view" trigger: the first reader in a
 * process converges the runs a restart interrupted, and later readers reuse that answer. Reading
 * still answers the same rows either way; the convergence only ever touches work that is provably
 * without a host (§2.2), never `queued` rows and never `paused` agent runs.
 *
 * Nothing here writes a status of its own: listing is a read, and cancelling has its own entry
 * (`POST /api/runs/[id]/cancel`). `POST` re-runs the convergence scan on demand, which is what the
 * recovery path and the compatibility tests use.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  if (kind !== null && !isTaskKind(kind)) {
    return fail("Unknown task kind", 400, { kind, allowed: taskKinds });
  }
  const status = params.get("status");
  if (status !== null && !isTaskStatus(status)) {
    return fail("Unknown task status", 400, { status, allowed: taskStatuses });
  }
  const limit = Number(params.get("limit") ?? "");
  if (params.get("limit") !== null && (!Number.isInteger(limit) || limit <= 0)) {
    return fail("Invalid task limit", 400, { limit: params.get("limit") });
  }

  await reconcileInterruptedTasksOnce();
  const tasks = await listTaskViews({
    kind: kind ?? undefined,
    status: status ?? undefined,
    limit: params.get("limit") === null ? undefined : limit,
  });
  return ok({ tasks, total: tasks.length });
}

export async function POST() {
  return ok(await reconcileInterruptedTasks());
}
