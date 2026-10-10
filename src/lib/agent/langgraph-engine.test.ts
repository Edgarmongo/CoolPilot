import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolPlanStep } from "@/lib/ai/schemas";
import type { AccountRecord } from "@/lib/types";

/**
 * The planner runs on `aiRuntime` since P3-A2, so the mock moved from the legacy `@/lib/ai` facade
 * to the runtime itself. Everything else about this suite is unchanged: what it pins is the wiring
 * between a plan step and the tool call it becomes, not the transport.
 *
 * CI-P7-03 put a budget gate in front of the planner call, and the one thing this file has to say
 * about it is that a refusal is *not* the fallback plan: the fallback is the draft tool, which spends
 * again. The harness pins the temp database and puts the budget row back; it has to be the first
 * import, because the gate reads a settings row that this file's own imports would otherwise resolve
 * against the install's database.
 */
vi.mock("@/features/ai-runtime", async () => {
  const actual = await vi.importActual<typeof import("@/features/ai-runtime")>("@/features/ai-runtime");
  return { ...actual, aiRuntime: { ...actual.aiRuntime, chatStructured: vi.fn() } };
});

const { allowEveryAiBudgetCall, refuseEveryAiBudgetCall } = await import("@/test/route-harness");
const { aiRuntime } = await import("@/features/ai-runtime");
const { planToolCalls } = await import("./langgraph-engine");
const { createDefaultToolRegistry } = await import("./local-tools");

const registry = createDefaultToolRegistry();
const mockedChatStructured = vi.mocked(aiRuntime.chatStructured);

function planSteps(steps: ToolPlanStep[]) {
  mockedChatStructured.mockResolvedValue({
    data: { steps },
    providerId: "qwen",
    model: "qwen3-max",
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
  } as Awaited<ReturnType<typeof aiRuntime.chatStructured>>);
}

const threadsSite: AccountRecord = {
  id: "site-1",
  name: "clipversity.study",
  platform: "Threads",
  url: "https://www.threads.com/@clipversity.study",
  account: "clipversity.study",
  profilePath: "C:/profiles/site-1",
  memo: "",
  status: "active",
  preset: {},
  createdAt: 1,
  updatedAt: 1,
};

describe("local agent LLM tool planning", () => {
  beforeEach(async () => {
    // The shipped budget row is `off`; a case that wants a refusal states the refusal itself, and this
    // puts the row back so the other cases here keep calling the model.
    await allowEveryAiBudgetCall();
    mockedChatStructured.mockReset();
  });

  it("wires an image plan to the latest post context instead of drafting a new post", async () => {
    planSteps([
      { tool: "generate_image_prompt", input: {} },
      { tool: "generate_image_file", input: {} },
    ]);

    const calls = await planToolCalls(
      {
        message: "Generate the image",
        site: threadsSite,
        chatContext: {
          messages: [],
          latestPostText: "A curious orange cat explores a sunny windowsill.",
        },
      },
      registry,
    );

    expect(calls.some((call) => call.name === "generate_social_post_draft")).toBe(false);
    const imagePrompt = calls.find((call) => call.name === "generate_image_prompt");
    expect(String(imagePrompt?.input.topic)).toContain("orange cat");
    expect(imagePrompt?.input.postContext).toBe("A curious orange cat explores a sunny windowsill.");
    const imageFile = calls.find((call) => call.name === "generate_image_file");
    expect(imageFile?.input.promptFromImagePrompt).toBe(true);
  });

  it("posts existing generated text and image from context", async () => {
    planSteps([{ tool: "threads_create_post", input: { publish: true } }]);

    const calls = await planToolCalls(
      {
        message: "Post it now",
        site: threadsSite,
        params: { publish: true },
        chatContext: {
          messages: [],
          latestPostText: "A curious orange cat explores a sunny windowsill.",
          latestImagePath: "C:/tmp/cat.png",
        },
      },
      registry,
    );

    expect(calls.some((call) => call.name === "generate_social_post_draft")).toBe(false);
    const post = calls.find((call) => call.name === "threads_create_post");
    expect(post?.input.textFromContext).toBe(true);
    expect(post?.input.imageFromContext).toBe(true);
    expect(post?.input.publish).toBe(true);
  });

  it("lets an explicit publish parameter override the planned publish flag", async () => {
    planSteps([{ tool: "threads_create_post", input: { publish: true } }]);
    const draftCalls = await planToolCalls(
      { message: "draft a post", site: threadsSite, params: { publish: false } },
      registry,
    );
    expect(draftCalls.find((call) => call.name === "threads_create_post")?.input.publish).toBe(false);

    planSteps([{ tool: "threads_create_post", input: { publish: false } }]);
    const publishCalls = await planToolCalls(
      { message: "publish this post", site: threadsSite, params: { publish: true } },
      registry,
    );
    expect(publishCalls.find((call) => call.name === "threads_create_post")?.input.publish).toBe(true);
  });

  it("falls back to a single draft when the planner returns no usable tools", async () => {
    planSteps([{ tool: "unknown_tool", input: {} }]);
    const calls = await planToolCalls({ message: "write something about cats" }, registry);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("generate_social_post_draft");
  });

  it("falls back to a single draft when the planner call fails", async () => {
    mockedChatStructured.mockRejectedValue(new Error("no api key"));
    const calls = await planToolCalls({ message: "write something about cats" }, registry);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("generate_social_post_draft");
  });

  it("lets a budget refusal out as itself instead of turning it into the draft fallback", async () => {
    await refuseEveryAiBudgetCall();

    // The fallback above is for a planner that could not answer. A refusal is the user's decision, and
    // answering it with the draft tool would spend again right after the limit said no - so the gate's
    // own error leaves `planToolCalls` and the run fails saying why.
    await expect(planToolCalls({ message: "write something about cats" }, registry)).rejects.toMatchObject({
      code: "AI_BUDGET_EXCEEDED",
      status: 402,
    });
    expect(mockedChatStructured).not.toHaveBeenCalled();
  });
});
