import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `api/content/[id]/rewrite` on `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`).
 *
 * The last text surface of batch A, and the one that pins the batch's *negative* decision. The editor's
 * “AI 改写” dialog posts here, reads `text` / `html` / `provider` / `model` back, shows a diff and persists
 * the body itself, so these cases pin the rewrite contract: which article the `[id]` segment selected, which
 * text became the source and how the cap cut it, what the instructions looked like on the wire, that the
 * answer was trimmed rather than passed through, and what was recorded about it.
 *
 * A3-2.1..2.5 handed D-P3-3 (the runtime's code *and* status reach HTTP) to the routes migrated there. This
 * one does not: `P3-A3-3.2` moves the call boundary and nothing else, so every failure below still expects
 * the flat 502 with the `UNKNOWN_ERROR` code the facade produced. What could *not* be kept is the message of
 * the two families `lib/ai/compat.ts` used to mask behind `MissingAIKeyError` (“Missing qwen API key”): the
 * runtime answers with its routing reason instead. These cases pin that too, so applying D-P3-3 here later
 * is a conscious change instead of a surprise.
 *
 * The chain under test is the real one - route handler, runtime, registry, router, key pool, provider
 * adapter - and only the *transport* is stubbed. Nothing here asserts that a mock was called.
 *
 * The two text facades and the compatibility shim are mocked with throwing factories, because this is the
 * last file that used to import `generateText` from `@/lib/ai/generate`: one such import anywhere in this
 * route's graph fails the whole file instead of a single case quietly keeping the old behaviour alive. The
 * shim mock is safe here for the reason it is safe in A3-2.3..2.5 - `lib/agent/image-generation.ts` is the
 * only production importer of `@/lib/ai/compat`, and this route reaches neither it nor `lib/article-images.ts`.
 */
vi.mock("@/lib/ai", () => {
  throw new Error("api/content/[id]/rewrite must not import the legacy facade (@/lib/ai)");
});
vi.mock("@/lib/ai/generate", () => {
  throw new Error("api/content/[id]/rewrite must not import the legacy facade (@/lib/ai/generate)");
});
vi.mock("@/lib/ai/compat", () => {
  throw new Error("api/content/[id]/rewrite must not reach the compat shim (@/lib/ai/compat)");
});

/**
 * The harness pins the temp database and the keyless env before anything that reads them loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
const {
  authorizationsOf,
  bodyOf,
  chatCalls,
  credentials,
  jsonRequest,
  jsonResponse,
  prepareChatModel,
  qwenCatalog,
  resetRuntime,
  runtime,
  runtimeRepository,
  stubFetch,
  unavailable,
} = await import("@/test/route-harness");
const { POST } = await import("./route");
const { createContentItem, getContentItem, listUsageRecords } = await import("@/db/repository");
const { htmlToPlainText, plainTextToHtml } = await import("@/lib/article-themes");
const { industryDomainPrompt } = await import("@/lib/ai-writing");
const { countTextCharacters } = await import("@/lib/usage");
const { AppError } = await import("@/lib/app-errors");

/** The route as Next.js calls it: the `[id]` segment arrives as a promise the handler awaits. */
const rewriteUrl = (id: string) => `http://localhost/api/content/${id}/rewrite`;

const rewrite = (id: string, body: unknown) =>
  POST(jsonRequest(rewriteUrl(id), body), { params: Promise.resolve({ id }) });

/** Mirrors the route's own source cap, so the long-article case can prove the cut happened. */
const maxRewriteInput = 8000;

/** What the 改写 dialog posts: one mode, one strength, and every optional instruction filled in. */
const styleFeatures = "句子短一点，语气像朋友在讲话";
const requiredTitle = "收纳";
const customRequirements = "保留原文的小标题与段落顺序";
const bannedWords = ["绝对", "最强"];
const rewritePayload = (overrides: Record<string, unknown> = {}) => ({
  mode: "polish",
  industry: "tech",
  strength: "light",
  styleFeatures,
  requiredTitle,
  customRequirements,
  bannedWords,
  ...overrides,
});

/**
 * Mirrors the route's own literals - the mode table, the strength table and the system turn - spelled out
 * here, so a change on either side is a visible diff rather than a shared constant that hides it.
 */
const polishInstruction =
  "在不改变事实、观点与结构的前提下润色文章：让语言更自然流畅，长短句交错，去掉机械的连接词与排比堆砌，读起来像真人写的。";
const lightInstruction = "改写强度：轻。尽量贴近原文，只做小幅润色。";
const rewriteSystemPrompt = "你是一位资深中文编辑，擅长在不改变原意的前提下改写文章。";

/**
 * The prompt this route should have sent, rebuilt from the inputs it has - the mode, the strength, the four
 * optional instructions and the source - so a case pins the route's *assembly* instead of a copy of a string.
 * The instructions are joined by the route's own `filter(Boolean)`, so the slots that were left empty in the
 * payload are absent here too and the only blank line is the one before 原文：.
 */
function expectedPrompt(source: string) {
  return [
    polishInstruction,
    lightInstruction,
    `行业领域：${industryDomainPrompt.tech}。`,
    `风格特征：${styleFeatures}。`,
    `标题需自然包含以下关键词：${requiredTitle}。`,
    `补充要求：${customRequirements}。`,
    `禁止出现以下词语：${bannedWords.join("、")}。`,
    "只输出改写后的文章正文，不要输出标题、解释、markdown 代码块或任何额外说明。",
    "",
    "原文：",
    source,
  ].join("\n");
}

/** The two chat turns of a call, so a case can read the prompt without repeating the guards. */
function turnsOf(call: Parameters<typeof bodyOf>[0]) {
  const messages = bodyOf(call).messages ?? [];
  return {
    system: messages.find((message) => message.role === "system"),
    user: messages.find((message) => message.role === "user"),
    roles: messages.map((message) => message.role),
  };
}

/**
 * What a model answers on the plain chat channel this route calls: free text, padded so the trim is visible,
 * plus the usage to report. `jsonReply()` from the harness is deliberately not used - that is the structured
 * channel's answer, and proving this route does *not* ask for that channel is half the point.
 */
const textReply = (content: string, usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }) =>
  jsonResponse({ choices: [{ message: { content } }], usage });

/**
 * An answer with no text at all: the model spent the turn on a tool call. The adapter accepts it (it only
 * refuses a payload with neither text nor tool calls), so this is the one shape that reaches the route's own
 * `EMPTY_RESULT` guard - which is why that guard is not dead code after the migration.
 */
const toolCallOnlyReply = () =>
  jsonResponse({
    choices: [{ message: { content: "", tool_calls: [{ id: "call-1", function: { name: "noop", arguments: "{}" } }] } }],
  });

/** The rewritten article a model returns, and the same text as the envelope's HTML field. */
const draftText = "先清空桌面，再按手感分区，最后给每样东西一个固定的位置。";
const draftReply = () => textReply(`\n  ${draftText}  \n`);

/** The article stored in the database: the route's only source of text, and its raw HTML must not leak. */
const storedTitle = "桌面收纳指南（仓库标题）";
const storedMarker = "仓库正文第一段，改写时必须出现在提示词里。";
const storedBody = [
  "<h1>桌面收纳指南</h1>",
  `<p>${storedMarker}</p>`,
  "<p>再按手感分区，常用的放在手边。</p>",
].join("\n");
const siblingMarker = "另一篇文章的正文";

/** A stored article long enough that the source cap bites inside its last paragraph. */
const longTitle = "超长文章（仓库标题）";
const longFiller = "这是一段用于撑长正文的示例内容。";
const longParagraph = (index: number) => `${longFiller.repeat(200)}第${index}段结束。`;
const longBody = [
  `<h1>${longTitle}</h1>`,
  `<p>${longParagraph(1)}</p>`,
  "",
  `<p>${longParagraph(2)}</p>`,
  "",
  `<p>${longParagraph(3)}</p>`,
].join("\n");

type SeededItem = NonNullable<Awaited<ReturnType<typeof createContentItem>>>;

/**
 * The articles these cases read: the target of most cases (whose raw HTML and stored title must never leak
 * into a prompt built from the flattened body), a sibling that must not be mentioned, one long enough that
 * the cap bites, and one with nothing to rewrite. Created once for the file, because `resetRuntime()`
 * resets the runtime's own tables, not these.
 */
let fixture: { target: SeededItem; sibling: SeededItem; long: SeededItem; empty: SeededItem };

beforeAll(async () => {
  const seed = async (title: string, body: string) => {
    const item = await createContentItem({ title, body, postReadyText: htmlToPlainText(body) });
    if (!item) throw new Error(`content fixture was not created: ${title}`);
    return item;
  };
  fixture = {
    target: await seed(storedTitle, storedBody),
    sibling: await seed("另一篇文章的标题", `<p>${siblingMarker}，绝不能出现在提示词里。</p>`),
    long: await seed(longTitle, longBody),
    empty: await seed("空正文文章", ""),
  };
});

describe("POST /api/content/[id]/rewrite on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers 200 with the rewritten body, the provider/model the runtime really used, and one usage row", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: draftReply },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const before = await getContentItem(fixture.target.id);

    const response = await rewrite(fixture.target.id, rewritePayload());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    // The answer is trimmed, not passed through, and the dialog's HTML pane is derived from the same text.
    expect(payload.data.text).toBe(draftText);
    expect(payload.data.html).toBe(plainTextToHtml(draftText));
    // What the route reports is what the runtime reported - not a hard-coded pair.
    expect(payload.data.provider).toBe("qwen");
    expect(payload.data.model).toBe("qwen3-max");

    // One call, on the *plain* channel: the rewrite is free text, so no JSON mode is requested and no
    // schema instruction is appended - that is the difference between `chat()` and `chatStructured()`.
    expect(chatCalls(calls)).toHaveLength(1);
    const wire = bodyOf(chatCalls(calls)[0]);
    expect(wire.model).toBe("qwen3-max");
    expect(wire.response_format).toBeUndefined();
    // The route passes no sampling overrides (the old facade had no way to either), so the adapter's own
    // default is what the provider sees, and the one key the model is configured with signs the call.
    expect(wire.temperature).toBe(0.7);
    expect(authorizationsOf(calls)).toEqual(["Bearer sk-stub-qwen"]);
    const turns = turnsOf(chatCalls(calls)[0]);
    expect(turns.roles).toEqual(["system", "user"]);
    expect(turns.system?.content).toBe(rewriteSystemPrompt);
    expect(turns.user?.content).toBe(expectedPrompt(htmlToPlainText(fixture.target.body)));
    expect(turns.user?.content).not.toContain("JSON schema:");

    // The usage row records the runtime's own report, plus the character count of what was returned.
    const usage = (await listUsageRecords({ limit: 10 })).find((row) => row.contentItemId === fixture.target.id);
    expect(usage).toMatchObject({
      provider: "qwen",
      model: "qwen3-max",
      kind: "article",
      status: "success",
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      wordCount: countTextCharacters(draftText),
    });

    // Nothing was written back: the dialog shows a diff and the editor persists only after the user confirms.
    expect(await getContentItem(fixture.target.id)).toEqual(before);
  });

  it("reads the article the `[id]` segment names, and prompts with its flattened body only", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: draftReply },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const response = await rewrite(fixture.target.id, rewritePayload());

    expect(response.status).toBe(200);
    const prompt = turnsOf(chatCalls(calls)[0]).user?.content ?? "";
    // `[id]` steered the read: this article's body reached the model, flattened ...
    expect(prompt).toContain(storedMarker);
    expect(prompt).not.toContain("<p>");
    expect(prompt).not.toContain("<h1>");
    // ... while the neighbouring article was never read, and the stored *title* is not part of the prompt
    // either: the dialog owns the title, and this route rewrites the body.
    expect(prompt).not.toContain(siblingMarker);
    expect(prompt).not.toContain(storedTitle);

    // Which article was selected is also what the usage row is filed under.
    const usage = (await listUsageRecords({ limit: 10 })).find((row) => row.contentItemId === fixture.target.id);
    expect(usage?.contentItemId).toBe(fixture.target.id);
  });

  it("caps the source at the route's own limit, cutting inside the last paragraph it can fit", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: draftReply },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const response = await rewrite(fixture.long.id, rewritePayload());

    expect(response.status).toBe(200);
    const flattened = htmlToPlainText(fixture.long.body);
    expect(flattened.length).toBeGreaterThan(maxRewriteInput);
    const source = flattened.slice(0, maxRewriteInput);
    expect(source).toHaveLength(maxRewriteInput);
    const prompt = turnsOf(chatCalls(calls)[0]).user?.content ?? "";
    // The prompt ends exactly at the cut ...
    expect(prompt).toBe(expectedPrompt(source));
    // ... so the tail the cap dropped is genuinely absent, while what fits is intact.
    expect(prompt).not.toContain("第3段结束。");
    expect(prompt).toContain(longParagraph(1));
  });

  it("counts the characters of the rewritten body, not of the source it was given", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => textReply(draftText) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    // A "rewrite" that came back far shorter than the 8000-character source it was sent.
    const response = await rewrite(fixture.long.id, rewritePayload());
    expect(response.status).toBe(200);

    const usage = (await listUsageRecords({ limit: 10 })).find((row) => row.contentItemId === fixture.long.id);
    expect(usage?.wordCount).toBe(countTextCharacters(draftText));
    expect(usage?.wordCount).not.toBe(countTextCharacters(htmlToPlainText(fixture.long.body)));
    expect(chatCalls(calls)).toHaveLength(1);
  });

  it("keeps the 400 guards it still words itself, and validates before it asks anything", async () => {
    const calls = stubFetch([]);

    // No mode at all: `contentRewriteSchema` has no default for it.
    const noMode = await rewrite(fixture.target.id, {});
    expect(noMode.status).toBe(400);
    const noModePayload = await noMode.json();
    expect(noModePayload.code).toBe("INVALID_PAYLOAD");
    expect(noModePayload.message).toBe("Invalid payload");

    // A mode this route does not know, and a body that is not JSON at all: the same 400, no parse error
    // handler needed - `parseJson` already answers `INVALID_JSON` for the second one.
    const badMode = await rewrite(fixture.target.id, rewritePayload({ mode: "steal" }));
    expect(badMode.status).toBe(400);
    expect((await badMode.json()).code).toBe("INVALID_PAYLOAD");

    const notJson = await POST(new Request(rewriteUrl(fixture.target.id), { method: "POST", body: "not json" }), {
      params: Promise.resolve({ id: fixture.target.id }),
    });
    expect(notJson.status).toBe(400);
    expect((await notJson.json()).code).toBe("INVALID_PAYLOAD");

    // An article whose body has nothing to rewrite: the route's own guard, worded as it always was.
    const empty = await rewrite(fixture.empty.id, rewritePayload());
    expect(empty.status).toBe(400);
    const emptyPayload = await empty.json();
    // `EMPTY_CONTENT` is not an `AppErrorCode`, so the code is UNKNOWN_ERROR and the message is that
    // literal - the wart this route has always had, pinned so a later cleanup is a conscious decision.
    expect(emptyPayload.code).toBe("UNKNOWN_ERROR");
    expect(emptyPayload.message).toBe("EMPTY_CONTENT");

    // Validation comes first: no model was configured or asked, and the stub would have answered an
    // unplanned call with a loud 404 instead of silence.
    expect(calls).toEqual([]);
  });

  it("answers 404 for an unknown article before it parses the payload or asks the runtime", async () => {
    const calls = stubFetch([]);
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;

    const missing = await rewrite("no-such-article", rewritePayload());
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("NOT_FOUND");

    // The article is read before the payload is parsed, so even a body this route would reject is a 404.
    const bogus = await rewrite("no-such-article", {});
    expect(bogus.status).toBe(404);

    // No model was configured or asked, and the stub would have answered an unplanned call with a loud
    // 404 instead of silence.
    expect(calls).toEqual([]);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
  });

  it("keeps the flat 502 when the model has no credential, and writes nothing", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const before = await getContentItem(fixture.target.id);
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;
    // The user removed the key after the model had been discovered: routing is now unroutable.
    await credentials.clearCredential(credentials.credentialRefFor("qwen"));

    const response = await rewrite(fixture.target.id, rewritePayload());
    const payload = await response.json();

    // The runtime names this `MODEL_CREDENTIAL_MISSING` and sets 400. This route does not pass either on
    // (D-P3-3 is not applied here): the status stays the flat 502 it has always answered with, and the code
    // stays whatever `fail()` makes of a plain message.
    expect(response.status).toBe(502);
    expect(payload.code).toBe("UNKNOWN_ERROR");
    // The one thing the migration could not preserve: the shim used to raise `MissingAIKeyError` here, whose
    // message ("Missing qwen API key") this route echoed. The runtime explains the routing instead.
    expect(payload.message).not.toContain("Missing qwen API key");
    expect(payload.message).toContain("credential");
    expect(payload.error).toBe(payload.message);
    // The pool refuses before a request exists, so nothing was sent and no key label could leak.
    expect(chatCalls(calls)).toEqual([]);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
    expect(await getContentItem(fixture.target.id)).toEqual(before);
  });

  it("keeps the flat 502 when every stored key is out of rotation", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-key-one\nsk-key-two");
    const before = await getContentItem(fixture.target.id);
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;

    // Key one is cooling down after a rate limit and key two was rejected, so the pool has nothing left to
    // sign the call with: `MODEL_CREDENTIAL_UNAVAILABLE`, which the runtime reports as a 429.
    const ref = credentials.credentialRefFor("qwen");
    await runtime.planCredentialKeys({ ref, providerId: "qwen" });
    const [first, second] = await runtimeRepository.listCredentialKeys(ref);
    await runtime.reportCredentialKeyFailure({ keyId: first.id }, new AppError("MODEL_RATE_LIMITED", { status: 429 }));
    await runtime.reportCredentialKeyFailure(
      { keyId: second.id },
      new AppError("MODEL_CREDENTIAL_INVALID", { status: 401 }),
    );

    const response = await rewrite(fixture.target.id, rewritePayload());
    const payload = await response.json();

    // A cooling pool would be a 429 for the client if this route passed the runtime's status on; it does not,
    // so the client still sees the flat 502 - and the diagnosis does not leak into the body.
    expect(response.status).toBe(502);
    expect(payload.code).toBe("UNKNOWN_ERROR");
    expect(payload.message).toContain("No usable credential key for credential://qwen/default");
    expect(payload.message).toContain("cooling-down");
    expect(payload.message).not.toContain("sk-");
    expect(chatCalls(calls)).toEqual([]);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
    expect(await getContentItem(fixture.target.id)).toEqual(before);
  });

  it("keeps the flat 502 when nothing is configured at all", async () => {
    const calls = stubFetch([]);
    const before = await getContentItem(fixture.target.id);
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;

    // No credential, no callable model, no default: `MODEL_NOT_CONFIGURED`, which the runtime reports as a 503.
    const response = await rewrite(fixture.target.id, rewritePayload());
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.code).toBe("UNKNOWN_ERROR");
    expect(payload.message).toBe("No model is configured for this request");
    expect(JSON.stringify(payload)).not.toContain("Missing");
    expect(JSON.stringify(payload)).not.toContain("API key");
    expect(calls).toEqual([]);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
    expect(await getContentItem(fixture.target.id)).toEqual(before);
  });

  it("keeps the flat 502 when the provider itself fails, with the runtime's diagnosis in the message", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: unavailable },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const before = await getContentItem(fixture.target.id);
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;

    const response = await rewrite(fixture.target.id, rewritePayload());
    const payload = await response.json();

    // `MODEL_UPSTREAM_FAILED` is the one runtime code the legacy shim never masked, so this case is parity:
    // same 502, one attempt for one enabled model and one key. The upstream status and the provider/model it
    // happened to are *not* in the body - flattening a message into `fail()` drops `details`, which is the
    // price this route pays for skipping D-P3-3.
    expect(response.status).toBe(502);
    expect(payload.code).toBe("UNKNOWN_ERROR");
    expect(payload.message).toContain("HTTP 503");
    expect(payload.details).toBeUndefined();
    expect(chatCalls(calls)).toHaveLength(1);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
    expect(await getContentItem(fixture.target.id)).toEqual(before);
  });

  it("keeps the flat 502 when the model answers without any text, and records nothing", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => textReply("   ") },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const before = await getContentItem(fixture.target.id);
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;

    const response = await rewrite(fixture.target.id, rewritePayload());
    const payload = await response.json();

    // The adapter trims the completion and refuses a blank one, so the route never sees an empty answer from
    // this shape - `MODEL_UPSTREAM_NO_CONTENT` is raised below it, and the legacy flat 502 covers it.
    expect(response.status).toBe(502);
    expect(payload.code).toBe("UNKNOWN_ERROR");
    expect(payload.message).toContain("returned no text");
    expect(chatCalls(calls)).toHaveLength(1);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
    expect(await getContentItem(fixture.target.id)).toEqual(before);
  });

  it("still answers its own 502 EMPTY_RESULT for an answer that carries no text at all", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: toolCallOnlyReply },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const before = await getContentItem(fixture.target.id);
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;

    const response = await rewrite(fixture.target.id, rewritePayload());
    const payload = await response.json();

    // The guard the route owns, kept verbatim: a tool-call turn has no text to rewrite, and an empty
    // rewrite must never reach the dialog as a "diff". `chat()` has no schema to validate against, so the
    // runtime makes exactly one attempt - no corrective second turn - and nothing is recorded.
    expect(response.status).toBe(502);
    expect(payload.code).toBe("UNKNOWN_ERROR");
    expect(payload.message).toBe("EMPTY_RESULT");
    expect(chatCalls(calls)).toHaveLength(1);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
    expect(await getContentItem(fixture.target.id)).toEqual(before);
  });
});
