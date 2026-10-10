import { fail, ok } from "@/lib/api";
import { cancelTask } from "@/lib/tasks/task-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CI-P1-02-05: the cancellation entry the contract names (`docs/coolpilot-integration-contracts.md` §2.2).
 *
 *   POST /api/runs/<id>/cancel -> 200 { cancelled: true,  alreadyCancelled, message, task }
 *                              -> 409 { cancelled: false, reason, message, status, rawStatus }
 *                              -> 404 when the id names no playbook run
 *
 * A `409` is the honest answer, not a failure of the endpoint: it says the run is being executed by a
 * process that holds no abort handle (or has already finished), so this entry refuses to write
 * `cancelled` for work it cannot stop. Only a `queued` run is cancelled for real - the claimer reads
 * `status = "queued"`, so writing `cancelled` is what takes it out of the executor's hands.
 *
 * The other two task systems cancel where the product already does it, so this route does not grow a
 * second writer for them: a paused agent run goes through `POST /api/agent/runs/[id]/resume` with
 * `approved: false`, and a schedule through `DELETE /api/agent/schedules/[id]`.
 *
 * CI-P7-03-B: a *budget-paused* playbook run is cancelled by this entry (a pause leaves nothing in
 * flight), and the way back from that pause is `POST /api/runs/[id]/resume` - the entry above, which
 * re-checks the budget instead of this route re-queueing a run on a wish.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const outcome = await cancelTask("playbook", id);
  if (!outcome) return fail("Run not found", 404, { id });

  if (!outcome.cancelled) {
    return fail(outcome.message, 409, {
      cancelled: false,
      reason: outcome.reason,
      message: outcome.message,
      status: outcome.task.status,
      rawStatus: outcome.task.rawStatus,
    });
  }

  return ok({
    cancelled: true,
    alreadyCancelled: outcome.alreadyCancelled,
    message: outcome.message,
    task: outcome.task,
  });
}
