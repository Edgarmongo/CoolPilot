import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiWritingConfig, AiWritingMaterial, AiWritingPositioning } from "@/lib/ai-writing";
import type { BrandRecord, PositionRecord } from "@/lib/types";

/**
 * `lib/article-generation.ts` - the article generation seam of C3 (`docs/creator-workflow-audit.md`,
 * `docs/generation-service-audit.md` §8).
 *
 * The two route tests keep guarding their own contracts, so nothing here repeats a payload, a guard or
 * an envelope: this file pins the business invariants the two entries handed over, one by one - the
 * positioning lookup, the knowledge selection, the two prompts, the structured call, the image
 * resolution, the content item and the usage row - and the things the service must *not* do: invent a
 * title, re-shape the caller's provenance, or swallow a runtime error.
 *
 * The chain under test is the real one - `generateArticle`, the runtime, the registry, the router, the
 * key pool, the provider adapter, the article image strategy - and only the *transport* is stubbed.
 * Nothing here asserts that a mock was called.
 *
 * This is also the layer that composes the stored metadata blob, so the provenance is pinned by key
 * rather than by order: no reader in the app depends on the key order. Which image value means what used
 * to be C4's question; C4 answered it (`images` holds one reference shape, `imageAssets` says what each
 * one is), so the keys are asserted here and the shape itself is pinned in `content-image-assets.test.ts`.
 */

/**
 * The harness pins the temp database and the keyless env before anything that reads them loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
const {
  allowEveryAiBudgetCall,
  bodyOf,
  chatCalls,
  jsonReply,
  prepareChatModel,
  qwenCatalog,
  refuseEveryAiBudgetCall,
  resetRuntime,
  routeTestDataDir,
  stubFetch,
  unavailable,
} = await import("@/test/route-harness");
const { generateArticle } = await import("./article-generation");
const { listContentItems, listUsageRecords } = await import("@/db/repository");
const { createKnowledgeBase, listKnowledgeBase } = await import("@/db/repositories/knowledge-base");
const { createBrand, updateBrand } = await import("@/db/repositories/brands");
const { createPosition } = await import("@/db/repositories/positions");
const {
  audiencePrompt,
  buildArticlePrompt,
  buildArticleSystemPrompt,
  industryDomainPrompt,
} = await import("@/lib/ai-writing");
const { selectKnowledgeReferences } = await import("@/lib/knowledge-base");
const { countTextCharacters } = await import("@/lib/usage");
const fs = await import("node:fs/promises");
const path = await import("node:path");

/** What a model that understood `postDraftSchema` answers - padded, so the trimming is visible. */
const draft = { title: "  换季收纳  ", body: "先把不穿的收起来。\n\n再按使用频率分层。" };
const draftTitle = "换季收纳";
const draftBody = "先把不穿的收起来。\n\n再按使用频率分层。";

const topicUrl = "https://example.com/hot/closet";
const freeText = "自研扣具，三年质保。";

/** One material in the shape both entries build, so the prompt assertion has a single source. */
const material: AiWritingMaterial = {
  topics: [{ title: "换季收纳", source: "weibo", url: topicUrl }],
  products: [
    {
      name: "折叠收纳箱",
      brand: "CoolPilot",
      category: "家居",
      keywords: ["可折叠"],
      description: "承重 30kg。",
      linkUrl: "https://example.com/products/box",
    },
  ],
  freeText,
};

const positioningKnowledge = { title: "选箱要点", content: "先量柜内径，再看承重。" };
const sharedKnowledge = { title: "平台规则", content: "标题不超过 20 字，正文分段。" };

type Request = Parameters<typeof generateArticle>[0];

function configFixture(overrides: Partial<AiWritingConfig> = {}): AiWritingConfig {
  return {
    materialSource: "hot",
    articleStyle: "advertorial",
    industry: "home",
    wordCount: 700,
    audience: "office",
    targetPlatform: "zhihu",
    coreKeywords: "小户型、收纳",
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

/**
 * The request under test with everything else defaulted, so each case names only what it changes. The
 * positioning lookup reads the request's `positioningId`, which is why the config fixture's own
 * `positioningId` stays empty - that one is provenance the caller happens to carry.
 */
function requestFixture(overrides: Partial<Request> = {}): Request {
  return {
    positioningId: fixture.position.id,
    config: configFixture(),
    material,
    titleFallback: "未命名文章",
    imageSources: { productImagePaths: [], sourceUrls: [] },
    provenance: {},
    ...overrides,
  };
}

/** The prompt this service should have sent, assembled from the same tables it reads. */
async function expectedPrompt(config: AiWritingConfig, positionId: string | undefined) {
  return buildArticlePrompt({
    config,
    materials: material,
    knowledge: selectKnowledgeReferences(await listKnowledgeBase(), positionId),
    audienceLabel: audiencePrompt[config.audience],
    industryLabel: industryDomainPrompt[config.industry],
  });
}

/** The eight fields a positioning contributes to a prompt. */
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

/** The turns of one chat call in the order they went on the wire: system first, then user. */
const turnsOf = (call: Parameters<typeof bodyOf>[0]) => bodyOf(call).messages ?? [];

/** The two channels a generation may use, so a case can say what the model answers. */
const chatRoutes = (respond: () => Response) => [
  { match: (target: string) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
  { match: (target: string) => target.includes("/chat/completions"), respond },
];

/** A stored product photo, written for real: the copy the article gets is a real `fs.copyFile`. */
async function productPhoto(name: string) {
  const dir = path.join(routeTestDataDir, "product-images");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, `bytes-of-${name}`);
  return filePath;
}

/**
 * The business rows a generation reads: one positioning (the install's default, because it is the first
 * one), one knowledge entry tied to it and one that applies to every positioning, and the two brand
 * profiles P2-02-05 needs (a run must inject one of them, never a mix). Created once for the file,
 * because `resetRuntime()` resets the runtime's own tables, not these.
 */
let fixture: {
  position: PositionRecord;
  brands: { clipversity: BrandRecord; seafood: BrandRecord };
};

beforeAll(async () => {
  const position = await createPosition({
    name: "小户型收纳",
    personaRole: "你是一位家居收纳编辑，说话直接。",
    toneStyle: "平实、具体",
    writingGuide: "先给结论，再给收纳步骤。",
    bannedWords: ["最强"],
  });
  if (!position) throw new Error("positioning fixture was not created");
  await createKnowledgeBase({ ...positioningKnowledge, positionId: position.id, weight: "high" });
  await createKnowledgeBase({ ...sharedKnowledge, positionId: "", weight: "medium" });

  const clipversity = await createBrand({
    name: "Clipversity",
    description: "跨境内容工作室",
    targetAudience: "做外贸的中小团队",
    tone: "专业但不生硬",
    keywords: ["选品", "跨境"],
    bannedWords: ["最好用"],
  });
  const seafood = await createBrand({
    name: "绿源海鲜",
    targetAudience: "注重食材的年轻家庭",
    tone: "亲切具体，少用夸张词",
    keywords: ["冷链"],
    bannedWords: ["包治百病"],
  });
  if (!clipversity || !seafood) throw new Error("brand fixtures were not created");

  fixture = { position, brands: { clipversity, seafood } };
});

describe("generateArticle", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    // The shipped budget row is `off`; a case that wants a refusal states the refusal itself, and this
    // puts the row back so the other cases here keep calling the model.
    await allowEveryAiBudgetCall();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores one ready item and one usage row, and answers the item, its images and the runtime's pair", async () => {
    const calls = stubFetch(chatRoutes(() => jsonReply(draft)));
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const itemsBefore = (await listContentItems({ pageSize: 20 })).total;
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;
    const photo = await productPhoto("box.png");
    const config = configFixture();

    const result = await generateArticle(
      requestFixture({ config, imageSources: { productImagePaths: [photo], sourceUrls: [topicUrl] } }),
    );

    // What the runtime really used is what the caller is told.
    expect(result.provider).toBe("qwen");
    expect(result.model).toBe("qwen3-max");

    // The images were resolved by the image layer: this one is a real copy of the stored photo, stored as
    // the one reference shape an item holds (C4) - the file name, not the path of the machine it came from.
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatch(/^writing-/);
    expect(await fs.readFile(path.join(routeTestDataDir, "artifacts", result.images[0]), "utf-8"))
      .toBe("bytes-of-box.png");

    // The item: trimmed, ready, the first image as its cover, and the caller's own source list.
    expect(result.item).toMatchObject({
      title: draftTitle,
      body: draftBody,
      postReadyText: `${draftTitle}\n\n${draftBody}`,
      sourceUrls: [topicUrl],
      imagePath: result.images[0],
      status: "ready",
    });
    // The service adds the four facts it owns to the caller's provenance (here: nothing else).
    expect(result.item?.metadata).toMatchObject({
      images: result.images,
      // C4: the item also says what each image is and where it came from, in the same order as the list.
      imageAssets: [
        expect.objectContaining({ reference: result.images[0], fileName: result.images[0], source: "copied" }),
      ],
      positioningId: fixture.position.id,
      provider: "qwen",
      model: "qwen3-max",
    });
    // Nothing was skipped, so no failure key is added to an article that simply has no remote image.
    expect(result.item?.metadata).not.toHaveProperty("imageLocalizationFailures");

    // Exactly one item, and the usage row that reports the runtime's own numbers for the stored body.
    expect((await listContentItems({ pageSize: 20 })).total).toBe(itemsBefore + 1);
    const usage = (await listUsageRecords({ limit: 500 })).find((row) => row.contentItemId === result.item?.id);
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
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore + 1);
    expect(chatCalls(calls)).toHaveLength(1);
  });

  it("asks with the caller's prefix ahead of the positioning prompt, and builds the article prompt itself", async () => {
    const calls = stubFetch(chatRoutes(() => jsonReply(draft)));
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const config = configFixture();
    const prefix = "你是一位资深家居编辑，说话直接。";

    await generateArticle(requestFixture({ config, systemPromptPrefix: prefix }));
    // The prefix is the only optional half: without it the positioning's rules stand alone.
    await generateArticle(requestFixture({ config }));

    const first = bodyOf(chatCalls(calls)[0]);
    expect(first.response_format).toEqual({ type: "json_object" });
    expect(first.messages?.map((message) => message.role)).toEqual(["system", "user"]);
    const [systemTurn, userTurn] = turnsOf(chatCalls(calls)[0]);
    expect(systemTurn?.content).toBe(
      [prefix, buildArticleSystemPrompt({ config, positioning: positioningOf(fixture.position) })].join("\n\n"),
    );
    expect(turnsOf(chatCalls(calls)[1])[0]?.content).toBe(
      buildArticleSystemPrompt({ config, positioning: positioningOf(fixture.position) }),
    );

    // The article prompt is assembled here: the caller's material, the positioning's knowledge and the
    // two label maps - the runtime only appends the schema instruction.
    const prompt = userTurn?.content ?? "";
    expect(prompt.startsWith(await expectedPrompt(config, fixture.position.id))).toBe(true);
    expect(prompt).toContain("JSON schema:");
    expect(prompt).toContain(material.topics[0]?.title ?? "");
    expect(prompt).toContain(material.products[0]?.name ?? "");
    expect(prompt).toContain(freeText);
    expect(prompt).toContain(positioningKnowledge.title);
  });

  it("resolves the positioning and the knowledge itself: the default, a row that is gone, and off", async () => {
    const calls = stubFetch(chatRoutes(() => jsonReply(draft)));
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const config = configFixture();

    // `""` means "the account's default positioning", which is the fixture - the only one there is.
    const fallback = await generateArticle(requestFixture({ config, positioningId: "" }));
    expect(fallback.item?.metadata.positioningId).toBe(fixture.position.id);
    expect(turnsOf(chatCalls(calls)[0])[0]?.content).toContain(fixture.position.personaRole);
    expect(turnsOf(chatCalls(calls)[0])[1]?.content).toContain(positioningKnowledge.title);

    // A positioning that no longer exists: no persona is sent, and the knowledge is no longer filtered
    // by an id - so even the entry that belongs to the missing row still reaches the model.
    const gone = await generateArticle(requestFixture({ config, positioningId: "position-that-is-gone" }));
    expect(gone.item?.metadata.positioningId).toBe("");
    expect(turnsOf(chatCalls(calls)[1])[0]?.content).toBe(
      buildArticleSystemPrompt({ config, positioning: undefined }),
    );
    const gonePrompt = turnsOf(chatCalls(calls)[1])[1]?.content ?? "";
    expect(gonePrompt).toContain(sharedKnowledge.title);
    expect(gonePrompt).toContain(positioningKnowledge.title);

    // The knowledge switch is read on this side too: nothing is selected, so nothing is sent.
    await generateArticle(requestFixture({ config: configFixture({ knowledgeMode: "off" }) }));
    const offPrompt = turnsOf(chatCalls(calls)[2])[1]?.content ?? "";
    expect(offPrompt).not.toContain("可参考的知识库资料");
    expect(offPrompt).not.toContain(sharedKnowledge.title);
  });

  it("stores the caller's provenance verbatim and adds only the four facts it owns", async () => {
    stubFetch(chatRoutes(() => jsonReply(draft)));
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    // A provenance blob shaped like the one `api/content/generate` passes, nested value included.
    const provenance = {
      type: "post",
      prompt: "补充说明：主打小户型。",
      topic: "桌面收纳",
      generationType: "topic",
      agentId: "hot-commentator",
      agentName: "热点评论员",
      nested: { deep: [1, 2] },
    };

    const result = await generateArticle(requestFixture({ provenance }));

    const stored = result.item?.metadata ?? {};
    expect(stored).toMatchObject(provenance);
    // The caller's keys, plus the six facts this layer owns - no seventh smuggled in.
    expect(Object.keys(stored).sort()).toEqual(
      [...Object.keys(provenance), "images", "positioningId", "brandId", "brandVersion", "provider", "model"].sort(),
    );
  });

  it("uses the caller's fallback only when the model answers an empty title, and stores no image otherwise", async () => {
    let attempt = 0;
    stubFetch(chatRoutes(() => (attempt++ === 0 ? jsonReply({ title: "   ", body: draftBody }) : jsonReply(draft))));
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const config = configFixture();

    // Nothing but spaces came back: the caller's fallback is used and the body is still trimmed in.
    const empty = await generateArticle(requestFixture({ config, titleFallback: "未命名文章" }));
    expect(empty.item).toMatchObject({
      title: "未命名文章",
      postReadyText: `未命名文章\n\n${draftBody}`,
    });
    // No product photo and no source page, so the image layer returns nothing and the cover stays unset.
    expect(empty.images).toEqual([]);
    expect(empty.item?.imagePath).toBeUndefined();

    // A title the model really wrote is never overridden by the fallback.
    const answered = await generateArticle(requestFixture({ config, titleFallback: "未命名文章" }));
    expect(answered.item?.title).toBe(draftTitle);
  });

  it("lets the runtime's failure through unchanged and stores nothing", async () => {
    const calls = stubFetch([
      { match: (target: string) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target: string) => target.includes("/chat/completions"), respond: unavailable },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const itemsBefore = (await listContentItems({ pageSize: 20 })).total;
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;

    // No translation and no swallowing: the runtime's own code and status travel out of the service,
    // and the route's `failFromError` is still the only place they become a response.
    await expect(generateArticle(requestFixture())).rejects.toMatchObject({
      code: "MODEL_UPSTREAM_FAILED",
      status: 502,
    });

    // One enabled model and one key: the failure is reported after that single attempt, and the failed
    // generation left neither an article nor a cost row behind (F-C3-6 keeps that out of this cut).
    expect(chatCalls(calls)).toHaveLength(1);
    expect((await listContentItems({ pageSize: 20 })).total).toBe(itemsBefore);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
  });

  it("refuses before the prompt is sent, so the caller gets the gate's own 402 and nothing is stored", async () => {
    await refuseEveryAiBudgetCall();
    const calls = stubFetch(chatRoutes(() => jsonReply(draft)));
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const itemsBefore = (await listContentItems({ pageSize: 20 })).total;
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;

    // A refusal is the gate's own `AI_BUDGET_EXCEEDED` (402), not a provider failure: the service does
    // not send, does not store an item, and does not write a cost row for a call that never happened.
    await expect(generateArticle(requestFixture())).rejects.toMatchObject({
      code: "AI_BUDGET_EXCEEDED",
      status: 402,
    });

    expect(chatCalls(calls)).toHaveLength(0);
    expect((await listContentItems({ pageSize: 20 })).total).toBe(itemsBefore);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
  });

  it("writes as the brand the request named, records its version, and never mixes in the other one", async () => {
    const calls = stubFetch(chatRoutes(() => jsonReply(draft)));
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const config = configFixture();
    const { clipversity, seafood } = fixture.brands;

    // Brand A: its own voice and its own banned words (the positioning bans 最强, so the list is a union).
    const first = await generateArticle(requestFixture({ config, brandId: clipversity.id }));
    const [systemA, userA] = turnsOf(chatCalls(calls)[0]);
    expect(systemA?.content).toContain("品牌语气：专业但不生硬");
    expect(systemA?.content).toContain("禁止出现：最强、最好用");
    expect(userA?.content).toContain("品牌关键词：选品、跨境");
    expect(systemA?.content).not.toContain("亲切具体，少用夸张词");
    expect(userA?.content).not.toContain("品牌关键词：冷链");
    // The reference the article keeps, and the version it was written as (P2-02-04).
    expect(first.item?.metadata).toMatchObject({ brandId: clipversity.id, brandVersion: clipversity.updatedAt });

    // Brand B: the same request, the other brand. What changed is exactly the brand's contribution.
    const second = await generateArticle(requestFixture({ config, brandId: seafood.id }));
    const [systemB, userB] = turnsOf(chatCalls(calls)[1]);
    expect(systemB?.content).toContain("品牌语气：亲切具体，少用夸张词");
    expect(systemB?.content).toContain("禁止出现：最强、包治百病");
    expect(userB?.content).toContain("品牌关键词：冷链");
    expect(systemB?.content).not.toContain("专业但不生硬");
    expect(userB?.content).not.toContain("品牌关键词：选品、跨境");
    expect(second.item?.metadata).toMatchObject({ brandId: seafood.id, brandVersion: seafood.updatedAt });
  });

  it("treats a brand id that is gone as no brand instead of borrowing another one", async () => {
    const calls = stubFetch(chatRoutes(() => jsonReply(draft)));
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const result = await generateArticle(requestFixture({ config: configFixture(), brandId: "brand-that-is-gone" }));

    expect(result.item?.metadata).toMatchObject({ brandId: "", brandVersion: 0 });
    const system = turnsOf(chatCalls(calls)[0])[0]?.content ?? "";
    expect(system).not.toContain("品牌");
    // The positioning still applies: an unknown brand takes nothing else down with it.
    expect(system).toContain(fixture.position.personaRole);
  });

  it("moves the recorded version when the brand is edited, so a later edit stays visible", async () => {
    const calls = stubFetch(chatRoutes(() => jsonReply(draft)));
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const brand = await createBrand({ name: "版本可见", tone: "第一版语气" });
    if (!brand) throw new Error("brand fixture was not created");

    const before = await generateArticle(requestFixture({ config: configFixture(), brandId: brand.id }));
    expect(turnsOf(chatCalls(calls)[0])[0]?.content).toContain("品牌语气：第一版语气");

    await updateBrand(brand.id, { tone: "第二版语气" });
    const after = await generateArticle(requestFixture({ config: configFixture(), brandId: brand.id }));

    expect(turnsOf(chatCalls(calls)[1])[0]?.content).toContain("品牌语气：第二版语气");
    expect(after.item?.metadata.brandId).toBe(brand.id);
    // The article keeps the version it was written with; comparing it with the row is the whole check.
    expect(after.item?.metadata.brandVersion as number).toBeGreaterThan(before.item?.metadata.brandVersion as number);
  });
});
