import { describe, expect, it } from "vitest";
import type { AgentRuntimeRecord, RunRecord, ScheduleRecord } from "@/lib/types";
import {
  agentEventsToTaskLogs,
  agentRunToTaskView,
  classifyRetryable,
  deriveProgress,
  hasInterruption,
  isKnownSourceStatus,
  mapAgentStatus,
  mapPlaybookStatus,
  mapScheduleStatus,
  playbookRunToTaskView,
  runEventsToTaskLogs,
  scheduleToTaskView,
  taskKinds,
  taskStatuses,
} from "./task-view";

/**
 * CI-P1-02-01/02/03/04: the mapping rules, pinned where they are decided.
 *
 * These are the assertions the three red lines turn into facts: every source status word keeps its
 * own canonical value (nothing is merged away), an unknown literal cannot become a success, and a
 * task without a progress event carries `null` instead of a made-up number.
 */

const run = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  id: "run-1",
  playbookId: "article_scraper_rewriter",
  status: "queued",
  params: { urls: "https://example.com/a" },
  resultMessage: "",
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
});

const agentRun = (overrides: Partial<AgentRuntimeRecord> = {}): AgentRuntimeRecord => ({
  id: "agent-1",
  status: "running",
  mode: "local",
  input: { message: "hello" },
  state: {},
  pendingApproval: {},
  result: {},
  createdAt: 2_000,
  updatedAt: 2_000,
  ...overrides,
});

const schedule = (overrides: Partial<ScheduleRecord> = {}): ScheduleRecord => ({
  id: "schedule-1",
  playbookId: "threads_auto_post",
  enabled: true,
  scheduleTimes: [{ type: "daily", time: "09:00" }],
  params: { text: "hello" },
  status: "scheduled",
  publishAuthorized: false,
  nextRunAt: 5_000,
  createdAt: 3_000,
  updatedAt: 3_000,
  ...overrides,
});

describe("task status mapping (CI-P1-02-01)", () => {
  it("maps every playbook status to a canonical one and keeps the original", () => {
    expect(
      ["queued", "running", "success", "warning", "failed", "cancelled"].map(mapPlaybookStatus),
    ).toEqual(["queued", "running", "succeeded", "warning", "failed", "cancelled"]);

    for (const status of ["queued", "running", "success", "warning", "failed", "cancelled"] as const) {
      const view = playbookRunToTaskView(run({ status }));
      expect(view.rawStatus).toBe(status);
      expect(isKnownSourceStatus("playbook", view.rawStatus)).toBe(true);
    }
  });

  it("keeps `paused`, `warning` and `missed` as their own statuses instead of merging them", () => {
    expect(mapAgentStatus("paused")).toBe("paused");
    expect(mapPlaybookStatus("warning")).toBe("warning");
    expect(mapScheduleStatus("missed")).toBe("missed");
    // The three words mean three different things and none of them is a failure or a success.
    expect(new Set(["paused", "warning", "missed"]).size).toBe(3);
  });

  it("maps an idle schedule to queued rather than to failed", () => {
    expect(mapScheduleStatus("scheduled")).toBe("queued");
    expect(mapScheduleStatus("queued")).toBe("queued");
    expect(mapScheduleStatus("running")).toBe("running");
    expect(mapScheduleStatus("posted")).toBe("succeeded");
    expect(scheduleToTaskView(schedule()).status).toBe("queued");
  });

  it("never lets an unknown literal claim success, and keeps it readable", () => {
    expect(mapPlaybookStatus("zombie")).toBe("failed");
    expect(mapAgentStatus("zombie")).toBe("failed");
    expect(mapScheduleStatus("zombie")).toBe("failed");

    const view = playbookRunToTaskView(run({ status: "zombie" as RunRecord["status"] }));
    expect(view.status).toBe("failed");
    expect(view.rawStatus).toBe("zombie");
    expect(isKnownSourceStatus("playbook", "zombie")).toBe(false);
  });

  it("answers every canonical status and every kind from its own vocabulary", () => {
    expect(taskKinds).toEqual(["playbook", "agent", "schedule"]);
    expect(taskStatuses).toContain(mapPlaybookStatus("success"));
    expect(taskStatuses).toContain(mapAgentStatus("paused"));
    expect(taskStatuses).toContain(mapScheduleStatus("missed"));
  });
});

describe("task progress derivation (CI-P1-02-03)", () => {
  it("answers null when the log carries no progress at all", () => {
    expect(deriveProgress([])).toBeNull();
    expect(deriveProgress([{ createdAt: 1, data: {} }, { createdAt: 2 }])).toBeNull();
    expect(deriveProgress([{ createdAt: 1, data: { message: "halfway" } }])).toBeNull();
  });

  it("reads an explicit progress payload, and a current/total pair", () => {
    expect(deriveProgress([{ createdAt: 1, data: { progress: 40 } }])).toBe(40);
    expect(deriveProgress([{ createdAt: 1, data: { current: 3, total: 4 } }])).toBe(75);
  });

  it("uses the newest signal and ignores events that only look like one", () => {
    expect(
      deriveProgress([
        { createdAt: 1, data: { progress: 10 } },
        { createdAt: 2, data: {} },
        { createdAt: 3, data: { current: 1, total: 2 } },
      ]),
    ).toBe(50);

    // A string, a NaN, a zero total and a missing half are not evidence of anything.
    expect(deriveProgress([{ createdAt: 1, data: { progress: "40" } }])).toBeNull();
    expect(deriveProgress([{ createdAt: 1, data: { progress: Number.NaN } }])).toBeNull();
    expect(deriveProgress([{ createdAt: 1, data: { current: 3, total: 0 } }])).toBeNull();
    expect(deriveProgress([{ createdAt: 1, data: { current: 3 } }])).toBeNull();
  });

  it("keeps a signal inside 0-100", () => {
    expect(deriveProgress([{ createdAt: 1, data: { progress: 140 } }])).toBe(100);
    expect(deriveProgress([{ createdAt: 1, data: { progress: -5 } }])).toBe(0);
    expect(deriveProgress([{ createdAt: 1, data: { current: 5, total: 4 } }])).toBe(100);
  });

  it("reports an interruption only when the marker is really there", () => {
    expect(hasInterruption([{ createdAt: 1, data: { interrupted: true } }])).toBe(true);
    expect(hasInterruption([{ createdAt: 1, data: { interrupted: false } }])).toBe(false);
    expect(hasInterruption([{ createdAt: 1, data: {} }])).toBe(false);
  });
});

describe("retry classification (CI-P1-02-02)", () => {
  it("marks the transient failures retryable", () => {
    for (const message of [
      "read ECONNRESET",
      "Request timed out after 30000ms",
      "HTTP 503 Service Unavailable",
      "429 Too Many Requests",
      // `MODEL_CREDENTIAL_UNAVAILABLE`, the pool's own sentence for keys that are all cooling down.
      "Every stored key is unavailable (cooling down or rejected)",
      "Interrupted: the process running this task stopped before it finished. It was not retried automatically.",
    ]) {
      expect(classifyRetryable(message), `expected "${message}" to be retryable`).toBe(true);
    }
  });

  it("does not promise a retry for anything else", () => {
    for (const message of [
      "",
      "Invalid payload: urls is required",
      "Model credential is invalid (401)",
      "Account not found",
      "Login required before publishing",
    ]) {
      expect(classifyRetryable(message)).toBe(false);
    }
  });

  it("lets a validation failure win over an upstream 500 mentioned in the same message", () => {
    expect(classifyRetryable("Invalid request: upstream said 500")).toBe(false);
  });
});

describe("task view fields", () => {
  it("takes the artifact reference as the result url only when there is one", () => {
    expect(playbookRunToTaskView(run({ artifactPath: "artifacts/cover.png" })).resultUrl).toBe(
      "artifacts/cover.png",
    );
    expect(playbookRunToTaskView(run()).resultUrl).toBeUndefined();
  });

  it("summarises a failed run from the message the executor wrote", () => {
    const view = playbookRunToTaskView(
      run({ status: "failed", resultMessage: "ETIMEDOUT while fetching the page" }),
    );
    expect(view.error).toEqual({
      code: "RUN_FAILED",
      message: "ETIMEDOUT while fetching the page",
      retryable: true,
    });
  });

  it("uses the contract's `interrupted` code for a converged run", () => {
    const view = playbookRunToTaskView(
      run({
        status: "failed",
        resultMessage:
          "Interrupted: the process running this task stopped before it finished. It was not retried automatically.",
      }),
      { interrupted: true },
    );
    expect(view.error?.code).toBe("interrupted");
    expect(view.error?.retryable).toBe(true);
  });

  it("does not turn a success message into an error, or a warning into a failure", () => {
    expect(
      playbookRunToTaskView(run({ status: "success", resultMessage: "Imported 3 URL(s)" })).error,
    ).toBeNull();
    expect(
      playbookRunToTaskView(run({ status: "cancelled", resultMessage: "Cancelled before it started." }))
        .error,
    ).toBeNull();
    const warning = playbookRunToTaskView(run({ status: "warning", resultMessage: "2 of 3 URLs imported" }));
    expect(warning.status).toBe("warning");
    expect(warning.error?.code).toBe("RUN_WARNING");
  });

  it("reads an agent failure from `result.error` and keeps the run's own timestamps", () => {
    const view = agentRunToTaskView(agentRun({ status: "failed", result: { error: "ECONNREFUSED" } }));
    expect(view).toMatchObject({ kind: "agent", type: "local", status: "failed", rawStatus: "failed" });
    expect(view.error).toEqual({ code: "AGENT_RUN_FAILED", message: "ECONNREFUSED", retryable: true });
    expect(view.startedAt).toBeUndefined();
    expect(view.resultUrl).toBeUndefined();
    expect(view.createdAt).toBe(2_000);
  });

  it("uses a schedule's own anchors: last_run_at as the start, next_run_at as the next occurrence", () => {
    const view = scheduleToTaskView(schedule({ status: "running", lastRunAt: 4_000 }));
    expect(view).toMatchObject({
      kind: "schedule",
      type: "threads_auto_post",
      status: "running",
      startedAt: 4_000,
      nextRunAt: 5_000,
      progress: null,
      error: null,
    });
  });
});

describe("unified log view", () => {
  it("maps run event levels onto info/warn/error and keeps the message", () => {
    const logs = runEventsToTaskLogs("run-1", [
      { id: "e1", runId: "run-1", level: "info", message: "Run queued", createdAt: 1 },
      { id: "e2", runId: "run-1", level: "success", message: "Imported 3 URL(s)", createdAt: 2 },
      { id: "e3", runId: "run-1", level: "warn", message: "Partial", createdAt: 3 },
      {
        id: "e4",
        runId: "run-1",
        level: "error",
        message: "Boom",
        data: { stage: "publish" },
        createdAt: 4,
      },
    ]);

    expect(logs.map((entry) => [entry.level, entry.message, entry.stage])).toEqual([
      ["info", "Run queued", "run"],
      ["info", "Imported 3 URL(s)", "run"],
      ["warn", "Partial", "run"],
      ["error", "Boom", "publish"],
    ]);
  });

  it("maps agent events with their own type as the stage", () => {
    const logs = agentEventsToTaskLogs("agent-1", [
      { id: "e1", agentRunId: "agent-1", type: "progress", message: "started", data: {}, createdAt: 1 },
      {
        id: "e2",
        agentRunId: "agent-1",
        type: "tool_start",
        message: "generate_image",
        data: { name: "generate_image" },
        createdAt: 2,
      },
      { id: "e3", agentRunId: "agent-1", type: "error", message: "Boom", data: {}, createdAt: 3 },
    ]);

    expect(logs.map((entry) => [entry.level, entry.stage])).toEqual([
      ["info", "progress"],
      ["info", "tool_start"],
      ["error", "error"],
    ]);
    expect(logs[1].data).toEqual({ name: "generate_image" });
  });
});

