import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `api/content/[id]/translate` on `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`).
 *
 * The editor's 翻译 dialog posts to this route, reads `title` / `paragraphs` / `sourceTitle` /
 * `sourceParagraphs` back and lays them out itself, and persists nothing until the user confirms - so the
 * cases pin the *translation* contract: which article the `[id]` segment selected, which text became the
 * source, what the prompt looked like, and that the answer was normalised rather than passed through. The
 * chain under test is the real one - route handler, runtime, registry, router, key pool, provider adapter -
 * and only the *transport* is stubbed. Nothing here asserts that a mock was called.
 *
 * The two text facades are mocked with throwing factories, because this is the file that used to import
 * `generateStructured` from `@/lib/ai/generate`: if the route - or anything it imports - still reached for
 * a facade, the whole file fails instead of one case quietly keeping the old behaviour alive. The
 * compatibility shim is mocked the same way, which this route can afford and its two predecessors could
 * not: the only production importer of `@/lib/ai/compat` is `lib/agent/image-generation.ts`, and this
 * route does not touch it - unlike A3-2.2, whose route reaches it through `lib/article-images.ts`.
 */
vi.mock("@/lib/ai", () => {
  throw new Error("api/content/[id]/translate must not import the legacy facade (@/lib/ai)");
});
vi.mock("@/lib/ai/generate", () => {
  throw new Error("api/content/[id]/translate must not import the legacy facade (@/lib/ai/generate)");
});
vi.mock("@/lib/ai/compat", () => {
  throw new Error("api/content/[id]/translate must not reach the compat shim (@/lib/ai/compat)");
});

/**
 * The harness pins the temp database and the keyless env before anything that reads them loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
const {
  allowEveryAiBudgetCall,
  bodyOf,
  chatCalls,
  credentials,
  jsonReply,
  jsonRequest,
  prepareChatModel,
  qwenCatalog,
  refuseEveryAiBudgetCall,
  resetRuntime,
  stubFetch,
} = await import("@/test/route-harness");
const { POST } = await import("./route");
const { createContentItem, getContentItem, listUsageRecords } = await import("@/db/repository");
const { listAiUsageLedgerEntries } = await import("@/db/repositories/ai-usage-ledger");
const { createPosition, updatePosition } = await import("@/db/repositories/positions");
const { htmlToPlainText } = await import("@/lib/article-themes");
const { toParagraphs } = await import("@/lib/translation-layouts");
const { countTextCharacters } = await import("@/lib/usage");

/** The route as Next.js calls it: the `[id]` segment arrives as a promise the handler awaits. */
const translateUrl = (id: string) => `http://localhost/api/content/${id}/translate`;

const translate = (id: string, body: unknown) =>
  POST(jsonRequest(translateUrl(id), body), { params: Promise.resolve({ id }) });

/** What a model that understood `articleTranslationSchema` answers - padded, so the trim is visible. */
const draft = {
  title: "  桌面收納指南  ",
  paragraphs: ["  Clear the desk first.  ", "", "  Then sort by feel.  ", "   "],
};
const draftTitle = "桌面收納指南";
/** The route trims every entry and drops the blank ones the model padded the array with. */
const draftParagraphs = ["Clear the desk first.", "Then sort by feel."];

/** The article stored in the database, and the editor's own text - the two sources of a translation. */
const storedTitle = "桌面收纳（仓库标题）";
const storedBody = "<p>仓库正文第一段，翻译时绝不应该出现。</p><p>仓库正文第二段。</p>";
const storedMarker = "仓库正文";
const editorTitle = "桌面收纳（编辑器标题）";
const editorText = "第一段：先清空桌面。\n\n第二段：再按手感分区。";
const editorParagraphs = ["第一段：先清空桌面。", "第二段：再按手感分区。"];
const siblingMarker = "另一篇文章的正文";

/** Mirrors the translator instruction the route sends - the route's own literal, spelled out here. */
const translatorSystemPrompt = "你是一位专业翻译，擅长把自媒体文章逐段翻译成目标语言并保持段落一一对应。";

/** Mirrors the route's own source cap, so the long-article case can prove the cut happened. */
const maxTranslateInput = 8000;

/** A stored article long enough that the cap bites inside its last paragraph. */
const longTitle = "超长文章（仓库标题）";
const longFiller = "这是一段用于撑长正文的示例内容。";
const longParagraphText = (index: number) => `${longFiller.repeat(200)}第${index}段结束。`;
const longBody = [
  `<h1>${longTitle}</h1>`,
  `<p>${longParagraphText(1)}</p>`,
  "",
  `<p>${longParagraphText(2)}</p>`,
  "",
  `<p>${longParagraphText(3)}</p>`,
].join("\n");

/** The payload the 翻译 dialog sends: its own flattened text, its own title, the language label as-is. */
function sourcePayload(overrides: Record<string, unknown> = {}) {
  return { targetLanguage: "English", title: `  ${editorTitle}  `, text: editorText, ...overrides };
}

/**
 * The prompt this route should have sent, rebuilt from the three inputs it has - the language label, the
 * source title and the source paragraphs - so a case pins the route's *assembly* instead of a copy of the
 * string.
 */
function expectedPrompt(targetLanguage: string, sourceTitle: string, sourceParagraphs: string[]) {
  return [
    `把下面的文章逐段翻译成${targetLanguage}。`,
    "要求：段落数量与顺序必须与原文完全一致（一段对一段），用词自然地道，不要逐字直译；只输出译文，不要添加解释、注释或编号。",
    `原标题：${sourceTitle}`,
    "原文（编号仅用于对照，不要输出编号）：",
    ...sourceParagraphs.map((text, index) => `${index + 1}. ${text}`),
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

type SeededItem = NonNullable<Awaited<ReturnType<typeof createContentItem>>>;

/**
 * The articles these cases read: the target of most cases (whose *stored* title and body must never leak
 * into a prompt built from the editor's text), a sibling that must not be touched or mentioned, one long
 * enough that the source cap bites, and one with nothing to translate. Created once for the file, because
 * `resetRuntime()` resets the runtime's own tables, not these.
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

describe("POST /api/content/[id]/translate on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers 200 with the aligned translation and the provider/model the runtime really used", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const before = await getContentItem(fixture.target.id);

    const response = await translate(fixture.target.id, sourcePayload());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    // The answer is normalised, not passed through: the title is trimmed, and the blank paragraph the
    // model padded the array with never reaches the dialog's comparison.
    expect(payload.data.title).toBe(draftTitle);
    expect(payload.data.paragraphs).toEqual(draftParagraphs);
    // The left pane of the comparison is the editor's own text and title, not the stored ones.
    expect(payload.data.sourceTitle).toBe(editorTitle);
    expect(payload.data.sourceParagraphs).toEqual(editorParagraphs);
    // What the route reports is what the runtime reported - not a hard-coded pair.
    expect(payload.data.provider).toBe("qwen");
    expect(payload.data.model).toBe("qwen3-max");

    // One structured call: the runtime's model, on the runtime's JSON channel ...
    expect(chatCalls(calls)).toHaveLength(1);
    const wire = bodyOf(chatCalls(calls)[0]);
    expect(wire.model).toBe("qwen3-max");
    expect(wire.response_format).toEqual({ type: "json_object" });
    const turns = turnsOf(chatCalls(calls)[0]);
    expect(turns.roles).toEqual(["system", "user"]);
    expect(turns.system?.content).toBe(translatorSystemPrompt);
    // ... and the route's own prompt in the user turn, where the runtime appends the schema instruction.
    const prompt = turns.user?.content ?? "";
    expect(prompt.startsWith(expectedPrompt("English", editorTitle, editorParagraphs))).toBe(true);
    expect(prompt).toContain("JSON schema:");
    // `[id]` steered the read: the prompt carries this article's editor text ...
    expect(prompt).toContain(editorParagraphs[0]);
    expect(prompt).toContain(editorParagraphs[1]);
    // ... and neither the stored body nor the sibling article.
    expect(prompt).not.toContain(storedMarker);
    expect(prompt).not.toContain(siblingMarker);

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
      wordCount: countTextCharacters(draftParagraphs.join("\n")),
    });

    // Nothing was written back: the dialog shows a diff and persists only after the user confirms.
    expect(await getContentItem(fixture.target.id)).toEqual(before);
  });

  it("reads the stored body when the editor sends no text, and caps the source at the route's own limit", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    // A caller that only has the article id: no editor text, no editor title.
    const response = await translate(fixture.long.id, { targetLanguage: "繁体中文" });
    const payload = await response.json();

    expect(response.status).toBe(200);
    // The stored body is HTML, so the route flattens it before splitting paragraphs ...
    const flattened = htmlToPlainText(fixture.long.body);
    expect(flattened.length).toBeGreaterThan(maxTranslateInput);
    const sourceParagraphs = toParagraphs(flattened.slice(0, maxTranslateInput));
    expect(payload.data.sourceParagraphs).toEqual(sourceParagraphs);
    expect(sourceParagraphs).toHaveLength(4);
    // ... and the cap cut the last paragraph short instead of dropping it.
    const longThird = longParagraphText(3);
    expect(longThird.startsWith(sourceParagraphs[3] ?? "")).toBe(true);
    expect(sourceParagraphs[3]?.length).toBeLessThan(longThird.length);
    // With no title in the payload, the stored one is what the prompt calls the source title.
    expect(payload.data.sourceTitle).toBe(longTitle);

    const prompt = turnsOf(chatCalls(calls)[0]).user?.content ?? "";
    expect(prompt.startsWith(expectedPrompt("繁体中文", longTitle, sourceParagraphs))).toBe(true);
    expect(prompt).toContain("JSON schema:");
  });

  it("answers 400 with the runtime's code when the model has no credential, and writes nothing", async () => {
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const before = await getContentItem(fixture.target.id);
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;
    // The user removed the key after the model had been discovered: routing is now unroutable.
    await credentials.clearCredential(credentials.credentialRefFor("qwen"));

    const response = await translate(fixture.target.id, sourcePayload());
    const payload = await response.json();

    expect(response.status).toBe(400);
    // The code is the runtime's - this route recognises no error class of its own any more.
    expect(payload.code).toBe("MODEL_CREDENTIAL_MISSING");
    // The old contract was a 502 carrying `MissingAIKeyError`'s message; the message now explains the
    // routing, which is the D-P3-3 trade this batch makes, and the envelope is unchanged.
    expect(payload.message).not.toContain("Missing qwen API key");
    expect(payload.message).toContain("credential");
    expect(payload.error).toBe(payload.message);
    // Nothing was attempted, and the failure happens before any row is written.
    expect(chatCalls(calls)).toEqual([]);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
    expect(await getContentItem(fixture.target.id)).toEqual(before);
  });

  it("answers 404 for an unknown article before it parses the payload or asks the runtime", async () => {
    const calls = stubFetch([]);
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;

    const missing = await translate("no-such-article", sourcePayload());
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("NOT_FOUND");

    // The article is read before the payload is parsed, so even a body this route would reject is a 404.
    const bogus = await translate("no-such-article", {});
    expect(bogus.status).toBe(404);

    // No model was configured or asked, and the stub would have answered an unplanned call with a loud
    // 404 instead of silence.
    expect(calls).toEqual([]);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
  });

  it("keeps the 400 guards it still words itself, and validates before it asks anything", async () => {
    const calls = stubFetch([]);

    // No target language at all.
    const noLanguage = await translate(fixture.target.id, {});
    expect(noLanguage.status).toBe(400);
    const noLanguagePayload = await noLanguage.json();
    expect(noLanguagePayload.code).toBe("INVALID_PAYLOAD");
    expect(noLanguagePayload.message).toBe("Invalid payload");

    // A language that is blank once trimmed, and a body that is not JSON at all: the same 400.
    const blankLanguage = await translate(fixture.target.id, { targetLanguage: "   " });
    expect(blankLanguage.status).toBe(400);
    expect((await blankLanguage.json()).code).toBe("INVALID_PAYLOAD");

    const notJson = await POST(new Request(translateUrl(fixture.target.id), { method: "POST", body: "not json" }), {
      params: Promise.resolve({ id: fixture.target.id }),
    });
    expect(notJson.status).toBe(400);
    expect((await notJson.json()).code).toBe("INVALID_PAYLOAD");

    // An article with nothing to translate: `text` falls back to the stored body, which is empty.
    const empty = await translate(fixture.empty.id, { targetLanguage: "English" });
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

  it("answers 502 for a schema-valid answer whose paragraphs are blank, and records no usage", async () => {
    let attempts = 0;
    stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      {
        match: (target) => target.includes("/chat/completions"),
        // Schema-valid - one whitespace-only paragraph - so the runtime accepts it on the first try and the
        // route's own trim/filter is what empties the result.
        respond: () => {
          attempts += 1;
          return jsonReply({ title: draftTitle, paragraphs: ["   "] });
        },
      },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const before = await getContentItem(fixture.target.id);
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;

    const response = await translate(fixture.target.id, sourcePayload());
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(attempts).toBe(1);
    expect(payload.code).toBe("UNKNOWN_ERROR");
    expect(payload.message).toBe("EMPTY_RESULT");
    // The guard sits before the usage row, so a run that produced nothing to translate records nothing.
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
    expect(await getContentItem(fixture.target.id)).toEqual(before);
  });

  it("keeps the runtime's single corrective retry, and reports the usage of both answers", async () => {
    let attempt = 0;
    const calls = stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      {
        match: (target) => target.includes("/chat/completions"),
        // The first answer forgets the paragraph array, which `articleTranslationSchema` rejects; the
        // second one is usable, so the route answers from the corrected one.
        respond: () => {
          attempt += 1;
          return attempt === 1 ? jsonReply({ title: draftTitle }) : jsonReply(draft);
        },
      },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const response = await translate(fixture.target.id, sourcePayload());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.title).toBe(draftTitle);
    expect(payload.data.paragraphs).toEqual(draftParagraphs);
    expect(payload.data.provider).toBe("qwen");
    expect(payload.data.model).toBe("qwen3-max");

    // Two calls: the rejected answer, then the correction turn the runtime appends to the same prompt.
    expect(chatCalls(calls)).toHaveLength(2);
    const retry = turnsOf(chatCalls(calls)[1]);
    expect(retry.roles).toEqual(["system", "user", "assistant", "user"]);
    expect(retry.system?.content).toBe(translatorSystemPrompt);
    expect(retry.user?.content?.startsWith(expectedPrompt("English", editorTitle, editorParagraphs))).toBe(true);

    // The usage row reports both attempts merged, exactly as the runtime reports them.
    const usage = (await listUsageRecords({ limit: 10 })).find((row) => row.contentItemId === fixture.target.id);
    expect(usage).toMatchObject({ inputTokens: 22, outputTokens: 14, totalTokens: 36 });
  });

  it("answers the gate's own 402 instead of translating, and records nothing", async () => {
    // The model is configured through a catalog read first, then the transport is emptied: from this point
    // on, any call this request makes is one the case will see.
    stubFetch([
      { match: (target) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    await refuseEveryAiBudgetCall();
    const calls = stubFetch([]);
    const usageBefore = (await listUsageRecords({ limit: 500 })).length;

    const response = await translate(fixture.target.id, sourcePayload());
    const payload = await response.json();

    // A refusal is not a provider failure: the 502 catch above would have written a ledger row and a
    // "the provider failed" sentence for a request that was never sent.
    expect(response.status).toBe(402);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("AI_BUDGET_EXCEEDED");
    expect(payload.data).toBeUndefined();
    expect(calls).toEqual([]);
    expect((await listUsageRecords({ limit: 500 })).length).toBe(usageBefore);
  });
});

/**
 * CI-P7-05-03 (remaining surface): the Marketplace extension these ledger rows ran as.
 *
 * 翻译 arrives with an article id and a dialog that names no listing, so the only attribution this route
 * can state is the one the article's own stored provenance holds - the same answer 改写 gets, because
 * both read it through `marketplaceExtensionIdOfContentItem()`. What is pinned here is that the stored
 * provenance reaches the rows, on *every* row of the call (a self-correcting re-ask is two rows), and
 * that an article naming nothing stays unattributed rather than inheriting an identity from the request.
 */
describe("POST /api/content/[id]/translate and the Marketplace extension it ran as (CI-P7-05-03)", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    // The budget row is stored, not runtime state, so `resetRuntime()` does not clear the refusal the
    // file's own gate case leaves behind - and every case here expects the call to really go out.
    await allowEveryAiBudgetCall();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A published positioning, as the storefront lists it: the record its 我的 tab answers with. */
  async function publishedPosition(name: string) {
    const position = await createPosition({ name });
    if (!position) throw new Error("the published fixture was not created");
    await updatePosition(position.id, { store: { ...position.store, status: "published" } });
    return position;
  }

  /** One stored article, with exactly the provenance a generation would have written on it. */
  async function storedArticle(metadata: Record<string, unknown>) {
    const item = await createContentItem({
      title: storedTitle,
      body: storedBody,
      postReadyText: htmlToPlainText(storedBody),
      metadata,
    });
    if (!item) throw new Error("the article fixture was not created");
    return item;
  }

  /** The rows one request wrote, told apart from the ledger's earlier content by id. */
  async function rowsWrittenBy(run: () => Promise<Response>, routes: Parameters<typeof stubFetch>[0]) {
    stubFetch(routes);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const before = new Set((await listAiUsageLedgerEntries({ limit: 500 })).map((row) => row.id));

    const response = await run();
    expect(response.status).toBe(200);

    return (await listAiUsageLedgerEntries({ limit: 500 })).filter((row) => !before.has(row.id));
  }

  const oneAnswer = [
    { match: (target: string) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
    { match: (target: string) => target.includes("/chat/completions"), respond: () => jsonReply(draft) },
  ];

  it("attributes the translation to the published position the article was written as", async () => {
    const position = await publishedPosition("已上架的翻译顾问");
    const item = await storedArticle({ positioningId: position.id });

    const rows = await rowsWrittenBy(() => translate(item.id, sourcePayload()), oneAnswer);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.purpose === "content-translate")).toBe(true);
    // The article being translated is this call's business identity, and the listing joins it.
    expect(rows.every((row) => row.contentItemId === item.id)).toBe(true);
    expect(rows.every((row) => row.extensionId === `position-${position.id}`)).toBe(true);
  });

  it("attributes both rows of a self-correcting re-ask, because both requests were really sent", async () => {
    const position = await publishedPosition("已上架的翻译顾问二号");
    const item = await storedArticle({ positioningId: position.id });
    let answer = 0;
    const retrying = [
      ...oneAnswer.slice(0, 1),
      {
        match: (target: string) => target.includes("/chat/completions"),
        // The first answer forgets the paragraph array and is rejected; the correction turn is a second
        // request, and a second charge, so it is a second row of the *same* call.
        respond: () => {
          answer += 1;
          return answer === 1 ? jsonReply({ title: draftTitle }) : jsonReply(draft);
        },
      },
    ];

    const rows = await rowsWrittenBy(() => translate(item.id, sourcePayload()), retrying);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.extensionId === `position-${position.id}`)).toBe(true);
  });

  it("leaves an article whose provenance names no listing unattributed", async () => {
    // The position the generation resolved is a draft; `general` is the picker's own default and not a
    // catalogue listing. Neither can be named, so the rows stay unattributed instead of claiming one.
    const draftPosition = await createPosition({ name: "未上架的翻译定位" });
    if (!draftPosition) throw new Error("the draft fixture was not created");
    const pickerOnly = await storedArticle({ positioningId: draftPosition.id, agentId: "general" });
    const bare = await storedArticle({});

    for (const item of [pickerOnly, bare]) {
      const rows = await rowsWrittenBy(() => translate(item.id, sourcePayload()), oneAnswer);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.extensionId === "")).toBe(true);
      expect(rows.every((row) => row.contentItemId === item.id)).toBe(true);
    }
  });
});
