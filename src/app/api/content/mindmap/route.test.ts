import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `api/content/mindmap` on `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`).
 *
 * The batch's thinnest migration and its cleanest boundary sample. The route asks a model for free text,
 * forwards it verbatim as `{ markdown }` and leaves every interpretation of that outline to its callers -
 * `markdownToMindMap()` in `src/mindmap/mindmap-markdown.ts` on the canvas, and the Drawnix whiteboard's
 * own reader, which reaches this endpoint from a *different origin*. So there is no schema, no JSON mode,
 * no usage row and no post-processing to keep in sync: the whole risk of a two-line diff lives in the two
 * things a flimsy diff could still get wrong, which is what this file pins instead. One is the CORS
 * contract the foreign-origin caller needs on *every* answer (success, failure and preflight alike). The
 * other is the error vocabulary: `withLegacyCompatibility()` used to turn "nothing is routable" and "no
 * usable credential" into `MissingAIKeyError`, and `failFromError` then answered both with a flat 500.
 * The runtime names them, so this route now passes 503 / 400 / 502 on (D-P3-3) - and §2.1 lists this route
 * as a `failFromError` one, not as one of the two with a deterministic fallback, which is why no case here
 * expects a 200 from a failure.
 *
 * The chain under test is the real one - route handler, runtime, registry, router, key pool, provider
 * adapter - and only the *transport* is stubbed.
 *
 * The two text facades and the compatibility shim are mocked with throwing factories, because this is the
 * file that used to import `generateText` from `@/lib/ai`: one such import anywhere in this route's graph
 * fails the whole file instead of a single case quietly keeping the old behaviour alive. The shim mock is
 * safe here for the same reason it is safe in A3-2.3..2.5 and was not in A3-2.1/A3-2.2 -
 * `lib/article-images.ts`, which is how `@/lib/ai/compat` is reached in production (through
 * `lib/agent/image-generation.ts`), is imported by those two routes and not by this one, whose imports are
 * `next/server`, `zod`, `@/lib/api` and the runtime.
 */
vi.mock("@/lib/ai", () => {
  throw new Error("api/content/mindmap must not import the legacy facade (@/lib/ai)");
});
vi.mock("@/lib/ai/generate", () => {
  throw new Error("api/content/mindmap must not import the legacy facade (@/lib/ai/generate)");
});
vi.mock("@/lib/ai/compat", () => {
  throw new Error("api/content/mindmap must not import the compat shim (@/lib/ai/compat)");
});

/**
 * The harness pins the temp database and the keyless env before any of this loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
const {
  bodyOf,
  chatCalls,
  credentials,
  jsonRequest,
  jsonResponse,
  prepareChatModel,
  prepareModel,
  qwenCatalog,
  resetRuntime,
  stubFetch,
  unavailable,
} = await import("@/test/route-harness");
const { OPTIONS, POST } = await import("./route");
const { listUsageRecords } = await import("@/db/repository");

const mindmapUrl = "http://localhost/api/content/mindmap";

/** What the canvas posts and what the whiteboard posts - one topic, nothing else. */
const generate = (body: unknown) => POST(jsonRequest(mindmapUrl, body));

const topic = "短视频运营";

/** An answer with blank lines and a fenced block on purpose: the route must hand it through untouched. */
const outline = "```markdown\r\n# 短视频运营\r\n\r\n## 内容策划\r\n### 选题方法\r\n\r\n## 发布策略\r\n```";

/** The route's own system turn, mirrored so a case can pin it byte for byte. */
const mindmapSystemPrompt = `你是一个专业的思维导图生成助手。根据用户提供的主题，生成一个结构清晰、内容全面的 Markdown 格式思维导图大纲。

要求：
1. 使用 Markdown 标题层级表示思维导图层级：一级标题（#）是中心主题，二级标题（##）是主要分支，三级标题（###）是子分支
2. 内容要全面、有逻辑、结构化，涵盖主题的主要方面
3. 分支数量适中（3-7 个主要分支，每个分支 2-5 个子节点）
4. 每个节点用简洁的短语（不要长句）
5. 只输出 Markdown 内容，不要任何解释、前后缀、代码块标记

示例输出格式：
# 短视频运营
## 内容策划
### 选题方法
### 脚本结构
## 拍摄制作
### 设备选择
### 剪辑技巧
## 发布策略
### 发布时间
### 平台选择`;

/** The provider's model list, for the cases that sync a catalog; a case that must not call anyone stubs nothing. */
const qwenModels = {
  match: (target: string) => target.includes("dashscope") && target.endsWith("/models"),
  respond: qwenCatalog,
};
const chatCompletions = (respond: () => Response) => ({
  match: (target: string) => target.includes("/chat/completions"),
  respond,
});

/** A plain text answer - this route never asks for JSON mode. */
const textReply = (text: string) =>
  jsonResponse({
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  });

type Call = Parameters<typeof bodyOf>[0];
type ChatTurn = { role: string; content?: string };

/** The turns of a chat call, in order, with the system turn separated for the byte-identical check. */
function turnsOf(call: Call) {
  const messages = (bodyOf(call).messages ?? []) as ChatTurn[];
  return {
    roles: messages.map((message) => message.role),
    system: messages.find((message) => message.role === "system"),
    user: messages.find((message) => message.role === "user"),
  };
}

/** The three headers the whiteboard's browser needs - on a success, on a failure and on a preflight. */
function expectCors(response: Response) {
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
  expect(response.headers.get("access-control-allow-headers")).toBe("Content-Type");
}

describe("POST /api/content/mindmap on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers 200 with the model's outline verbatim, as the plain text it is", async () => {
    const calls = stubFetch([qwenModels, chatCompletions(() => textReply(outline))]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const response = await generate({ topic });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    // Nothing but the text: no provider, no model, no key label, no code. The whiteboard reads `data.markdown`
    // and falls back to a bare `markdown`, so the envelope is a contract, not decoration.
    expect(Object.keys(payload.data)).toEqual(["markdown"]);
    expect(payload.data.markdown).toBe(outline);
    expectCors(response);

    // One call, on the text channel: the runtime's model, no JSON mode, no tools, no pinned provider, and the
    // adapter's own default temperature.
    expect(chatCalls(calls)).toHaveLength(1);
    const wire = bodyOf(chatCalls(calls)[0]);
    expect(wire.model).toBe("qwen3-max");
    expect(wire.temperature).toBe(0.7);
    expect(wire.response_format).toBeUndefined();
    // The system literal goes in whole, and the user turn is this route's prompt - nothing else was added.
    const turns = turnsOf(chatCalls(calls)[0]);
    expect(turns.roles).toEqual(["system", "user"]);
    expect(turns.system?.content).toBe(mindmapSystemPrompt);
    expect(turns.user?.content).toBe(`主题：${topic}\n请输出该主题的 Markdown 思维导图大纲。`);

    // This endpoint has never booked a usage row, and the migration did not add one: the text was paid for, but
    // charging a run is a business decision rather than a boundary move.
    expect(await listUsageRecords({ limit: 10 })).toEqual([]);
  });

  it("answers with the model when no capability default is set, instead of refusing", async () => {
    const calls = stubFetch([qwenModels, chatCompletions(() => textReply(outline))]);
    // A credential and one enabled model - the state a catalog sync leaves behind - but no `chat` default:
    // routing has to reach this model by capability alone, which is the install state most users are in.
    await prepareModel("qwen", "qwen3-max", "sk-stub-qwen");

    const response = await generate({ topic });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.markdown).toBe(outline);
    expect(chatCalls(calls)).toHaveLength(1);
  });

  it("answers the whiteboard's preflight with 204 and the CORS contract, without a model", async () => {
    // A preflight must not need an install: nothing is configured in this case.
    const calls = stubFetch([]);

    const response = await OPTIONS();

    expect(response.status).toBe(204);
    expectCors(response);
    expect(await response.text()).toBe("");
    expect(calls).toEqual([]);
  });

  it("asks with the topic the schema trimmed, and with nothing else added", async () => {
    const calls = stubFetch([qwenModels, chatCompletions(() => textReply(outline))]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const response = await generate({ topic: `  ${topic}  ` });

    expect(response.status).toBe(200);
    // `z.string().trim()` did the work, and the route pasted its output in whole - no slice, no second cap.
    expect(turnsOf(chatCalls(calls)[0]).user?.content).toBe(`主题：${topic}\n请输出该主题的 Markdown 思维导图大纲。`);
  });

  it("keeps answering 400 for an unusable payload, and never asks a model for one", async () => {
    // Nothing configured *and* an empty transport: a guard that ran late would have to call someone.
    const calls = stubFetch([]);

    const missing = await generate({});
    const blank = await generate({ topic: "" });
    const spaces = await generate({ topic: "   " });
    const wrongType = await generate({ topic: 42 });

    for (const response of [blank, missing, spaces, wrongType]) {
      const payload = await response.json();
      // The route's own message and code - not a runtime code, and not a fallback.
      expect(response.status).toBe(400);
      expect(payload.ok).toBe(false);
      expect(payload.code).toBe("INVALID_PAYLOAD");
      expect(payload.message).toBe("Invalid payload");
      // The whiteboard prints a failed call's body, so even this answer has to be CORS-readable.
      expectCors(response);
    }

    expect(calls).toEqual([]);
  });

  it("keeps this route's own 500 for a body that is not JSON", async () => {
    // The guard is deliberately left where it was: `request.json()` runs inside the same `try` as the model call,
    // so a malformed body is answered by `failFromError`'s fallback - 500 `UNKNOWN_ERROR`, carrying the parser's
    // own message - rather than by the `parseJson()` 400 the other AI routes use. That is why this route's
    // fallback code stays `UNKNOWN_ERROR`: it is not an AI-only fallback. This case is that decision, pinned, so
    // a later `parseJson()` cleanup shows up as a changed expectation instead of a silent behaviour shift.
    const calls = stubFetch([]);

    const response = await POST(new Request(mindmapUrl, { method: "POST", body: "not json" }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("UNKNOWN_ERROR");
    expect(String(payload.message)).toContain("JSON");
    expectCors(response);
    expect(calls).toEqual([]);
  });

  it("answers the runtime's 503 when nothing is configured, with no legacy error class", async () => {
    // Any provider call would be answered with a loud 404 instead of silence.
    const calls = stubFetch([]);

    const response = await generate({ topic });
    const payload = await response.json();

    // The old contract was a flat 500 carrying `MissingAIKeyError`'s message ("Missing gemini API key"). The
    // runtime names the cause and sets the status, and this route passes both on (D-P3-3): there is nothing here
    // to branch on, and nothing of the legacy error class survives in the body.
    expect(response.status).toBe(503);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("MODEL_NOT_CONFIGURED");
    expect(payload.message).toBe("No model is configured for this request");
    expect(JSON.stringify(payload)).not.toContain("Missing");
    expect(JSON.stringify(payload)).not.toContain("API key");
    expectCors(response);
    expect(calls).toEqual([]);
  });


  it("passes the runtime's 400 on when the credential is gone", async () => {
    const calls = stubFetch([qwenModels]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    // The user revoked the key after the model was configured: routing now fails with
    // `MODEL_CREDENTIAL_MISSING`. This is the case the batch exists for - the old route answered a flat 500 here.
    await credentials.clearCredential(credentials.credentialRefFor("qwen"));

    const response = await generate({ topic });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe("MODEL_CREDENTIAL_MISSING");
    expect(payload.message).toBe("No configured model has a usable credential for this request");
    // The pool refuses before a request exists, so nothing was sent and no key label could leak.
    expect(chatCalls(calls)).toEqual([]);
    expectCors(response);
  });

  it("keeps answering 502 for a provider that fails, with the upstream status in details", async () => {
    const calls = stubFetch([qwenModels, chatCompletions(unavailable)]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const response = await generate({ topic });
    const payload = await response.json();

    // `MODEL_UPSTREAM_FAILED` is the one runtime code the legacy shim never masked (only credential failures and
    // "nothing routable" became `MissingAIKeyError`), so this case is parity: same 502, same upstream status in
    // details, exactly one attempt for one enabled model and one key.
    expect(response.status).toBe(502);
    expect(payload.code).toBe("MODEL_UPSTREAM_FAILED");
    expect(payload.details.status).toBe(503);
    expect(chatCalls(calls)).toHaveLength(1);
    expectCors(response);
  });

  it("never answers with an empty outline: a blank answer is the runtime's 502", async () => {
    const calls = stubFetch([qwenModels, chatCompletions(() => textReply("   "))]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const response = await generate({ topic });
    const payload = await response.json();

    // The adapter trims the completion and refuses a blank one, so this route needs no `EMPTY_RESULT` guard of its
    // own - there is no path that could put `markdown: ""` in the envelope. Same adapter as the legacy path, so
    // this is parity too; the case exists because "the route forwards whatever it gets" invites the assumption
    // that a blank answer can reach the canvas.
    expect(response.status).toBe(502);
    expect(payload.code).toBe("MODEL_UPSTREAM_NO_CONTENT");
    expect(payload.details.providerId).toBe("qwen");
    expect(chatCalls(calls)).toHaveLength(1);
    expectCors(response);
  });
});

