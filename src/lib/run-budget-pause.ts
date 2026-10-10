import { isAiBudgetRefusal } from "@/lib/ai-budget-guard";

/**
 * CI-P7-03-B: the vocabulary of a *budget pause* (completion standard 5 of `CI-P7-03`).
 *
 * The gate already refuses a call before it is sent - `AI_BUDGET_EXCEEDED` / 402, with the arithmetic
 * attached. What was missing is somewhere to *stand* after the refusal: a refusal that can only fail a
 * run throws away both the work the run had finished and the decision that stopped it, so the user's
 * only way back is to start over. This module is the shape of the alternative - one record, written at
 * the moment of the refusal, that says which gate spoke, over which period, with what arithmetic, which
 * step was *not* run and how many steps *were*.
 *
 * It is plain data: no database, no model, no credential, no prompt. The worker, the agent engine and
 * both resume routes therefore share one spelling of "paused on the budget" without depending on each
 * other, and a pause is readable from the run's own log later.
 *
 * Nothing here decides anything, and that is deliberate: the check that refuses a call and the check a
 * resume re-runs are both the guard's. This is only what a decision leaves behind.
 */

/** Which gate refused: a step boundary (a node about to start) or a call about to be sent. */
export type BudgetPauseGate = "node" | "call";

/** Where a resume re-enters: what was refused, and how much of the run is already done. */
export interface BudgetPauseCheckpoint {
  /** The step the run was about to run - a step name, a URL, a tool name. Its resume re-attempts it. */
  pendingStep: string;
  /** Steps that finished *before* the refused one. A resume skips exactly these, no more. */
  completedSteps: number;
  /** The refused step's own index in a counted iteration (the URL importer counts its URLs). */
  stepIndex?: number | null;
}

/**
 * One budget pause, as it is stored on the run.
 *
 * Every amount is either a figure the gate itself stated or `null` - never `0`. `spent` with
 * `spentIsComplete: false` is a floor, not a total, and both are carried so no renderer has to guess.
 */
export interface BudgetPauseRecord extends BudgetPauseCheckpoint {
  kind: "budget";
  at: number;
  gate: BudgetPauseGate;
  /** The gate's own purpose string, so the decision row and this record can be read together. */
  purpose: string;
  /** The gate's first reason code (`over-limit`, `unknown-cost-refused`, …). */
  reason: string;
  periodKey: string;
  currency: string;
  limit: number | null;
  /** This period's spending, or `null` when the gate's own figures were not read on this path. */
  spent: number | null;
  /** `false` when the period's spending is a floor - unpriced or unmeasured rows exist. */
  spentIsComplete: boolean;
  /** What calls in flight were holding at the instant of the refusal (`null` when unread). */
  reserved: number | null;
  remaining: number | null;
  enforcement: string;
}

/** The two fields of a run event this module reads: the stamp and the payload. */
export interface BudgetMarkerEvent {
  createdAt: number;
  data?: Record<string, unknown>;
}

/**
 * What a run's log says about the budget: at most one of these is set, and which one it is *is* the
 * answer. `pause` means the run is standing still on the budget; `resume` means it was let go at the
 * recorded checkpoint. The newest marker wins, so a second pause after a resume reads as a pause again.
 */
export interface BudgetPauseMarker {
  pause: BudgetPauseRecord | null;
  resume: { at: number; from: BudgetPauseRecord } | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

/** Whether a stored value is one of this module's own pause records. */
export function isBudgetPauseRecord(value: unknown): value is BudgetPauseRecord {
  const record = asRecord(value);
  return record.kind === "budget" && typeof record.pendingStep === "string";
}

/**
 * The refusal as a pause record.
 *
 * The gate's `details` is the only place the arithmetic exists, and this reads it rather than
 * re-deriving it: a number the gate did not state stays `null` (an unknown amount is not 0), and the
 * checkpoint - the part only the call site knows - comes in as an argument.
 *
 * Callers reach this only for `isAiBudgetRefusal()` errors; a non-refusal yields the same shape with
 * every figure `null`, because inventing one would be worse than admitting it is unknown.
 */
export function budgetPauseOf(
  error: unknown,
  checkpoint: BudgetPauseCheckpoint & { gate: BudgetPauseGate; purpose: string; at?: number },
): BudgetPauseRecord {
  const details = asRecord(isAiBudgetRefusal(error) ? error.details : undefined);
  const period = asRecord(details.period);
  const reasons = Array.isArray(details.reasons) ? details.reasons : [];
  const spent = numberOrNull(details.spentAmount);
  return {
    kind: "budget",
    at: checkpoint.at ?? Date.now(),
    gate: checkpoint.gate,
    purpose: checkpoint.purpose,
    reason: stringOr(reasons[0], "over-limit"),
    periodKey: stringOr(period.key, ""),
    currency: stringOr(details.currency, ""),
    limit: numberOrNull(details.limit),
    spent,
    // `false` both when the gate called its own figure a floor *and* when there is no figure at all: with
    // `spent: null`, "complete" would read as "the whole truth is 0", which is the one thing this module
    // exists to prevent. Only a figure the gate stated *and* stood behind is complete.
    spentIsComplete: spent !== null && details.spentIsComplete !== false,
    reserved: numberOrNull(details.reserved),
    remaining: numberOrNull(details.remaining),
    enforcement: stringOr(details.enforcement, ""),
    pendingStep: checkpoint.pendingStep,
    completedSteps: checkpoint.completedSteps,
    stepIndex: checkpoint.stepIndex ?? null,
  };
}

/**
 * The same shape for a refusal that arrived as a *task code* rather than an `AppError`
 * (`research_extraction` maps the gate's refusal onto its own `BUDGET_EXCEEDED`).
 *
 * That path carries prose but no arithmetic, so every figure is `null` and `spentIsComplete` is
 * `false`: the honest statement is "this period's spending was not read here", not a 0 the caller would
 * otherwise mistake for "nothing was spent".
 *
 * `code` replaces the reason with the code the refusing task actually used. It has to be a code and not
 * the task's sentence: `budgetPauseMessage` renders `reason` verbatim inside its own sentence, so prose
 * here would nest one sentence in another. The prose is not lost - it is the refusing task's own log line.
 */
export function budgetPauseFromTaskRefusal(
  checkpoint: BudgetPauseCheckpoint & { gate: BudgetPauseGate; purpose: string; at?: number; code?: string },
): BudgetPauseRecord {
  const record = budgetPauseOf(null, checkpoint);
  // `spentIsComplete` is already `false` here - a task code carries no spending figure at all, and
  // `budgetPauseOf` never calls an unread figure complete.
  return { ...record, reason: checkpoint.code ?? record.reason };
}

/**
 * One sentence for the run log and for the chat, which is the only place the pause is *explained*.
 *
 * It states the arithmetic the gate gave - limit, spending and what was held - and names the step a
 * resume will re-attempt. It never claims a provider failed, because no request was sent.
 *
 * The wording is English like every other run-event message in this repo; the *localised* copy a user
 * reads in the console comes from the i18n keys (`agentBudgetPaused`), not from here.
 */
export function budgetPauseMessage(pause: BudgetPauseRecord) {
  const period = pause.periodKey ? ` (${pause.periodKey})` : "";
  const limit = pause.limit === null ? "no limit is set" : `the limit is ${pause.limit} ${pause.currency}`.trim();
  const spent =
    pause.spent === null
      ? "spending is unknown"
      : `spending is ${pause.spent}${pause.spentIsComplete ? "" : " (a floor, not a total)"}`;
  const held = pause.reserved !== null && pause.reserved > 0 ? `, with ${pause.reserved} held by calls in flight` : "";
  return [
    `The AI budget refused the next step, so this run is paused${period}: ${pause.reason}; ${limit}, ${spent}${held}.`,
    ` The step that did not run is "${pause.pendingStep}". Everything finished before it is kept`,
    ` (${pause.completedSteps} finished); raising the budget lets this run continue from there.`,
  ].join("");
}

/**
 * The resume's own sentence, the mirror of the pause.
 *
 * A resume re-queues the run and re-enters at the checkpoint, so the two facts worth stating are which
 * step it re-attempts and that the work behind it is not repeated.
 */
export function budgetResumeMessage(pause: BudgetPauseRecord) {
  return [
    `Continuing after the AI budget pause: this run re-enters at "${pause.pendingStep}" and re-uses`,
    ` what already finished (${pause.completedSteps} steps).`,
  ].join("");
}

/**
 * Reads the newest budget marker out of a run's events, newest first.
 *
 * A resume marker is the route's own write (`budgetResume`), and it is what makes "this run is
 * continuing from there" different from "this run is still standing" without a second status column.
 */
export function readBudgetPauseMarker(events: readonly BudgetMarkerEvent[]): BudgetPauseMarker {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const data = events[index]?.data;
    if (!data) continue;
    const resume = asRecord(data.budgetResume);
    if (isBudgetPauseRecord(resume.from)) {
      return {
        pause: null,
        resume: { at: numberOrNull(resume.at) ?? events[index]?.createdAt ?? 0, from: resume.from },
      };
    }
    if (isBudgetPauseRecord(data.budgetPause)) {
      return { pause: data.budgetPause, resume: null };
    }
  }
  return { pause: null, resume: null };
}

/** The event payload a pause is stored as, in one place, so writer and reader cannot drift. */
export function budgetPauseEventData(pause: BudgetPauseRecord): Record<string, unknown> {
  return { budgetPause: { ...pause } };
}

/** The event payload a resume is stored as. `from` is the pause the resume continues. */
export function budgetResumeEventData(from: BudgetPauseRecord, at: number): Record<string, unknown> {
  return { budgetResume: { at, from: { ...from } } };
}
