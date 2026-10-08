import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiWritingConfig, AiWritingMaterial, AiWritingPositioning } from "@/lib/ai-writing";
import type { PositionRecord } from "@/lib/types";

/**
 * `api/content/generate` on `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`).
 *
 * This is the article-creation entry point, so the cases pin *its* business contract and not only the
 * call: the writing agent, the knowledge mode, the article prompt, the stored content item, the usage
 * row and the 201 envelope. The chain under test is the real one - route handler, runtime, registry,
 * router, key pool, provider adapter - and only the *transport* is stubbed. Nothing here asserts that a
 * mock was called: the runtime is asked for real, and the cases pin what this route answers.
 *
 * The two text facades are mocked with throwing factories, because this is the file that used to import
 * `generateStructured` from `@/lib/ai/generate`: if the route - or anything it imports - still reached
 * for a facade, the whole file fails instead of one case quietly keeping the old behaviour alive.
 * `@/lib/ai/compat` is deliberately **not** mocked: `lib/article-images.ts` imports
 * `lib/agent/image-generation.ts`, and that module imports compat on purpose until batch P3-B migrates
 * it, so a throwing factory there would fail on a legitimate import.
 */
vi.mock("@/lib/ai", () => {
  throw new Error("api/content/generate must not import the legacy facade (@/lib/ai)");
});
vi.mock("@/lib/ai/generate", () => {
  throw new Error("api/content/generate must not import the legacy facade (@/lib/ai/generate)");
});

/**
 * The harness pins the temp database and the keyless env before anything that reads them loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
const {
  bodyOf,
  chatCalls,
  credentials,
  jsonReply,
  jsonRequest,
  prepareChatModel,
  qwenCatalog,
  resetRuntime,
  stubFetch,
  unavailable,
} = await import("@/test/route-harness");
const { POST } = await import("./route");
const {
  audiencePrompt,
  buildArticlePrompt,
  buildArticleSystemPrompt,
  industryDomainPrompt,
  outputLanguagePrompt,
} = await import("@/lib/ai-writing");
const { getWritingAgent } = await import("@/lib/writing-agents");
const { listContentItems, listUsageRecords } = await import("@/db/repository");
const { createKnowledgeBase, listKnowledgeBase } = await import("@/db/repositories/knowledge-base");
const { createPosition } = await import("@/db/repositories/positions");
const { selectKnowledgeReferences } = await import("@/lib/knowledge-base");
const { countTextCharacters } = await import("@/lib/usage");

const generateUrl = "http://localhost/api/content/generate";

/** What a model that understood `postDraftSchema` answers - padded, so the route's trimming is visible. */
const draft = { title: "  桌面收纳指南  ", body: "先清空桌面。\n\n再按手感分区。" };
const draftTitle = "桌面收纳指南";
const draftBody = "先清空桌面。\n\n再按手感分区。";

const topic = "桌面收纳";
const extraPrompt = "补充说明：主打小户型，预算 500 元内。";
const agentId = "hot-commentator";
const contentType = "post";

const positioningKnowledge = { title: "选材要点", content: "优先讲真实使用场景，不堆参数。" };
const sharedKnowledge = { title: "平台规则", content: "标题不超过 20 字，正文分段。" };

/** The request body `contentGenerateSchema` accepts, spelled out so a case can override one field. */
type Payload = {
  topic: string;
  keywords: string;
  maxWords: number;
  language: string;
  prompt: string;
  type: string;
  agentId: string;
  positioningId: string;
  knowledgeMode: AiWritingConfig["knowledgeMode"];
  articleStyle: AiWritingConfig["articleStyle"];
  industry: AiWritingConfig["industry"];
  audience: AiWritingConfig["audience"];
  targetPlatform: string;
  languageCode?: AiWritingConfig["language"];
  imageStrategy: AiWritingConfig["imageStrategy"];
  imageCount: AiWritingConfig["imageCount"];
  deAi: boolean;
};

/**
 * The payload the article-creation page sends: every field is present, so the fixture doubles as the
 * article config the route builds from it and as the material the prompt carries.
 */
function payloadFixture(overrides: Partial<Payload> = {}): Payload {
  return {
    topic,
    keywords: "小户型、收纳",
    maxWords: 900,
    language: "简体中文",
    prompt: extraPrompt,
    type: contentType,
    agentId,
    positioningId: fixture.position.id,
    knowledgeMode: "position",
    articleStyle: "science",
    industry: "home",
    audience: "office",
    targetPlatform: "zhihu",
    languageCode: "zh-CN",
    imageStrategy: "product",
    imageCount: "standard",
    deAi: true,
    ...overrides,
  };
}

function generateRequest(overrides: Partial<Payload> = {}) {
  return jsonRequest(generateUrl, { ...payloadFixture(overrides) });
}

/**
 * The `AiWritingConfig` this route derives from a payload. `language` is the only field with a fallback
 * (`guessLanguage()` over the legacy `language` string), which is why the case that exercises the legacy
 * field passes the code it expects as an override rather than copying that mapping here.
 */
function configOf(payload: Payload, overrides: Partial<AiWritingConfig> = {}): AiWritingConfig {
  return {
    materialSource: "free",
    articleStyle: payload.articleStyle,
    industry: payload.industry,
    wordCount: payload.maxWords,
    audience: payload.audience,
    targetPlatform: payload.targetPlatform,
    coreKeywords: payload.keywords,
    language: payload.languageCode ?? "zh-CN",
    imageStrategy: payload.imageStrategy,
    imageCount: payload.imageCount,
    deAi: payload.deAi,
    knowledgeMode: payload.knowledgeMode,
    positioningId: payload.positioningId,
    ...overrides,
  };
}

/** This route sends no topics and no products; the topic (and the extra instructions) are the material. */
function materialsOf(payload: Payload): AiWritingMaterial {
  return {
    topics: [],
    products: [],
    freeText: payload.prompt ? `${payload.topic}\n\n${payload.prompt}` : payload.topic,
  };
}

/** The eight fields a positioning contributes to a prompt - the route's own `toPositioning()`. */
function positioningOf(position: PositionRecord): AiWritingPositioning {
  return {
    name: position.name,
    description: position.description,
    targetAudience: position.targetAudience,
    contentDirection: position.contentDirection,
    toneStyle: position.toneStyle,
    personaRole: position.personaRole,
    writingGuide: position.writingGuide,
    bannedWords: position.bannedWords,
  };
}

/** The system turn: the writing agent's own prompt, then the article rules the config implies. */
function expectedSystemPrompt(config: AiWritingConfig, chosenAgentId: string, position?: PositionRecord) {
  return [
    getWritingAgent(chosenAgentId).systemPrompt,
    buildArticleSystemPrompt({ config, positioning: position ? positioningOf(position) : undefined }),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The prompt this route should have sent, assembled from the same tables and the same three inputs - the
 * knowledge mode, whatever the positioning lookup returned, and the two label maps - so a case pins the
 * route's *assembly* instead of a copy of the string.
 */
async function expectedPrompt(config: AiWritingConfig, payload: Payload, position: PositionRecord | null) {
  return buildArticlePrompt({
    config,
    materials: materialsOf(payload),
    knowledge:
      config.knowledgeMode === "position" ? selectKnowledgeReferences(await listKnowledgeBase(), position?.id) : [],
    audienceLabel: audiencePrompt[config.audience],
    industryLabel: industryDomainPrompt[config.industry],
  });
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
 * The business rows a generation reads: one positioning (the install's default, because it is the first
 * one), one knowledge entry tied to it and one that applies to every positioning. Created once for the
 * file, because `resetRuntime()` resets the runtime's own tables, not these.
 */
let fixture: { position: PositionRecord };

beforeAll(async () => {
  const position = await createPosition({
    name: "小户型收纳",
    personaRole: "你是一位家居收纳编辑，说话直接。",
    toneStyle: "平实、具体",
    writingGuide: "先给结论，再给收纳步骤。",
    bannedWords: ["最强"],
  });
  if (!position) throw new Error("positioning fixture was not created");
  await createKnowledgeBase({
    ...positioningKnowledge,
    positionId: position.id,
    weight: "high",
  });
  await createKnowledgeBase({ ...sharedKnowledge, positionId: "", weight: "medium" });

  fixture = { position };
});

describe("POST /api/content/generate on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers 201 with the stored item and asks the runtime with this route's own prompts and schema", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const payload = payloadFixture();
    const config = configOf(payload);
    const response = await POST(generateRequest());
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.ok).toBe(true);
    // The answer is normalised, not passed through: the title is trimmed, and the stored text is the
    // `title\n\nbody` a publisher uses.
    expect(result.data.item).toMatchObject({
      title: draftTitle,
      body: draftBody,
      postReadyText: `${draftTitle}\n\n${draftBody}`,
      status: "ready",
      sourceUrls: [],
    });
    // `"product"` with no product photo and no source page: the article is stored without an image, and
    // the empty string the route writes comes back as `undefined`, which is what "no image" means here.
    expect(result.data.images).toEqual([]);
    expect(result.data.item.imagePath).toBeUndefined();
    // What the route reports is what the runtime reported - not a hard-coded pair.
    expect(result.data.provider).toBe("qwen");
    expect(result.data.model).toBe("qwen3-max");
    expect(result.data.item.metadata).toMatchObject({
      type: contentType,
      images: [],
      topic,
      prompt: extraPrompt,
      generationType: "topic",
      agentId,
      agentName: getWritingAgent(agentId).name,
      provider: "qwen",
      model: "qwen3-max",
      positioningId: fixture.position.id,
      aiWriting: { ...config },
    });

    // The wire: one structured chat call carrying this route's prompts.
    const call = chatCalls(calls)[0];
    const body = bodyOf(call);
    expect(body.model).toBe("qwen3-max");
    // The route asks for a *structured* answer, and the runtime turns that into the provider's JSON mode.
    expect(body.response_format).toEqual({ type: "json_object" });
    const turns = turnsOf(call);
    expect(turns.roles).toEqual(["system", "user"]);
    expect(turns.system?.content).toBe(expectedSystemPrompt(config, agentId, fixture.position));
    const prompt = turns.user?.content ?? "";
    expect(prompt.startsWith(await expectedPrompt(config, payload, fixture.position))).toBe(true);
    expect(prompt).toContain("JSON schema:");
    // The prompt really carries the console's topic, its extra instructions and both knowledge entries.
    expect(prompt).toContain(topic);
    expect(prompt).toContain(extraPrompt);
    expect(prompt).toContain(positioningKnowledge.title);
    expect(prompt).toContain(sharedKnowledge.title);

    // The usage row records the runtime's own report, plus the word count of what was stored.
    const usage = (await listUsageRecords({ limit: 10 })).find((row) => row.contentItemId === result.data.item.id);
    expect(usage).toMatchObject({
      provider: "qwen",
      model: "qwen3-max",
      kind: "article",
      status: "success",
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      wordCount: countTextCharacters(draftBody),
    });
  });

  it("maps the legacy language field, the default positioning and an empty prompt onto the article", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    // No `languageCode`, no extra instructions, no positioning id: the console's older payload shape.
    const legacy = { language: "English", languageCode: undefined, prompt: "", positioningId: "" };
    const payload = payloadFixture(legacy);
    // The route guesses the code from the legacy string; the expectation here is the code itself.
    const config = configOf(payload, { language: "en" });
    const response = await POST(generateRequest(legacy));
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.data.item.metadata.aiWriting).toMatchObject({ language: "en", wordCount: 900 });
    // `""` means "the account's default positioning", and the metadata records the row that was found.
    expect(result.data.item.metadata.positioningId).toBe(fixture.position.id);

    const turns = turnsOf(chatCalls(calls)[0]);
    expect(turns.system?.content).toBe(expectedSystemPrompt(config, agentId, fixture.position));
    expect(turns.system?.content).toContain(fixture.position.personaRole);
    const prompt = turns.user?.content ?? "";
    expect(prompt.startsWith(await expectedPrompt(config, payload, fixture.position))).toBe(true);
    expect(prompt).toContain(`输出语言：${outputLanguagePrompt.en}。`);
    expect(prompt).not.toContain("输出语言：简体中文。");
    // With no extra instructions the topic alone is the material, and the English answer was still asked
    // for the same knowledge references and the same audience/industry labels.
    expect(prompt).toContain(`自定义素材：\n${topic}`);
    expect(prompt).not.toContain(extraPrompt);
    expect(prompt).toContain(positioningKnowledge.title);

    // The traditional-Chinese spelling of the same legacy field maps onto the other code.
    const traditional = { language: "繁體", languageCode: undefined, prompt: "", positioningId: "" };
    const traditionalPayload = payloadFixture(traditional);
    const traditionalResponse = await POST(generateRequest(traditional));
    const traditionalResult = await traditionalResponse.json();

    expect(traditionalResponse.status).toBe(201);
    expect(traditionalResult.data.item.metadata.aiWriting.language).toBe("zh-TW");
    const traditionalPrompt = turnsOf(chatCalls(calls)[1]).user?.content ?? "";
    expect(
      traditionalPrompt.startsWith(
        await expectedPrompt(configOf(traditionalPayload, { language: "zh-TW" }), traditionalPayload, fixture.position),
      ),
    ).toBe(true);
    expect(traditionalPrompt).toContain(`输出语言：${outputLanguagePrompt["zh-TW"]}。`);
  });

  it("answers 400 with the runtime's code when the model has no credential, and stores nothing", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const itemsBefore = (await listContentItems({ pageSize: 20 })).total;
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;
    // The user removed the key after the model had been discovered: routing is now unroutable.
    await credentials.clearCredential(credentials.credentialRefFor("qwen"));

    const response = await POST(generateRequest());
    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.ok).toBe(false);
    // The code is the runtime's - this route recognises no error class of its own any more.
    expect(result.code).toBe("MODEL_CREDENTIAL_MISSING");
    // The old contract was a 502 carrying `MissingAIKeyError`'s message; the message now explains the
    // routing, which is the D-P3-3 trade this batch makes, and the envelope is unchanged.
    expect(result.message).not.toContain("Missing qwen API key");
    expect(result.message).toContain("credential");
    expect(result.error).toBe(result.message);
    // Nothing was attempted, and the failure happens before the article is stored.
    expect(chatCalls(calls)).toEqual([]);
    expect((await listContentItems({ pageSize: 20 })).total).toBe(itemsBefore);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
  });

  it("answers 502 with the upstream status in details when the provider itself fails", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: unavailable },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const itemsBefore = (await listContentItems({ pageSize: 20 })).total;

    const response = await POST(generateRequest());
    const result = await response.json();

    // Unchanged status: this route answered 502 for a provider failure before the migration too. What is
    // new is that the runtime supplies the code and the upstream status instead of a flattened message.
    expect(response.status).toBe(502);
    expect(result.code).toBe("MODEL_UPSTREAM_FAILED");
    expect(result.details.status).toBe(503);
    // One enabled model and one key: the failure is reported after that single attempt.
    expect(chatCalls(calls)).toHaveLength(1);
    expect((await listContentItems({ pageSize: 20 })).total).toBe(itemsBefore);
  });

  it("keeps the 400 payload guard, and validates before it reads or asks anything", async () => {
    const calls = stubFetch([]);

    // No `topic` at all.
    const missingTopic = await POST(jsonRequest(generateUrl, { maxWords: 900 }));
    expect(missingTopic.status).toBe(400);
    const missingPayload = await missingTopic.json();
    // This route words its guard itself: the message is not an `AppErrorCode`, so the code stays
    // UNKNOWN_ERROR (`api/ai-writing/generate` answers INVALID_PAYLOAD - the two guards always differed).
    expect(missingPayload.code).toBe("UNKNOWN_ERROR");
    expect(missingPayload.message).toBe("Invalid generation payload");
    expect(missingPayload.error).toBe("Invalid generation payload");

    // A word count below the console's own 50-word floor, and a style the console cannot produce.
    const outOfRange = await POST(generateRequest({ maxWords: 10 }));
    expect(outOfRange.status).toBe(400);
    expect((await outOfRange.json()).message).toBe("Invalid generation payload");

    const badStyle = await POST(jsonRequest(generateUrl, { ...payloadFixture(), articleStyle: "poem" }));
    expect(badStyle.status).toBe(400);
    expect((await badStyle.json()).code).toBe("UNKNOWN_ERROR");

    // A body that is not JSON at all takes the same path.
    const notJson = await POST(new Request(generateUrl, { method: "POST", body: "not json" }));
    expect(notJson.status).toBe(400);
    expect((await notJson.json()).message).toBe("Invalid generation payload");

    // Validation comes first: no model was configured or asked, and the stub would have answered an
    // unplanned call with a loud 404 instead of silence.
    expect(calls).toEqual([]);
  });

  it("assembles the prompt from the chosen agent, the knowledge mode and what the positioning lookup found", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    // Another writing agent, and the knowledge base switched off while the positioning stays in force.
    const chosenAgentId = "funny-news";
    const offPayload = payloadFixture({ agentId: chosenAgentId, knowledgeMode: "off" });
    const offConfig = configOf(offPayload);
    const offResponse = await POST(generateRequest({ agentId: chosenAgentId, knowledgeMode: "off" }));
    const offResult = await offResponse.json();

    expect(offResponse.status).toBe(201);
    expect(offResult.data.item.metadata).toMatchObject({
      agentId: chosenAgentId,
      agentName: getWritingAgent(chosenAgentId).name,
    });
    expect(offResult.data.item.metadata.aiWriting.knowledgeMode).toBe("off");
    const offTurns = turnsOf(chatCalls(calls)[0]);
    expect(offTurns.system?.content).toBe(expectedSystemPrompt(offConfig, chosenAgentId, fixture.position));
    expect(offTurns.system?.content?.startsWith(getWritingAgent(chosenAgentId).systemPrompt)).toBe(true);
    const offPrompt = offTurns.user?.content ?? "";
    expect(offPrompt.startsWith(await expectedPrompt(offConfig, offPayload, fixture.position))).toBe(true);
    expect(offPrompt).not.toContain("可参考的知识库资料");
    expect(offPrompt).not.toContain(positioningKnowledge.title);
    expect(offPrompt).not.toContain(sharedKnowledge.title);

    // A positioning that no longer exists: no persona is sent, and because the lookup came back null the
    // knowledge base is not filtered by an id, so both entries still reach the model.
    const gonePayload = payloadFixture({ positioningId: "position-that-is-gone" });
    const goneConfig = configOf(gonePayload);
    const goneResponse = await POST(generateRequest({ positioningId: gonePayload.positioningId }));
    const goneResult = await goneResponse.json();

    expect(goneResponse.status).toBe(201);
    expect(goneResult.data.item.metadata.aiWriting.positioningId).toBe("position-that-is-gone");
    // The metadata records the row that was found, which is none.
    expect(goneResult.data.item.metadata.positioningId).toBe("");
    const goneTurns = turnsOf(chatCalls(calls)[1]);
    expect(goneTurns.system?.content).toBe(expectedSystemPrompt(goneConfig, agentId));
    expect(goneTurns.system?.content).not.toContain(fixture.position.personaRole);
    const gonePrompt = goneTurns.user?.content ?? "";
    expect(gonePrompt.startsWith(await expectedPrompt(goneConfig, gonePayload, null))).toBe(true);
    expect(gonePrompt).toContain(positioningKnowledge.title);
    expect(gonePrompt).toContain(sharedKnowledge.title);
  });
});
