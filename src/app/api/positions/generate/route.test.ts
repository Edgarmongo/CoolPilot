import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `api/positions/generate` on `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`).
 *
 * The "AI 生成定位" dialog posts one sentence and expects a whole writing profile back. The route asks a
 * model for it and - this is §2.1's row 6, the second of the two routes built that way - falls back to
 * `buildPositionDraftFromPrompt()` for *any* AI failure: nothing configured, no usable credential, a
 * provider that is down, an answer that failed the schema twice. Every one of those answers HTTP 200 with
 * `source: "fallback"` plus a `reason` string, so the dialog always has a draft to apply. So this file pins
 * two contracts at once: the AI path (what was asked, what the answer was normalised into, what was
 * recorded) and the fallback path (which failures really reach it, that the runtime's own code/status never
 * reaches the client, that an overreaching answer cannot set a field this route owns, and that the one text
 * which did change on that path is `reason`).
 *
 * The chain under test is the real one - route handler, runtime, registry, router, key pool, provider
 * adapter - and only the *transport* is stubbed.
 *
 * P4 deleted the three legacy modules this file used to mock with a throwing factory (`@/lib/ai`,
 * `@/lib/ai/generate`, `@/lib/ai/compat`). The guard is structural now: reviving one of them fails
 * `tsc` and module resolution instead of a single test file (`docs/generate-migration-p3.md`, P4).
 */

/**
 * The harness pins the temp database and the keyless env before any of this loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
const {
  bodyOf,
  chatCalls,
  credentials,
  jsonReply,
  jsonRequest,
  prepareChatModel,
  prepareModel,
  qwenCatalog,
  refuseEveryAiBudgetCall,
  resetRuntime,
  stubFetch,
  unavailable,
} = await import("@/test/route-harness");
const { POST } = await import("./route");
const { listUsageRecords } = await import("@/db/repository");
const { buildPositionDraftFromPrompt, defaultStoreListing, emptyPositionDraft, positionFieldLimits } = await import(
  "@/lib/positions"
);
const { countTextCharacters } = await import("@/lib/usage");

const generateUrl = "http://localhost/api/positions/generate";

/** The dialog's request. */
const generate = (body: unknown) => POST(jsonRequest(generateUrl, body));

/** One sentence, well inside the schema's 300-character ceiling. */
const prompt = "搞笑的科技新闻号，用段子口语解说热点";

/** The route's own system turn, mirrored so the case can pin it byte for byte. */
const positionSystemPrompt = [
  "你是资深自媒体运营顾问，擅长把一个模糊的想法拆成可直接投入生产的账号定位。",
  "请基于用户的一句话描述，输出整套写作智能体配置。",
  "字段要求：name 为 12 字以内的定位名称；description 为 60-200 字的定位描述；",
  "targetAudience 为具体人群画像；contentDirection 为 2-6 个关键词；toneStyle 为语气风格说明；",
  "personaRole 为 120-400 字的系统角色设定；personaSeeds 留空字符串；",
  "writingGuide 为 3-5 条写作准则，每条一行。全部使用简体中文。",
].join("\n");

/**
 * What the deterministic local builder answers for that sentence. Its `name` is the sentence's first
 * segment, which is how the cases below can tell the model's draft apart from the fallback's.
 */
const localDraft = buildPositionDraftFromPrompt(prompt);

/** A model answer that understood `aiPositionSchema`, padded so the normalisation is visible. */
const answer = {
  name: "  热点解读官  ",
  description: "  面向上班族的科技新闻账号，用段子讲清热点背后的技术。  ",
  targetAudience: "  25-40 岁上班族，通勤时刷新闻。  ",
  contentDirection: "  科技、热点、科普  ",
  toneStyle: "  口语、有梗、不端着  ",
  personaRole: "  你是「热点解读官」的写作智能体，先给结论，再展开论据。  ",
  personaSeeds: "",
  writingGuide: "  1. 开头用生活场景引入\n2. 关键数据标注来源  ",
};
const answerName = "热点解读官";
const answerDescription = "面向上班族的科技新闻账号，用段子讲清热点背后的技术。";
const answerAudience = "25-40 岁上班族，通勤时刷新闻。";
const answerDirection = "科技、热点、科普";
const answerTone = "口语、有梗、不端着";
const answerRole = "你是「热点解读官」的写作智能体，先给结论，再展开论据。";
const answerGuide = "1. 开头用生活场景引入\n2. 关键数据标注来源";

/** The provider's model list, for the cases that sync a catalog; a case that must not call anyone stubs nothing. */
const qwenModels = {
  match: (target: string) => target.includes("dashscope") && target.endsWith("/models"),
  respond: qwenCatalog,
};
const chatCompletions = (respond: () => Response) => ({
  match: (target: string) => target.includes("/chat/completions"),
  respond,
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

/**
 * Row identities, so a case can talk about what *it* recorded: `resetRuntime()` clears the runtime's own
 * tables, and the usage log is this file's business table - it keeps the rows of every earlier case. This
 * route writes nothing else: a position is created by the dialog's own save, not by this endpoint.
 */
const usageIds = async () => new Set((await listUsageRecords({ limit: 500 })).map((row) => row.id));
const usageSince = async (before: Set<string>) =>
  (await listUsageRecords({ limit: 500 })).filter((row) => !before.has(row.id));

describe("POST /api/positions/generate on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers 200 with the normalised draft, the provider/model the runtime used and one usage row", async () => {
    const calls = stubFetch([qwenModels, chatCompletions(() => jsonReply(answer))]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const usageBefore = await usageIds();

    const response = await generate({ prompt });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    // The AI envelope carries the provider pair; the fallback below has none to carry, and neither carries a
    // runtime code - D-P3-3 does not apply to this route.
    expect(Object.keys(payload.data).sort()).toEqual(["draft", "model", "provider", "source"]);
    expect(payload.data.source).toBe("ai");
    expect(payload.data.provider).toBe("qwen");
    expect(payload.data.model).toBe("qwen3-max");

    // The draft is the model's answer, normalised: every AI field trimmed to the model's text, and the
    // fields `aiPositionSchema` never asks about left at their defaults.
    expect(payload.data.draft).toEqual({
      ...emptyPositionDraft(answerName),
      description: answerDescription,
      targetAudience: answerAudience,
      contentDirection: answerDirection,
      toneStyle: answerTone,
      personaRole: answerRole,
      writingGuide: answerGuide,
    });
    // That is the model's name, not the sentence's first segment the local builder would use.
    expect(payload.data.draft.name).not.toBe(localDraft.name);

    // One structured call: the runtime's model, on the runtime's JSON channel ...
    expect(chatCalls(calls)).toHaveLength(1);
    const wire = bodyOf(chatCalls(calls)[0]);
    expect(wire.model).toBe("qwen3-max");
    expect(wire.response_format).toEqual({ type: "json_object" });
    const turns = turnsOf(chatCalls(calls)[0]);
    expect(turns.roles).toEqual(["system", "user"]);
    expect(turns.system?.content).toBe(positionSystemPrompt);
    // ... and the route's own prompt in the user turn, where the runtime appends the schema instruction.
    const asked = turns.user?.content ?? "";
    expect(asked.startsWith(`用户想做这样的账号：${prompt}`)).toBe(true);
    expect(asked).toContain("JSON schema:");

    // The usage row records the runtime's report, plus the character count of the *answer*.
    const written = await usageSince(usageBefore);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      provider: "qwen",
      model: "qwen3-max",
      kind: "profile",
      status: "success",
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      wordCount: countTextCharacters(answerRole),
    });
    expect(written[0].wordCount).not.toBe(countTextCharacters(prompt));
  });

  it("clamps an oversized answer, and never lets one set a field this route owns", async () => {
    // A model that answered past every limit and also tried to fill in the switches `aiPositionSchema` never
    // asks about - model size, reuse policy, and a store listing it has no business publishing.
    const rogue = {
      name: "热点解读官".repeat(20),
      description: "长".repeat(600),
      targetAudience: "  受众  ",
      contentDirection: "科技",
      toneStyle: "口语",
      personaRole: "角色".repeat(1200),
      personaSeeds: " 种子范文 ",
      writingGuide: "1. 准则",
      bannedWords: ["滚"],
      antiAiDetection: false,
      aiFreedom: 100,
      cooldownDays: 0,
      platformOverrides: [{ platform: "x", tone: "formal" }],
      rssSources: ["https://example.com/rss.xml"],
      store: { emoji: "🚀", category: "tech", tagline: "买我", status: "published", testScore: 100 },
    };
    let attempt = 0;
    const calls = stubFetch([
      qwenModels,
      chatCompletions(() => {
        attempt += 1;
        // The second answer leaves the name blank: this route stores that as blank rather than inventing one
        // from the sentence - deriving a name is the fallback path's job, not the AI path's.
        return attempt === 1 ? jsonReply(rogue) : jsonReply({ ...answer, name: "   " });
      }),
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const first = (await (await generate({ prompt })).json()).data.draft;
    expect(first.name).toHaveLength(positionFieldLimits.name);
    expect(first.name).not.toBe(rogue.name);
    expect(first.description).toHaveLength(positionFieldLimits.description);
    expect(first.personaRole).toHaveLength(positionFieldLimits.personaRole);
    expect(first.description.startsWith("长")).toBe(true);
    // What the model *did* answer inside its own fields is kept, trimmed.
    expect(first.personaSeeds).toBe("种子范文");
    // Nothing it said about this route's switches reached the draft.
    expect(first).toMatchObject({
      bannedWords: [],
      antiAiDetection: true,
      aiFreedom: 50,
      cooldownDays: 7,
      platformOverrides: [],
      rssSources: [],
      store: defaultStoreListing(),
    });
    expect(first.store.status).toBe("none");

    const second = (await (await generate({ prompt })).json()).data.draft;
    expect(second.name).toBe("");
    expect(second.name).not.toBe(localDraft.name);

    expect(chatCalls(calls)).toHaveLength(2);
  });

  it("falls back to the local draft when nothing is configured, without asking anyone", async () => {
    // Any provider call would be answered with a loud 404 instead of silence.
    const calls = stubFetch([]);
    const usageBefore = await usageIds();

    const response = await generate({ prompt });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.source).toBe("fallback");
    // The fallback envelope is the local draft plus the failure's own words: no provider pair, no code.
    expect(Object.keys(payload.data).sort()).toEqual(["draft", "reason", "source"]);
    expect(payload.data.draft).toEqual(localDraft);
    expect(payload.data.reason).toBe("No model is configured for this request");
    expect(payload.code).toBeUndefined();

    // Nothing was asked, and nothing was billed: a run with no model has no usage to report.
    expect(calls).toEqual([]);
    expect(await usageSince(usageBefore)).toEqual([]);
  });

  it("keeps the fallback - not the runtime's 400 - when the credential is gone", async () => {
    const calls = stubFetch([qwenModels]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    // The user revoked the key after the model was configured: routing now fails with
    // `MODEL_CREDENTIAL_MISSING`, which is a 400 on every other route of this batch.
    await credentials.clearCredential(credentials.credentialRefFor("qwen"));
    const usageBefore = await usageIds();

    const response = await generate({ prompt });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.source).toBe("fallback");
    expect(payload.data.draft).toEqual(localDraft);
    expect(payload.data.reason).toBe("No configured model has a usable credential for this request");
    // No error envelope at all: the runtime's code and status stop at this route (D-P3-3 does not apply here).
    expect(payload.code).toBeUndefined();
    // The pool refused before a request existed, and nothing was billed for a draft that never came.
    expect(chatCalls(calls)).toEqual([]);
    expect(await usageSince(usageBefore)).toEqual([]);
  });

  it("falls back when the provider itself fails, after exactly one attempt", async () => {
    const calls = stubFetch([qwenModels, chatCompletions(unavailable)]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const usageBefore = await usageIds();

    const response = await generate({ prompt });
    const payload = await response.json();

    // The runtime's `MODEL_UPSTREAM_FAILED` (502) never becomes this route's answer either.
    expect(response.status).toBe(200);
    expect(payload.data.source).toBe("fallback");
    expect(payload.data.draft).toEqual(localDraft);
    // `reason` is the failure's own message, verbatim: for a provider error that is the adapter's wording,
    // not one of the runtime's translated app messages. It is a diagnostic the dialog does not read - which
    // is why it may say what it likes and still not make this route fail an HTTP request.
    expect(payload.data.reason).toBe("Chat completion HTTP 503: {\"error\":{\"message\":\"boom\"}}");
    // One enabled model and one key: the failure is reported after that single attempt.
    expect(chatCalls(calls)).toHaveLength(1);
    expect(await usageSince(usageBefore)).toEqual([]);
  });

  it("falls back after a schema-invalid answer on both attempts, and keeps nothing half-applied", async () => {
    let attempts = 0;
    const calls = stubFetch([
      qwenModels,
      chatCompletions(() => {
        attempts += 1;
        // Schema-valid JSON, wrong shape: `aiPositionSchema` rejects it, so the runtime retries once.
        return jsonReply({ name: "只有名字" });
      }),
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const usageBefore = await usageIds();

    const response = await generate({ prompt });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.source).toBe("fallback");
    expect(String(payload.data.reason).startsWith("Structured output validation failed")).toBe(true);
    // Both attempts happened (the runtime's own corrective retry), and both were refused.
    expect(attempts).toBe(2);
    expect(chatCalls(calls)).toHaveLength(2);
    // The rejected answer is nowhere: the draft is the local one, not a profile with nothing but a name.
    expect(payload.data.draft).toEqual(localDraft);
    expect(payload.data.draft.name).not.toContain("只有名字");
    expect(await usageSince(usageBefore)).toEqual([]);
  });

  it("keeps answering 400 for an unusable payload, and never falls back for one", async () => {
    // Nothing configured *and* an empty transport: a guard that ran late would have to call someone.
    const calls = stubFetch([]);
    const usageBefore = await usageIds();

    const missing = await generate({});
    const blank = await generate({ prompt: "   " });
    const tooLong = await generate({ prompt: "长".repeat(301) });
    const notJson = await POST(new Request(generateUrl, { method: "POST", body: "not json" }));

    for (const response of [missing, blank, tooLong, notJson]) {
      const payload = await response.json();
      // The route's own message and code - not a fallback, and not a runtime code.
      expect(response.status).toBe(400);
      expect(payload.ok).toBe(false);
      expect(payload.code).toBe("INVALID_PAYLOAD");
      expect(payload.message).toBe("Invalid payload");
    }

    // Validation comes first: no model was configured or asked, and nothing was billed.
    expect(calls).toEqual([]);
    expect(await usageSince(usageBefore)).toEqual([]);
  });

  it("asks with the sentence whole, at the schema's own ceiling", async () => {
    const calls = stubFetch([qwenModels, chatCompletions(() => jsonReply(answer))]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    // Exactly the 300 characters `positionGenerateSchema` allows, padded on both sides the way the dialog
    // does not: the schema trims it, and the route pastes the trimmed sentence in whole - no slice here.
    const longest = `${"话题".repeat(149)}补充`;
    expect(longest).toHaveLength(300);

    const response = await generate({ prompt: ` ${longest} ` });
    expect(response.status).toBe(200);

    const asked = turnsOf(chatCalls(calls)[0]).user?.content ?? "";
    expect(asked.startsWith(`用户想做这样的账号：${longest}`)).toBe(true);
  });

  it("answers with the model when no capability default is set, instead of falling back", async () => {
    const calls = stubFetch([qwenModels, chatCompletions(() => jsonReply(answer))]);
    // A credential and one enabled model - the state a catalog sync leaves behind - but no `chat` or
    // `structured_output` default: routing has to reach this model by capability alone.
    await prepareModel("qwen", "qwen3-max", "sk-stub-qwen");

    const response = await generate({ prompt });
    const payload = await response.json();

    expect(payload.data.source).toBe("ai");
    expect(payload.data.provider).toBe("qwen");
    expect(payload.data.draft.name).toBe(answerName);
    expect(chatCalls(calls)).toHaveLength(1);
  });

  it("answers the gate's own 402 instead of inventing a fallback draft, and books nothing", async () => {
    // The model is configured through a catalog read first, then the transport is emptied: from this point
    // on, any call this request makes is one the case will see.
    stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    await refuseEveryAiBudgetCall();
    const calls = stubFetch([]);
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;

    const response = await generate({ prompt });
    const payload = await response.json();

    // The deterministic draft is this route's answer to an AI that failed. A refusal is not one, and the
    // gate stands outside that try: a local template here would look like a successful generation.
    expect(response.status).toBe(402);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("AI_BUDGET_EXCEEDED");
    expect(payload.data).toBeUndefined();
    expect(calls).toEqual([]);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
  });
});
