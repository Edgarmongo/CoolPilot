import { ZodError, z } from "zod";
import type { AgentExecutionContext } from "@/lib/agent/contracts";
import { isAppErrorCode } from "@/lib/app-errors";
import { classifyRetryable } from "@/lib/tasks/task-view";

/**
 * CI-P1-03-02/03: the unified tool-call contract of `docs/coolpilot-integration-contracts.md` §3.2.
 *
 * This file is the pure half of the entry: identifiers, the common execution context, the result and
 * error envelopes, the input/output summary a record may hold, and the JSON Schema a caller reads the
 * parameter contract from. Nothing here opens a database, touches the clock or runs a tool.
 *
 * Three rules it exists to keep:
 *
 * 1. **A generic caller never impersonates an Agent.** `asAgentContext()` is the only place that
 *    builds an `AgentExecutionContext` for a non-Agent caller, and it fills exactly the fields the
 *    type demands: no site, no browser profile, no Agent system prompt, and every permission at
 *    `confirm`. A tool that reads any of that private state therefore stays out of the thin registry
 *    instead of being handed a fabricated value (CI-P1-03-03).
 * 2. **The error is a value, not a stack.** `ToolCallError` carries a machine-readable code, the
 *    product's own message, whether retrying may help (CI-P1-02's `classifyRetryable()`) and, at
 *    most, `{ path, code }` pairs from Zod - never Zod's own (localized) text, never a stack trace.
 * 3. **What gets written down is already redacted.** `summarizeToolInput()`/`summarizeToolOutput()`
 *    are the only way a value reaches a task log, so a key, a token or a cookie cannot end up in
 *    `run_events` even when a tool's schema accepts one.
 */

/** The `agentRunId` a non-Agent call runs under: a literal, so a log line can never be mistaken for a run's own event. */
export const toolCallRunId = "tool-call";

/**
 * The codes §3.2 lists, plus the two the entry needs to stay honest: `INVALID_OUTPUT` (the tool broke
 * its own contract) and `TASK_NOT_FOUND` (a returned `taskId` that names no real task).
 */
export const toolCallErrorCodes = [
  "INVALID_INPUT",
  "UNKNOWN_TOOL",
  "APPROVAL_REQUIRED",
  "TOOL_FAILED",
  "INVALID_OUTPUT",
  "TASK_NOT_FOUND",
  "CANCELLED",
] as const;

export type ToolCallErrorCode = (typeof toolCallErrorCodes)[number];

export type ToolCallError = {
  code: ToolCallErrorCode;
  /** The product's own sentence, safe to show. Never a stack trace, never a localized parser message. */
  message: string;
  /** True only when §2.2's transient patterns match the message; "may help" is not a default. */
  retryable: boolean;
  details?: unknown;
};

export type ToolCallResult<T> = { ok: true; data: T } | { ok: false; error: ToolCallError };

/** The approval a caller may present for a side-effecting tool; mirrors the Agent loop's `approvedToolCallId`. */
export type ToolCallApprovals = {
  grantedToolCallId?: string;
};

/**
 * The generic execution context (§3.2): what a caller that is not the Agent loop can honestly provide.
 * It is deliberately smaller than `AgentExecutionContext` - the Agent-private fields are filled by
 * `asAgentContext()` with values that mean "not an Agent", not with a caller's claim.
 */
export type ToolCallContext = {
  /** The real task this call belongs to (CI-P0-04 id space). Also the id the call's own record is written under. */
  taskId?: string;
  approvals?: ToolCallApprovals;
  /** Optional progress channel; the Agent loop passes its own, other callers may leave it out. */
  emit?: AgentExecutionContext["emit"];
  /** Checked before the tool runs: an already-aborted caller must not start side effects. */
  signal?: AbortSignal;
};

async function noopEmit() {
  // A caller without a progress channel still gets a context the tools can call.
}

/**
 * The minimal compatibility mapping of §3.3: a valid `AgentExecutionContext` for a non-Agent caller,
 * built from the generic context only.
 *
 * `settings.runtimeMode` is the frozen `"local"` literal of the settings type, and every permission is
 * `confirm`, so a tool gated by `runtimeMode !== "local"` or by an `auto` permission behaves exactly
 * as it does for an unapproved Agent step: it stops and asks. That is the safe direction for a caller
 * the approval policy knows nothing about.
 */
export function asAgentContext(context: ToolCallContext = {}): AgentExecutionContext {
  const permissions = {
    browserStep: "confirm" as const,
    browserPostContent: "confirm" as const,
    generateImage: "confirm" as const,
    generatePostContent: "confirm" as const,
  };
  return {
    agentRunId: context.taskId ?? toolCallRunId,
    profilePath: "",
    settings: { runtimeMode: "local", agentPermissions: permissions },
    systemPrompt: "",
    emit: context.emit ?? noopEmit,
    ...(context.approvals?.grantedToolCallId
      ? { approvedToolCallId: context.approvals.grantedToolCallId }
      : {}),
  };
}

/** The HTTP status the tool entry answers with, one place so the route and its tests cannot drift. */
export function toolCallErrorStatus(code: ToolCallErrorCode): number {
  switch (code) {
    case "UNKNOWN_TOOL":
      return 404;
    case "APPROVAL_REQUIRED":
    case "CANCELLED":
      return 409;
    case "TOOL_FAILED":
    case "INVALID_OUTPUT":
      return 500;
    case "INVALID_INPUT":
    case "TASK_NOT_FOUND":
      return 400;
  }
}

export function invalidInputError(toolName: string, error: ZodError): ToolCallError {
  return {
    code: "INVALID_INPUT",
    message: `Invalid input for tool "${toolName}".`,
    retryable: false,
    // The schema contract is machine-readable (§3.4); Zod's own (localized) wording is not part of it.
    details: {
      tool: toolName,
      issues: error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.map(String).join("."),
        code: issue.code,
      })),
    },
  };
}

export function invalidOutputError(toolName: string): ToolCallError {
  return {
    code: "INVALID_OUTPUT",
    message: `Tool "${toolName}" returned a result that does not match its output schema.`,
    retryable: false,
    details: { tool: toolName },
  };
}

export function unknownToolError(toolName: string, available: readonly string[]): ToolCallError {
  return {
    code: "UNKNOWN_TOOL",
    message: `Unknown tool: "${toolName}".`,
    retryable: false,
    details: { name: toolName, available },
  };
}

export function approvalRequiredError(toolName: string): ToolCallError {
  return {
    code: "APPROVAL_REQUIRED",
    message: `Tool "${toolName}" changes state and was not approved.`,
    retryable: false,
    details: { tool: toolName },
  };
}

export function cancelledError(toolName: string): ToolCallError {
  return {
    code: "CANCELLED",
    message: `Tool "${toolName}" was cancelled before it ran.`,
    retryable: false,
    details: { tool: toolName },
  };
}

/** `role: "result"` is a tool claiming a task it produced; `role: "host"` is a caller claiming a task it belongs to. */
export function taskNotFoundError(toolName: string, taskId: string, role: "result" | "host"): ToolCallError {
  return {
    code: "TASK_NOT_FOUND",
    message:
      role === "result"
        ? `Tool "${toolName}" returned taskId "${taskId}", which names no task.`
        : `No task "${taskId}" for tool "${toolName}" to report under.`,
    retryable: false,
    details: { taskId, tool: toolName, role },
  };
}


/**
 * Maps anything a tool threw into the contract's error value.
 *
 * A `ZodError` that reaches here is the tool's **output** failing its own schema: the entry checks the
 * input before executing, so the input case never arrives with this shape. An `AppError` keeps its
 * code (the AI runtime's `MODEL_CAPABILITY_UNAVAILABLE` and friends), because that vocabulary is more
 * useful to a caller than a generic `TOOL_FAILED`.
 */
export function describeToolCallFailure(error: unknown, toolName: string): ToolCallError {
  if (error instanceof ZodError) {
    return invalidOutputError(toolName);
  }
  if (error instanceof Error) {
    const message = error.message.trim() || `Tool "${toolName}" failed.`;
    const details: Record<string, unknown> = { tool: toolName, errorName: error.name };
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && isAppErrorCode(code)) details.upstreamCode = code;
    return { code: "TOOL_FAILED", message, retryable: classifyRetryable(message), details };
  }
  return {
    code: "TOOL_FAILED",
    message: `Tool "${toolName}" failed.`,
    retryable: false,
    details: { tool: toolName },
  };
}

const maxSummaryStringLength = 160;
const maxSummaryEntries = 24;
const maxSummaryDepth = 3;

const sensitiveKeyPatterns = [
  /api[_-]?key/i,
  /(^|[_-])key$/i,
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /cookie/i,
  /authorization/i,
];

/** True for the field names that must never be written to a log as-is. */
export function isSensitiveToolKey(key: string) {
  return sensitiveKeyPatterns.some((pattern) => pattern.test(key));
}

export const redactedToolValue = "[redacted]";

/**
 * A bounded, redacted copy of a value for a task log: strings are cut, collections are cut, depth is
 * cut, and anything whose *name* looks like a secret is replaced by `[redacted]`.
 */
export function summarizeToolValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return value.length > maxSummaryStringLength
      ? `${value.slice(0, maxSummaryStringLength)}… (${value.length} chars)`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return `${value}`;
  if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) {
    if (depth >= maxSummaryDepth) return `[${value.length} items]`;
    const head = value.slice(0, maxSummaryEntries).map((item) => summarizeToolValue(item, depth + 1));
    return value.length > maxSummaryEntries ? [...head, `… (${value.length} items)`] : head;
  }

  const record = value as Record<string, unknown>;
  if (depth >= maxSummaryDepth) return `{${Object.keys(record).length} fields}`;
  const entries = Object.entries(record).slice(0, maxSummaryEntries);
  const summary: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    summary[key] = isSensitiveToolKey(key) ? redactedToolValue : summarizeToolValue(entry, depth + 1);
  }
  const hidden = Object.keys(record).length - entries.length;
  if (hidden > 0) summary["…"] = `${hidden} more fields`;
  return summary;
}

/** The `inputSummary` a tool-call record holds: always an object, so a log reader can rely on the shape. */
export function summarizeToolInput(input: unknown): Record<string, unknown> {
  const summary = summarizeToolValue(input);
  return summary !== null && typeof summary === "object" && !Array.isArray(summary)
    ? (summary as Record<string, unknown>)
    : { input: summary };
}

export function summarizeToolOutput(output: unknown): Record<string, unknown> {
  return summarizeToolInput(output);
}

/**
 * The `taskId` a long-running tool reports (§3.2: an asynchronous tool returns one, a fast tool does not).
 * Reading it in one place is what lets the entry verify the id names a real task.
 */
export function readTaskId(output: unknown): string | null {
  if (output === null || typeof output !== "object" || Array.isArray(output)) return null;
  const value = (output as Record<string, unknown>).taskId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The input schema as JSON Schema, for discovery (§3.2). `io: "input"` describes what a caller has to
 * send, so a field the schema defaults is not required by the published contract.
 *
 * A schema Zod cannot express (a transform, a custom refinement) answers `null`: the tool is still
 * listed - it exists and can be called - but the entry never invents a contract for it.
 */
export function inputJsonSchema(schema: z.ZodType): Record<string, unknown> | null {
  try {
    return z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  } catch {
    return null;
  }
}

