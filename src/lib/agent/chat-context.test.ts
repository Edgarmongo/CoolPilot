import { describe, expect, it } from "vitest";
import { buildAgentChatContext, formatAgentChatContext } from "./chat-context";
import type { AgentChatMessageWithTools } from "@/lib/types";

function message(input: Partial<AgentChatMessageWithTools>): AgentChatMessageWithTools {
  return {
    id: input.id ?? "message",
    threadId: "thread",
    role: input.role ?? "assistant",
    content: input.content ?? "",
    metadata: {},
    createdAt: input.createdAt ?? 1,
    toolCalls: input.toolCalls ?? [],
  };
}

describe("agent chat context", () => {
  it("keeps visible chat and useful generated artifacts without raw tool JSON", () => {
    const context = buildAgentChatContext([
      message({ role: "user", content: "Generate a post about a curious orange cat." }),
      message({
        role: "assistant",
        content: "Curious cat post ready.",
        toolCalls: [
          {
            id: "tool-1",
            threadId: "thread",
            messageId: "message",
            name: "generate_social_post_draft",
            status: "completed",
            input: { topic: "cat" },
            output: {
              postReadyText: "A curious orange cat explores a sunny windowsill.",
              itemId: "content-1",
            },
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: "tool-2",
            threadId: "thread",
            messageId: "message",
            name: "generate_image_file",
            status: "completed",
            input: { prompt: "internal prompt" },
            output: { path: "C:/tmp/cat.png" },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    ]);

    const formatted = formatAgentChatContext(context);
    expect(context.latestPostText).toContain("orange cat");
    expect(context.latestContentItemId).toBe("content-1");
    expect(context.latestImagePath).toBe("C:/tmp/cat.png");
    expect(formatted).toContain("Generate a post about a curious orange cat.");
    expect(formatted).not.toContain('"topic"');
    expect(formatted).not.toContain("internal prompt");
  });

  it("keeps local content linkage in the chat context contract", () => {
    const context = buildAgentChatContext([
      message({
        role: "user",
        content: "Create a post",
        toolCalls: [
          {
            id: "tool-1",
            threadId: "thread",
            messageId: "message",
            name: "generate_social_post_draft",
            status: "completed",
            input: { topic: "cat" },
            output: {
              postReadyText: "Post",
              itemId: "local-content-id",
            },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    ]);

    expect(context.latestPostText).toBe("Post");
    expect(context.latestContentItemId).toBe("local-content-id");
    expect(context.messages).toEqual([{ role: "user", content: "Create a post" }]);
  });
});
