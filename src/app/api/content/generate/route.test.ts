import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiWritingBrand, AiWritingConfig, AiWritingMaterial, AiWritingPositioning } from "@/lib/ai-writing";
import type { BrandRecord, PositionRecord, ResearchMaterialRecord, TopicRecord } from "@/lib/types";

/**
 * `api/content/generate` on `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`).
 *
 * This is the article-creation entry point, so the cases pin *its* business contract and not only the
 * call: the writing agent, the knowledge mode, the article prompt, the stored content item, the usage
 * row and the 201 envelope. The chain under test is the real one - route handler, runtime, registry,
 * router, key pool, provider adapter - and only the *transport* is stubbed. Nothing here asserts that a
 * mock was called: the runtime is asked for real, and the cases pin what this route answers.
 *
 * P4 deleted the three legacy modules this file used to mock with a throwing factory (`@/lib/ai`,
 * `@/lib/ai/generate`, `@/lib/ai/compat`). The guard is structural now: reviving one of them fails
 * `tsc` and module resolution instead of a single test file (`docs/generate-migration-p3.md`, P4).
 *
 * The last describe block is CI-P2-03's half of the contract: which stored `topic`/`brand` rows this
 * entry reads, what they do to the prompts, and what the stored article and the topic row keep.
 */

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
const { createBrand } = await import("@/db/repositories/brands");
const { createTopic, getTopic } = await import("@/db/repositories/topics");
const { createResearchMaterial, getResearchMaterial } = await import("@/db/repositories/research");
const { selectKnowledgeReferences } = await import("@/lib/knowledge-base");
const { researchMaterialPromptText } = await import("@/lib/research");
const { topicMaterialText } = await import("@/lib/topics");
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
  /** CI-P2-03: the two stored rows this entry now reads besides the positioning. */
  brandId: string;
  topicId: string;
  /** CI-P3-01: the third one - the research material whose text becomes material. */
  researchMaterialId: string;
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
    // The selections a payload may name; the default is "none of them", which is every earlier client.
    brandId: "",
    topicId: "",
    researchMaterialId: "",
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
    // The brand the payload named, verbatim: what the caller asked for is the config's business, while
    // what was actually read is the stored article's (`metadata.brandId`, CI-P2-03).
    brandId: payload.brandId,
    ...overrides,
  };
}

/**
 * This route sends no topics and no products: the material is the subject, the supplement, and - when
 * the payload named a row that resolves (CI-P2-03) - the topic's own stored fields, worded exactly as
 * the wizard's step 1 words a topic it carries into the form (`topicMaterialText`, P2-01-04). A research
 * material (CI-P3-01) joins the same list through `researchMaterialPromptText`: its own stored text, with
 * its source labelled as a source.
 */
function materialsOf(
  payload: Payload,
  topic: TopicRecord | null = null,
  research: ResearchMaterialRecord | null = null,
): AiWritingMaterial {
  const subject = payload.topic.trim();
  return {
    topics: [],
    products: [],
    freeText: [
      topic ? topicMaterialText(topic) : "",
      research ? researchMaterialPromptText(research) : "",
      subject && subject !== topic?.title.trim() ? subject : "",
      payload.prompt,
    ]
      .filter(Boolean)
      .join("\n\n"),
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

/** The six fields a brand contributes to a prompt - the route's own `toBrand()`. */
function brandOf(brand: BrandRecord): AiWritingBrand {
  return {
    name: brand.name,
    description: brand.description,
    targetAudience: brand.targetAudience,
    tone: brand.tone,
    keywords: brand.keywords,
    bannedWords: brand.bannedWords,
  };
}

/** The system turn: the writing agent's own prompt, then the article rules the config implies. */
function expectedSystemPrompt(
  config: AiWritingConfig,
  chosenAgentId: string,
  position?: PositionRecord,
  brand?: BrandRecord,
) {
  return [
    getWritingAgent(chosenAgentId).systemPrompt,
    buildArticleSystemPrompt({
      config,
      positioning: position ? positioningOf(position) : undefined,
      brand: brand ? brandOf(brand) : undefined,
    }),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The prompt this route should have sent, assembled from the same tables and the same three inputs - the
 * knowledge mode, whatever the positioning lookup returned, and the two label maps - so a case pins the
 * route's *assembly* instead of a copy of the string.
 */
async function expectedPrompt(
  config: AiWritingConfig,
  payload: Payload,
  position: PositionRecord | null,
  topic: TopicRecord | null = null,
  brand: BrandRecord | null = null,
  research: ResearchMaterialRecord | null = null,
) {
  return buildArticlePrompt({
    config,
    materials: materialsOf(payload, topic, research),
    knowledge:
      config.knowledgeMode === "position" ? selectKnowledgeReferences(await listKnowledgeBase(), position?.id) : [],
    audienceLabel: audiencePrompt[config.audience],
    industryLabel: industryDomainPrompt[config.industry],
    brand: brand ? brandOf(brand) : undefined,
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
/**
 * CI-P2-03: the topic and the brand this entry now reads.
 *
 * Each case pins a different fact about the joined chain: the stored rows reach both prompts, two brands
 * never meet in one run, and an id that names nothing stays "no brand, no topic" without losing the
 * article. The rows are real repository rows and the prompts are the route's own; nothing here asserts
 * that a function was called.
 */
describe("POST /api/content/generate on the topic and the brand it names (CI-P2-03)", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Two brands whose names, tones and banned words cannot be confused with each other. */
  const clipversity = {
    name: "Clipversity",
    description: "面向剪辑师的工作流品牌。",
    targetAudience: "短视频剪辑师",
    tone: "克制、专业",
    keywords: ["剪辑工作流", "素材管理"],
    // Deliberately none of the positioning fixture's own banned words (`最强`): a marker a case can
    // attribute to *this* brand, which is what makes the isolation assertions mean something.
    bannedWords: ["硬广腔"],
  };
  const greenSea = {
    name: "绿源海鲜",
    description: "东海直发的海产品牌。",
    targetAudience: "家庭主厨",
    tone: "热情、有烟火气",
    keywords: ["冷链直送"],
    bannedWords: ["绝对新鲜"],
  };

  /** The topic a run writes about: every field is one the prompt must show. */
  const stored = {
    title: "小户型桌面收纳",
    description: "讲清 3 平米书桌的分区与取舍。",
    keywords: ["小户型", "桌面分区"],
    source: "hot",
    sourceUrl: "https://example.com/hot/desk-storage",
  };

  it("reads the brand and the topic the payload names, and records both on the article", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const brand = await createBrand(clipversity);
    const topicRow = await createTopic(stored);
    if (!brand || !topicRow) throw new Error("topic/brand fixtures were not created");

    const payload = payloadFixture({ brandId: brand.id, topicId: topicRow.id });
    const config = configOf(payload);
    const response = await POST(generateRequest({ brandId: brand.id, topicId: topicRow.id }));
    const result = await response.json();

    expect(response.status).toBe(201);
    // The row that was *read* is what the article records, and the brand's version with it (P2-02-04).
    expect(result.data.item.metadata).toMatchObject({
      brandId: brand.id,
      brandVersion: brand.updatedAt,
      topicId: topicRow.id,
      aiWriting: { ...config },
    });

    const turns = turnsOf(chatCalls(calls)[0]);
    // The brand is system-level identity, exactly as the wizard's own brand selection is.
    expect(turns.system?.content).toBe(expectedSystemPrompt(config, agentId, fixture.position, brand));
    expect(turns.system?.content).toContain(`品牌：${brand.name}`);
    expect(turns.system?.content).toContain(`品牌简介：${brand.description}`);
    expect(turns.system?.content).toContain(`品牌语气：${brand.tone}`);
    expect(turns.system?.content).toContain(clipversity.bannedWords[0]);
    // ...and prompt-level material for the audience and the keywords.
    const prompt = turns.user?.content ?? "";
    expect(prompt.startsWith(await expectedPrompt(config, payload, fixture.position, topicRow, brand))).toBe(true);
    expect(prompt).toContain(`品牌目标受众：${brand.targetAudience}`);
    expect(prompt).toContain(`品牌关键词：${brand.keywords.join("、")}`);
    // The topic's stored fields are the material, worded as the wizard words them (P2-01-04 / P2-03-02).
    expect(prompt).toContain(`选题：${topicRow.title}`);
    expect(prompt).toContain(`说明：${topicRow.description}`);
    expect(prompt).toContain(`关键词：${topicRow.keywords.join("、")}`);
    expect(prompt).toContain(`来源：${topicRow.sourceUrl}`);
    // The subject was prefilled from the topic and left alone, so it is not repeated back at the model.
    expect(prompt).not.toContain(`${topicRow.title}\n\n${extraPrompt}`);

    // The topic keeps the link back to the article it produced (P2-01-05).
    expect((await getTopic(topicRow.id))?.contentItemId).toBe(result.data.item.id);
    // The topic's own page is the image source this entry can offer, and the article records it (C4).
    expect(result.data.item.sourceUrls).toEqual([topicRow.sourceUrl]);
  });

  it("switches brands without carrying the previous brand's fields into the next run", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const first = await createBrand(clipversity);
    const second = await createBrand(greenSea);
    if (!first || !second) throw new Error("brand fixtures were not created");

    const firstResponse = await POST(generateRequest({ brandId: first.id }));
    const secondResponse = await POST(generateRequest({ brandId: second.id }));
    const firstResult = await firstResponse.json();
    const secondResult = await secondResponse.json();

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);

    const firstTurns = turnsOf(chatCalls(calls)[0]);
    const secondTurns = turnsOf(chatCalls(calls)[1]);

    expect(firstTurns.system?.content).toContain(`品牌：${first.name}`);
    expect(firstTurns.system?.content).toContain(clipversity.bannedWords[0]);
    expect(firstTurns.system?.content).not.toContain(second.name);
    expect(firstTurns.system?.content).not.toContain(`品牌语气：${greenSea.tone}`);
    expect(firstTurns.system?.content).not.toContain(greenSea.bannedWords[0]);
    expect(firstTurns.user?.content).not.toContain(`品牌关键词：${greenSea.keywords.join("、")}`);

    expect(secondTurns.system?.content).toContain(`品牌：${second.name}`);
    expect(secondTurns.system?.content).toContain(`品牌语气：${greenSea.tone}`);
    expect(secondTurns.system?.content).toContain(greenSea.bannedWords[0]);
    expect(secondTurns.system?.content).not.toContain(first.name);
    expect(secondTurns.system?.content).not.toContain(clipversity.bannedWords[0]);
    expect(secondTurns.user?.content).toContain(`品牌关键词：${greenSea.keywords.join("、")}`);
    expect(secondTurns.user?.content).not.toContain(`品牌关键词：${clipversity.keywords.join("、")}`);

    // Each article keeps the brand of its own run, not the last one selected.
    expect(firstResult.data.item.metadata.brandId).toBe(first.id);
    expect(secondResult.data.item.metadata.brandId).toBe(second.id);
  });

  it("writes with no brand and no topic when the payload names none, or names rows that are gone", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const ghostId = "brand-that-is-gone";
    const ghostTopicId = "topic-that-is-gone";
    const ghostPayload = payloadFixture({ brandId: ghostId, topicId: ghostTopicId });
    const plainResponse = await POST(generateRequest());
    const ghostResponse = await POST(generateRequest({ brandId: ghostId, topicId: ghostTopicId }));
    const plain = await plainResponse.json();
    const ghost = await ghostResponse.json();

    expect(plainResponse.status).toBe(201);
    expect(ghostResponse.status).toBe(201);

    // What was read is nothing - not another brand, not a ghost topic - and the article still exists.
    for (const result of [plain, ghost]) {
      expect(result.data.item.metadata.brandId).toBe("");
      expect(result.data.item.metadata.brandVersion).toBe(0);
      expect(result.data.item.metadata.topicId).toBeUndefined();
      expect(result.data.item.sourceUrls).toEqual([]);
    }
    // What the caller *asked* for stays visible in the entry's own summary, so a stale id can be told
    // apart from no selection at all (which is what the two assertions above record).
    expect(ghost.data.item.metadata.aiWriting.brandId).toBe(ghostId);
    expect(plain.data.item.metadata.aiWriting.brandId).toBe("");

    const plainTurns = turnsOf(chatCalls(calls)[0]);
    const ghostTurns = turnsOf(chatCalls(calls)[1]);
    for (const turns of [plainTurns, ghostTurns]) {
      expect(turns.system?.content).not.toContain("品牌：");
      expect(turns.user?.content).not.toContain("品牌目标受众");
      expect(turns.user?.content).not.toContain("品牌关键词");
    }
    // A topic id that no longer resolves is linked nowhere either: there is no row to point back.
    expect(await getTopic(ghostTopicId)).toBeNull();
    // The material is exactly what the user typed: the subject and the supplement, nothing else.
    const ghostPrompt = ghostTurns.user?.content ?? "";
    expect(ghostPrompt.startsWith(await expectedPrompt(configOf(ghostPayload), ghostPayload, fixture.position))).toBe(
      true,
    );
    expect(ghostPrompt).toContain(`自定义素材：\n${topic}\n\n${extraPrompt}`);
  });
});

/**
 * CI-P3-01: the research material this entry now reads.
 *
 * The material is the third input of the same shape as the topic and the brand - an id the route reads
 * rather than trusts - and each case pins one thing its text must and must not do: the **stored 正文** is what
 * reaches the prompt, a page nobody has read contributes a title and a link and no invented 正文, its source
 * page joins the image sources only once it really contributed that text, an id that names nothing is refused
 * instead of quietly writing the article without the material, and a client that never heard of the field
 * behaves exactly as it did before.
 */
describe("POST /api/content/generate on the research material it names (CI-P3-01)", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** One material whose every field can be told apart from the payload's own material. */
  const researchNote = {
    title: "夏季冰饮动销报告",
    kind: "url" as const,
    sourceUrl: "https://example.com/research/summer-drinks",
    content: "七点以后冰饮最好卖，夜市摊位比商场高 40%。",
  };

  it("reads the material and writes its own text into the prompt, recording which version was read", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const material = await createResearchMaterial(researchNote);
    if (!material) throw new Error("the material fixture was not created");

    const payload = payloadFixture({ researchMaterialId: material.id });
    const config = configOf(payload);
    const response = await POST(generateRequest({ researchMaterialId: material.id }));
    const result = await response.json();

    expect(response.status).toBe(201);
    // Which stored row was read, and the version it was read at - the shape a brand records too, so "the
    // material changed after this article" is a comparison of two stored numbers (P3-01-04).
    expect(result.data.item.metadata).toMatchObject({
      researchMaterialId: material.id,
      researchMaterialVersion: material.updatedAt,
    });
    // The page is a source of *this* article, because the text came with it (P3-01-05).
    expect(result.data.item.sourceUrls).toEqual([researchNote.sourceUrl]);

    const turns = turnsOf(chatCalls(calls)[0]);
    const prompt = turns.user?.content ?? "";
    expect(prompt.startsWith(await expectedPrompt(config, payload, fixture.position, null, null, material))).toBe(true);
    expect(prompt).toContain(`研究素材：${researchNote.title}`);
    expect(prompt).toContain(`来源：${researchNote.sourceUrl}`);
    // The stored 正文 itself - not its title, and not a summary of it (P3-01-04).
    expect(prompt).toContain(`正文：\n${researchNote.content}`);
    // The subject the user typed is still in the material, after what the material contributed.
    expect(prompt).toContain("自定义素材：\n研究素材：");
  });

  it("carries a material nobody has read without inventing a 正文, and offers no image source for it", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const unread = await createResearchMaterial({
      title: "还没读的网页",
      kind: "url",
      sourceUrl: "https://example.com/research/unread",
    });
    if (!unread) throw new Error("the material fixture was not created");

    const payload = payloadFixture({ researchMaterialId: unread.id });
    const response = await POST(generateRequest({ researchMaterialId: unread.id }));
    const result = await response.json();

    expect(response.status).toBe(201);
    // The row was read, so it is recorded - and the row itself says 待读取, which is what the workspace shows.
    expect(result.data.item.metadata.researchMaterialId).toBe(unread.id);
    // A page that contributed no text is not a source of this article, and the image resolver is never sent
    // to it on this article's behalf.
    expect(result.data.item.sourceUrls).toEqual([]);

    const prompt = turnsOf(chatCalls(calls)[0]).user?.content ?? "";
    expect(prompt.startsWith(await expectedPrompt(configOf(payload), payload, fixture.position, null, null, unread))).toBe(
      true,
    );
    expect(prompt).toContain(`研究素材：${unread.title}`);
    expect(prompt).toContain(`来源：https://example.com/research/unread`);
    expect(prompt).not.toContain("正文：");
  });

  it("writes with a topic, a brand and a material at once, keeping each on its own terms", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const brand = await createBrand({
      name: "Clipversity",
      description: "面向剪辑师的工作流品牌。",
      targetAudience: "短视频剪辑师",
      tone: "克制、专业",
      keywords: ["剪辑工作流"],
      bannedWords: ["硬广腔"],
    });
    const topicRow = await createTopic({
      title: "小户型桌面收纳",
      description: "讲清 3 平米书桌的分区与取舍。",
      keywords: ["小户型"],
      source: "hot",
      sourceUrl: "https://example.com/hot/desk-storage",
    });
    const material = await createResearchMaterial(researchNote);
    if (!brand || !topicRow || !material) throw new Error("fixtures were not created");

    const payload = payloadFixture({ brandId: brand.id, topicId: topicRow.id, researchMaterialId: material.id });
    const config = configOf(payload);
    const response = await POST(
      generateRequest({ brandId: brand.id, topicId: topicRow.id, researchMaterialId: material.id }),
    );
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.data.item.metadata).toMatchObject({
      brandId: brand.id,
      topicId: topicRow.id,
      researchMaterialId: material.id,
    });
    // Two real source pages, in the order the route builds them: the topic's, then the material's.
    expect(result.data.item.sourceUrls).toEqual([topicRow.sourceUrl, researchNote.sourceUrl]);

    const turns = turnsOf(chatCalls(calls)[0]);
    const prompt = turns.user?.content ?? "";
    expect(
      prompt.startsWith(await expectedPrompt(config, payload, fixture.position, topicRow, brand, material)),
    ).toBe(true);
    // Each input contributes what it owns: the brand is identity, the topic is a subject, the material is text.
    expect(turns.system?.content).toContain(`品牌：${brand.name}`);
    expect(turns.system?.content).toContain(`品牌语气：${brand.tone}`);
    expect(prompt).toContain(`选题：${topicRow.title}`);
    expect(prompt).toContain(`研究素材：${researchNote.title}`);
    expect(prompt).toContain(`正文：\n${researchNote.content}`);
  });

  it("refuses an id that names nothing instead of writing the article without the material", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const itemsBefore = (await listContentItems({ pageSize: 20 })).total;
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;

    const response = await POST(generateRequest({ researchMaterialId: "material-that-is-gone" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await getResearchMaterial("material-that-is-gone")).toBeNull();
    // Nothing was written and no model was asked: a material is the run's source text, not a hint, so
    // "静默替换成其他素材 / 静默降级成没有素材" is not one of the outcomes (P3-01-04).
    expect(chatCalls(calls)).toEqual([]);
    expect((await listContentItems({ pageSize: 20 })).total).toBe(itemsBefore);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
  });

  it("keeps every client that never heard of the field exactly as it was", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    // The payload an older build sends: the field is simply absent, which the schema defaults to "".
    const legacy: Partial<Payload> = { ...payloadFixture() };
    delete legacy.researchMaterialId;
    const response = await POST(jsonRequest(generateUrl, { ...legacy }));
    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.data.item.metadata.researchMaterialId).toBeUndefined();
    expect(result.data.item.metadata.researchMaterialVersion).toBeUndefined();
    expect(result.data.item.sourceUrls).toEqual([]);
    const prompt = turnsOf(chatCalls(calls)[0]).user?.content ?? "";
    expect(prompt).not.toContain("研究素材：");
    expect(prompt).toContain(`自定义素材：\n${topic}\n\n${extraPrompt}`);
  });
});


