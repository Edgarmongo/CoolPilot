import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiWritingMaterial } from "@/lib/ai-writing";
import type { KnowledgeBaseRecord } from "@/lib/types";

/**
 * The query side of the semantic mode (CI-EMB-01, D8/D9), against a throwaway database and a stubbed provider.
 *
 * `src/lib/knowledge-base.test.ts` already pins the *ranking*; what is left for this file is the business half:
 * the query text is built from the request and nothing else, the query embedding is a call of its own with its
 * own ledger row, and the ways it can go wrong end differently - a provider problem degrades to the keyword
 * selector, an index that cannot answer degrades the same way, and a *budget refusal* refuses the whole
 * operation instead of bypassing the gate.
 */
const {
  allowEveryAiBudgetCall,
  embeddingCalls,
  embeddingRoute,
  jsonResponse,
  prepareEmbeddingModel,
  refuseEveryAiBudgetCall,
  resetRuntime,
  stubFetch,
} = await import("@/test/route-harness");
const { knowledgeQueryText, recallKnowledgeForArticle } = await import("./recall");
const { chunkKnowledgeBody } = await import("./embedding");
const { knowledgeChunkHash, knowledgeSourceHash } = await import("./source");
const { createKnowledgeBase, getKnowledgeBase, updateKnowledgeBase } = await import("@/db/repositories/knowledge-base");
const { replaceKnowledgeChunks } = await import("@/db/repositories/knowledge-embeddings");
const { listAiUsageLedgerEntries } = await import("@/db/repositories/ai-usage-ledger");

const model = { providerId: "qwen", modelId: "text-embedding-v4" };
/** The vector the stub provider answers every query with: "the title is about storage boxes". */
const queryVector = [1, 0, 0];

const material: AiWritingMaterial = {
  topics: [{ title: "换季收纳", source: "weibo", url: "https://example.com/t" }],
  products: [
    { name: "折叠收纳箱", brand: "CoolPilot", category: "家居", keywords: ["可折叠"], description: "", linkUrl: "" },
  ],
  freeText: "自研扣具，三年质保。",
};

const titleFallback = "换季收纳指南";

/**
 * The catalog the fixture's own sync reads: one embedding model, which is what makes `prepareEmbeddingModel()`
 * able to enable it.
 *
 * The route has to be here at all because `prepareEmbeddingModel()` syncs the provider catalog first, and a stub
 * without a `/models` route answers 404 - which the key pool records as a failed request and then refuses to
 * reuse the key for, so the *next* case's fixture would fail for a reason that has nothing to do with it.
 */
const catalogRoute = {
  match: (url: string) => url.endsWith("/models"),
  respond: () => jsonResponse({ data: [{ id: "text-embedding-v4" }] }),
};

/** A knowledge record that really exists, so each case reads as its own statement. */
async function makeRecord(title: string, content: string) {
  const record = await createKnowledgeBase({ title, content });
  if (!record) throw new Error("the knowledge fixture was not created");
  return record;
}

/** Indexes one record for real: the same chunking, hashes and writer the batch task uses. */
async function indexRecord(record: KnowledgeBaseRecord, vectors: number[][]) {
  const chunks = chunkKnowledgeBody(record.content);
  await replaceKnowledgeChunks(
    record.id,
    model,
    chunks.map((text, index) => ({
      chunkIndex: index,
      text,
      chunkHash: knowledgeChunkHash(text),
      sourceHash: knowledgeSourceHash(record),
      dimensions: vectors[index].length,
      vector: vectors[index],
    })),
  );
}

/** The knowledge rows a recall may read, in the shape `listKnowledgeBase()` hands them over. */
const recall = (entries: KnowledgeBaseRecord[], queryText = knowledgeQueryText({ material, titleFallback })) =>
  recallKnowledgeForArticle({ entries, positioningId: null, queryText });

/** This call's own ledger rows (the dimension is its own, which is the point). */
async function knowledgeRows() {
  return (await listAiUsageLedgerEntries()).filter((row) => row.purpose === "knowledge");
}

describe("semantic knowledge recall", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the query from the request, embeds it and answers from the index", async () => {
    await resetRuntime();
    await allowEveryAiBudgetCall();
    const calls = stubFetch([catalogRoute, embeddingRoute([queryVector])]);
    await prepareEmbeddingModel("qwen", "text-embedding-v4", "sk-stub");

    const relevant = await makeRecord("收纳箱选型", "先量柜内径，再看承重。");
    const unrelated = await makeRecord("冷链运输", "全程零下十八度。");
    await indexRecord(relevant, [[1, 0, 0]]);
    await indexRecord(unrelated, [[0, 1, 0]]);

    const outcome = await recall([relevant, unrelated]);

    expect(outcome.source).toBe("semantic");
    expect(outcome.fallbackReason).toBe("");
    expect(outcome.model).toBe("text-embedding-v4");
    expect(outcome.compared).toBe(2);
    // Only the entry the query really is about, rendered in the shape the prompt already reads.
    expect(outcome.references).toEqual([`【收纳箱选型】${relevant.content.slice(0, 300)}`]);

    // The query text is the request's own facts, and the model was asked exactly once.
    expect(embeddingCalls(calls)).toHaveLength(1);
    const body = JSON.parse(String(embeddingCalls(calls)[0]?.init?.body)) as { input: string[] };
    expect(body.input).toHaveLength(1);
    expect(body.input[0]).toContain(`标题：${titleFallback}`);
    expect(body.input[0]).toContain("产品：折叠收纳箱、CoolPilot、家居、可折叠");
    expect(body.input[0]).toContain("素材：自研扣具，三年质保。");

    // D8: the query call is its own ledger row, in its own dimension - never a `text` row.
    const rows = (await listAiUsageLedgerEntries()).filter((entry) => entry.purpose === "knowledge");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      meteredKind: "embedding",
      outcome: "success",
      completeness: "reported",
      modelId: "text-embedding-v4",
      providerId: "qwen",
    });
    // No price is on file for an embedding call in this workspace, so the cost is NULL - not a zero a total
    // would read as "it was free".
    expect(rows[0].costAmount).toBeNull();
  });

  it("degrades to the keyword selection when nothing can embed, and says why", async () => {
    await resetRuntime();
    await allowEveryAiBudgetCall();
    const calls = stubFetch([]);
    const entry = await makeRecord("平台规则", "标题不超过 20 字。");
    const billed = (await knowledgeRows()).length;

    const outcome = await recall([entry]);

    expect(outcome).toMatchObject({ source: "position", fallbackReason: "provider-unavailable" });
    // The keyword selector answered, exactly as it does in `position` mode.
    expect(outcome.references).toEqual([`【平台规则】${entry.content.slice(0, 300)}`]);
    // Nothing was sent, so nothing was billed and nothing was logged.
    expect(embeddingCalls(calls)).toHaveLength(0);
    expect((await knowledgeRows()).length).toBe(billed);
  });

  it("ignores a stale vector instead of matching it, and degrades with its own reason", async () => {
    await resetRuntime();
    await allowEveryAiBudgetCall();
    stubFetch([catalogRoute, embeddingRoute([queryVector])]);
    await prepareEmbeddingModel("qwen", "text-embedding-v4", "sk-stub");

    const entry = await makeRecord("会过期的知识", "原始的正文。");
    await indexRecord(entry, [[1, 0, 0]]);
    // The body moves on: the stored vector now describes text the user no longer has.
    await updateKnowledgeBase(entry.id, { content: "改过的正文，完全换了内容。" });
    const updated = await getKnowledgeBase(entry.id);
    if (!updated) throw new Error("the knowledge fixture vanished");

    const outcome = await recall([updated]);

    expect(outcome).toMatchObject({ source: "position", fallbackReason: "no-compatible-vectors" });
  });

  it("refuses the whole operation on a budget refusal instead of bypassing the gate", async () => {
    await resetRuntime();
    await refuseEveryAiBudgetCall();
    const calls = stubFetch([catalogRoute, embeddingRoute([queryVector])]);
    await prepareEmbeddingModel("qwen", "text-embedding-v4", "sk-stub");
    const entry = await makeRecord("预算拒绝", "甲。");
    const billed = (await knowledgeRows()).length;

    const failure: unknown = await recall([entry]).catch((error: unknown) => error);

    // D9: a refusal is not a fallback. The gate's own error travels out, so the caller answers 402 rather than
    // completing the work without the knowledge the user asked for.
    expect(failure).toMatchObject({ code: "AI_BUDGET_EXCEEDED" });
    expect(embeddingCalls(calls)).toHaveLength(0);
    expect((await knowledgeRows()).length).toBe(billed);
    await allowEveryAiBudgetCall();
  });

  it("asks nothing - and does not consult the budget - when the request has nothing to query with", async () => {
    await resetRuntime();
    await refuseEveryAiBudgetCall();
    const calls = stubFetch([]);
    const entry = await makeRecord("空查询", "甲。");

    const outcome = await recall([entry], "   ");

    expect(outcome).toMatchObject({ source: "position", fallbackReason: "empty-query" });
    expect(calls).toHaveLength(0);
    await allowEveryAiBudgetCall();
  });

  it("bounds the query text so a long material cannot push the title out", () => {
    const long: AiWritingMaterial = { topics: [], products: [], freeText: "很长的素材。".repeat(400) };
    const text = knowledgeQueryText({ material: long, titleFallback });
    expect(text.length).toBeLessThanOrEqual(600);
    expect(text.startsWith(`标题：${titleFallback}`)).toBe(true);
  });
});
