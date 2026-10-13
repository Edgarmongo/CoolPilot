import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/app-errors";

/**
 * `POST /api/runs/<id>/cancel` (CI-P1-02-05, extended by CI-P7-03-B) at the route boundary - CI-P7-03-F's
 * second button.
 *
 * The console offers the two decisions together, so the two routes have to agree about the state they
 * leave behind, and that agreement is what these cases pin:
 *
 *  - **a paused run is cancelled for real.** A pause left nothing in flight, so writing `cancelled` is
 *    what takes the run out of the claimer's hands - and afterwards the resume route refuses it with
 *    `not-paused`, which is why the two buttons cannot both win.
 *  - **a refusal is a `409`, not a failure.** A `running` run holds no abort handle and a finished one
 *    has nothing left to stop, so the answer says which of the two it is and the run is untouched; the
 *    console turns that into "the run was not changed" plus the server's own sentence.
 *  - **cancelling twice is one write.** The state really is cancelled, so reporting success is not a
 *    lie - and it is not a second cancellation either.
 *
 * The three-line opening is the temp database (`src/test/route-harness.ts` documents it); nothing here
 * resolves a model, so this file needs none of that harness's runtime surface.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-run-cancel-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "cancel.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { POST: cancel } = await import("./route");
const { POST: resume } = await import("../resume/route");
const { createRun, appendRunEvent, getRun, listRunEvents, markRunPaused, updateRunStatus } = await import("@/db/repository");
const { budgetPauseEventData, budgetPauseMessage, budgetPauseOf } = await import("@/lib/run-budget-pause");

/** A refusal shaped like the gate's own, enough to build the pause record a paused run carries. */
function pauseRecord(playbookId: "topic_article_generator" = "topic_article_generator") {
  return budgetPauseOf(
    new AppError("AI_BUDGET_EXCEEDED", { status: 402, message: "refused", details: { reasons: ["over-limit"] } }),
    { gate: "node", purpose: `run:${playbookId}`, pendingStep: playbookId, completedSteps: 0, stepIndex: null },
  );
}

/** The pause the worker writes, so a run is *really* paused and not only labelled that way. */
async function pausedRun() {
  const run = await createRun({ playbookId: "topic_article_generator", params: { topic: "换季收纳" } });
  if (!run) throw new Error("the run was not created");
  const pause = pauseRecord();
  await markRunPaused(run.id, budgetPauseMessage(pause));
  await appendRunEvent(run.id, budgetPauseMessage(pause), "warn", budgetPauseEventData(pause));
  return { run, pause };
}

/** The request both console buttons send: no body, the id in the path. */
async function post(handler: typeof cancel, id: string) {
  const url = `http://localhost/api/runs/${id}`;
  return handler(new Request(url, { method: "POST" }), { params: Promise.resolve({ id }) });
}

describe("the run cancellation route", () => {
  it("answers 404 when the id names no playbook run", async () => {
    const response = await post(cancel, "missing-run");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "UNKNOWN_ERROR",
      message: "Run not found",
      details: { id: "missing-run" },
    });
  });

  it("cancels a budget-paused run, keeping what it had finished, and takes the resume away with it", async () => {
    const { run } = await pausedRun();
    const eventsBefore = await listRunEvents(run.id);

    const response = await post(cancel, run.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ ok: true, data: { cancelled: true, alreadyCancelled: false } });
    // The wording the console shows is the route's, and it is about what a cancellation keeps.
    expect(payload.data.message).toContain("Cancelled while paused on the AI budget");
    expect(payload.data.task.status).toBe("cancelled");

    // One write and one `warn` event - nothing is being executed, so there is nothing to abort.
    const after = await getRun(run.id);
    expect(after?.status).toBe("cancelled");
    expect(after?.finishedAt).toBeDefined();
    const events = await listRunEvents(run.id);
    expect(events).toHaveLength(eventsBefore.length + 1);
    expect(events.at(-1)).toMatchObject({ level: "warn", data: { cancelled: true, cancelledFrom: "paused" } });

    // The seam between the console's two buttons: a cancelled run is no longer paused, so "continue" now
    // refuses instead of queueing work the user has just stopped.
    const resumeResponse = await post(resume, run.id);
    expect(resumeResponse.status).toBe(409);
    expect(await resumeResponse.json()).toMatchObject({ details: { resumed: false, reason: "not-paused", status: "cancelled" } });
    expect((await getRun(run.id))?.status).toBe("cancelled");
  });

  it("refuses a run that is being executed instead of writing a cancellation it cannot honour", async () => {
    const run = await createRun({ playbookId: "topic_article_generator", params: {} });
    if (!run) throw new Error("the run was not created");
    await updateRunStatus(run.id, "running");

    const response = await post(cancel, run.id);
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      details: { cancelled: false, reason: "not-safe-to-stop", status: "running" },
    });
    // The sentence the console shows as `{message}`: it explains why nothing was written.
    expect(payload.details.message).toContain("holds no abort handle");
    expect((await getRun(run.id))?.status).toBe("running");
  });

  it("refuses a run that already finished", async () => {
    const run = await createRun({ playbookId: "topic_article_generator", params: {} });
    if (!run) throw new Error("the run was not created");
    await updateRunStatus(run.id, "success", "done");

    const response = await post(cancel, run.id);
    expect(response.status).toBe(409);
    // `status` is the *task view*'s vocabulary (`succeeded`), `rawStatus` is the run's own (`success`) -
    // which is why the console reads the `reason` and never treats `status` as a run status.
    expect(await response.json()).toMatchObject({
      details: { cancelled: false, reason: "already-finished", status: "succeeded", rawStatus: "success" },
    });
    expect((await getRun(run.id))?.status).toBe("success");
  });

  it("reports a second cancellation as a success without writing a second one", async () => {
    const { run } = await pausedRun();
    await post(cancel, run.id);
    const eventsBefore = await listRunEvents(run.id);

    const response = await post(cancel, run.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { cancelled: true, alreadyCancelled: true, message: "This task was already cancelled." },
    });
    expect(await listRunEvents(run.id)).toHaveLength(eventsBefore.length);
  });
});

