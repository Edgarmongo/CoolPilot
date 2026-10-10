import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentChatMessageWithTools, AgentChatThreadRecord } from "@/lib/types";

/**
 * The first block is about the pure title helpers; the second is the P3-A2 change - title generation
 * calls `aiRuntime.chatStructured()` directly, so the runtime is mocked here rather than the legacy
 * `@/lib/ai` facade. The transport-level guarantees (rotation, failover, usage) are asserted in
 * `src/lib/scraper.test.ts` and `src/features/ai-runtime/runtime.test.ts`; what matters here is that
 * the schema goes in, `data.title` comes out, and a runtime failure never blocks the chat response.
 *
 * CI-P7-03 later put a budget gate in front of that call, so this file also pins what a refusal means
 * here: the local fallback, and no request at all. The harness pins the temp database and puts the
 * budget row back to the shipped default, and - as in `src/lib/article-generation.test.ts` - it has to
 * be the first import: the gate reads a settings row that this file's own imports would otherwise
 * resolve against the install's database.
 */
vi.mock("@/features/ai-runtime", async () => {
  const actual = await vi.importActual<typeof import("@/features/ai-runtime")>("@/features/ai-runtime");
  return { ...actual, aiRuntime: { ...actual.aiRuntime, chatStructured: vi.fn() } };
});

const { allowEveryAiBudgetCall, refuseEveryAiBudgetCall } = await import("@/test/route-harness");
const { AppError } = await import("@/lib/app-errors");
const { aiRuntime } = await import("@/features/ai-runtime");
const { chatTitleSchema } = await import("@/lib/ai/schemas");
const {
  isGenericChatThreadTitle,
  defaultChatThreadTitle,
  generateChatThreadTitle,
  normalizeChatThreadTitle,
  shouldGenerateChatThreadTitle,
  userMessagesForTitle,
} = await import("./chat-thread-title");

const mockedChatStructured = vi.mocked(aiRuntime.chatStructured);

function runtimeAnswer(title: string) {
  return {
    data: { title },
    providerId: "qwen",
    model: "qwen3-max",
    usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 },
  } as Awaited<ReturnType<typeof aiRuntime.chatStructured>>;
}

const thread: AgentChatThreadRecord = {
  id: "thread-1",
  title: "Chat",
  createdAt: 1,
  updatedAt: 1,
};

function userMessage(content: string): AgentChatMessageWithTools {
  return {
    id: content,
    threadId: "thread-1",
    role: "user",
    content,
    metadata: {},
    createdAt: 1,
    toolCalls: [],
  };
}

describe("chat thread title helpers", () => {
  it("recognizes default titles as generic", () => {
    expect(isGenericChatThreadTitle("Chat")).toBe(true);
    expect(isGenericChatThreadTitle("\u804a\u5929")).toBe(true);
    expect(isGenericChatThreadTitle("Campaign plan")).toBe(false);
  });

  it("localizes the default placeholder title", () => {
    expect(defaultChatThreadTitle("en")).toBe("Chat");
    expect(defaultChatThreadTitle("zh-hk")).toBe("\u804a\u5929");
  });

  it("collapses whitespace and trims trailing punctuation into one clean line", () => {
    expect(normalizeChatThreadTitle("Threads   launch\nplan.")).toBe("Threads launch plan");
  });

  it("generates when a job is done or the user has sent at least three messages", () => {
    expect(shouldGenerateChatThreadTitle({ thread, messages: [userMessage("one")], jobDone: true })).toBe(true);
    expect(shouldGenerateChatThreadTitle({
      thread,
      messages: [userMessage("one"), userMessage("two"), userMessage("three")],
      jobDone: false,
    })).toBe(true);
  });

  it("uses recent user messages for title context", () => {
    const messages = Array.from({ length: 8 }, (_, index) => userMessage(`message ${index + 1}`));
    expect(userMessagesForTitle(messages)).toEqual([
      "message 3",
      "message 4",
      "message 5",
      "message 6",
      "message 7",
      "message 8",
    ]);
  });
});

describe("chat thread title generation on the runtime", () => {
  beforeEach(async () => {
    // The shipped budget row is `off`; a case that wants a refusal states the refusal itself, and this
    // puts the row back so the other cases here keep calling the model.
    await allowEveryAiBudgetCall();
    mockedChatStructured.mockReset();
  });

  it("asks the runtime with the title schema and keeps the answer it returned", async () => {
    mockedChatStructured.mockResolvedValue(runtimeAnswer("  Threads launch   plan. "));

    const title = await generateChatThreadTitle({ messages: ["plan my launch"], locale: "en" });

    // The runtime's `data.title` is the only field this call site reads, normalised as before.
    expect(title).toBe("Threads launch plan");
    const request = mockedChatStructured.mock.calls[0]?.[0];
    expect(request?.schema).toBe(chatTitleSchema);
    expect(request?.systemPrompt).toBeUndefined();
    expect(request?.messages.at(-1)?.role).toBe("user");
    expect(request?.messages.at(-1)?.content).toContain("Language: English.");
    expect(request?.messages.at(-1)?.content).toContain("1. plan my launch");
  });

  it("never blocks the chat response when the runtime fails (D-P3-3 vocabulary included)", async () => {
    mockedChatStructured.mockRejectedValue(new AppError("MODEL_CREDENTIAL_MISSING"));

    // A missing key is the runtime's to report; a thread title is not worth an error, so the local
    // fallback stands - the same behaviour the facade migration had to preserve.
    await expect(generateChatThreadTitle({ messages: ["plan my launch"], locale: "en" })).resolves.toBe(
      "Chat: plan my launch",
    );
  });

  it("keeps a usable preferred title without calling the runtime or the model", async () => {
    const title = await generateChatThreadTitle({
      messages: ["plan my launch"],
      locale: "en",
      preferredTitle: "Launch plan",
    });

    expect(title).toBe("Launch plan");
    expect(mockedChatStructured).not.toHaveBeenCalled();
  });

  it("degrades to the local fallback when the budget refuses the title, without sending it", async () => {
    await refuseEveryAiBudgetCall();

    // A refused title is the user's own policy speaking and is not worth blocking a chat over, so it
    // degrades exactly like a provider failure - and the refusal never reaches the transport.
    await expect(generateChatThreadTitle({ messages: ["plan my launch"], locale: "en" })).resolves.toBe(
      "Chat: plan my launch",
    );
    expect(mockedChatStructured).not.toHaveBeenCalled();
  });
});

