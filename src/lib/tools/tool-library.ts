import { ZodError } from "zod";
import { appendRunEvent } from "@/db/repository";
import type { ToolRegistry } from "@/lib/agent/tool-registry";
import type { TaskKind, TaskStatus, TaskView } from "@/lib/tasks/task-view";
import { findTaskView } from "@/lib/tasks/task-library";
import { getMediaToolRegistry } from "@/lib/tools/media-tools";
import {
  approvalRequiredError,
  asAgentContext,
  cancelledError,
  describeToolCallFailure,
  inputJsonSchema,
  invalidInputError,
  readTaskId,
  summarizeToolInput,
  summarizeToolOutput,
  taskNotFoundError,
  unknownToolError,
  type ToolCallContext,
  type ToolCallError,
  type ToolCallErrorCode,
  type ToolCallResult,
} from "@/lib/tools/tool-call";

/**
 * CI-P1-03-04/05: the unified discovery and call entry of `docs/coolpilot-integration-contracts.md` §3.2.
 *
 * It is a thin layer over the existing `ToolRegistry`: no tool logic lives here, and nothing about the
 * Agent loop changes. What it adds is the four things §3.2 asks of an entry that other callers use:
 *
 * 1. **Discovery** - `listCallableTools()` publishes the registered tools with their input contract as
 *    JSON Schema, and it publishes only what it can also run (the thin media registry of §3.3, never
 *    `getDefaultToolRegistry()`: listing an Agent-private tool would advertise a capability a generic
 *    caller cannot have).
 * 2. **Validation** - the registry's own Zod schemas stay the single source of truth: the input is
 *    checked before anything runs (so an invalid call has no side effects, and is never a misleading
 *    `APPROVAL_REQUIRED`), and the output is checked by `execute()` exactly as it is for the Agent.
 * 3. **Approval** - a side-effecting tool without a granted approval stops with `APPROVAL_REQUIRED`;
 *    the decision is the tool's own `requiresApproval()`, evaluated against the minimal context, so a
 *    tool added later needs no change here.
 * 4. **A real task id** - when a tool answers with a `taskId`, the entry resolves it through the
 *    CI-P1-02 task view. An id that names no task is `TASK_NOT_FOUND`: `docs/coolpilot-integration-
 *    contracts.md` forbids a task id that is not backed by a real record, and returning one would make
 *    the caller poll a task that does not exist.
 *
 * The call is **synchronous**: the tools of this card finish inside the call and are reported as
 * `completed`. A tool that hands back a `taskId` is not being faked into an async tool by this entry -
 * it reports the real task it created (CI-P1-04 owns the media tasks that need that).
 */

/** A tool a caller may call: the identifier, the description, and the input contract as JSON Schema. */
export type CallableTool = {
  name: string;
  description: string;
  /** `null` when the tool's schema cannot be expressed as JSON Schema; the tool is still callable. */
  inputSchema: Record<string, unknown> | null;
};

export type ToolCallRecord = {
  name: string;
  status: "completed" | "failed";
  /** Redacted, bounded copies - the only form of a value this feature ever logs. */
  inputSummary: Record<string, unknown>;
  outputSummary: Record<string, unknown>;
  errorCode?: ToolCallErrorCode;
  at: number;
};

/** The status-query entry of §3.2: the task id the tool returned, resolved, never re-invented. */
export type ToolTaskLink = {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  rawStatus: string;
  updatedAt: number;
  /** Where the caller reads the status from (CI-P1-02-06). */
  lookup: string;
};

export type ToolCallOutcome = {
  result: ToolCallResult<Record<string, unknown>>;
  record: ToolCallRecord;
  /** The real task this call produced, or `null` when the tool returned no `taskId`. */
  task: ToolTaskLink | null;
  /** True when the record was appended to the host task's own log (`run_events`). */
  recorded: boolean;
};

export function toolTaskLookup(taskId: string) {
  return `/api/tasks/${encodeURIComponent(taskId)}`;
}

/** The workspace-independent half of a task link: everything a caller needs to poll the status. */
export function toToolTaskLink(task: TaskView): ToolTaskLink {
  return {
    id: task.id,
    kind: task.kind,
    status: task.status,
    rawStatus: task.rawStatus,
    updatedAt: task.updatedAt,
    lookup: toolTaskLookup(task.id),
  };
}

/** Every tool this entry can both describe and run, in registration order. */
export function listCallableTools(registry: ToolRegistry = getMediaToolRegistry()): CallableTool[] {
  return registry.list().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: inputJsonSchema(tool.inputSchema),
  }));
}

/**
 * Appends the call's record to the host task's own log.
 *
 * `run_events` is the playbook runner's table, so that is where a playbook host is written - and only
 * there. An agent host's tool record belongs in `chat_tool_calls`, which the Agent loop writes; this
 * entry does not become a second writer of Agent state (§3.2), and a schedule has no log at all.
 *
 * The data holds no `progress`, `current`/`total` or `interrupted` key: CI-P1-02 derives progress and
 * interruption from exactly those, and a tool record must not look like either of them.
 */
async function recordUnderHost(host: TaskView | null, record: ToolCallRecord, message: string): Promise<boolean> {
  if (!host || host.kind !== "playbook") return false;
  await appendRunEvent(host.id, message, record.status === "completed" ? "info" : "error", {
    stage: "tool",
    tool: record.name,
    status: record.status,
    inputSummary: record.inputSummary,
    outputSummary: record.outputSummary,
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
  });
  return true;
}

/**
 * The rejected-call outcome, with its record appended under the host task when there is one.
 *
 * `host` is `null` for the one rejection that happens before a host can be resolved: a name that is
 * not registered at all (see `callTool`), which is refused before any task is looked up.
 */
async function failCall(
  host: TaskView | null,
  name: string,
  input: unknown,
  error: ToolCallError,
  options: { message?: string; output?: unknown } = {},
): Promise<ToolCallOutcome> {
  const record: ToolCallRecord = {
    name,
    status: "failed",
    inputSummary: summarizeToolInput(input),
    outputSummary: options.output === undefined ? {} : summarizeToolOutput(options.output),
    errorCode: error.code,
    at: Date.now(),
  };
  const recorded = await recordUnderHost(host, record, options.message ?? `Tool ${name} failed: ${error.message}`);
  return { result: { ok: false, error }, record, task: null, recorded };
}


/**
 * Runs one registered tool and answers the contract's result.
 *
 * Order matters and is deliberate: unknown tool -> host task -> cancellation -> schema -> approval ->
 * execution -> task verification. Nothing with a side effect happens before the schema and the
 * approval are settled, and no `taskId` leaves the entry before it has been resolved to a real task.
 */
export async function callTool(
  name: string,
  input: unknown = {},
  context: ToolCallContext = {},
  registry: ToolRegistry = getMediaToolRegistry(),
): Promise<ToolCallOutcome> {
  if (!registry.has(name)) {
    return failCall(null, name, input, unknownToolError(name, registry.list().map((tool) => tool.name)));
  }
  const tool = registry.get(name);

  let host: TaskView | null = null;
  if (context.taskId) {
    host = await findTaskView(context.taskId);
    if (!host) {
      return failCall(null, name, input, taskNotFoundError(name, context.taskId, "host"));
    }
  }

  if (context.signal?.aborted) {
    return failCall(host, name, input, cancelledError(name), { message: `Tool ${name} was cancelled` });
  }

  // Validated before the approval gate: an input that could never run must not be answered with
  // `APPROVAL_REQUIRED` (that would promise a call the schema rejects), and it must not run anything.
  let parsedInput: unknown;
  try {
    parsedInput = tool.inputSchema.parse(input);
  } catch (error) {
    const failure =
      error instanceof ZodError ? invalidInputError(name, error) : describeToolCallFailure(error, name);
    return failCall(host, name, input, failure);
  }

  const agentContext = asAgentContext(context);

  let approvalRequired: boolean;
  try {
    approvalRequired = registry.requiresApproval(name, parsedInput, agentContext);
  } catch (error) {
    return failCall(host, name, parsedInput, describeToolCallFailure(error, name));
  }
  if (approvalRequired) {
    return failCall(host, name, parsedInput, approvalRequiredError(name), {
      message: `Tool ${name} was not approved`,
    });
  }

  let output: Record<string, unknown>;
  try {
    output = await registry.execute(name, parsedInput, agentContext);
  } catch (error) {
    return failCall(host, name, parsedInput, describeToolCallFailure(error, name));
  }

  const taskId = readTaskId(output);
  const task = taskId ? await findTaskView(taskId) : null;
  if (taskId && !task) {
    // The tool ran and answered a task id. If that id names no task, the honest answer is that its
    // result cannot be tracked - not a `data` object whose `taskId` would 404 on the first poll.
    const failure = taskNotFoundError(name, taskId, "result");
    return failCall(host, name, parsedInput, failure, { output });
  }

  const record: ToolCallRecord = {
    name,
    status: "completed",
    inputSummary: summarizeToolInput(parsedInput),
    outputSummary: summarizeToolOutput(output),
    at: Date.now(),
  };
  const recorded = await recordUnderHost(host, record, `Tool ${name} completed`);
  return {
    result: { ok: true, data: output },
    record,
    task: task ? toToolTaskLink(task) : null,
    recorded,
  };
}

