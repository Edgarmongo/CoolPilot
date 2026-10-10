import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/app-errors";
import {
  budgetPauseEventData,
  budgetPauseFromTaskRefusal,
  budgetPauseMessage,
  budgetPauseOf,
  budgetResumeEventData,
  budgetResumeMessage,
  isBudgetPauseRecord,
  readBudgetPauseMarker,
  type BudgetPauseCheckpoint,
  type BudgetMarkerEvent,
} from "@/lib/run-budget-pause";

/**
 * The pause vocabulary (CI-P7-03-B) on its own: no database, no runtime, no clock.
 *
 * This module is what the worker, the resume routes and the queue read and write, so the two things it
 * must never do are the two things these cases pin:
 *
 *  1. **invent a figure.** The gate's `details` is the only place the arithmetic exists. A refusal that
 *     did not state a limit (or a spending total) leaves `null`, never `0` - and `spentIsComplete` is
 *     `false` whenever there is no figure to call complete, so a reader cannot take "0 spent, and that
 *     is the whole truth" out of an amount nobody read.
 *  2. **lose the marker.** A pause is stored as a run event and read back newest-first, so "still
 *     standing" and "let go at this checkpoint" have to survive a resume followed by a second pause.
 */

/** A refusal shaped exactly like the gate's own: `AI_BUDGET_EXCEEDED`/402 with the decision attached. */
function refusal(details: Record<string, unknown>) {
  return new AppError("AI_BUDGET_EXCEEDED", {
    status: 402,
    message: "The AI budget refused this call before it was sent (over-limit).",
    details,
  });
}

const checkpoint: BudgetPauseCheckpoint & { gate: "node"; purpose: string } = {
  gate: "node",
  purpose: "run:article_scraper_rewriter:url",
  pendingStep: "https://example.com/second",
  completedSteps: 1,
  stepIndex: 1,
};

describe("the budget pause vocabulary", () => {
  it("carries the gate's own arithmetic, and only the figures the gate stated", () => {
    const pause = budgetPauseOf(
      refusal({
        purpose: "run:article_scraper_rewriter:url",
        reasons: ["over-limit"],
        enforcement: "block",
        period: { key: "2026-10", start: 1, end: 2 },
        currency: "CNY",
        limit: 0,
        spentAmount: 1.25,
        spentIsComplete: true,
        reserved: 0.5,
        remaining: -1.75,
      }),
      checkpoint,
    );

    expect(pause).toMatchObject({
      kind: "budget",
      gate: "node",
      purpose: "run:article_scraper_rewriter:url",
      reason: "over-limit",
      periodKey: "2026-10",
      currency: "CNY",
      limit: 0,
      spent: 1.25,
      spentIsComplete: true,
      reserved: 0.5,
      remaining: -1.75,
      enforcement: "block",
      pendingStep: "https://example.com/second",
      completedSteps: 1,
      stepIndex: 1,
    });
    expect(typeof pause.at).toBe("number");
  });

  it("leaves an amount the gate did not state as null, and never calls it complete", () => {
    // A refusal that names a reason but no figures - the shape a decision takes when the refusal itself
    // was all that was read.
    const pause = budgetPauseOf(
      refusal({ reasons: ["unknown-cost-refused"], spentIsComplete: false }),
      checkpoint,
    );

    // `0` here would be the one lie this module exists to prevent: "nothing was spent" instead of
    // "nobody asked how much was spent".
    expect(pause.limit).toBeNull();
    expect(pause.spent).toBeNull();
    expect(pause.spentIsComplete).toBe(false);
    expect(pause.reserved).toBeNull();
    expect(pause.remaining).toBeNull();
    expect(pause.currency).toBe("");
    expect(pause.periodKey).toBe("");
    // The reason falls back to the gate's own first reason code rather than inventing one.
    expect(pause.reason).toBe("unknown-cost-refused");
  });

  it("answers an error that is not a refusal with the same shape and no figures at all", () => {
    const pause = budgetPauseOf(new Error("provider said no"), checkpoint);

    expect(pause.reason).toBe("over-limit");
    expect(pause.limit).toBeNull();
    expect(pause.spent).toBeNull();
    // Nothing was read, so nothing may be called complete - the checkpoint is still the caller's truth.
    expect(pause.spentIsComplete).toBe(false);
    expect(pause.pendingStep).toBe(checkpoint.pendingStep);
  });

  it("keeps a refusal that arrived as a task code, stating the code and no arithmetic", () => {
    const pause = budgetPauseFromTaskRefusal({
      gate: "call",
      purpose: "run:research_extraction",
      pendingStep: "research_extraction",
      completedSteps: 0,
      stepIndex: null,
      code: "BUDGET_EXCEEDED",
    });

    // The code replaces the reason (the message renders `reason` verbatim inside its own sentence, so
    // prose here would nest one sentence in another); that task's own prose stays in its own log line.
    expect(pause.reason).toBe("BUDGET_EXCEEDED");
    expect(pause.limit).toBeNull();
    expect(pause.spent).toBeNull();
    expect(pause.spentIsComplete).toBe(false);
    expect(pause.gate).toBe("call");
    expect(pause.stepIndex).toBeNull();
  });
});


describe("the pause's sentence and its stored markers", () => {
  it("explains itself without claiming a provider failed, and says when the figure is a floor", () => {
    const pause = budgetPauseOf(
      refusal({
        reasons: ["over-limit"],
        period: { key: "2026-10" },
        currency: "CNY",
        limit: 0,
        spentAmount: 1.25,
        spentIsComplete: false,
      }),
      checkpoint,
    );

    const message = budgetPauseMessage(pause);
    expect(message).toContain("over-limit");
    expect(message).toContain("2026-10");
    expect(message).toContain("the limit is 0 CNY");
    // The floor is stated as a floor, not as the total.
    expect(message).toContain("spending is 1.25 (a floor, not a total)");
    expect(message).toContain(pause.pendingStep);
    expect(message).toContain("(1 finished)");
    // A refused call was never sent, so nothing in the sentence may read as a provider failure.
    expect(message).not.toMatch(/failed|error/i);
  });

  it("says 'no limit' and 'spending unknown' rather than spelling either as zero", () => {
    const message = budgetPauseMessage(budgetPauseOf(refusal({ reasons: ["over-limit"] }), checkpoint));

    expect(message).toContain("no limit is set");
    expect(message).toContain("spending is unknown");
    // The only numeral left in the sentence is the checkpoint's own count - never a made-up amount.
    expect(message.match(/\d+/g)).toEqual(["1"]);
  });

  it("states the resume's own two facts: where it re-enters, and what it does not repeat", () => {
    const pause = budgetPauseOf(refusal({ reasons: ["over-limit"], limit: 0 }), {
      ...checkpoint,
      completedSteps: 3,
      stepIndex: 3,
    });

    const message = budgetResumeMessage(pause);
    expect(message).toContain(pause.pendingStep);
    expect(message).toContain("(3 steps)");
    expect(message).toContain("Continuing after the AI budget pause");
  });

  it("reads the newest marker, so a resume does not hide a later pause", () => {
    const pause = budgetPauseOf(refusal({ reasons: ["over-limit"], limit: 0 }), checkpoint);
    const events: BudgetMarkerEvent[] = [
      { createdAt: 1, data: budgetPauseEventData(pause) },
      { createdAt: 2, data: budgetResumeEventData(pause, 2) },
    ];

    const resumed = readBudgetPauseMarker(events);
    expect(resumed.pause).toBeNull();
    expect(resumed.resume?.at).toBe(2);
    // The resume carries the pause it let go, so the checkpoint travels with it.
    expect(resumed.resume?.from.completedSteps).toBe(1);
    expect(resumed.resume?.from.pendingStep).toBe(checkpoint.pendingStep);

    // A second refusal after the resume is a pause again, and it is the *newest* one that wins.
    const second = budgetPauseOf(refusal({ reasons: ["over-limit"], limit: 0 }), {
      ...checkpoint,
      pendingStep: "https://example.com/third",
      completedSteps: 2,
      stepIndex: 2,
    });
    const after = readBudgetPauseMarker([...events, { createdAt: 3, data: budgetPauseEventData(second) }]);
    expect(after.resume).toBeNull();
    expect(after.pause?.pendingStep).toBe("https://example.com/third");
    expect(after.pause?.completedSteps).toBe(2);
  });

  it("ignores a foreign or half-shaped payload instead of reading a checkpoint out of it", () => {
    expect(isBudgetPauseRecord({ kind: "budget", pendingStep: "step" })).toBe(true);
    // A step to resume is the one field a pause cannot be read without.
    expect(isBudgetPauseRecord({ kind: "budget" })).toBe(false);
    expect(isBudgetPauseRecord({ budgetPause: {} })).toBe(false);

    const events: BudgetMarkerEvent[] = [
      { createdAt: 1, data: { someOtherWriter: { pause: true } } },
      { createdAt: 2, data: { budgetPause: { kind: "budget" } } },
      { createdAt: 3, data: { budgetResume: { at: 3, from: { kind: "budget" } } } },
      { createdAt: 4 },
    ];

    expect(readBudgetPauseMarker(events)).toEqual({ pause: null, resume: null });
    expect(readBudgetPauseMarker([])).toEqual({ pause: null, resume: null });
  });

  it("round-trips a pause and its resume through the stored payloads", () => {
    const pause = budgetPauseOf(
      refusal({ reasons: ["over-limit"], period: { key: "2026-10" }, limit: 3, currency: "CNY" }),
      checkpoint,
    );

    const written = budgetPauseEventData(pause);
    expect(Object.keys(written)).toEqual(["budgetPause"]);
    expect(readBudgetPauseMarker([{ createdAt: pause.at, data: written }]).pause).toEqual(pause);

    const resumeData = budgetResumeEventData(pause, 99);
    expect(Object.keys(resumeData)).toEqual(["budgetResume"]);
    const afterResume = readBudgetPauseMarker([
      { createdAt: pause.at, data: written },
      { createdAt: 99, data: resumeData },
    ]);
    expect(afterResume.resume?.from).toEqual(pause);
  });
});
