import type {
  AgentRuntimeEventRecord,
  AgentRuntimeRecord,
  RunEventRecord,
  RunRecord,
  ScheduleRecord,
} from "@/lib/types";

/**
 * CI-P1-02-01/02/03/04: the pure half of the canonical long-task view of
 * `docs/coolpilot-integration-contracts.md` §2.
 *
 * Nothing here touches the database, the filesystem or the clock, so the mapping rules - the part
 * that has to stay honest - are testable on their own and shared by routes, tasks and components.
 *
 * The three rules this file exists to keep:
 *
 * 1. **No status is merged away.** `warning` (partially successful), `paused` (waiting for a human)
 *    and `missed` (a schedule whose one-time occurrence was skipped) survive as their own canonical
 *    values; every view also carries `rawStatus`, so the literal the row holds is never lost - an
 *    unknown literal keeps `rawStatus` and *cannot* claim success (it maps to `failed`).
 * 2. **No progress is invented.** `deriveProgress()` reads an explicit `progress` (0-100) or
 *    `{ current, total }` payload out of the task's own events and answers `null` when the log has
 *    none. There is no time-based estimate, no stage count and no "0%" for "unknown".
 * 3. **No retry claim without a reason.** `classifyRetryable()` only answers `true` for the
 *    transient failures §2.2 lists (network, 5xx, rate limit, credential cooldown, interruption);
 *    everything else is `false`, because "retrying this may help" is a promise, not a default.
 */

export const taskKinds = ["playbook", "agent", "schedule"] as const;

export type TaskKind = (typeof taskKinds)[number];

export function isTaskKind(value: string): value is TaskKind {
  return (taskKinds as readonly string[]).includes(value);
}

export const taskStatuses = [
  "queued",
  "running",
  "paused",
  "succeeded",
  "warning",
  "failed",
  "cancelled",
  "missed",
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export function isTaskStatus(value: string): value is TaskStatus {
  return (taskStatuses as readonly string[]).includes(value);
}

export type TaskErrorSummary = {
  /** Stable, machine-readable label: `RUN_FAILED`, `RUN_WARNING`, `AGENT_RUN_FAILED`, `interrupted`. */
  code: string;
  message: string;
  retryable: boolean;
};

export type TaskView = {
  id: string;
  kind: TaskKind;
  /** Task type: the playbook id, or an agent run's mode. Never a new enum - taken from an existing column. */
  type: string;
  status: TaskStatus;
  /** The literal before mapping (`success`, `paused`, `posted`, an unknown value…). Never dropped. */
  rawStatus: string;
  input: Record<string, unknown>;
  /** `null` until the task's own events carry an explicit progress signal. Never a guess, never 0. */
  progress: number | null;
  error: TaskErrorSummary | null;
  /** Existing artifact reference (`runs.artifact_path`); absent when the source row has none. */
  resultUrl?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  updatedAt: number;
  /** Next occurrence of a schedule (`schedules.next_run_at`); the other two kinds have no such anchor. */
  nextRunAt?: number;
};

/** The unified log view of §2.2: one shape over `run_events` and `agent_runtime_events`. */
export type TaskLogEntry = {
  taskId: string;
  at: number;
  level: "info" | "warn" | "error";
  /** `data.stage` when the writer set one, the event type for agent events, `"run"` otherwise. */
  stage: string;
  message: string;
  data: Record<string, unknown>;
};

/**
 * Canonical mapping, one table per source table. An unrecognised literal maps to `failed`: the view
 * may not claim success it cannot prove, and `rawStatus` still shows what the row really says.
 */
const playbookStatusMap: Record<string, TaskStatus> = {
  queued: "queued",
  running: "running",
  /**
   * CI-P7-03-B: the budget paused the run between steps. It is its own bucket - neither `failed`
   * (nothing went wrong and the run is still going to continue) nor `running` (nothing is in flight).
   */
  paused: "paused",
  success: "succeeded",
  warning: "warning",
  failed: "failed",
  cancelled: "cancelled",
};

const agentStatusMap: Record<string, TaskStatus> = {
  queued: "queued",
  running: "running",
  paused: "paused",
  success: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

/**
 * `scheduled` is the schedules table's idle state ("accepted, waiting for its next occurrence"), which
 * is the same canonical bucket as `queued` - it is not "unknown", and mapping it to `failed` would
 * make every idle schedule look broken. `posted` is a schedule's success word.
 */
const scheduleStatusMap: Record<string, TaskStatus> = {
  scheduled: "queued",
  queued: "queued",
  running: "running",
  posted: "succeeded",
  failed: "failed",
  missed: "missed",
  cancelled: "cancelled",
};

export function mapPlaybookStatus(rawStatus: string): TaskStatus {
  return playbookStatusMap[rawStatus] ?? "failed";
}

export function mapAgentStatus(rawStatus: string): TaskStatus {
  return agentStatusMap[rawStatus] ?? "failed";
}

export function mapScheduleStatus(rawStatus: string): TaskStatus {
  return scheduleStatusMap[rawStatus] ?? "failed";
}

/**
 * Whether a literal is one of the source table's own status words. Callers that are about to *write*
 * (a cancellation, a restart convergence) use this to refuse a row whose status they do not
 * recognise, instead of guessing on top of it. The three maps above stay the single source of truth.
 */
export function isKnownSourceStatus(kind: TaskKind, rawStatus: string): boolean {
  const map =
    kind === "playbook" ? playbookStatusMap : kind === "agent" ? agentStatusMap : scheduleStatusMap;
  return Object.prototype.hasOwnProperty.call(map, rawStatus);
}


/**
 * §2.2's `retryable` rule. The "not retryable" list wins when both lists match, so a validation
 * failure that happens to mention an upstream 500 stays `false`. The words here are verdicts
 * (`invalid`, `missing`, `forbidden`), not topics: a credential in cooldown is retryable in
 * §2.2's own list, so `credential` on its own is not a reason to say no.
 */
const notRetryablePatterns = [
  /invalid/i,
  /missing/i,
  /required/i,
  /not found/i,
  /unauthorized/i,
  /forbidden/i,
  /permission/i,
  /approval/i,
  /login/i,
  /unsupported/i,
  /\b400\b/,
  /\b401\b/,
  /\b403\b/,
  /权限|拒绝/,
];

const retryablePatterns = [
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i,
  /socket hang up/i,
  /timeout|timed out/i,
  /network/i,
  /\b429\b/,
  /rate.?limit|too many requests/i,
  /\b5\d{2}\b/,
  /temporarily|try again/i,
  // `MODEL_CREDENTIAL_UNAVAILABLE`'s own sentence ("cooling down"), which the pool reports as a 429.
  /cooling|cooldown|冷却/i,
  /interrupted|中断/i,
];

export function classifyRetryable(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (notRetryablePatterns.some((pattern) => pattern.test(text))) return false;
  return retryablePatterns.some((pattern) => pattern.test(text));
}

/** Oldest-first, the order both event tables are read in. */
export type ProgressSource = { data?: Record<string, unknown>; createdAt: number };

function percentOf(data: Record<string, unknown> | undefined): number | null {
  if (!data) return null;
  const direct = data.progress;
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return Math.min(100, Math.max(0, direct));
  }
  const current = data.current;
  const total = data.total;
  if (
    typeof current === "number"
    && Number.isFinite(current)
    && typeof total === "number"
    && Number.isFinite(total)
    && total > 0
  ) {
    return Math.min(100, Math.max(0, (current / total) * 100));
  }
  return null;
}

/**
 * The newest explicit progress signal in a task's log, or `null`. Scanning newest-first means a
 * later `{ current, total }` supersedes an earlier `progress`, and an event that carries neither
 * (every event the current writers emit) simply contributes nothing.
 */
export function deriveProgress(events: readonly ProgressSource[]): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const value = percentOf(events[index]?.data);
    if (value !== null) return value;
  }
  return null;
}

/** True when the task's log records that a restart interrupted it (§2.2 重启恢复). */
export function hasInterruption(events: readonly ProgressSource[]): boolean {
  return events.some((event) => event.data?.interrupted === true);
}

function playbookError(run: RunRecord, status: TaskStatus, interrupted: boolean): TaskErrorSummary | null {
  const message = run.resultMessage.trim();
  // A run the restart reconciler converged carries the contract's own code, and is retryable: the
  // interruption says nothing about whether the work itself can work.
  if (interrupted && status === "failed") {
    return { code: "interrupted", message, retryable: true };
  }
  if (status === "failed" && message) {
    return { code: "RUN_FAILED", message, retryable: classifyRetryable(message) };
  }
  if (status === "warning" && message) {
    return { code: "RUN_WARNING", message, retryable: classifyRetryable(message) };
  }
  return null;
}

function agentError(run: AgentRuntimeRecord, status: TaskStatus, interrupted: boolean): TaskErrorSummary | null {
  if (interrupted && status === "failed") {
    return { code: "interrupted", message: "", retryable: true };
  }
  const message = typeof run.result.error === "string" ? run.result.error : "";
  if (status === "failed" && message) {
    return { code: "AGENT_RUN_FAILED", message, retryable: classifyRetryable(message) };
  }
  return null;
}

export function playbookRunToTaskView(
  run: RunRecord,
  options: { progress?: number | null; interrupted?: boolean } = {},
): TaskView {
  const status = mapPlaybookStatus(run.status);
  return {
    id: run.id,
    kind: "playbook",
    type: run.playbookId,
    status,
    rawStatus: run.status,
    input: run.params,
    progress: options.progress ?? null,
    error: playbookError(run, status, options.interrupted === true),
    resultUrl: run.artifactPath || undefined,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    updatedAt: run.updatedAt,
  };
}

export function agentRunToTaskView(
  run: AgentRuntimeRecord,
  options: { progress?: number | null; interrupted?: boolean } = {},
): TaskView {
  const status = mapAgentStatus(run.status);
  return {
    id: run.id,
    kind: "agent",
    type: run.mode,
    status,
    rawStatus: run.status,
    input: run.input,
    progress: options.progress ?? null,
    error: agentError(run, status, options.interrupted === true),
    // Agent runs record their outcome in `result_json` (assistant text plus tool calls); there is no
    // artifact column, and turning a tool's output path into a url is the next card's job.
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function scheduleToTaskView(schedule: ScheduleRecord): TaskView {
  const status = mapScheduleStatus(schedule.status);
  return {
    id: schedule.id,
    kind: "schedule",
    type: schedule.playbookId,
    status,
    rawStatus: schedule.status,
    input: schedule.params,
    progress: null,
    // A schedule has no result channel of its own: the run it triggered carries the outcome.
    error: null,
    createdAt: schedule.createdAt,
    startedAt: schedule.lastRunAt,
    updatedAt: schedule.updatedAt,
    nextRunAt: schedule.nextRunAt,
  };
}

function runEventLevel(level: RunEventRecord["level"]): TaskLogEntry["level"] {
  if (level === "error") return "error";
  if (level === "warn") return "warn";
  // `run_events.level` also has `success`, which the unified log vocabulary does not: the message
  // stays, the level lands on `info`.
  return "info";
}

export function runEventsToTaskLogs(taskId: string, events: readonly RunEventRecord[]): TaskLogEntry[] {
  return events.map((event) => ({
    taskId,
    at: event.createdAt,
    level: runEventLevel(event.level),
    stage: typeof event.data?.stage === "string" ? event.data.stage : "run",
    message: event.message,
    data: event.data ?? {},
  }));
}

export function agentEventsToTaskLogs(taskId: string, events: readonly AgentRuntimeEventRecord[]): TaskLogEntry[] {
  return events.map((event) => ({
    taskId,
    at: event.createdAt,
    level: event.type === "error" ? "error" : "info",
    stage: event.type,
    message: event.message,
    data: event.data,
  }));
}



