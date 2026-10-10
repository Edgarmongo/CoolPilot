import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiWritingBrand, AiWritingConfig, AiWritingMaterial, AiWritingPositioning } from "@/lib/ai-writing";
import type { BrandRecord, PositionRecord, ProductRecord } from "@/lib/types";

/**
 * `api/ai-writing/generate` on `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`).
 *
 * The chain under test is the real one - route handler, runtime, registry, router, key pool, provider
 * adapter - and only the *transport* is stubbed. Nothing here asserts that a mock was called: the
 * runtime is asked for real, and the cases pin what this route answers.
 *
 * P4 deleted the three legacy modules this file used to mock with a throwing factory (`@/lib/ai`,
 * `@/lib/ai/generate`, `@/lib/ai/compat`). The guard is structural now: reviving one of them fails
 * `tsc` and module resolution instead of a single test file (`docs/generate-migration-p3.md`, P4).
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
  routeTestDataDir,
  stubFetch,
  unavailable,
} = await import("@/test/route-harness");
const { POST } = await import("./route");
const { audiencePrompt, buildArticlePrompt, buildArticleSystemPrompt, industryDomainPrompt } = await import(
  "@/lib/ai-writing"
);
const { listContentItems, listUsageRecords } = await import("@/db/repository");
const { createKnowledgeBase, listKnowledgeBase } = await import("@/db/repositories/knowledge-base");
const { createBrand } = await import("@/db/repositories/brands");
const { createPosition } = await import("@/db/repositories/positions");
const { createProduct } = await import("@/db/repositories/products");
const { createTopic, getTopic } = await import("@/db/repositories/topics");
const { selectKnowledgeReferences } = await import("@/lib/knowledge-base");
const { countTextCharacters } = await import("@/lib/usage");
const fs = await import("node:fs/promises");
const path = await import("node:path");

const generateUrl = "http://localhost/api/ai-writing/generate";

/** What a model that understood `postDraftSchema` answers - padded, so the route's trimming is visible. */
const draft = { title: "  夏日厨房焕新  ", body: "第一段。\n\n第二段。" };
const draftTitle = "夏日厨房焕新";
const draftBody = "第一段。\n\n第二段。";

const topic = { title: "夏季美食趋势", source: "weibo", url: "https://example.com/hot/summer" };
const freeText = "自研涂层，全国售后网点 200+。";

/** A complete config: the request carries every field, so the fixture doubles as the prompt's input. */
function configFixture(overrides: Partial<AiWritingConfig> = {}): AiWritingConfig {
  return {
    materialSource: "hot",
    articleStyle: "advertorial",
    industry: "food",
    wordCount: 700,
    audience: "mom",
    targetPlatform: "threads",
    coreKeywords: "少油不粘",
    language: "zh-CN",
    imageStrategy: "product",
    imageCount: "few",
    deAi: true,
    knowledgeMode: "position",
    positioningId: "",
    brandId: "",
    ...overrides,
  };
}

function generateRequest(
  overrides: { config?: Partial<AiWritingConfig>; productIds?: string[]; topicId?: string } = {},
) {
  return jsonRequest(generateUrl, {
    config: configFixture(overrides.config),
    topics: [topic],
    productIds: overrides.productIds ?? [],
    freeText,
    // Omitted unless a case asks for it, so every existing payload stays exactly what it was.
    ...(overrides.topicId ? { topicId: overrides.topicId } : {}),
  });
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

function materialsOf(products: ProductRecord[]): AiWritingMaterial {
  return {
    topics: [{ title: topic.title, source: topic.source, url: topic.url }],
    products: products.map((product) => ({
      name: product.name,
      brand: product.brand,
      category: product.category,
      keywords: product.keywords,
      description: product.description,
      linkUrl: product.linkUrl,
    })),
    freeText,
  };
}

/**
 * The prompt this route should have sent, built from the same tables the route uses - so the case pins
 * the route's *assembly* (material, the selected products, the positioning's knowledge references, the
 * audience and industry labels) instead of a copy of the string.
 */
async function expectedPrompt(
  config: AiWritingConfig,
  positionId: string,
  products: ProductRecord[],
  brand?: AiWritingBrand,
) {
  return buildArticlePrompt({
    config,
    materials: materialsOf(products),
    knowledge: selectKnowledgeReferences(await listKnowledgeBase(), positionId),
    audienceLabel: audiencePrompt[config.audience],
    industryLabel: industryDomainPrompt[config.industry],
    brand,
  });
}

/**
 * The business rows a generation reads: one positioning, one knowledge entry tied to it, and one product
 * whose photo sits on disk. Created once for the file, because `resetRuntime()` resets the runtime's own
 * tables, not these.
 */
let fixture: { position: PositionRecord; product: ProductRecord; brand: BrandRecord };

beforeAll(async () => {
  const position = await createPosition({
    name: "家庭厨房",
    personaRole: "你是一位厨房好物测评编辑。",
    toneStyle: "轻松、直接",
    writingGuide: "先讲场景，再给方案。",
    bannedWords: ["最好"],
  });
  if (!position) throw new Error("positioning fixture was not created");
  await createKnowledgeBase({
    title: "选锅要点",
    content: "看涂层厚度，也看锅底厚度。",
    positionId: position.id,
    weight: "high",
  });

  const imagePath = path.join(routeTestDataDir, "product-shot.png");
  await fs.writeFile(imagePath, "not-a-real-png");
  const product = await createProduct({
    name: "不粘锅",
    brand: "CoolPilot",
    category: "厨房",
    keywords: ["不粘", "少油"],
    description: "三层涂层，导热均匀。",
    linkUrl: "https://example.com/products/pan",
    imagePath,
  });
  if (!product) throw new Error("product fixture was not created");

  const brand = await createBrand({
    name: "Clipversity",
    description: "跨境内容工作室",
    targetAudience: "做外贸的中小团队",
    tone: "专业但不生硬",
    keywords: ["选品"],
    bannedWords: ["最好用"],
  });
  if (!brand) throw new Error("brand fixture was not created");

  fixture = { position, product, brand };
});

describe("POST /api/ai-writing/generate on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers 201 with the stored article, its images, and the provider/model the runtime really used", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const config = configFixture({ positioningId: fixture.position.id });
    const response = await POST(generateRequest({ config, productIds: [fixture.product.id] }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    // The answer is normalised, not passed through: the title is trimmed, and the stored text is the
    // `title\n\nbody` a publisher uses.
    expect(payload.data.item).toMatchObject({
      title: draftTitle,
      body: draftBody,
      postReadyText: `${draftTitle}\n\n${draftBody}`,
      status: "ready",
      sourceUrls: [topic.url],
    });
    // The article's cover is the copy in the artifacts directory, and the product photo really was copied.
    // C4 stores the bare file name - the identity the library and the publish path both address - so the
    // file is read where the workspace keeps it, not at an absolute path the item no longer claims.
    expect(payload.data.images).toHaveLength(1);
    const cover = payload.data.images[0] as string;
    expect(cover).toMatch(/^writing-\d+-[A-Za-z0-9_-]{8}\.png$/);
    expect(await fs.readFile(path.join(routeTestDataDir, "artifacts", cover), "utf-8")).toBe("not-a-real-png");
    expect(payload.data.item.imagePath).toBe(cover);
    // And the copy's provenance is stored beside it: a bare name on its own says nothing about where the
    // image came from, which is what the item has to answer after a restart and a reopen.
    expect(payload.data.item.metadata.imageAssets).toEqual([
      expect.objectContaining({ reference: cover, fileName: cover, source: "copied", external: false }),
    ]);
    // What the route reports is what the runtime reported - not a hard-coded pair.
    expect(payload.data.provider).toBe("qwen");
    expect(payload.data.model).toBe("qwen3-max");
    expect(payload.data.item.metadata).toMatchObject({
      type: "article",
      images: [payload.data.images[0]],
      positioningId: fixture.position.id,
      provider: "qwen",
      model: "qwen3-max",
      aiWriting: { topics: [topic.title], productIds: [fixture.product.id] },
    });

    // One structured call: the runtime's model, on the runtime's JSON channel ...
    expect(chatCalls(calls)).toHaveLength(1);
    const wire = bodyOf(chatCalls(calls)[0]);
    expect(wire.model).toBe("qwen3-max");
    expect(wire.response_format).toEqual({ type: "json_object" });
    expect(wire.messages?.map((message) => message.role)).toEqual(["system", "user"]);
    // ... the route's own system prompt in the system turn ...
    const [systemTurn, userTurn] = wire.messages ?? [];
    expect(systemTurn?.content).toBe(
      buildArticleSystemPrompt({ config, positioning: positioningOf(fixture.position) }),
    );
    // ... and the route's article prompt in the user turn, where the runtime appends the schema instruction.
    const prompt = userTurn?.content ?? "";
    expect(prompt.startsWith(await expectedPrompt(config, fixture.position.id, [fixture.product]))).toBe(true);
    expect(prompt).toContain("JSON schema:");
    // The prompt really carries the console's material, the selected product and the free text.
    expect(prompt).toContain(topic.title);
    expect(prompt).toContain(fixture.product.name);
    expect(prompt).toContain(freeText);

    // The usage row records the runtime's own report, plus the word count of what was stored.
    const usage = (await listUsageRecords({ limit: 10 })).find((row) => row.contentItemId === payload.data.item.id);
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

  it("answers 400 with the runtime's code when the model has no credential, and stores nothing", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const articlesBefore = (await listContentItems({ pageSize: 20 })).total;
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;
    // The user removed the key after the model had been discovered: routing is now unroutable.
    await credentials.clearCredential(credentials.credentialRefFor("qwen"));

    const response = await POST(generateRequest());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    // The code is the runtime's - this route recognises no error class of its own any more.
    expect(payload.code).toBe("MODEL_CREDENTIAL_MISSING");
    // The old contract was a 502 carrying `MissingAIKeyError`'s message; the message now explains the
    // routing, which is the D-P3-3 trade this batch makes, and the envelope is unchanged.
    expect(payload.message).not.toContain("Missing qwen API key");
    expect(payload.message).toContain("credential");
    expect(payload.error).toBe(payload.message);
    // Nothing was attempted, and the failure happens before the article is stored.
    expect(chatCalls(calls)).toEqual([]);
    expect((await listContentItems({ pageSize: 20 })).total).toBe(articlesBefore);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
  });

  it("answers 502 with the upstream status in details when the provider itself fails", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: unavailable },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const articlesBefore = (await listContentItems({ pageSize: 20 })).total;

    const response = await POST(generateRequest());
    const payload = await response.json();

    // Unchanged status: this route answered 502 for a provider failure before the migration too. What is
    // new is that the runtime supplies the code and the upstream status instead of a flattened message.
    expect(response.status).toBe(502);
    expect(payload.code).toBe("MODEL_UPSTREAM_FAILED");
    expect(payload.details.status).toBe(503);
    // One enabled model and one key: the failure is reported after that single attempt.
    expect(chatCalls(calls)).toHaveLength(1);
    expect((await listContentItems({ pageSize: 20 })).total).toBe(articlesBefore);
  });

  it("keeps the 400 INVALID_PAYLOAD guard, and validates before it reads or asks anything", async () => {
    const calls = stubFetch([]);

    // No `config` at all.
    const missingConfig = await POST(jsonRequest(generateUrl, { topics: [], productIds: [], freeText: "" }));
    expect(missingConfig.status).toBe(400);
    expect((await missingConfig.json()).code).toBe("INVALID_PAYLOAD");

    // A word count outside the console's own 300..3000 range.
    const outOfRange = await POST(generateRequest({ config: { wordCount: 10 } }));
    expect(outOfRange.status).toBe(400);
    expect((await outOfRange.json()).code).toBe("INVALID_PAYLOAD");

    // Validation comes first: no model was configured or asked, and the stub would have answered an
    // unplanned call with a loud 404 instead of silence.
    expect(calls).toEqual([]);
  });

  it("keeps the runtime's single corrective retry, and reports the usage of both answers", async () => {
    let attempt = 0;
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      {
        match: (target) => target.includes("/chat/completions"),
        // The first answer forgets the body, which `postDraftSchema` rejects; the second one is usable.
        respond: () => (attempt++ === 0 ? jsonReply({ title: draftTitle }) : jsonReply(draft)),
      },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    // `""` means "the account's default positioning" - the other branch of the route's position lookup.
    const config = configFixture({ positioningId: "" });

    const response = await POST(generateRequest({ config }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.item).toMatchObject({ title: draftTitle, body: draftBody });
    expect(payload.data.provider).toBe("qwen");
    expect(payload.data.model).toBe("qwen3-max");
    // No product was selected this time, so the article is stored without an image.
    expect(payload.data.images).toEqual([]);
    expect(payload.data.item.imagePath).toBeUndefined();

    // Two calls: the rejected answer, then the correction turn the runtime appends to the same prompt.
    expect(chatCalls(calls)).toHaveLength(2);
    const retry = bodyOf(chatCalls(calls)[1]);
    expect(retry.messages?.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    // The default positioning is the fixture's, and the prompt is still the route's own.
    expect(retry.messages?.[0]?.content).toBe(
      buildArticleSystemPrompt({ config, positioning: positioningOf(fixture.position) }),
    );
    expect(retry.messages?.[1]?.content?.startsWith(await expectedPrompt(config, fixture.position.id, []))).toBe(
      true,
    );

    // The usage row reports both attempts merged, exactly as the runtime reports them.
    const usage = (await listUsageRecords({ limit: 10 })).find((row) => row.contentItemId === payload.data.item.id);
    expect(usage).toMatchObject({ inputTokens: 22, outputTokens: 14, totalTokens: 36 });
  });

  it("keeps the topic it was opened from: the id on the article, the article on the topic (CI-P2-01)", async () => {
    stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const topicRecord = await createTopic({ title: topic.title, source: topic.source, sourceUrl: topic.url });
    if (!topicRecord) throw new Error("topic fixture was not created");

    const response = await POST(
      generateRequest({ config: configFixture({ positioningId: fixture.position.id }), topicId: topicRecord.id }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    // Provenance on the article: the id the topic list sent, next to the material it already carried.
    expect(payload.data.item.metadata).toMatchObject({ type: "article", topicId: topicRecord.id });
    // And the link back, which is what lets the topic row open what it produced.
    expect((await getTopic(topicRecord.id))!.contentItemId).toBe(payload.data.item.id);
  });

  it("still answers the article when the topic it names is gone, and links nothing", async () => {
    stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const response = await POST(generateRequest({ config: configFixture(), topicId: "no-such-topic" }));
    const payload = await response.json();

    // The article is the primary effect and is already stored, so a link with nothing to link to is
    // reported and the generation still answers: it is not a 500 in the user's face.
    expect(response.status).toBe(201);
    expect(payload.data.item.metadata.topicId).toBe("no-such-topic");
    expect(await getTopic("no-such-topic")).toBeNull();
  });

  it("injects the brand the config selected, and records the version it was written as", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const config = configFixture({ brandId: fixture.brand.id });

    const response = await POST(generateRequest({ config }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    // The id the payload selected is the id the article records, next to the version it was written as
    // (P2-02-04), and the provenance carries the same selection because the console's config is stored.
    expect(payload.data.item.metadata).toMatchObject({
      brandId: fixture.brand.id,
      brandVersion: fixture.brand.updatedAt,
      aiWriting: { brandId: fixture.brand.id },
    });

    // And it really reached the model: the brand's voice is in the system turn ...
    const wire = bodyOf(chatCalls(calls)[0]);
    const [systemTurn, userTurn] = wire.messages ?? [];
    expect(systemTurn?.content).toBe(
      buildArticleSystemPrompt({ config, positioning: positioningOf(fixture.position), brand: fixture.brand }),
    );
    // ... and this route's own article prompt is the one the brand's keywords landed in.
    expect(userTurn?.content ?? "").toContain("品牌关键词：选品");
    expect(userTurn?.content ?? "").toContain(fixture.brand.targetAudience);
  });

  it("writes as no brand when the payload names none, which is what every older client does", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const response = await POST(generateRequest({ config: configFixture() }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.item.metadata).toMatchObject({ brandId: "", brandVersion: 0 });
    const system = (bodyOf(chatCalls(calls)[0]).messages ?? [])[0]?.content ?? "";
    expect(system).not.toContain("品牌");
    // The positioning, including its banned word, still applies: no brand means no brand context only.
    expect(system).toContain(fixture.position.personaRole);
  });
});
