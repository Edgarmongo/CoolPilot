import { appendRunEvent, getRun, listRunEvents, updateRunStatus } from "@/db/repository";
import { beginAiBudgetNode } from "@/lib/ai-budget-guard";
import { fail, failFromError, ok } from "@/lib/api";
import { budgetResumeEventData, budgetResumeMessage, readBudgetPauseMarker } from "@/lib/run-budget-pause";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CI-P7-03-B: the resume the pause implies (`docs/coolpilot-capability-integration-plan.md`).
 *
 *   POST /api/runs/<id>/resume -> 200 { resumed: true, run, pause, message, resumeAt }
 *                             -> 402 the gate's own `AI_BUDGET_EXCEEDED` (`failFromError` keeps it)
 *                             -> 409 { resumed: false, reason, status, message }
 *                             -> 404 when the id names no playbook run
 *
 * A paused run is not a failed run, so this entry does the one thing `queue` cannot: it asks the budget
 * again **now**, and only then hands the run back. Three things it deliberately does not do:
 *
 *  - It does not resume anything on the strength of the old refusal. The check that refused is the check
 *    that lets it go - `beginAiBudgetNode`, the same guard, the same settings, read at this instant - so
 *    "the user raised the budget" is a fact this route verifies rather than a claim it trusts. A refusal
 *    here is the gate's own `AI_BUDGET_EXCEEDED`/402, which is exactly what `failFromError` returns.
 *  - It does not run the playbook itself. It writes the resume marker and puts the run back to `queued`,
 *    where the same claimer that started it the first time picks it up; a route holding a long run would
 *    be the thing CI-P7-03 removed.
 *  - It does not touch the checkpoint. `processRun` reads the newest marker off the run's own log and
 *    re-enters there, so a resumed URL import continues at the URL the budget refused and the URLs
 *    already imported are not created twice.
 *
 * A `409` is the honest answer for a run that is not standing still on the budget: `not-paused` (it is
 * running, queued, or finished) or `no-checkpoint` (its status says paused but its log carries no marker
 * to resume from, which only a hand-edited database produces).
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = await getRun(id);
  if (!run) return fail("Run not found", 404, { id });

  const marker = readBudgetPauseMarker(await listRunEvents(run.id));
  if (run.status !== "paused") {
    return fail("This run is not paused on the AI budget, so there is nothing to resume.", 409, {
      resumed: false,
      reason: "not-paused",
      status: run.status,
      message: run.resultMessage,
    });
  }
  const pause = marker.pause;
  if (!pause) {
    return fail("This run says it is paused but its log carries no budget checkpoint.", 409, {
      resumed: false,
      reason: "no-checkpoint",
      status: run.status,
      message: run.resultMessage,
    });
  }

  // The re-check. It is a *decision* even when it passes (CI-P7-03-A stores both verdicts), so the log
  // says when the budget started allowing this run again. A refusal travels as the gate's own error.
  try {
    await beginAiBudgetNode({ purpose: `run-resume:${run.playbookId}`, identity: { runId: run.id } });
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }

  const at = Date.now();
  const message = budgetResumeMessage(pause);
  await appendRunEvent(run.id, message, "info", budgetResumeEventData(pause, at));
  const resumed = await updateRunStatus(run.id, "queued", message);

  return ok({ resumed: true, run: resumed, pause, resumeAt: at, message });
}
