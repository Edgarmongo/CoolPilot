import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentRunStatus, PlaybookId, ScheduleRecord, ScheduleTime } from "@/lib/types";
import type { ReconcileReport } from "./task-library";
import type { TaskView } from "./task-view";

/**
 * CI-P1-02-03/04/05/06: the database half, pinned on a real SQLite workspace.
 *
 * `task-view.test.ts` pins the mapping rules where they are decided; this file pins what those rules
 * do to the three tables that already exist. Three promises are what §2.2 asks for, and all three are
 * only observable against a database:
 *
 * - **one list is the truth of three systems at once** - a `runs` row, an `agent_runtime_runs` row and
 *   a `schedules` row appear together, each keeping its own status word, and the log view unifies
 *   `run_events` and `agent_runtime_events` without inventing entries for a schedule;
 * - **a cancel is reported as done only when it really stopped something** - a `queued` run is stopped,
 *   a run paused on the AI budget is stopped too but with wording that says what is kept (CI-P7-03-B),
 *   a `running` run is refused (`not-safe-to-stop`) with its row left alone, a paused agent run is
 *   pointed at the approval route that owns it, and a second cancel writes nothing again;
 * - **a restart converges what it interrupted and nothing else** - live work, `queued` work, a paused
 *   approval and a run paused on the AI budget (CI-P7-03-B) survive, while an orphaned `running` row
 *   becomes `failed` with one idempotent marker.
 *
 * `@/db/client` resolves its database URL once, when it is first imported, so the throwaway workspace
 * is put in the environment before any module of the app is loaded, exactly like
 * `src/db/repository.test.ts`.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), "coolpilot-tasks-"));
const workspace = path.join(tempDir, "CoolPilot", "web-data");

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;
const previousDbUrl = process.env.SOCIAL_AUTO_POST_DB_URL;
process.env.SOCIAL_AUTO_POST_DATA_DIR = workspace;
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path
  .join(workspace, "social-auto-post.db")
  .replace(/\\/g, "/")}`;

let repository: typeof import("@/db/repository");
let sqlite: typeof import("@/db/client").sqlite;
let tasks: typeof import("./task-library");

beforeAll(async () => {
  repository = await import("@/db/repository");
  ({ sqlite } = await import("@/db/client"));
  tasks = await import("./task-library");
  // Migrations run on the first repository call, exactly like the app's first request.
  await repository.listRuns(1);
});

afterAll(async () => {
  // The app never closes its own connection; Windows refuses to remove a file a live handle holds.
  await sqlite.close();
  if (previousDataDir === undefined) delete process.env.SOCIAL_AUTO_POST_DATA_DIR;
  else process.env.SOCIAL_AUTO_POST_DATA_DIR = previousDataDir;
  if (previousDbUrl === undefined) delete process.env.SOCIAL_AUTO_POST_DB_URL;
  else process.env.SOCIAL_AUTO_POST_DB_URL = previousDbUrl;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // A throwaway folder the OS reclaims on its own.
  }
});

/** A restart as the reconciler sees it: every row already in the database predates this process. */
function afterRestart() {
  return { processStartedAt: Date.now() + 1_000 };
}

/**
 * A process that never restarted, with a freshness window far wider than this file takes to run: only
 * rows whose own writes are demonstrably old may be converged here.
 */
const LIVE_PROCESS = { processStartedAt: 0, staleAfterMs: 10 * 60_000 };

const TWO_HOURS_AGO = Date.now() - 2 * 3_600_000;

async function newRun(playbookId: PlaybookId = "article_scraper_rewriter") {
  const run = await repository.createRun({ playbookId, params: { urls: "https://example.com/a" } });
  if (!run) throw new Error("createRun returned no row");
  return run;
}

async function runningRun(playbookId: PlaybookId = "article_scraper_rewriter") {
  const run = await newRun(playbookId);
  await repository.updateRunStatus(run.id, "running");
  return run.id;
}

async function newAgentRun(status?: AgentRunStatus) {
  const run = await repository.createAgentRuntimeRun({ status, input: { message: "hello" } });
  if (!run) throw new Error("createAgentRuntimeRun returned no row");
  return run;
}

async function newSchedule(
  options: { status?: ScheduleRecord["status"]; scheduleTimes?: ScheduleTime[] } = {},
) {
  const schedule = await repository.createSchedule({
    playbookId: "threads_auto_post",
    enabled: true,
    status: options.status,
    scheduleTimes: options.scheduleTimes ?? [{ type: "daily", time: "09:00" }],
    nextRunAt: Date.now() + 3_600_000,
  });
  if (!schedule) throw new Error("createSchedule returned no row");
  return schedule;
}

function viewOf(views: readonly TaskView[], id: string) {
  const view = views.find((candidate) => candidate.id === id);
  if (!view) throw new Error(`no task view for ${id}`);
  return view;
}

/** One column of one table, read around the repository so a test can see the row itself. */
async function sqlRow(sql: string, args: Array<string | number> = []) {
  const result = await sqlite.execute({ sql, args });
  return result.rows[0] ?? {};
}

/** The ids a pass converged, so an assertion reads as "this row was not touched". */
const convergedIds = (report: ReconcileReport) => report.converged.map((entry) => entry.id);

describe("the unified task list", () => {
  it("shows all three systems in one answer, each keeping its own status literal", async () => {
    const run = await newRun();
    const agent = await newAgentRun("running");
    const schedule = await newSchedule();

    const views = await tasks.listTaskViews();

    expect(viewOf(views, run.id)).toMatchObject({
      kind: "playbook",
      type: "article_scraper_rewriter",
      status: "queued",
      rawStatus: "queued",
      progress: null,
    });
    expect(viewOf(views, run.id).input).toEqual({ urls: "https://example.com/a" });
    expect(viewOf(views, agent.id)).toMatchObject({
      kind: "agent",
      type: "local",
      status: "running",
      rawStatus: "running",
      progress: null,
    });
    expect(viewOf(views, schedule.id)).toMatchObject({
      kind: "schedule",
      type: "threads_auto_post",
      status: "queued",
      rawStatus: "scheduled",
      progress: null,
    });
    // A schedule's own anchor survives the mapping; the other two kinds have none.
    expect(viewOf(views, schedule.id).nextRunAt).toBe(schedule.nextRunAt);
    expect(viewOf(views, run.id).nextRunAt).toBeUndefined();
  });

  it("orders the three systems by the one column they share, newest activity first", async () => {
    const views = await tasks.listTaskViews();
    const expected = [...views].sort(
      (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
    );

    expect(views.map((view) => view.id)).toEqual(expected.map((view) => view.id));
    expect(views.map((view) => view.updatedAt)).toEqual(
      [...views.map((view) => view.updatedAt)].sort((left, right) => right - left),
    );
  });

  it("filters by kind, by status and by limit without reading less than it filters", async () => {
    const running = await runningRun();
    const agent = await newAgentRun("running");
    const schedule = await newSchedule();

    const playbooks = await tasks.listTaskViews({ kind: "playbook" });
    expect(playbooks.every((view) => view.kind === "playbook")).toBe(true);
    expect(playbooks.some((view) => view.id === running)).toBe(true);
    expect(playbooks.some((view) => view.id === agent.id)).toBe(false);

    const runningPlaybooks = await tasks.listTaskViews({ kind: "playbook", status: "running" });
    expect(runningPlaybooks.some((view) => view.id === running)).toBe(true);
    expect(
      runningPlaybooks.every((view) => view.kind === "playbook" && view.status === "running"),
    ).toBe(true);

    const schedules = await tasks.listTaskViews({ kind: "schedule" });
    expect(schedules.map((view) => view.id)).toContain(schedule.id);
    expect(schedules.some((view) => view.id === running)).toBe(false);

    // The limit bounds the answer, not the read: the first rows are the same rows either way.
    const limited = await tasks.listTaskViews({ limit: 2 });
    expect(limited.map((view) => view.id)).toEqual(
      (await tasks.listTaskViews())
        .slice(0, 2)
        .map((view) => view.id),
    );
    // `limit: 0` is not "no rows" but a nonsensical request, and the default answers it.
    expect((await tasks.listTaskViews({ limit: 0 })).length).toBeGreaterThan(2);
  });

  it("reads progress from the task's own events, newest signal first, and never guesses", async () => {
    const run = await newRun();
    expect((await tasks.getTaskView("playbook", run.id))?.progress).toBeNull();

    await repository.appendRunEvent(run.id, "Publishing batch 1 of 4", "info", {
      stage: "publish",
      current: 1,
      total: 4,
    });
    expect((await tasks.getTaskView("playbook", run.id))?.progress).toBe(25);

    await repository.appendRunEvent(run.id, "Publishing batch 3 of 4", "info", {
      stage: "publish",
      progress: 75,
    });
    expect((await tasks.getTaskView("playbook", run.id))?.progress).toBe(75);

    const agent = await newAgentRun("running");
    expect((await tasks.getTaskView("agent", agent.id))?.progress).toBeNull();
    await repository.appendAgentRuntimeEvent({
      agentRunId: agent.id,
      type: "progress",
      message: "halfway",
      data: { progress: 50 },
    });
    expect((await tasks.getTaskView("agent", agent.id))?.progress).toBe(50);
  });

  it("unifies both event tables into one log shape and invents none for a schedule", async () => {
    const run = await newRun();
    await repository.appendRunEvent(run.id, "Publish rejected", "error", { stage: "publish" });

    const runLogs = await tasks.listTaskLogs("playbook", run.id);
    expect(runLogs[0]).toMatchObject({
      taskId: run.id,
      level: "info",
      stage: "run",
      message: "Run queued",
    });
    expect(runLogs[runLogs.length - 1]).toMatchObject({
      level: "error",
      stage: "publish",
      message: "Publish rejected",
      data: { stage: "publish" },
    });

    const agent = await newAgentRun("running");
    await repository.appendAgentRuntimeEvent({
      agentRunId: agent.id,
      type: "error",
      message: "tool failed",
    });
    await repository.appendAgentRuntimeEvent({
      agentRunId: agent.id,
      type: "final",
      message: "draft ready",
    });
    // An agent event's own type is the stage it lands on.
    const agentLogs = await tasks.listTaskLogs("agent", agent.id);
    expect(agentLogs.map((entry) => [entry.level, entry.stage])).toEqual(
      expect.arrayContaining([
        ["error", "error"],
        ["info", "final"],
      ]),
    );

    const schedule = await newSchedule();
    expect(await tasks.listTaskLogs("schedule", schedule.id)).toEqual([]);
  });

  it("finds a task by id alone and reports a miss as null", async () => {
    const run = await newRun();
    const agent = await newAgentRun("running");
    const schedule = await newSchedule();

    expect((await tasks.findTaskView(run.id))?.kind).toBe("playbook");
    expect((await tasks.findTaskView(agent.id))?.kind).toBe("agent");
    expect((await tasks.findTaskView(schedule.id))?.kind).toBe("schedule");
    // Pinning the wrong kind is not a licence to look in the other two tables.
    expect(await tasks.findTaskView(run.id, "agent")).toBeNull();
    expect(await tasks.getTaskView("playbook", "no-such-task")).toBeNull();
    expect(await tasks.findTaskView("no-such-task")).toBeNull();
  });
});

describe("cancelling a task", () => {
  it("stops a queued playbook run for real and records who stopped it", async () => {
    const run = await newRun();
    const before = await repository.listRunEvents(run.id);

    const outcome = await tasks.cancelTask("playbook", run.id);

    expect(outcome).toMatchObject({ cancelled: true, alreadyCancelled: false });
    if (!outcome || !outcome.cancelled) throw new Error("expected the queued run to be cancelled");
    expect(outcome.task).toMatchObject({ status: "cancelled", rawStatus: "cancelled" });
    expect(outcome.message).toBe(tasks.cancelMessage);

    // The claimer reads `status = "queued"`, so the write is what really stops the run.
    const stored = await repository.getRun(run.id);
    expect(stored?.status).toBe("cancelled");
    expect(stored?.resultMessage).toBe(tasks.cancelMessage);

    const after = await repository.listRunEvents(run.id);
    expect(after.length).toBe(before.length + 1);
    expect(after[after.length - 1]).toMatchObject({
      message: tasks.cancelMessage,
      level: "warn",
      data: { cancelled: true, cancelledFrom: "queued" },
    });
  });

  it("stops a run paused on the AI budget and says what is kept", async () => {
    // CI-P7-03-B. A pause leaves nothing in flight - the executor returned when it paused - so a
    // cancellation is the same write a `queued` run gets, but the wording must not claim the run never
    // started: it finished steps, and those stay.
    const run = await newRun();
    await repository.appendRunEvent(run.id, "Imported 2 of 5 URLs.", "info");
    await repository.markRunPaused(run.id, "Waiting for a higher AI budget.");
    const before = await repository.listRunEvents(run.id);

    const outcome = await tasks.cancelTask("playbook", run.id);

    expect(outcome).toMatchObject({ cancelled: true, alreadyCancelled: false });
    if (!outcome || !outcome.cancelled) throw new Error("expected the paused run to be cancelled");
    expect(outcome.message).toBe(tasks.cancelPausedMessage);
    expect(outcome.task).toMatchObject({ status: "cancelled", rawStatus: "cancelled" });

    const stored = await repository.getRun(run.id);
    expect(stored?.status).toBe("cancelled");
    expect(stored?.resultMessage).toBe(tasks.cancelPausedMessage);
    expect(stored?.finishedAt).toBeDefined();

    const after = await repository.listRunEvents(run.id);
    expect(after.length).toBe(before.length + 1);
    expect(after[after.length - 1]).toMatchObject({
      message: tasks.cancelPausedMessage,
      level: "warn",
      data: { cancelled: true, cancelledFrom: "paused" },
    });
    // What the pause had finished is still there, and the cancel did not restart it either: the run is
    // out of the claimer's hands (`claimNextQueuedRun` reads `status = "queued"`).
    expect(after.some((event) => event.message === "Imported 2 of 5 URLs.")).toBe(true);
    expect(
      (await repository.listRuns(20)).some((candidate) => candidate.id === run.id && candidate.status === "queued"),
    ).toBe(false);
  });

  it("reports a second cancellation as already cancelled without writing again", async () => {
    const run = await newRun();
    await tasks.cancelTask("playbook", run.id);
    const afterFirst = await repository.listRunEvents(run.id);
    const firstRow = await sqlRow("SELECT status, result_message, updated_at FROM runs WHERE id = ?", [
      run.id,
    ]);

    const second = await tasks.cancelTask("playbook", run.id);

    // The state really is cancelled, so success is not a lie - and it is not a second cancellation.
    expect(second).toMatchObject({
      cancelled: true,
      alreadyCancelled: true,
      message: tasks.alreadyCancelledMessage,
    });
    expect(await repository.listRunEvents(run.id)).toHaveLength(afterFirst.length);
    expect(
      await sqlRow("SELECT status, result_message, updated_at FROM runs WHERE id = ?", [run.id]),
    ).toEqual(firstRow);
  });

  it("refuses to fake a stop for work that is running inside this process", async () => {
    const runId = await runningRun();
    const eventsBefore = await repository.listRunEvents(runId);

    const outcome = await tasks.cancelTask("playbook", runId);

    expect(outcome).toMatchObject({
      cancelled: false,
      reason: "not-safe-to-stop",
      message: tasks.notSafeToStopMessage,
    });
    expect((await repository.getRun(runId))?.status).toBe("running");
    expect(await repository.listRunEvents(runId)).toHaveLength(eventsBefore.length);

    const agent = await newAgentRun("running");
    expect(await tasks.cancelTask("agent", agent.id)).toMatchObject({
      cancelled: false,
      reason: "not-safe-to-stop",
    });
    expect((await repository.getAgentRuntimeRun(agent.id))?.status).toBe("running");

    // The scheduler tick drives it in-process and holds no abort handle either.
    const schedule = await newSchedule({ status: "running" });
    expect(await tasks.cancelTask("schedule", schedule.id)).toMatchObject({
      cancelled: false,
      reason: "not-safe-to-stop",
      message: tasks.scheduleNotSafeToStopMessage,
    });
    expect((await repository.getSchedule(schedule.id))?.status).toBe("running");
  });

  it("points a paused agent run at the route that really cancels it", async () => {
    const agent = await newAgentRun("paused");

    const outcome = await tasks.cancelTask("agent", agent.id);

    // The pause is an approval gate owned by `POST /api/agent/runs/[id]/resume`; believing this entry
    // stopped it would be the fake stop §2.2 warns about.
    expect(outcome).toMatchObject({
      cancelled: false,
      reason: "use-resume-endpoint",
      message: tasks.agentResumeCancellationMessage,
    });
    expect((await repository.getAgentRuntimeRun(agent.id))?.status).toBe("paused");
  });

  it("refuses a queued agent run that no executor claims", async () => {
    const agent = await newAgentRun("queued");

    expect(await tasks.cancelTask("agent", agent.id)).toMatchObject({
      cancelled: false,
      reason: "not-safe-to-stop",
      message: tasks.inertAgentRunMessage,
    });
    expect((await repository.getAgentRuntimeRun(agent.id))?.status).toBe("queued");
  });

  it("leaves a task that already reached a terminal status alone", async () => {
    const run = await newRun();
    await repository.updateRunStatus(run.id, "success", "done");

    expect(await tasks.cancelTask("playbook", run.id)).toMatchObject({
      cancelled: false,
      reason: "already-finished",
      message: tasks.alreadyFinishedMessage,
    });
    expect((await repository.getRun(run.id))?.status).toBe("success");

    const schedule = await newSchedule({ status: "posted" });
    expect(await tasks.cancelTask("schedule", schedule.id)).toMatchObject({
      cancelled: false,
      reason: "already-finished",
    });
    expect((await repository.getSchedule(schedule.id))?.status).toBe("posted");
  });

  it("does not touch a row holding a status word this build does not know", async () => {
    const run = await newRun();
    // A literal from a newer build (or a hand-edited workspace): the view may not read it as success.
    await sqlite.execute({ sql: "UPDATE runs SET status = 'zombie' WHERE id = ?", args: [run.id] });

    expect(await tasks.cancelTask("playbook", run.id)).toMatchObject({
      cancelled: false,
      reason: "unknown-status",
      message: tasks.unknownStatusMessage,
    });
    expect((await sqlRow("SELECT status FROM runs WHERE id = ?", [run.id])).status).toBe("zombie");
    expect(await tasks.getTaskView("playbook", run.id)).toMatchObject({
      status: "failed",
      rawStatus: "zombie",
    });
  });

  it("cancels a schedule with the exact write its own delete route performs", async () => {
    const schedule = await newSchedule();
    const queued = await newSchedule({ status: "queued" });

    const outcome = await tasks.cancelTask("schedule", schedule.id);

    expect(outcome).toMatchObject({
      cancelled: true,
      alreadyCancelled: false,
      message: tasks.scheduleCancelMessage,
    });
    const row = await sqlRow("SELECT enabled, status FROM schedules WHERE id = ?", [schedule.id]);
    expect(Number(row.enabled)).toBe(0);
    expect(String(row.status)).toBe("cancelled");
    // `dueSchedules()` reads `enabled = true` only, so nothing is left to fire again.
    const due = await repository.dueSchedules(Date.now() + 10 * 3_600_000);
    expect(due.some((candidate) => candidate.id === schedule.id)).toBe(false);

    // A schedule the tick already claimed (`queued`) is stopped the same way, and cancelling either one
    // twice reports the state that is really there.
    expect(await tasks.cancelTask("schedule", queued.id)).toMatchObject({
      cancelled: true,
      alreadyCancelled: false,
    });
    expect(await tasks.cancelTask("schedule", schedule.id)).toMatchObject({
      cancelled: true,
      alreadyCancelled: true,
      message: tasks.alreadyCancelledMessage,
    });
  });

  it("answers null for an id that names no task at all", async () => {
    expect(await tasks.cancelTask("playbook", "no-such-task")).toBeNull();
    expect(await tasks.cancelTask("agent", "no-such-task")).toBeNull();
    expect(await tasks.cancelTask("schedule", "no-such-task")).toBeNull();
  });
});

describe("converging what a restart interrupted", () => {
  it("leaves live work, queued work and paused approvals where they are", async () => {
    const running = await runningRun();
    const queued = await newRun();
    const agent = await newAgentRun("running");
    const paused = await newAgentRun("paused");
    const pausedRun = await newRun();
    await repository.markRunPaused(pausedRun.id, "Waiting for a higher AI budget.");

    const report = await tasks.reconcileInterruptedTasks(LIVE_PROCESS);

    expect(report.staleAfterMs).toBe(LIVE_PROCESS.staleAfterMs);
    // `checked` counts what was inspected, so "converged nothing" is distinguishable from "looked at nothing".
    expect(report.checked.playbook).toBeGreaterThanOrEqual(1);
    expect(report.checked.agent).toBeGreaterThanOrEqual(1);
    expect(convergedIds(report)).not.toContain(running);
    expect(convergedIds(report)).not.toContain(agent.id);
    expect(convergedIds(report)).not.toContain(pausedRun.id);
    expect(report.untouched.queuedRuns).toBeGreaterThanOrEqual(1);
    expect(report.untouched.pausedRuns).toBeGreaterThanOrEqual(1);
    expect(report.untouched.pausedAgentRuns).toBeGreaterThanOrEqual(1);

    expect((await repository.getRun(running))?.status).toBe("running");
    expect((await repository.getRun(queued.id))?.status).toBe("queued");
    expect((await repository.getAgentRuntimeRun(agent.id))?.status).toBe("running");
    // `queued` work is claimable and a pause is waiting for a human: both are recoverable, not interrupted.
    expect((await repository.getAgentRuntimeRun(paused.id))?.status).toBe("paused");
    // CI-P7-03-B: a budget pause is recoverable too - it awaits the budget, not a repair.
    expect((await repository.getRun(pausedRun.id))?.status).toBe("paused");
  });

  it("converges an interrupted playbook run to failed with one marker event", async () => {
    const runId = await runningRun();
    const before = await repository.listRunEvents(runId);

    const report = await tasks.reconcileInterruptedTasks(afterRestart());

    expect(report.converged).toContainEqual({
      kind: "playbook",
      id: runId,
      from: "running",
      to: "failed",
    });
    const stored = await repository.getRun(runId);
    expect(stored?.status).toBe("failed");
    expect(stored?.resultMessage).toBe(tasks.interruptionMessage);

    const after = await repository.listRunEvents(runId);
    expect(after).toHaveLength(before.length + 1);
    expect(after[after.length - 1]).toMatchObject({
      level: "error",
      message: tasks.interruptionMessage,
      data: { interrupted: true, reason: "process-restart" },
    });
    expect(typeof after[after.length - 1]?.data?.lastActivityAt).toBe("number");

    // The marker is what makes the view report the contract's own retryable interruption code.
    expect((await tasks.getTaskView("playbook", runId))?.error).toMatchObject({
      code: "interrupted",
      retryable: true,
    });

    // A converged row is no longer a candidate, and its marker is never written a second time.
    const again = await tasks.reconcileInterruptedTasks(afterRestart());
    expect(convergedIds(again)).not.toContain(runId);
    expect(await repository.listRunEvents(runId)).toHaveLength(after.length);
  });

  it("leaves a run paused on the AI budget alone even when a restart made every row look orphaned", async () => {
    // Every row here predates `afterRestart`, which is what the pass treats as an interrupted process.
    // A `running` run in this position is converged to `failed` (the case above); a paused one must not
    // be, or a restart - or simply the workspace being reopened - would turn "the budget was too low"
    // into "the run broke" and take the finished steps with it.
    const pausedRun = await newRun();
    const steps = await repository.appendRunEvent(pausedRun.id, "Wrote article 1 of 3.", "info");
    await repository.markRunPaused(pausedRun.id, "Waiting for a higher AI budget.");
    const before = await repository.listRunEvents(pausedRun.id);

    const report = await tasks.reconcileInterruptedTasks(afterRestart());

    expect(convergedIds(report)).not.toContain(pausedRun.id);
    expect(report.untouched.pausedRuns).toBeGreaterThanOrEqual(1);
    const stored = await repository.getRun(pausedRun.id);
    expect(stored?.status).toBe("paused");
    // Not a finish: the record omits the optional timestamp, and the column itself is SQL NULL.
    expect(stored?.finishedAt).toBeUndefined();
    expect(await sqlRow("SELECT finished_at FROM runs WHERE id = ?", [pausedRun.id])).toEqual({
      finished_at: null,
    });
    // The work it had finished is still there, and the pass wrote nothing into its log.
    expect(await repository.listRunEvents(pausedRun.id)).toHaveLength(before.length);
    expect(before.some((event) => event.id === steps.id)).toBe(true);
    expect(before.some((event) => event.message === "Wrote article 1 of 3.")).toBe(true);
  });

  it("converges an interrupted agent run without discarding what it already produced", async () => {
    const agent = await newAgentRun("queued");
    await repository.updateAgentRuntimeRun(agent.id, {
      status: "running",
      result: { assistant: "the draft I already wrote" },
    });
    const before = await repository.listAgentRuntimeEvents(agent.id);

    const report = await tasks.reconcileInterruptedTasks(afterRestart());

    expect(report.converged).toContainEqual({
      kind: "agent",
      id: agent.id,
      from: "running",
      to: "failed",
    });
    const stored = await repository.getAgentRuntimeRun(agent.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.result).toMatchObject({
      assistant: "the draft I already wrote",
      error: tasks.interruptionMessage,
    });

    const after = await repository.listAgentRuntimeEvents(agent.id);
    expect(after).toHaveLength(before.length + 1);
    expect(after[after.length - 1]).toMatchObject({
      type: "error",
      message: tasks.interruptionMessage,
      data: { interrupted: true, reason: "process-restart" },
    });
    expect((await tasks.getTaskView("agent", agent.id))?.error).toMatchObject({
      code: "interrupted",
      retryable: true,
    });
  });

  it("keeps a running row alive while its own log is still moving", async () => {
    const runId = await runningRun();
    // Two hours old by its columns, but the log moved just now: the executor that owns it is alive.
    await sqlite.execute({
      sql: "UPDATE runs SET created_at = ?, updated_at = ? WHERE id = ?",
      args: [TWO_HOURS_AGO, TWO_HOURS_AGO, runId],
    });
    await repository.appendRunEvent(runId, "Scraping page 3", "info", { stage: "scrape" });

    const report = await tasks.reconcileInterruptedTasks(LIVE_PROCESS);

    expect(convergedIds(report)).not.toContain(runId);
    expect((await repository.getRun(runId))?.status).toBe("running");
  });

  it("returns a recurring schedule to armed and a one-time occurrence to failed", async () => {
    const recurring = await newSchedule({ status: "running" });
    const claimed = await newSchedule({ status: "queued" });
    const once = await newSchedule({
      status: "running",
      scheduleTimes: [{ type: "once", at: new Date(Date.now() + 86_400_000).toISOString() }],
    });

    const report = await tasks.reconcileInterruptedTasks(afterRestart());

    // The recurring schedule's `next_run_at` was already advanced by the tick that died: it is armed,
    // and calling it `failed` would claim a schedule that will fire again had failed.
    expect(report.converged).toContainEqual({
      kind: "schedule",
      id: recurring.id,
      from: "running",
      to: "scheduled",
    });
    expect(report.converged).toContainEqual({
      kind: "schedule",
      id: claimed.id,
      from: "queued",
      to: "scheduled",
    });
    expect(report.converged).toContainEqual({
      kind: "schedule",
      id: once.id,
      from: "running",
      to: "failed",
    });

    const storedRecurring = await repository.getSchedule(recurring.id);
    expect(storedRecurring?.status).toBe("scheduled");
    expect(storedRecurring?.enabled).toBe(true);
    expect((await repository.getSchedule(once.id))?.status).toBe("failed");
  });

  it("waits for a schedule whose own run is still held by a live process", async () => {
    const schedule = await newSchedule({ status: "running" });
    const run = await repository.createRun({
      playbookId: "threads_auto_post",
      scheduleId: schedule.id,
    });
    if (!run) throw new Error("createRun returned no row");
    await repository.updateRunStatus(run.id, "running");
    // The schedule's own row went quiet two hours ago, but the run it triggered is moving.
    await sqlite.execute({
      sql: "UPDATE schedules SET updated_at = ? WHERE id = ?",
      args: [TWO_HOURS_AGO, schedule.id],
    });

    const report = await tasks.reconcileInterruptedTasks(LIVE_PROCESS);

    expect(convergedIds(report)).not.toContain(schedule.id);
    expect((await repository.getSchedule(schedule.id))?.status).toBe("running");
    expect((await repository.getRun(run.id))?.status).toBe("running");
  });
});

describe("the once-only scan at first access", () => {
  it("hands every reader of a process the same reconciliation", async () => {
    const first = tasks.reconcileInterruptedTasksOnce();
    // The second reader gets the first reader's answer, not a second scan of three tables.
    expect(tasks.reconcileInterruptedTasksOnce()).toBe(first);

    const report = await first;
    expect(report.staleAfterMs).toBe(tasks.defaultStaleAfterMs);
    expect(report.checked).toEqual({
      playbook: expect.any(Number),
      agent: expect.any(Number),
      schedule: expect.any(Number),
    });
    expect(report.untouched).toEqual({
      queuedRuns: expect.any(Number),
      pausedRuns: expect.any(Number),
      pausedAgentRuns: expect.any(Number),
    });
  });
});
