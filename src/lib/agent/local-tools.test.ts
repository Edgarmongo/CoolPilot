import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentExecutionContext } from "./contracts";

/**
 * The approval block is about permission policy; the last block is the P3-A2 change - the image-prompt
 * tool calls `aiRuntime.chatStructured()` directly, so the runtime is mocked instead of the legacy
 * `@/lib/ai` facade, and what the case pins is that the tool reports the provider/model the runtime
 * really used rather than a hard-coded pair.
 *
 * CI-P7-03 put a budget gate inside that tool, so this file also pins the refusal: the gate's own
 * error, and no request. The harness pins the temp database and puts the budget row back; it has to be
 * the first import, because the gate reads a settings row that this file's own imports would otherwise
 * resolve against the install's database.
 */
vi.mock("@/features/ai-runtime", async () => {
  const actual = await vi.importActual<typeof import("@/features/ai-runtime")>("@/features/ai-runtime");
  return { ...actual, aiRuntime: { ...actual.aiRuntime, chatStructured: vi.fn() } };
});

const { allowEveryAiBudgetCall, refuseEveryAiBudgetCall } = await import("@/test/route-harness");
const { aiRuntime } = await import("@/features/ai-runtime");
const { imagePromptSchema } = await import("@/lib/ai/schemas");
const { createDefaultToolRegistry } = await import("./local-tools");

const mockedChatStructured = vi.mocked(aiRuntime.chatStructured);

const baseContext: AgentExecutionContext = {
  agentRunId: "run_1",
  profilePath: "profile",
  settings: {
    runtimeMode: "local",
    agentPermissions: {
      browserStep: "confirm",
      browserPostContent: "confirm",
      generateImage: "confirm",
      generatePostContent: "confirm",
    },
  },
  systemPrompt: "Test system prompt",
  emit: vi.fn(),
};

describe("local tool approval policy", () => {
  it("guards all local operations by default", () => {
    const registry = createDefaultToolRegistry();
    expect(
      registry.requiresApproval(
        "browser_click",
        { selector: "button[type=submit]", isFinalPublish: true },
        baseContext,
      ),
    ).toBe(true);
    expect(registry.requiresApproval("generate_social_post_draft", { topic: "x" }, baseContext)).toBe(true);
    expect(registry.requiresApproval("generate_image_file", { prompt: "x" }, baseContext)).toBe(true);
    expect(registry.requiresApproval("browser_screenshot", {}, baseContext)).toBe(true);
  });

  it("allows only operations whose permission is auto", () => {
    const registry = createDefaultToolRegistry();
    const context = {
      ...baseContext,
      settings: {
        ...baseContext.settings,
        agentPermissions: { ...baseContext.settings.agentPermissions, browserPostContent: "auto" as const },
      },
    };
    expect(
      registry.requiresApproval(
        "browser_click",
        { selector: "button[type=submit]", isFinalPublish: true },
        context,
      ),
    ).toBe(false);
    expect(registry.requiresApproval("browser_screenshot", {}, context)).toBe(true);
  });

  it("uses the post-content permission for the final Threads publish action", () => {
    const registry = createDefaultToolRegistry();
    const input = { text: "Hello Threads", publish: true };

    expect(registry.requiresApproval("threads_create_post", input, baseContext)).toBe(true);
    expect(registry.requiresApproval("threads_create_post", input, {
      ...baseContext,
      settings: {
        ...baseContext.settings,
        agentPermissions: {
          ...baseContext.settings.agentPermissions,
          browserPostContent: "auto",
        },
      },
    })).toBe(false);
  });
});

describe("local tool model calls on the runtime", () => {
  beforeEach(async () => {
    // The shipped budget row is `off`; a case that wants a refusal states the refusal itself, and this
    // puts the row back so the other cases here keep calling the model.
    await allowEveryAiBudgetCall();
    mockedChatStructured.mockReset();
  });

  it("reports the provider and model the runtime really used for the image prompt", async () => {
    mockedChatStructured.mockResolvedValue({
      data: { prompt: "  Wide shot of a cold-start diagram, flat vector, soft light, 4:5.  " },
      providerId: "deepseek",
      model: "deepseek-chat",
      usage: { inputTokens: 21, outputTokens: 34, totalTokens: 55 },
    } as Awaited<ReturnType<typeof aiRuntime.chatStructured>>);
    const registry = createDefaultToolRegistry();

    const output = await registry.execute(
      "generate_image_prompt",
      { topic: "cold start", style: "flat vector" },
      baseContext,
    );

    expect(output).toEqual({
      prompt: "Wide shot of a cold-start diagram, flat vector, soft light, 4:5.",
      provider: "deepseek",
      model: "deepseek-chat",
    });
    const request = mockedChatStructured.mock.calls[0]?.[0];
    expect(request?.schema).toBe(imagePromptSchema);
    expect(request?.systemPrompt).toBe("Test system prompt");
    expect(request?.messages.at(-1)?.content).toContain("Topic: cold start");
    expect(request?.messages.at(-1)?.content).toContain("Style: flat vector");
  });

  it("refuses the image prompt before it is sent, with the gate's own error", async () => {
    await refuseEveryAiBudgetCall();
    const registry = createDefaultToolRegistry();

    // The refusal leaves the tool as the gate's own `AI_BUDGET_EXCEEDED` (402) rather than a failed
    // model call: nothing was sent, so there is no attempt to record and no prompt to charge for.
    await expect(
      registry.execute("generate_image_prompt", { topic: "cold start", style: "flat vector" }, baseContext),
    ).rejects.toMatchObject({ code: "AI_BUDGET_EXCEEDED", status: 402 });
    expect(mockedChatStructured).not.toHaveBeenCalled();
  });
});

