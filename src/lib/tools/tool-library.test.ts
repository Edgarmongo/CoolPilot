import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { AgentExecutionContext, AgentToolDefinition } from "@/lib/agent/contracts";
import { toolCallErrorStatus } from "./tool-call";
import type { ToolCallOutcome } from "./tool-library";

/**
 * CI-P1-03-04/05: the entry itself, pinned on a real workspace and a real SQLite database.
 *
 * `tool-call.test.ts` pins the envelope where it is decided; this file pins what the entry *does* to
 * the two registries and to the task tables. Four promises are only observable here:
 *
 * - **discovery and execution are the same registry** - `listCallableTools()` publishes exactly the two
 *   media tools (never an Agent-private one), and `generate_image_file` is the Agent's own object, so
 *   the reused path cannot drift from the Agent path;
 * - **nothing side-effecting runs before validation and approval** - a bad `root` is answered as
 *   `INVALID_INPUT` and an unapproved image call is answered as `APPROVAL_REQUIRED`, both without the
 *   tool's `execute` ever being reached;
 * - **a failure is a value** - with an approval granted the image tool really runs and really fails
 *   (`MODEL_*` - no image-capable model is enabled in this workspace), reported as `TOOL_FAILED` with
 *   the runtime's own code, instead of a thrown error or a fabricated success;
 * - **only a verified task id leaves the entry, and what is written down is redacted** - a tool that
 *   returns a real playbook run is answered with a `ToolTaskLink` whose log entry lives in that run's
 *   own `run_events`, holds `[redacted]` where a secret was, and holds no progress-shaped key.
 *
 * `@/db/client` resolves its database URL once, when it is first imported, so the throwaway workspace
 * is put in the environment before any module of the app is loaded, exactly like
 * `src/lib/tasks/task-library.test.ts`.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), "coolpilot-tools-"));
const workspace = path.join(tempDir, "CoolPilot", "web-data");

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;
const previousDbUrl = process.env.SOCIAL_AUTO_POST_DB_URL;
process.env.SOCIAL_AUTO_POST_DATA_DIR = workspace;
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path
  .join(workspace, "social-auto-post.db")
  .replace(/\\/g, "/")}`;

let repository: typeof import("@/db/repository");
let sqlite: typeof import("@/db/client").sqlite;
let tools: typeof import("./tool-library");
let mediaTools: typeof import("./media-tools");
let defaultTools: typeof import("@/lib/agent/local-tools");
let registryModule: typeof import("@/lib/agent/tool-registry");

beforeAll(async () => {
  repository = await import("@/db/repository");
  ({ sqlite } = await import("@/db/client"));
  tools = await import("./tool-library");
  mediaTools = await import("./media-tools");
  defaultTools = await import("@/lib/agent/local-tools");
  registryModule = await import("@/lib/agent/tool-registry");
  // Migrations run on the first repository call, exactly like the app's first request.
  await repository.listRuns(1);
  // The two files `media_list_assets` is expected to see, written where `paths.ts` looks for them.
  mkdirSync(path.join(workspace, "artifacts"), { recursive: true });
  mkdirSync(path.join(workspace, "videos"), { recursive: true });
  writeFileSync(path.join(workspace, "artifacts", "first.png"), "not really a png");
  writeFileSync(path.join(workspace, "videos", "clip.mp4"), "not really a video");
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

function failureOf(outcome: ToolCallOutcome) {
  if (outcome.result.ok) throw new Error("expected the call to fail, but it answered data");
  return outcome.result.error;
}

function dataOf(outcome: ToolCallOutcome) {
  if (!outcome.result.ok) {
    throw new Error(`expected the call to succeed: ${outcome.result.error.message}`);
  }
  return outcome.result.data;
}

/** The workspace's `artifacts/` and `videos/` files, in the order the library reports them. */
function assetNamesIn(data: Record<string, unknown>) {
  return (data.assets as Array<{ root: string; fileName: string }>).map(
    (asset) => `${asset.root}/${asset.fileName}`,
  );
}

describe("listCallableTools", () => {
  it("publishes the media tools with their input contract, and no Agent-private tool", () => {
    const listed = tools.listCallableTools();

    expect(listed.map((tool) => tool.name)).toEqual([...mediaTools.mediaToolNames]);
    expect(listed.every((tool) => tool.description.trim().length > 0)).toBe(true);
    const listing = listed.find((tool) => tool.name === "media_list_assets");
    const schema = listing?.inputSchema as { type?: string; properties?: Record<string, unknown> } | null;
    expect(schema?.type).toBe("object");
    expect(Object.keys(schema?.properties ?? {})).toEqual(["root", "limit"]);

    // The eight tools that read Agent-private state are neither listed nor callable, and they are
    // still the Agent's own nine tools: this card changed nothing about the Agent loop.
    const agentOnly = [
      "browser_open_page",
      "browser_click",
      "browser_type",
      "browser_screenshot",
      "generate_social_post_draft",
      "generate_image_prompt",
      "threads_create_post",
      "xiaohongshu_create_post",
    ];
    for (const name of agentOnly) {
      expect(listed.map((tool) => tool.name)).not.toContain(name);
      expect(mediaTools.getMediaToolRegistry().has(name)).toBe(false);
    }
    expect(defaultTools.createDefaultToolRegistry().list()).toHaveLength(9);
  });

  it("reuses the Agent's own generate_image_file definition instead of copying it", () => {
    const source = defaultTools.createDefaultToolRegistry();
    const media = mediaTools.createMediaToolRegistry(source);

    // By reference (not a copy): one definition, so the Agent path and the media path cannot drift.
    expect(media.get("generate_image_file")).toBe(source.get("generate_image_file"));
    expect(media.get("media_list_assets")).toBe(mediaTools.mediaListAssetsTool);
    expect(mediaTools.getMediaToolRegistry()).toBe(mediaTools.getMediaToolRegistry());
  });
});

describe("callTool: what is refused before anything runs", () => {
  it("refuses a name that is not registered, and names the ones that are", async () => {
    // An Agent-private tool is exactly this kind of name here: it exists in the Agent registry and is
    // not a capability this entry may offer.
    const outcome = await tools.callTool("browser_open_page", { url: "https://example.com" });
    const error = failureOf(outcome);

    expect(error.code).toBe("UNKNOWN_TOOL");
    expect(toolCallErrorStatus(error.code)).toBe(404);
    expect(error.details).toEqual({
      name: "browser_open_page",
      available: ["generate_image_file", "media_list_assets", "video_render"],
    });
    expect(outcome.record.status).toBe("failed");
    expect(outcome.recorded).toBe(false);
    expect(outcome.task).toBeNull();
  });

  it("checks the input before the approval gate, so a call that can never run is not asked to", async () => {
    const outcome = await tools.callTool("media_list_assets", { root: "nowhere", limit: 10_000 });
    const error = failureOf(outcome);

    expect(error.code).toBe("INVALID_INPUT");
    expect(toolCallErrorStatus(error.code)).toBe(400);
    expect(error.message).toBe('Invalid input for tool "media_list_assets".');
    expect((error.details as { issues: Array<{ path: string }> }).issues.map((issue) => issue.path)).toEqual([
      "root",
      "limit",
    ]);
  });

  it("refuses a host task that does not exist rather than recording nowhere", async () => {
    const outcome = await tools.callTool("media_list_assets", {}, { taskId: "no-such-task" });
    const error = failureOf(outcome);

    expect(error.code).toBe("TASK_NOT_FOUND");
    expect((error.details as { role?: string; taskId?: string }).role).toBe("host");
    expect((error.details as { taskId?: string }).taskId).toBe("no-such-task");
    expect(outcome.recorded).toBe(false);
  });

  it("does not run a tool for a caller that already cancelled", async () => {
    const outcome = await tools.callTool("media_list_assets", {}, { signal: AbortSignal.abort() });
    const error = failureOf(outcome);

    expect(error.code).toBe("CANCELLED");
    expect(toolCallErrorStatus(error.code)).toBe(409);
  });
});

describe("callTool: media_list_assets on a real workspace", () => {
  it("answers the workspace's files as the unified asset references", async () => {
    const data = dataOf(await tools.callTool("media_list_assets", {}));

    expect(assetNamesIn(data)).toEqual(["artifacts/first.png", "videos/clip.mp4"]);
    expect(data.total).toBe(2);
    expect(data.matched).toBe(2);
    expect(data.byRoot).toEqual({ artifacts: 1, videos: 1 });

    const [image, video] = data.assets as Array<Record<string, unknown>>;
    expect(image.kind).toBe("image");
    expect(image.mimeType).toBe("image/png");
    expect(image.external).toBe(false);
    expect(typeof image.url).toBe("string");
    expect(image.url).not.toBe("");
    expect(video.kind).toBe("video");
  });

  it("reports a filter and a limit as themselves, not as a smaller workspace", async () => {
    const filtered = dataOf(await tools.callTool("media_list_assets", { root: "videos" }));
    expect(assetNamesIn(filtered)).toEqual(["videos/clip.mp4"]);
    expect(filtered.matched).toBe(1);
    expect(filtered.total).toBe(2); // the workspace still holds both files
    expect(filtered.byRoot).toEqual({ artifacts: 1, videos: 1 }); // …and the answer still says so

    const limited = dataOf(await tools.callTool("media_list_assets", { limit: 1 }));
    expect(assetNamesIn(limited)).toHaveLength(1);
    expect(limited.matched).toBe(2);
    expect(limited.total).toBe(2);
  });

  it("needs no approval, and invents no record when it runs outside a task", async () => {
    const outcome = await tools.callTool("media_list_assets", {});

    expect(outcome.result.ok).toBe(true);
    expect(outcome.record.status).toBe("completed");
    expect(outcome.recorded).toBe(false);
    expect(outcome.task).toBeNull();
  });
});

const writeInputSchema = z.object({ file: z.string(), prompt: z.string(), apiKey: z.string().optional() });
const writeOutputSchema = z.object({ written: z.boolean(), taskId: z.string().optional() });

type WriteInput = z.infer<typeof writeInputSchema>;

/**
 * A side-effecting tool this file registers itself: it needs approval, it may report a `taskId`, and it
 * says what it was handed - the three things the entry has to get right around a real execution.
 */
function writeTool(
  options: {
    taskId?: string;
    onExecute?: (input: WriteInput, context: AgentExecutionContext) => void;
  } = {},
): AgentToolDefinition<typeof writeInputSchema, typeof writeOutputSchema> {
  return {
    name: "media_test_write",
    description: "A tool this test registers, to pin what the entry does around a real execution.",
    inputSchema: writeInputSchema,
    outputSchema: writeOutputSchema,
    requiresApproval: () => true,
    async execute(input, context) {
      options.onExecute?.(input, context);
      return { written: true, ...(options.taskId ? { taskId: options.taskId } : {}) };
    },
  };
}

describe("callTool: approval and a real failure", () => {
  it("stops a side-effecting tool that was not approved", async () => {
    const outcome = await tools.callTool("generate_image_file", { prompt: "a red fox" });
    const error = failureOf(outcome);

    expect(error.code).toBe("APPROVAL_REQUIRED");
    expect(toolCallErrorStatus(error.code)).toBe(409);
    expect(error.details).toEqual({ tool: "generate_image_file" });
    expect(error.message).toBe('Tool "generate_image_file" changes state and was not approved.');
    expect(outcome.record.status).toBe("failed");
  });

  it("runs it once approved, and reports the runtime's own failure as a value", async () => {
    const outcome = await tools.callTool(
      "generate_image_file",
      { prompt: "a red fox" },
      { approvals: { grantedToolCallId: "call_approved" } },
    );
    const error = failureOf(outcome);

    expect(error.code).toBe("TOOL_FAILED");
    expect(toolCallErrorStatus(error.code)).toBe(500);
    // This workspace enables no image-capable model, and the entry says exactly that: the runtime's own
    // code is kept (`MODEL_NOT_CONFIGURED` here; `MODEL_CAPABILITY_UNAVAILABLE` where models exist but
    // none of them can draw), instead of the call being faked into a success or a thrown error.
    const details = error.details as { tool?: string; errorName?: string; upstreamCode?: string };
    expect(details.tool).toBe("generate_image_file");
    expect(details.errorName).toBe("AppError");
    expect(details.upstreamCode).toMatch(/^MODEL_/);
    expect(error.message.trim()).not.toBe("");
    expect(error.retryable).toBe(false); // "no model configured" is not one of CI-P1-02's transients
    expect(outcome.record.status).toBe("failed");
    expect(outcome.record.errorCode).toBe("TOOL_FAILED");
  });
});

describe("callTool: records and task links", () => {
  it("does not reach execute for an unapproved tool, and does once a grant is presented", async () => {
    const calls: string[] = [];
    const registry = new registryModule.ToolRegistry();
    registry.register(writeTool({ onExecute: (input) => calls.push(input.file) }));

    const unapproved = await tools.callTool(
      "media_test_write",
      { file: "out.png", prompt: "draw a fox" },
      {},
      registry,
    );
    expect(failureOf(unapproved).code).toBe("APPROVAL_REQUIRED");
    expect(calls).toEqual([]); // the gate is in front of the execution, not around the answer

    const approved = await tools.callTool(
      "media_test_write",
      { file: "out.png", prompt: "draw a fox" },
      { approvals: { grantedToolCallId: "call_1" } },
      registry,
    );
    expect(dataOf(approved)).toEqual({ written: true });
    expect(calls).toEqual(["out.png"]);
  });

  it("writes one redacted record into the host playbook run's own log", async () => {
    const run = await repository.createRun({ playbookId: "article_scraper_rewriter", params: {} });
    if (!run) throw new Error("the probe run was expected to be created");
    const contexts: AgentExecutionContext[] = [];
    const registry = new registryModule.ToolRegistry();
    registry.register(
      writeTool({ taskId: run.id, onExecute: (_input, context) => contexts.push(context) }),
    );

    const outcome = await tools.callTool(
      "media_test_write",
      { file: "out.png", prompt: "draw a fox", apiKey: "sk-live-secret-value" },
      { taskId: run.id, approvals: { grantedToolCallId: "call_1" } },
      registry,
    );

    expect(dataOf(outcome)).toEqual({ written: true, taskId: run.id });
    expect(outcome.recorded).toBe(true);
    expect(outcome.task).toMatchObject({
      id: run.id,
      kind: "playbook",
      status: "queued",
      rawStatus: run.status,
      lookup: `/api/tasks/${run.id}`,
    });
    expect(typeof outcome.task?.updatedAt).toBe("number");
    // The host task is the run the call reports under, so the tool sees a real id, not "tool-call".
    expect(contexts.map((context) => context.agentRunId)).toEqual([run.id]);

    const events = await repository.listRunEvents(run.id);
    const entry = events.find((event) => (event.data as { tool?: string }).tool === "media_test_write");
    expect(entry?.message).toBe("Tool media_test_write completed");
    expect(entry?.level).toBe("info");
    const data = entry?.data as Record<string, unknown>;
    expect(data.stage).toBe("tool");
    expect(data.status).toBe("completed");
    // What the caller sent, with the secret's *value* gone: anyone who can read the task can read its
    // log, so nothing written here may carry it.
    expect(data.inputSummary).toEqual({ file: "out.png", prompt: "draw a fox", apiKey: "[redacted]" });
    expect(JSON.stringify(events)).not.toContain("sk-live-secret-value");
    // Not progress-shaped: CI-P1-02 derives progress and interruption from exactly these keys.
    for (const key of ["progress", "current", "total", "interrupted"]) {
      expect(Object.keys(data)).not.toContain(key);
    }
  });

  it("refuses a task id the tool returned when it names no task", async () => {
    const registry = new registryModule.ToolRegistry();
    registry.register(writeTool({ taskId: "not-a-real-run" }));

    const outcome = await tools.callTool(
      "media_test_write",
      { file: "out.png", prompt: "draw a fox" },
      { approvals: { grantedToolCallId: "call_1" } },
      registry,
    );
    const error = failureOf(outcome);

    expect(error.code).toBe("TASK_NOT_FOUND");
    expect((error.details as { role?: string }).role).toBe("result");
    expect(error.message).toContain('returned taskId "not-a-real-run"');
    expect(outcome.task).toBeNull();
    expect(outcome.recorded).toBe(false); // no host task, so nowhere truthful to write it
    // The output is still reported: the tool did run, and its summary is what the record holds.
    expect(outcome.record.outputSummary).toEqual({ written: true, taskId: "not-a-real-run" });
  });

  it("answers INVALID_OUTPUT when a tool breaks its own output contract", async () => {
    const registry = new registryModule.ToolRegistry();
    registry.register({
      name: "media_test_broken",
      description: "A tool whose result does not match the `outputSchema` it declares.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      async execute() {
        return { nope: true } as unknown as { ok: boolean };
      },
    });

    const outcome = await tools.callTool("media_test_broken", {}, {}, registry);
    const error = failureOf(outcome);

    expect(error.code).toBe("INVALID_OUTPUT");
    expect(error.message).toBe(
      'Tool "media_test_broken" returned a result that does not match its output schema.',
    );
    expect(outcome.record.outputSummary).toEqual({});
  });
});

