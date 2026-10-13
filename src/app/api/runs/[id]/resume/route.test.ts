import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/app-errors";
import type { PlaybookId } from "@/lib/types";

/**
 * `POST /api/runs/<id>/resume` (CI-P7-03-B) at the route boundary, which is the boundary CI-P7-03-F's
 * console button talks to.
 *
 * A pause is only a decision if there is a way back from it, and the way back has exactly one rule: the
 * check that refused is the check that lets it go. So what these cases pin is that rule and the three
 * answers the console classifies on (its `run-pause-actions.ts` reads the code and the reason off them):
 *
 *  1. **a refusal is a 402 and a no-op.** While the budget is still what it was, the gate's own
 *     `AI_BUDGET_EXCEEDED` comes back with the arithmetic, the run stays `paused` with its own sentence,
 *     and its log gains nothing - no checkpoint was consumed and no step was attempted.
 *  2. **a pass moves the run exactly twice.** One `budgetResume` marker and the run back to `queued`,
 *     where the claimer that started it the first time picks it up; the newest marker is the resume, so
 *     `processRun` re-enters at the checkpoint instead of walking the playbook again.
 *  3. **everything else is a 409 or a 404 and writes nothing.** `not-paused` (it is queued, running or
 *     finished) and `no-checkpoint` (its status says paused but its log carries no pause - only a
 *     hand-edited database produces that) are honest answers, not failures of the endpoint.
 *
 * The two budget rows are written here rather than through `@/test/route-harness`, because neither the
 * route nor the gate resolves a model: the only thing needed from that harness is its three-line
 * temp-database opening, which is what the top of this file is.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-run-resume-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "resume.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { POST } = await import("./route");
const { appendRunEvent, createRun, getRun, listRunEvents, markRunPaused } = await import("@/db/repository");
const { updateAiBudgetSettings } = await import("@/db/repositories/settings");
const { budgetPauseEventData, budgetPauseMessage, budgetPauseOf, budgetResumeMessage, readBudgetPauseMarker } =
  await import("@/lib/run-budget-pause");

/** The shipped default, so a case that refuses is the one that says so. */
async function allowEveryCall() {
  await updateAiBudgetSettings({ policy: "off", monthlyLimit: null, currency: "CNY", unknownCostPolicy: "allow" });
}

/** A limit the period cannot be under: nothing is spent in a fresh database, and the policy still refuses. */
async function refuseEveryCall() {
  await updateAiBudgetSettings({ policy: "block", monthlyLimit: 0, currency: "CNY", unknownCostPolicy: "block" });
}

/** A refusal shaped exactly like the gate's own, so the pause a resume reads is a real one. */
function gateRefusal() {
  return new AppError("AI_BUDGET_EXCEEDED", {
    status: 402,
    message: "The AI budget refused this call before it was sent (over-limit).",
    details: {
      purpose: "run:topic_article_generator",
      reasons: ["over-limit"],
      enforcement: "block",
      period: { key: "2026-10", start: 1, end: 2 },
      currency: "CNY",
      limit: 0,
      spentAmount: 1.25,
      spentIsComplete: true,
      reserved: 0,
      remaining: -1.25,
    },
  });
}

/** The pause the worker writes: `markRunPaused` plus the `warn` event carrying that checkpoint. */
async function pausedRun(playbookId: PlaybookId = "topic_article_generator") {
  const run = await createRun({ playbookId, params: { topic: "换季收纳" } });
  if (!run) throw new Error("the run was not created");
  const pause = budgetPauseOf(gateRefusal(), {
    gate: "node",
    purpose: `run:${playbookId}`,
    pendingStep: playbookId,
    completedSteps: 0,
    stepIndex: null,
    at: 1_000,
  });
  await markRunPaused(run.id, budgetPauseMessage(pause));
  await appendRunEvent(run.id, budgetPauseMessage(pause), "warn", budgetPauseEventData(pause));
  return { run, pause };
}

/** The request the console sends: no body, the id in the path (see `run-pause-actions.ts`). */
async function resume(id: string) {
  const request = new Request(`http://localhost/api/runs/${id}/resume`, { method: "POST" });
  return POST(request, { params: Promise.resolve({ id }) });
}

beforeEach(async () => {
  await allowEveryCall();
});

describe("the budget-pause resume route", () => {
  it("answers 404 when the id names no playbook run", async () => {
    const response = await resume("missing-run");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "UNKNOWN_ERROR",
      message: "Run not found",
      details: { id: "missing-run" },
    });
  });

  it("refuses a run that is not standing on the budget instead of queueing it", async () => {
    const run = await createRun({ playbookId: "topic_article_generator", params: {} });
    if (!run) throw new Error("the run was not created");
    const eventsBefore = await listRunEvents(run.id);

    const response = await resume(run.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "UNKNOWN_ERROR",
      details: { resumed: false, reason: "not-paused", status: "queued" },
    });

    // The refusal writes nothing: the run is still queued and its log says nothing new.
    expect((await getRun(run.id))?.status).toBe("queued");
    expect(await listRunEvents(run.id)).toHaveLength(eventsBefore.length);
  });

  it("refuses a run whose status says paused but whose log carries no checkpoint", async () => {
    const run = await createRun({ playbookId: "topic_article_generator", params: {} });
    if (!run) throw new Error("the run was not created");
    // Only a hand-edited database produces this: `markRunPaused` without the worker's own event.
    await markRunPaused(run.id, "hand-edited");

    const response = await resume(run.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      details: { resumed: false, reason: "no-checkpoint", status: "paused" },
    });
    expect((await getRun(run.id))?.status).toBe("paused");
  });

  it("answers the gate's own 402, with its arithmetic, while the budget still refuses", async () => {
    const { run, pause } = await pausedRun();
    await refuseEveryCall();
    const eventsBefore = await listRunEvents(run.id);

    const response = await resume(run.id);
    expect(response.status).toBe(402);
    const payload = await response.json();

    // What the console classifies on (`code`) and what it reports to the user (`message`, the gate's own
    // sentence with the limit and the period in it) - it is not the console that decides this.
    expect(payload.code).toBe("AI_BUDGET_EXCEEDED");
    expect(payload.message).toContain("over-limit");
    expect(payload.message).toContain("Limit 0 CNY");
    expect(payload.details).toMatchObject({ currency: "CNY", limit: 0, status: "blocked" });
    expect(payload.details.reasons).toEqual(["over-limit"]);

    // A refusal is a decision (a gate row), not a step: the run stands where it was, its own pause
    // sentence is untouched, and its log gained nothing.
    const after = await getRun(run.id);
    expect(after?.status).toBe("paused");
    expect(after?.resultMessage).toBe(budgetPauseMessage(pause));
    const events = await listRunEvents(run.id);
    expect(events).toHaveLength(eventsBefore.length);
    expect(readBudgetPauseMarker(events)).toEqual({ pause, resume: null });
  });

  it("lets a paused run go once the budget does, and writes only the two things a claimer reads", async () => {
    const { run, pause } = await pausedRun();

    const response = await resume(run.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.data.resumed).toBe(true);
    expect(payload.data.run.id).toBe(run.id);
    expect(payload.data.pause).toMatchObject({
      gate: "node",
      pendingStep: "topic_article_generator",
      completedSteps: 0,
    });

    // The two `updateRunStatus` / `appendRunEvent` writes: the run is back where the claimer reads it,
    // with no finish time (a pause is not a failure, so there is nothing to clear twice).
    const after = await getRun(run.id);
    expect(after?.status).toBe("queued");
    expect(after?.finishedAt).toBeUndefined();
    expect(after?.resultMessage).toBe(budgetResumeMessage(pause));
    expect(payload.data.message).toBe(budgetResumeMessage(pause));

    // The newest marker off the run's own log is the resume, which is what makes `processRun` re-enter at
    // the checkpoint rather than walk the playbook from the top.
    const marker = readBudgetPauseMarker(await listRunEvents(run.id));
    expect(marker.pause).toBeNull();
    expect(marker.resume?.from).toMatchObject({
      pendingStep: pause.pendingStep,
      completedSteps: pause.completedSteps,
    });
    expect(payload.data.resumeAt).toEqual(marker.resume?.at);
  });
});
