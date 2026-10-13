import { ApiClientError } from "@/lib/api-client";
import type { TranslationKey } from "@/lib/locale-resources";
import type { RunRecord } from "@/lib/types";

/**
 * CI-P7-03-F: the user's half of a budget pause (completion standard 5 of `CI-P7-03`).
 *
 * CI-P7-03-B gave a refused run somewhere to stand - `status: "paused"`, a checkpoint in its own log,
 * and two routes that move it (`POST /api/runs/<id>/resume`, `POST /api/runs/<id>/cancel`). What the
 * Runs console did not have was the decision itself: the queue rendered the status badge and the
 * engine's own English sentence, so a paused run could only be moved from the API. This module is that
 * decision as plain functions - which request each button sends, what an answer means, and what a row
 * says - so the behaviour is pinnable by a test without rendering the page (vitest here runs in `node`,
 * with no DOM and no component renderer).
 *
 * Two things it deliberately does not do:
 *
 *  - **it does not decide the budget.** `resume` asks the route, and the route re-runs the very gate
 *    that refused (`beginAiBudgetNode`, read at that instant), so "the user raised the budget" is a
 *    fact the console reports rather than a claim it makes. A `402` is that answer, and it is shown with
 *    the server's own arithmetic (`ApiClientError.message`, which the gate built) instead of a
 *    console-invented reason.
 *  - **it does not claim a state change it was not told about.** Every outcome is classified from the
 *    response alone, and the caller re-reads the list afterwards - so a refusal leaves the run paused,
 *    and a stale row (`409 not-paused`: someone else already resumed or cancelled it) says exactly that
 *    instead of pretending it worked.
 *
 * The two fields it reads off an answer are both part of the documented contract of those routes:
 * `code` (`ApiErrorShape`, and `error_AI_BUDGET_EXCEEDED` is the localised line for it) and
 * `details.reason` for a `409` (`not-paused` / `no-checkpoint` in the resume route's own words). A
 * response that carries neither falls into the generic path, which still shows the server's sentence.
 */

/** The two decisions a paused run waits for. */
export type RunPauseAction = "resume" | "cancel";

/** `ConsoleNotice`'s own vocabulary, so a refusal cannot be dressed as a success. */
export type RunPauseNoticeTone = "success" | "warning" | "error";

/** The request the console sends: `apiPost` itself, passed in so this module holds no transport. */
export type RunPausePost = (url: string, body: unknown) => Promise<unknown>;

/**
 * What the console says after an outcome, as a key and its values rather than a sentence.
 *
 * `key` is a `TranslationKey`, so a notice the console can render is one the locale files have - a
 * missing key would be a build error rather than a screen that says `runPauseActionFailed` in English.
 */
export interface RunPauseNotice {
  tone: RunPauseNoticeTone;
  key: TranslationKey;
  values?: Record<string, string | number>;
  /**
   * Whether the console re-reads the run list after this outcome. True for every outcome: the row is
   * the server's record of the run, and a resume, a cancellation, a refusal and a stale-row `409` all
   * mean the copy on screen is older than the truth.
   */
  refresh: boolean;
}

/** The localised explanation a paused row shows - the key `agentBudgetPaused` exists for. */
export const runPauseExplanationKey: TranslationKey = "agentBudgetPaused";

/** The three fields of a row this module reads: its status, its own message and when it was created. */
export type RunPauseRow = Pick<RunRecord, "status" | "resultMessage" | "createdAt">;

/**
 * Whether this run is standing still on the budget, which is the only status that has a decision in it.
 *
 * Every other status is untouched by CI-P7-03-F: a `running` run holds no abort handle, and a finished
 * one has nothing left to decide, so neither grows a button here.
 */
export function runPauseActionsVisible(status: RunPauseRow["status"]) {
  return status === "paused";
}

export function runResumePath(runId: string) {
  return `/api/runs/${encodeURIComponent(runId)}/resume`;
}

export function runCancelPath(runId: string) {
  return `/api/runs/${encodeURIComponent(runId)}/cancel`;
}

/**
 * What one row says: the localised pause explanation (only for a paused run) and the run's own message.
 *
 * The second line is the queue's existing behaviour, unchanged - the engine's sentence when there is
 * one, the creation time otherwise. The first line is the new part, and it is why the key exists: the
 * engine's sentence is English like every other run-event message, so it is the *localised* copy that
 * has to say "the budget paused this run, raise it and continue".
 */
export function runRowLines(run: RunPauseRow, formatTime: (at: number) => string) {
  return {
    pauseKey: runPauseActionsVisible(run.status) ? runPauseExplanationKey : null,
    message: run.resultMessage || formatTime(run.createdAt),
  };
}

/** The server's own sentence, whichever way the failure arrived (an `ApiErrorShape` or a transport error). */
function serverMessage(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  return error instanceof Error ? error.message : "";
}

/**
 * Whether the gate itself refused - `AI_BUDGET_EXCEEDED`, the code every gate answers with.
 *
 * It is read as a code and not as prose because the gate's sentence is English: the localised line the
 * user gets is `error_AI_BUDGET_EXCEEDED`'s, and the arithmetic travels beside it.
 */
function isBudgetRefusal(error: unknown) {
  return error instanceof ApiClientError && error.code === "AI_BUDGET_EXCEEDED";
}

/** `details.reason` of a `409`, when the answer carries one. */
function refusalReason(error: unknown) {
  if (!(error instanceof ApiClientError)) return null;
  const details = error.details;
  if (!details || typeof details !== "object") return null;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

/**
 * A resume that was let go: the route writes the marker and puts the run back where the claimer reads it,
 * so the honest sentence is the queue's own (`runQueuedNotice`) - the run is queued again and continues
 * from the checkpoint, not from the beginning.
 */
export function runResumeSuccessNotice(runId: string): RunPauseNotice {
  return { tone: "success", key: "runQueuedNotice", values: { id: runId }, refresh: true };
}

/** A cancellation that was written: the steps the run had finished are kept (CI-P7-03-B's wording). */
export function runCancelSuccessNotice(): RunPauseNotice {
  return { tone: "success", key: "runPauseCancelled", refresh: true };
}

/**
 * The catch-all failure: the run was not changed, and the server's own sentence is what the user has to
 * act on. A translation written here would be a second, less informed account of the same refusal.
 */
export function runActionFailureNotice(error: unknown): RunPauseNotice {
  return {
    tone: "error",
    key: "runPauseActionFailed",
    values: { message: serverMessage(error) },
    refresh: true,
  };
}

/**
 * A resume that was refused.
 *
 * A `402` is the gate saying no *again* - the budget is still what it was - so the notice is the budget
 * refusal's own line, with the gate's arithmetic in it, and the run stays paused: nothing was resumed,
 * and the console must not read as if something was. A `409 not-paused` is the opposite case: the run
 * is not standing still any more (it ran on, or someone else cancelled it), so the row is simply stale.
 */
export function runResumeFailureNotice(error: unknown): RunPauseNotice {
  if (isBudgetRefusal(error)) {
    return {
      tone: "error",
      key: "runPauseResumeRefused",
      values: { message: serverMessage(error) },
      refresh: true,
    };
  }
  if (refusalReason(error) === "not-paused") {
    return { tone: "warning", key: "runPauseResumeStale", refresh: true };
  }
  return runActionFailureNotice(error);
}

/**
 * One decision, end to end: the request, and what its answer means.
 *
 * It never throws. A refusal is an *answer* here, not an exception the page has to translate, and both
 * buttons need the same thing back - a notice the user can read and a row that is re-read - whether the
 * decision was accepted, refused or never reached the server.
 */
export async function submitRunPauseDecision(input: {
  runId: string;
  action: RunPauseAction;
  post: RunPausePost;
}): Promise<RunPauseNotice> {
  const { runId, action, post } = input;
  const url = action === "resume" ? runResumePath(runId) : runCancelPath(runId);
  try {
    // Neither route reads a body: a pause is not something a client restates, and the resume's verdict
    // is the gate's, re-read from the settings at that instant. The id in the path is the whole request.
    await post(url, {});
  } catch (error) {
    return action === "resume" ? runResumeFailureNotice(error) : runActionFailureNotice(error);
  }
  return action === "resume" ? runResumeSuccessNotice(runId) : runCancelSuccessNotice();
}
