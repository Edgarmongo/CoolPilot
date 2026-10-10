import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/app-errors";
import {
  asAgentContext,
  cancelledError,
  describeToolCallFailure,
  inputJsonSchema,
  invalidInputError,
  isSensitiveToolKey,
  readTaskId,
  redactedToolValue,
  summarizeToolInput,
  summarizeToolValue,
  taskNotFoundError,
  toolCallErrorCodes,
  toolCallErrorStatus,
  toolCallRunId,
  unknownToolError,
} from "./tool-call";

/**
 * CI-P1-03-02/03: the pure half of the tool entry, pinned without a database, a clock or a tool.
 *
 * Four promises of `docs/coolpilot-integration-contracts.md` §3.2 are only decidable here:
 *
 * - **the generic context is honest** - `asAgentContext()` answers a valid `AgentExecutionContext`
 *   whose Agent-private fields say "not an Agent" (`profilePath: ""`, `systemPrompt: ""`, no site) and
 *   whose permissions are all `confirm`;
 * - **an error is a value** - each code keeps the product's own sentence, `INVALID_INPUT` carries only
 *   `{ path, code }` pairs so no parser wording (or stack) can reach a caller, and retryability comes
 *   from CI-P1-02's rules instead of being assumed;
 * - **a log line is already redacted** - the summary helpers are the only road into a task log, so a
 *   secret's *value* never appears, only `[redacted]`;
 * - **discovery never invents a contract** - a schema JSON Schema cannot express answers `null` rather
 *   than a schema nobody validated.
 */

function issuesOf(input: unknown) {
  const parsed = z.object({ prompt: z.string() }).safeParse(input);
  if (parsed.success) throw new Error("the probe schema was expected to reject this input");
  return parsed.error;
}

describe("asAgentContext", () => {
  it("fills the Agent-private fields with 'not an Agent' values", async () => {
    const context = asAgentContext();

    expect(context.agentRunId).toBe(toolCallRunId);
    expect(context.agentRunId).toBe("tool-call");
    expect(context.profilePath).toBe("");
    expect(context.systemPrompt).toBe("");
    expect(context.site).toBeUndefined();
    expect(context.approvedToolCallId).toBeUndefined();
    expect(context.settings.runtimeMode).toBe("local");
    // Every permission is `confirm`: a caller the approval policy knows nothing about is not auto-run.
    expect(context.settings.agentPermissions).toEqual({
      browserStep: "confirm",
      browserPostContent: "confirm",
      generateImage: "confirm",
      generatePostContent: "confirm",
    });
    // A caller without a channel still gets one the tools can call.
    await expect(context.emit({ type: "progress", message: "probe" })).resolves.toBeUndefined();
  });

  it("carries the caller's own id, channel and grant, and nothing else", async () => {
    const emit = vi.fn(async () => {});
    const context = asAgentContext({
      taskId: "run_1",
      emit,
      approvals: { grantedToolCallId: "call_9" },
    });

    expect(context.agentRunId).toBe("run_1");
    expect(context.emit).toBe(emit);
    expect(context.approvedToolCallId).toBe("call_9");
    // The grant lifts the gate; it does not grant anything else the Agent loop itself would set.
    expect(context.profilePath).toBe("");
    expect(context.settings.agentPermissions.generateImage).toBe("confirm");
  });
});

describe("tool call errors", () => {
  it("maps every code to the one status the HTTP entry answers with", () => {
    expect(toolCallErrorCodes.map((code) => [code, toolCallErrorStatus(code)])).toEqual([
      ["INVALID_INPUT", 400],
      ["UNKNOWN_TOOL", 404],
      ["APPROVAL_REQUIRED", 409],
      ["TOOL_FAILED", 500],
      ["INVALID_OUTPUT", 500],
      ["TASK_NOT_FOUND", 400],
      ["CANCELLED", 409],
    ]);
  });

  it("reports invalid input as machine-readable issues, never as the parser's own sentence", () => {
    const error = invalidInputError("media_list_assets", issuesOf({}));

    expect(error.code).toBe("INVALID_INPUT");
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('Invalid input for tool "media_list_assets".');
    const details = error.details as { tool: string; issues: Array<Record<string, unknown>> };
    expect(details.tool).toBe("media_list_assets");
    expect(details.issues).toEqual([{ path: "prompt", code: "invalid_type" }]);
    // Zod's own wording ("Invalid input: expected string, received undefined") stays out of the envelope.
    expect(JSON.stringify(error)).not.toContain("expected string");
    expect(JSON.stringify(error)).not.toContain("stack");
  });

  it("names the tool and the allowed names when a name is unknown", () => {
    const error = unknownToolError("nope", ["media_list_assets", "generate_image_file"]);
    expect(error.code).toBe("UNKNOWN_TOOL");
    expect(error.message).toBe('Unknown tool: "nope".');
    expect(error.details).toEqual({
      name: "nope",
      available: ["media_list_assets", "generate_image_file"],
    });
  });

  it("separates a task id the tool returned from a host task that does not exist", () => {
    const result = taskNotFoundError("media_list_assets", "abc", "result");
    const host = taskNotFoundError("media_list_assets", "abc", "host");
    expect(result.code).toBe("TASK_NOT_FOUND");
    expect(result.message).toContain("returned taskId");
    expect(host.message).toContain("report under");
    expect(cancelledError("media_list_assets").message).toBe(
      'Tool "media_list_assets" was cancelled before it ran.',
    );
  });
});

describe("describeToolCallFailure", () => {
  it("keeps an AppError's own code as the upstream reason and borrows the runtime's retry rule", () => {
    const error = describeToolCallFailure(
      new AppError("MODEL_CAPABILITY_UNAVAILABLE", { status: 503, message: "Upstream 503: no image model" }),
      "generate_image_file",
    );

    expect(error.code).toBe("TOOL_FAILED");
    expect(error.message).toBe("Upstream 503: no image model");
    expect(error.details).toEqual({
      tool: "generate_image_file",
      errorName: "AppError",
      upstreamCode: "MODEL_CAPABILITY_UNAVAILABLE",
    });
    // "503" is one of CI-P1-02's transient patterns, so the caller is told a retry may help.
    expect(error.retryable).toBe(true);
  });

  it("does not promise a retry without a transient reason", () => {
    const error = describeToolCallFailure(
      new Error("Model capability unavailable"),
      "generate_image_file",
    );
    expect(error.code).toBe("TOOL_FAILED");
    expect(error.retryable).toBe(false);
    expect(error.details).toEqual({
      tool: "generate_image_file",
      errorName: "Error",
      upstreamCode: undefined,
    });
  });

  it("treats an output that broke its own schema as INVALID_OUTPUT, not as a tool failure", () => {
    const error = describeToolCallFailure(issuesOf({}), "media_list_assets");
    expect(error.code).toBe("INVALID_OUTPUT");
    expect(error.message).toBe('Tool "media_list_assets" returned a result that does not match its output schema.');
    expect(error.retryable).toBe(false);
  });

  it("answers a thrown non-Error with its own generic sentence", () => {
    const error = describeToolCallFailure("boom", "media_list_assets");
    expect(error.code).toBe("TOOL_FAILED");
    expect(error.message).toBe('Tool "media_list_assets" failed.');
    expect(error.details).toEqual({ tool: "media_list_assets" });
  });
});

describe("tool call summaries", () => {
  it("replaces every sensitive key with the marker, at any depth", () => {
    const summary = summarizeToolInput({
      apiKey: "sk-live-123456",
      cookie: "session=abcdef",
      password: "hunter2",
      prompt: "draw a cat",
      nested: { authorization: "Bearer abc", token: "t-1", note: "keep me" },
    });

    expect(summary.apiKey).toBe(redactedToolValue);
    expect(summary.cookie).toBe(redactedToolValue);
    expect(summary.password).toBe(redactedToolValue);
    expect(summary.prompt).toBe("draw a cat");
    const nested = summary.nested as Record<string, unknown>;
    expect(nested.authorization).toBe(redactedToolValue);
    expect(nested.token).toBe(redactedToolValue);
    expect(nested.note).toBe("keep me");
    expect(JSON.stringify(summary)).not.toContain("sk-live-123456");
    expect(JSON.stringify(summary)).not.toContain("Bearer abc");
  });

  it("knows the field names that may hold a secret", () => {
    for (const key of ["apiKey", "api_key", "access_token", "client_secret", "password", "sessionCookie", "authorization"]) {
      expect(isSensitiveToolKey(key)).toBe(true);
    }
    for (const key of ["prompt", "limit", "root", "taskId"]) {
      expect(isSensitiveToolKey(key)).toBe(false);
    }
  });

  it("cuts long strings, deep nesting and long lists instead of logging them whole", () => {
    const long = "x".repeat(400);
    expect(summarizeToolInput({ prompt: long }).prompt).toBe(`${"x".repeat(160)}… (400 chars)`);
    expect(summarizeToolValue({ a: { b: { c: { d: 1 } } } })).toEqual({ a: { b: { c: "{1 fields}" } } });
    const many = summarizeToolValue(Array.from({ length: 30 }, (_, index) => index)) as unknown[];
    expect(many).toHaveLength(25);
    expect(many[24]).toBe("… (30 items)");
  });

  it("always answers an object, whatever the caller passed in", () => {
    expect(summarizeToolInput("boom")).toEqual({ input: "boom" });
    expect(summarizeToolInput(null)).toEqual({ input: null });
    expect(summarizeToolInput([1, 2])).toEqual({ input: [1, 2] });
  });
});

describe("readTaskId", () => {
  it("reads the id a long-running tool reported, and only a real string", () => {
    expect(readTaskId({ taskId: "  run_1  " })).toBe("run_1");
    expect(readTaskId({ taskId: 5 })).toBeNull();
    expect(readTaskId({ taskId: "   " })).toBeNull();
    expect(readTaskId({})).toBeNull();
    expect(readTaskId("run_1")).toBeNull();
    expect(readTaskId(null)).toBeNull();
  });
});

describe("inputJsonSchema", () => {
  it("publishes the schema's own contract, with defaults not required", () => {
    const schema = inputJsonSchema(
      z.object({
        root: z.enum(["artifacts", "videos"]).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        prompt: z.string(),
      }),
    );

    expect(schema?.type).toBe("object");
    const properties = (schema?.properties ?? {}) as Record<
      string,
      { type?: string; minimum?: number; maximum?: number; enum?: string[] }
    >;
    expect(Object.keys(properties)).toEqual(["root", "limit", "prompt"]);
    expect(properties.root.enum).toEqual(["artifacts", "videos"]);
    expect(properties.limit).toEqual({ type: "integer", minimum: 1, maximum: 500 });
    expect(schema?.required).toEqual(["prompt"]);
  });

  it("answers null for a schema JSON Schema cannot express, rather than inventing one", () => {
    // A `Date` (or `Map`, `Set`, custom parser …) has no JSON Schema form. The tool stays listed - it
    // exists and can be called - but the entry publishes `null` instead of a contract nobody validated.
    expect(inputJsonSchema(z.object({ at: z.date() }))).toBeNull();
  });

  it("describes what the caller must send, not what a transform computes", () => {
    // `io: "input"` is what makes this expressible: the transform's *input* is a plain string, so the
    // published contract is the string a caller sends - the computed value is not part of the contract.
    expect(inputJsonSchema(z.string().transform((value) => value.length))).toMatchObject({ type: "string" });
  });
});

