import {
  appendAgentRuntimeEvent,
  appendRunEvent,
  getAgentRuntimeRun,
  getRun,
  getSchedule,
  listAgentRuntimeEvents,
  listAgentRuntimeRuns,
  listRunEvents,
  listRuns,
  listSchedules,
  updateAgentRuntimeRun,
  updateRunStatus,
  updateSchedule,
} from "@/db/repository";
import type { AgentRuntimeRecord, RunRecord } from "@/lib/types";
import {
  agentEventsToTaskLogs,
  agentRunToTaskView,
  deriveProgress,
  hasInterruption,
  isKnownSourceStatus,
  playbookRunToTaskView,
  runEventsToTaskLogs,
  scheduleToTaskView,
  taskKinds,
  type TaskKind,
  type TaskLogEntry,
  type TaskStatus,
  type TaskView,
} from "./task-view";

/**
 * CI-P1-02-03/04/05/06: the database half of the unified long-task view.
 *
 * Everything here reads and writes through `@/db/repository`, on the tables that already exist, and
 * never introduces a column, a table or a status word. Three promises are what this file has to keep:
 *
 * - **Listing is a read that shows the truth of all three task systems at once.** Each row keeps its
 *   own status literal (`rawStatus`) and its own source (`kind`); nothing is normalised away, and a
 *   task whose progress is not in its log carries `progress: null` rather than a made-up percentage.
 * - **Cancellation only reports success when it really stopped something** (§2.2). A `queued` run has
 *   no executor holding it and is genuinely stopped by writing `cancelled`; a `running` run is driven
 *   by an in-flight `processRun` that holds no abort handle and will write its own terminal status, so
 *   cancelling it is refused (`not-safe-to-stop`) instead of being faked in the database. Agent runs
 *   are cancelled where the product already does it - the approval route - and this entry says so.
 * - **Restart convergence separates interrupted from recoverable.** Only a task whose owner cannot
 *   exist any more (its last activity predates this process, or nothing has moved for
 *   `staleAfterMs`) is converged, and only to `failed` + an `interrupted` event; `queued` rows stay
 *   claimable and `paused` agent runs stay waiting for the human they are waiting for.
 */

/** The most rows this view reads per kind, the same order of magnitude as the scheduler's dedupe read. */
export const taskScanLimit = 200;

export const defaultTaskLimit = 50;

export const maxTaskLimit = 200;

/** A restart is only a reason to converge a task that has been silent this long (§2.2 重启恢复). */
export const defaultStaleAfterMs = 30 * 60_000;

export const interruptionMessage =
  "Interrupted: the process running this task stopped before it finished. It was not retried automatically.";

export const cancelMessage = "Cancelled before it started.";

/**
 * CI-P7-03-B. A paused run is stopped the same way a queued one is, but it has already *run*, so
 * "before it started" would be the wrong sentence: what a cancellation keeps is the work it finished.
 */
export const cancelPausedMessage =
  "Cancelled while paused on the AI budget. The steps it had finished are kept; it will not continue on its own.";


export const agentResumeCancellationMessage =
  "A paused agent run is cancelled through POST /api/agent/runs/[id]/resume with approved: false.";

export const notSafeToStopMessage =
  "This task is running inside the current process and holds no abort handle, so cancelling it would only change the record, not the work.";

export const alreadyFinishedMessage = "This task already reached a terminal status.";

export const unknownStatusMessage =
  "This task holds a status this build does not recognise, so it is not touched. Check the source table.";

function clampLimit(limit?: number) {
  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) return defaultTaskLimit;
  return Math.min(maxTaskLimit, limit);
}

/** The view of one playbook run: the row plus the two facts only its event log carries. */
async function playbookView(run: RunRecord): Promise<TaskView> {
  const events = await listRunEvents(run.id);
  return playbookRunToTaskView(run, {
    progress: deriveProgress(events),
    interrupted: hasInterruption(events),
  });
}

async function agentView(run: AgentRuntimeRecord): Promise<TaskView> {
  const events = await listAgentRuntimeEvents(run.id);
  return agentRunToTaskView(run, {
    progress: deriveProgress(events),
    interrupted: hasInterruption(events),
  });
}

export type TaskListFilter = {
  kind?: TaskKind;
  status?: TaskStatus;
  limit?: number;
};

/**
 * Every task of the three systems in one list, newest activity first.
 *
 * `limit` bounds the answer, not the read: each kind contributes at most `taskScanLimit` rows so a
 * status filter still sees far more than it returns. The order is `updatedAt` descending, which is
 * the only ordering the three tables share.
 */
export async function listTaskViews(filter: TaskListFilter = {}): Promise<TaskView[]> {
  const limit = clampLimit(filter.limit);
  const views: TaskView[] = [];

  if (!filter.kind || filter.kind === "playbook") {
    for (const run of await listRuns(taskScanLimit)) {
      views.push(await playbookView(run));
    }
  }
  if (!filter.kind || filter.kind === "agent") {
    for (const run of await listAgentRuntimeRuns(taskScanLimit)) {
      views.push(await agentView(run));
    }
  }
  if (!filter.kind || filter.kind === "schedule") {
    for (const schedule of await listSchedules()) {
      views.push(scheduleToTaskView(schedule));
    }
  }

  return views
    .filter((view) => (filter.status ? view.status === filter.status : true))
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export async function getTaskView(kind: TaskKind, id: string): Promise<TaskView | null> {
  if (kind === "playbook") {
    const run = await getRun(id);
    return run ? playbookView(run) : null;
  }
  if (kind === "agent") {
    const run = await getAgentRuntimeRun(id);
    return run ? agentView(run) : null;
  }
  const schedule = await getSchedule(id);
  return schedule ? scheduleToTaskView(schedule) : null;
}

/** Task ids are `nanoid`s, so an id is looked up across the three kinds unless the caller pins one. */
export async function findTaskView(id: string, kind?: TaskKind): Promise<TaskView | null> {
  if (kind) return getTaskView(kind, id);
  for (const candidate of taskKinds) {
    const view = await getTaskView(candidate, id);
    if (view) return view;
  }
  return null;
}

/** The unified log view of §2.2. A schedule has no log of its own: its runs carry the entries. */
export async function listTaskLogs(kind: TaskKind, id: string): Promise<TaskLogEntry[]> {
  if (kind === "playbook") return runEventsToTaskLogs(id, await listRunEvents(id));
  if (kind === "agent") return agentEventsToTaskLogs(id, await listAgentRuntimeEvents(id));
  return [];
}

export const scheduleCancelMessage = "Schedule cancelled: it will not fire again.";

export const scheduleNotSafeToStopMessage =
  "The scheduler tick is executing this schedule inside the current process and holds no abort handle, so cancelling it would only change the record.";

export const inertAgentRunMessage =
  "No executor claims a queued agent run, so this entry has nothing to stop. A paused agent run is cancelled through the approval route.";

export const alreadyCancelledMessage = "This task was already cancelled.";

export type TaskCancelRefusal =
  /** Real work is in flight and the executor holds no abort handle (§2.2 "不可停"). */
  | "not-safe-to-stop"
  /** The task already reached a terminal status; there is nothing left to stop. */
  | "already-finished"
  /** The row holds a status this build does not recognise; it is left untouched. */
  | "unknown-status"
  /** The product cancels this task somewhere else, and this entry says where instead of duplicating it. */
  | "use-resume-endpoint";

export type TaskCancelOutcome =
  | { cancelled: true; alreadyCancelled: boolean; task: TaskView; message: string }
  | { cancelled: false; reason: TaskCancelRefusal; task: TaskView; message: string };

function refusal(task: TaskView, reason: TaskCancelRefusal, message: string): TaskCancelOutcome {
  return { cancelled: false, reason, task, message };
}

/**
 * §2.2's cancel semantics, `null` when the id names no task at all.
 *
 * What each kind can honestly promise:
 *
 * - **Playbook, `queued`** - `cancelled: true`. The only claimer is `claimNextQueuedRun`, which reads
 *   `status = "queued"`, so writing `cancelled` is what stops it; the run also gets a `warn` event so
 *   the log says who stopped it.
 * - **Playbook, `paused`** - `cancelled: true` for the same reason and with wording that says what is
 *   kept: a budget pause (CI-P7-03-B) left nothing in flight, so `cancelled` is what takes the run out
 *   of the claimer's hands - and afterwards the resume route refuses with `not-paused`.
 * - **Playbook, `running`** - refused. `processRun` is inside the request that claimed the run, holds
 *   no `AbortController`, and writes its own terminal status when it is done; `ctx.checkStop()` reads
 *   `status === "cancelled"` but no playbook calls it, so flipping the column would stop nothing and
 *   would be overwritten by the executor anyway.
 * - **Agent, `paused`** - refused *with a pointer*: the pause is an approval gate, and the route that
 *   owns it (`POST /api/agent/runs/[id]/resume`, `approved: false`) is what cancels for real. This
 *   entry deliberately does not become a second writer of agent run state.
 * - **Agent, `queued` / `running`** - refused, same reason as a running playbook run.
 * - **Schedule, `scheduled` / `queued`** - `cancelled: true`, with the exact write `DELETE
 *   /api/agent/schedules/[id]` performs (`enabled: false`, `status: "cancelled"`): a schedule that is
 *   not firing has nothing in flight, and disabling it is what stops every future occurrence.
 * - **Schedule, `running` / terminal** - refused: the tick drives it in-process, and `posted` /
 *   `failed` / `missed` are over.
 *
 * Cancelling twice is a success with `alreadyCancelled: true` and no second write or event - the state
 * really is cancelled, so reporting success is not a lie, and it is not a second cancellation either.
 */
export async function cancelTask(kind: TaskKind, id: string): Promise<TaskCancelOutcome | null> {
  const task = await getTaskView(kind, id);
  if (!task) return null;
  if (!isKnownSourceStatus(kind, task.rawStatus)) {
    return refusal(task, "unknown-status", unknownStatusMessage);
  }

  if (kind === "playbook") {
    if (task.rawStatus === "cancelled") {
      return { cancelled: true, alreadyCancelled: true, task, message: alreadyCancelledMessage };
    }
    if (task.rawStatus === "queued" || task.rawStatus === "paused") {
      // CI-P7-03-B. A paused run is a `queued` run in every way that matters to a cancellation: the
      // executor returned when it paused, so nothing is in flight, and the claimer - which reads
      // `status = "queued"` - is the only thing that could pick it up again. Writing `cancelled` is what
      // stops it for real, and a resume afterwards is refused by the resume route's own `not-paused`
      // answer rather than by a second writer of run state here. The event says which state it was
      // cancelled from, and the wording says what is kept.
      const message = task.rawStatus === "paused" ? cancelPausedMessage : cancelMessage;
      await updateRunStatus(id, "cancelled", message);
      await appendRunEvent(id, message, "warn", { cancelled: true, cancelledFrom: task.rawStatus });
      const after = await getTaskView(kind, id);
      return { cancelled: true, alreadyCancelled: false, task: after ?? task, message };
    }
    if (task.rawStatus === "running") return refusal(task, "not-safe-to-stop", notSafeToStopMessage);
    return refusal(task, "already-finished", alreadyFinishedMessage);
  }

  if (kind === "agent") {
    if (task.rawStatus === "cancelled") {
      return { cancelled: true, alreadyCancelled: true, task, message: alreadyCancelledMessage };
    }
    if (task.rawStatus === "paused") {
      return refusal(task, "use-resume-endpoint", agentResumeCancellationMessage);
    }
    if (task.rawStatus === "running") return refusal(task, "not-safe-to-stop", notSafeToStopMessage);
    if (task.rawStatus === "queued") return refusal(task, "not-safe-to-stop", inertAgentRunMessage);
    return refusal(task, "already-finished", alreadyFinishedMessage);
  }

  if (task.rawStatus === "cancelled") {
    return { cancelled: true, alreadyCancelled: true, task, message: alreadyCancelledMessage };
  }
  if (task.rawStatus === "scheduled" || task.rawStatus === "queued") {
    await updateSchedule(id, { enabled: false, status: "cancelled", nextRunAt: undefined });
    const after = await getTaskView(kind, id);
    return { cancelled: true, alreadyCancelled: false, task: after ?? task, message: scheduleCancelMessage };
  }
  if (task.rawStatus === "running") return refusal(task, "not-safe-to-stop", scheduleNotSafeToStopMessage);
  return refusal(task, "already-finished", alreadyFinishedMessage);
}

/**
 * When this process started. A task whose last activity predates it was being driven by a process
 * that no longer exists, which is the one thing a restart can assert without guessing (§2.2 重启恢复).
 */
export const processStartedAt = Date.now();

/** The newest timestamp a row actually has; rows leave the optional ones out. */
function newestTimestamp(...values: Array<number | undefined>): number {
  return values.reduce<number>(
    (newest, value) => (typeof value === "number" && value > newest ? value : newest),
    0,
  );
}

export type ReconcileConvergence = {
  kind: TaskKind;
  id: string;
  from: string;
  to: string;
};

export type ReconcileReport = {
  ranAt: number;
  staleAfterMs: number;
  /** Candidates inspected per kind (rows in a non-terminal state), not rows converged. */
  checked: { playbook: number; agent: number; schedule: number };
  converged: ReconcileConvergence[];
  /** Work this pass deliberately left alone, so "nothing happened" is visible rather than implied. */
  untouched: { queuedRuns: number; pausedRuns: number; pausedAgentRuns: number };
};

export type ReconcileOptions = {
  /** How long a task may go without a status update or an event before it counts as interrupted. */
  staleAfterMs?: number;
  /** The moment the current process started; overridable so a test can simulate a restart. */
  processStartedAt?: number;
};

/**
 * CI-P1-02-06: converge the tasks a restart really interrupted, and only those.
 *
 * A row is a candidate when its status says work is in flight (`runs.running`,
 * `agent_runtime_runs.running`, `schedules.running`/`queued`) **and** it has gone quiet, where quiet
 * means one of:
 *
 * - its last activity (status update or newest event) is older than `processStartedAt` - the process
 *   that was driving it is gone; or
 * - nothing has moved for `staleAfterMs` (30 minutes by default), far longer than any single step the
 *   executors take, so a live task that is merely slow is not mistaken for a dead one.
 *
 * What it writes, and what it refuses to write:
 *
 * - **Playbook run** → `failed`, and one marker event the view reads as `error.code = "interrupted"`.
 * - **Agent run** → `failed` with `result.error` kept alongside whatever the run had produced. A
 *   `paused` agent run is *not* touched: it is waiting for a human, so it is recoverable, not
 *   interrupted.
 * - **`queued` work** → not touched, in either run table. It never started, no host is needed to keep
 *   it, and the claimer will pick it up: converging it to `failed` would destroy recoverable work,
 *   which is the mistake §2.2 warns about.
 * - **`paused` playbook run** → not touched, though for a different reason than a paused agent run: a
 *   budget pause (CI-P7-03-B) is waiting for the *budget* rather than for a human's verdict, and
 *   `POST /api/runs/[id]/resume` is what moves it. Failing it here would throw away the steps it
 *   finished and turn "the budget was too low" into "the run broke", which is the confusion this pass
 *   exists to avoid. Only a `running` row is ever a candidate, so the status is what saves it.
 * - **Schedule** → back to the state its own tick would have written: `failed` for a one-time
 *   occurrence, `scheduled` for a recurring one (whose `next_run_at` the tick already advanced), and
 *   only when no run of it is still running. Converging a recurring schedule to `failed` would claim
 *   a schedule that is still armed had failed.
 *
 * Convergence is idempotent: the marker event (`data.interrupted = true`) is appended once, and a
 * converged row is no longer a candidate. A late write from a still-alive executor overwrites the
 * status with the real outcome, which is the correct last word.
 */
export async function reconcileInterruptedTasks(options: ReconcileOptions = {}): Promise<ReconcileReport> {
  const staleAfterMs = options.staleAfterMs ?? defaultStaleAfterMs;
  const bootedAt = options.processStartedAt ?? processStartedAt;
  const ranAt = Date.now();
  const isOrphan = (lastActivityAt: number) =>
    lastActivityAt < bootedAt || ranAt - lastActivityAt >= staleAfterMs;

  const converged: ReconcileConvergence[] = [];
  const checked = { playbook: 0, agent: 0, schedule: 0 };
  const untouched = { queuedRuns: 0, pausedRuns: 0, pausedAgentRuns: 0 };
  const convergedRunIds = new Set<string>();

  const runs = await listRuns(taskScanLimit);
  for (const run of runs) {
    if (run.status !== "running") continue;
    checked.playbook += 1;
    const events = await listRunEvents(run.id);
    const lastActivityAt = newestTimestamp(
      run.createdAt,
      run.startedAt,
      run.updatedAt,
      ...events.map((event) => event.createdAt),
    );
    if (!isOrphan(lastActivityAt)) continue;
    const alreadyMarked = hasInterruption(events);
    await updateRunStatus(run.id, "failed", interruptionMessage, run.artifactPath);
    if (!alreadyMarked) {
      await appendRunEvent(run.id, interruptionMessage, "error", {
        interrupted: true,
        reason: "process-restart",
        lastActivityAt,
      });
    }
    convergedRunIds.add(run.id);
    converged.push({ kind: "playbook", id: run.id, from: run.status, to: "failed" });
  }
  untouched.queuedRuns = runs.filter((run) => run.status === "queued").length;
  // CI-P7-03-B. Counted for the same reason as the two below: a budget pause is a non-terminal state
  // this pass deliberately does not converge, and a reader of the report should see it was left alone
  // rather than wonder whether the scan missed it.
  untouched.pausedRuns = runs.filter((run) => run.status === "paused").length;

  for (const run of await listAgentRuntimeRuns(taskScanLimit)) {
    if (run.status === "paused") untouched.pausedAgentRuns += 1;
    if (run.status !== "running") continue;
    checked.agent += 1;
    const events = await listAgentRuntimeEvents(run.id);
    const lastActivityAt = newestTimestamp(
      run.createdAt,
      run.updatedAt,
      ...events.map((event) => event.createdAt),
    );
    if (!isOrphan(lastActivityAt)) continue;
    const alreadyMarked = hasInterruption(events);
    await updateAgentRuntimeRun(run.id, {
      status: "failed",
      result: { ...run.result, error: interruptionMessage },
    });
    if (!alreadyMarked) {
      await appendAgentRuntimeEvent({
        agentRunId: run.id,
        type: "error",
        message: interruptionMessage,
        data: { interrupted: true, reason: "process-restart", lastActivityAt },
      });
    }
    converged.push({ kind: "agent", id: run.id, from: run.status, to: "failed" });
  }

  for (const schedule of await listSchedules()) {
    if (schedule.status !== "running" && schedule.status !== "queued") continue;
    checked.schedule += 1;
    if (!isOrphan(schedule.updatedAt)) continue;
    const stillDriven = runs.some(
      (run) => run.scheduleId === schedule.id && run.status === "running" && !convergedRunIds.has(run.id),
    );
    if (stillDriven) continue;
    const once = schedule.scheduleTimes.every((time) => time.type === "once");
    const next = once ? "failed" : "scheduled";
    await updateSchedule(schedule.id, { status: next });
    converged.push({ kind: "schedule", id: schedule.id, from: schedule.status, to: next });
  }

  return { ranAt, staleAfterMs, checked, converged, untouched };
}

let reconcileOnce: Promise<ReconcileReport> | null = null;

/**
 * §2.2's "on first access to the task view" trigger: the first reader in a process pays for the scan,
 * every reader after it gets the same answer, and a failed scan is forgotten so the next reader
 * retries instead of inheriting the error for the rest of the process's life.
 */
export function reconcileInterruptedTasksOnce(options: ReconcileOptions = {}): Promise<ReconcileReport> {
  reconcileOnce ??= reconcileInterruptedTasks(options).catch((error: unknown) => {
    reconcileOnce = null;
    throw error;
  });
  return reconcileOnce;
}




