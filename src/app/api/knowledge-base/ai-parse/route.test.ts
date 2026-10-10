import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `api/knowledge-base/ai-parse` on `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`).
 *
 * The "Smart import" dialog posts one paste and expects one knowledge entry back. The route asks a model
 * to structure it, and - this is what separates it from the rest of batch A3-2 - falls back to
 * `parseKnowledgeFromRawText()` for *any* AI failure: nothing configured, no usable credential, a provider
 * that is down, an answer that failed the schema twice. Every one of those answers HTTP 201 with
 * `source: "fallback"`, so a paste is never lost to a missing key. So this file pins two contracts at
 * once: the AI path (what was asked, what the answer was normalised into, what was written) and the
 * fallback path (which failures really reach it, that the runtime's own code/status never reaches the
 * client, and that no half-parsed answer is ever stored).
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
const { getKnowledgeBase, listKnowledgeBase } = await import("@/db/repositories/knowledge-base");
const { listUsageRecords } = await import("@/db/repository");
const { guessKnowledgeCategory, parseKnowledgeFromRawText } = await import("@/lib/knowledge-base");
const { countTextCharacters } = await import("@/lib/usage");

const parseUrl = "http://localhost/api/knowledge-base/ai-parse";

/** The dialog's request. */
const parse = (body: unknown) => POST(jsonRequest(parseUrl, body));

/** The route's own system turn, mirrored so the case can pin it byte for byte. */
const knowledgeSystemPrompt = [
  "你是知识库整理助手，负责把用户粘贴的原始内容（文章、网页正文、笔记、聊天记录等）结构化为一条知识条目。",
  "字段要求：title 为 24 字以内、能概括内容的知识标题；",
  "content 为整理后的正文，保留关键事实与数据，去除导航、广告、页脚等噪音，使用简体中文；",
  "category 只能取以下之一：product（产品）、industry（行业）、brand（品牌）、faq（常见问答）、formula（配方）、reference（参考资料）、other（其他）；",
  "weight 只能取 high、medium、low 之一，表示检索权重；",
  "tags 为 0-6 个简短的标签。",
].join("\n");

/**
 * The paste: a spec sheet lifted from a web page, so its first line carries the page's own noise. That
 * first line is exactly what the local parse would call the title, which is how the cases below can tell
 * the model's entry apart from the fallback's.
 */
const raw = [
  "X10 扫地机器人｜官方资料（来自官网，含导航与页脚）",
  "吸力：8000Pa",
  "电池：5200mAh，续航 180 分钟",
  "官方建议：每周清理一次滚刷。",
].join("\n");

/** What the local parse would produce for that paste. */
const localDraft = parseKnowledgeFromRawText(raw);

/** A model answer that understood `aiKnowledgeSchema`, padded so the normalisation is visible. */
const draft = {
  title: "  X10 扫地机器人参数速查  ",
  content: "  吸力 8000Pa；电池 5200mAh，续航 180 分钟；官方建议每周清理一次滚刷。  ",
  category: "product",
  weight: "high",
  tags: [" 扫地机器人 ", "", "参数  ", "  清洁  "],
};
const draftTitle = "X10 扫地机器人参数速查";
const draftContent = "吸力 8000Pa；电池 5200mAh，续航 180 分钟；官方建议每周清理一次滚刷。";
const draftTags = ["扫地机器人", "参数", "清洁"];

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
 * Row identities, so a case can talk about what *it* wrote: `resetRuntime()` clears the runtime's own
 * tables, and the knowledge base and the usage log are this file's business tables - they keep the rows
 * of every earlier case.
 */
const knowledgeIds = async () => new Set((await listKnowledgeBase()).map((entry) => entry.id));
const usageIds = async () => new Set((await listUsageRecords({ limit: 500 })).map((row) => row.id));
const usageSince = async (before: Set<string>) =>
  (await listUsageRecords({ limit: 500 })).filter((row) => !before.has(row.id));
const entriesSince = async (before: Set<string>) =>
  (await listKnowledgeBase()).filter((entry) => !before.has(entry.id));

describe("POST /api/knowledge-base/ai-parse on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers 201 with the structured entry, the provider/model the runtime used and one usage row", async () => {
    const calls = stubFetch([qwenModels, chatCompletions(() => jsonReply(draft))]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const usageBefore = await usageIds();

    const response = await parse({ content: raw, positionId: "position-1" });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.data.source).toBe("ai");
    // The AI envelope carries the provider pair; the fallback below does not have one to carry.
    expect(Object.keys(payload.data).sort()).toEqual(["item", "model", "provider", "source"]);
    expect(payload.data.provider).toBe("qwen");
    expect(payload.data.model).toBe("qwen3-max");

    // The entry is normalised, not passed through: trimmed title and body, trimmed non-empty tags ...
    expect(payload.data.item).toMatchObject({
      title: draftTitle,
      content: draftContent,
      category: "product",
      weight: "high",
      origin: "ai",
      enabled: true,
      tags: draftTags,
      positionId: "position-1",
    });
    // ... and it is the model's title, not the paste's first line, which is what the local parse would use.
    expect(payload.data.item.title).not.toBe(localDraft.title);
    // What the dialog's list reads is the same row.
    expect(await getKnowledgeBase(payload.data.item.id)).toEqual(payload.data.item);

    // One structured call: the runtime's model, on the runtime's JSON channel ...
    expect(chatCalls(calls)).toHaveLength(1);
    const wire = bodyOf(chatCalls(calls)[0]);
    expect(wire.model).toBe("qwen3-max");
    expect(wire.response_format).toEqual({ type: "json_object" });
    const turns = turnsOf(chatCalls(calls)[0]);
    expect(turns.roles).toEqual(["system", "user"]);
    expect(turns.system?.content).toBe(knowledgeSystemPrompt);
    // ... and the route's own prompt in the user turn, where the runtime appends the schema instruction.
    const prompt = turns.user?.content ?? "";
    expect(prompt.startsWith(`请把以下原始内容整理成一条知识条目：\n\n${raw}`)).toBe(true);
    expect(prompt).toContain("JSON schema:");

    // The usage row records the runtime's report, plus the character count of the *answer*.
    const written = await usageSince(usageBefore);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      provider: "qwen",
      model: "qwen3-max",
      kind: "knowledge",
      status: "success",
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      wordCount: countTextCharacters(draft.content),
    });
    expect(written[0].wordCount).not.toBe(countTextCharacters(raw));
  });

  it("caps the paste at 8000 characters, and stores the answer rather than the paste", async () => {
    const calls = stubFetch([qwenModels, chatCompletions(() => jsonReply(draft))]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    // 12 characters per repetition: well past the cap, with a marker that only exists beyond it.
    const longRaw = `${"X10 扫地机器人参数。".repeat(700)}SENTINEL-AFTER-CAP`;
    const response = await parse({ content: longRaw });
    const payload = await response.json();

    expect(response.status).toBe(201);
    const prompt = turnsOf(chatCalls(calls)[0]).user?.content ?? "";
    expect(prompt.startsWith(`请把以下原始内容整理成一条知识条目：\n\n${longRaw.slice(0, 8000)}`)).toBe(true);
    expect(prompt).not.toContain("SENTINEL-AFTER-CAP");

    // The paste is not the entry: the stored body is the model's, and the capped tail is nowhere.
    expect(payload.data.item.title).toBe(draftTitle);
    expect(payload.data.item.content).toBe(draftContent);
    expect(payload.data.item.content).not.toContain("SENTINEL-AFTER-CAP");
  });

  it("normalises a badly-behaved answer instead of storing it verbatim", async () => {
    // The first answer ignores the vocabulary and leaves the body blank; the second leaves the title blank
    // while getting the vocabulary right.
    const rogue = {
      title: "  产品参数一览  ",
      content: "   ",
      category: "misc",
      weight: "urgent",
      tags: [" 参数 ", "", "   ", "产品", "a", "b", "c", "d", "e", "f", "g", "h"],
    };
    let attempt = 0;
    const calls = stubFetch([
      qwenModels,
      chatCompletions(() => {
        attempt += 1;
        return attempt === 1
          ? jsonReply(rogue)
          : jsonReply({ title: "   ", content: "", category: "faq", weight: "low", tags: [] });
      }),
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const first = (await (await parse({ content: raw })).json()).data.item;
    // An unknown category is guessed from what the model *did* answer, an unknown weight becomes "medium",
    // a blank body falls back to the paste, and the tags are trimmed, emptied out and capped at 8.
    expect(first).toMatchObject({
      title: "产品参数一览",
      content: raw.trim(),
      category: guessKnowledgeCategory("产品参数一览\n"),
      weight: "medium",
      origin: "ai",
      tags: ["参数", "产品", "a", "b", "c", "d", "e", "f"],
    });
    expect(first.category).toBe("product");
    expect(first.tags).toHaveLength(8);

    const second = (await (await parse({ content: raw })).json()).data.item;
    // A blank title becomes the deterministic local one; a known category/weight is kept as answered.
    expect(second).toMatchObject({
      title: localDraft.title,
      content: raw.trim(),
      category: "faq",
      weight: "low",
      tags: [],
    });

    // Two answers, two calls - and nothing about either was left half-applied.
    expect(chatCalls(calls)).toHaveLength(2);
  });

  it("falls back to the local parse when nothing is configured, without asking anyone", async () => {
    // Any provider call would be answered with a loud 404 instead of silence.
    const calls = stubFetch([]);
    const itemsBefore = await knowledgeIds();
    const usageBefore = await usageIds();

    const response = await parse({ content: raw });
    const payload = await response.json();

    // 201, not an error: the dialog has nothing to show and the paste must survive.
    expect(response.status).toBe(201);
    expect(payload.data.source).toBe("fallback");
    // No provider and no model in the envelope - the fallback never had a pair to report.
    expect(Object.keys(payload.data).sort()).toEqual(["item", "source"]);

    // The entry is the deterministic parse of the paste, with the paste's first line as its title.
    expect(payload.data.item).toMatchObject({
      title: localDraft.title,
      content: localDraft.content,
      category: localDraft.category,
      weight: "medium",
      origin: "ai",
      enabled: true,
      tags: [],
      positionId: "",
    });
    const created = await entriesSince(itemsBefore);
    expect(created).toHaveLength(1);
    expect(created[0].id).toBe(payload.data.item.id);

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

    const response = await parse({ content: raw });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.source).toBe("fallback");
    expect(payload.data.item.title).toBe(localDraft.title);
    // No error envelope at all: the runtime's code and status stop at this route (D-P3-3 does not apply here).
    expect(payload.code).toBeUndefined();
    // The pool refused before a request existed, and nothing was billed for a parse that never happened.
    expect(chatCalls(calls)).toEqual([]);
    expect(await usageSince(usageBefore)).toEqual([]);
  });

  it("falls back when the provider itself fails, after exactly one attempt", async () => {
    const calls = stubFetch([qwenModels, chatCompletions(unavailable)]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const itemsBefore = await knowledgeIds();
    const usageBefore = await usageIds();

    const response = await parse({ content: raw });
    const payload = await response.json();

    // The runtime's `MODEL_UPSTREAM_FAILED` (502) never becomes this route's answer either.
    expect(response.status).toBe(201);
    expect(payload.data.source).toBe("fallback");
    expect(payload.data.item.title).toBe(localDraft.title);
    // One enabled model and one key: the failure is reported after that single attempt.
    expect(chatCalls(calls)).toHaveLength(1);
    expect(await usageSince(usageBefore)).toEqual([]);
    const created = await entriesSince(itemsBefore);
    expect(created).toHaveLength(1);
    expect(created[0].content).toBe(localDraft.content);
  });

  it("falls back after a schema-invalid answer on both attempts, and stores nothing half-parsed", async () => {
    let attempts = 0;
    const calls = stubFetch([
      qwenModels,
      chatCompletions(() => {
        attempts += 1;
        // Schema-valid JSON, wrong shape: `aiKnowledgeSchema` rejects it, so the runtime retries once.
        return jsonReply({ title: "只有标题" });
      }),
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const itemsBefore = await knowledgeIds();
    const usageBefore = await usageIds();

    const response = await parse({ content: raw });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.source).toBe("fallback");
    // Both attempts happened (the runtime's own corrective retry), and both were refused.
    expect(attempts).toBe(2);
    expect(chatCalls(calls)).toHaveLength(2);
    // The rejected answer is nowhere: the entry is the local parse, not a title with no body.
    expect(payload.data.item.title).toBe(localDraft.title);
    expect(payload.data.item.content).toBe(localDraft.content);
    expect(payload.data.item.title).not.toContain("只有标题");
    const created = await entriesSince(itemsBefore);
    expect(created).toHaveLength(1);
    expect(await usageSince(usageBefore)).toEqual([]);
  });

  it("keeps answering 400 for an unusable payload, and never falls back for one", async () => {
    // Nothing configured *and* an empty transport: a guard that ran late would have to call someone.
    const calls = stubFetch([]);
    const itemsBefore = await knowledgeIds();
    const usageBefore = await usageIds();

    const missing = await parse({});
    const blank = await parse({ content: "   " });
    const notJson = await POST(new Request(parseUrl, { method: "POST", body: "not json" }));

    for (const response of [missing, blank, notJson]) {
      const payload = await response.json();
      // The route's own message and code - not a fallback, and not a runtime code.
      expect(response.status).toBe(400);
      expect(payload.ok).toBe(false);
      expect(payload.code).toBe("INVALID_PAYLOAD");
      expect(payload.message).toBe("Invalid payload");
    }

    // Validation comes first: no model was configured or asked, and no entry was written.
    expect(calls).toEqual([]);
    expect(await entriesSince(itemsBefore)).toEqual([]);
    expect(await usageSince(usageBefore)).toEqual([]);
  });

  it("answers with the model when no capability default is set, instead of falling back", async () => {
    const calls = stubFetch([qwenModels, chatCompletions(() => jsonReply(draft))]);
    // A credential and one enabled model - the state a catalog sync leaves behind - but no `chat` or
    // `structured_output` default: routing has to reach this model by capability alone.
    await prepareModel("qwen", "qwen3-max", "sk-stub-qwen");

    const response = await parse({ content: raw });
    const payload = await response.json();

    expect(payload.data.source).toBe("ai");
    expect(payload.data.provider).toBe("qwen");
    expect(payload.data.model).toBe("qwen3-max");
    expect(payload.data.item.title).toBe(draftTitle);
    expect(chatCalls(calls)).toHaveLength(1);
  });

  it("answers the gate's own 402 instead of falling back to the local parse, and stores nothing", async () => {
    // The model is configured through a catalog read first, then the transport is emptied: from this point
    // on, any call this request makes is one the case will see.
    stubFetch([qwenModels]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    await refuseEveryAiBudgetCall();
    const calls = stubFetch([]);
    const knowledgeBefore = await knowledgeIds();
    const usageBefore = await usageIds();

    const response = await parse({ content: raw });
    const payload = await response.json();

    // The fallback exists for an AI that failed; a refusal is not one, and the gate stands outside that
    // try. Answering 201 with a locally parsed entry would report work this route never did.
    expect(response.status).toBe(402);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("AI_BUDGET_EXCEEDED");
    expect(calls).toEqual([]);
    expect(await entriesSince(knowledgeBefore)).toEqual([]);
    expect(await usageSince(usageBefore)).toEqual([]);
  });
});
