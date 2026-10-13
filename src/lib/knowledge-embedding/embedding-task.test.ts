import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The knowledge-index task (CI-EMB-01, D10), end to end against a throwaway database and a stubbed provider.
 *
 * What is pinned here is the task's own contract: it indexes what is stale, in batches, and writes the vectors
 * through the storage layer; it leaves a current index alone; it re-embeds an edited record and drops the chunk a
 * shorter body no longer has; a rebuild of the same work produces the same index rather than two; and a budget
 * refusal is the task's own `BUDGET_EXCEEDED` - named so the worker pauses the run instead of failing it.
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
const { createKnowledgeEmbeddingTask, executeKnowledgeEmbeddingTask, summarizeKnowledgeIndex } = await import(
  "./embedding-task"
);
const { createKnowledgeBase, updateKnowledgeBase } = await import("@/db/repositories/knowledge-base");
const { listKnowledgeChunks } = await import("@/db/repositories/knowledge-embeddings");
const { listAiUsageLedgerEntries } = await import("@/db/repositories/ai-usage-ledger");

const target = { providerId: "qwen", modelId: "text-embedding-v4" };

/** The catalog the fixture's sync reads: one embedding model, so `prepareEmbeddingModel()` can enable it. */
const catalogRoute = {
  match: (url: string) => url.endsWith("/models"),
  respond: () => jsonResponse({ data: [{ id: "text-embedding-v4" }] }),
};

/** A route with three vectors, so a batch of up to three chunk texts gets one each. */
const embedding = () => stubFetch([catalogRoute, embeddingRoute([[1, 0], [0, 1], [1, 1]])]);

/** One submission's whole life: create the task row, then execute it. */
async function runIndex(request: Record<string, unknown> = {}) {
  const { run, reused } = await createKnowledgeEmbeddingTask(request);
  const outcome = await executeKnowledgeEmbeddingTask(run.id);
  return { run, reused, outcome };
}

async function makeRecord(title: string, content: string) {
  const record = await createKnowledgeBase({ title, content });
  if (!record) throw new Error("the knowledge fixture was not created");
  return record;
}

describe("knowledge embedding task", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("indexes what is stale in batches and reports exactly what it wrote", async () => {
    await resetRuntime();
    await allowEveryAiBudgetCall();
    const calls = embedding();
    await prepareEmbeddingModel("qwen", "text-embedding-v4", "sk-stub");

    const first = await makeRecord("批量一", "第一段。");
    const second = await makeRecord("批量二", "第二段。");

    // One batch of two: two chunk texts in one provider request, which is what the batching is for.
    const { run, outcome } = await runIndex({ batchSize: 2 });
    expect(outcome.kind).toBe("succeeded");
    if (outcome.kind !== "succeeded") throw new Error("unreachable");
    expect(outcome).toMatchObject({ ...target, indexed: 2, chunks: 2, skipped: 0 });
    expect(run.playbookId).toBe("knowledge_embedding");

    expect(embeddingCalls(calls)).toHaveLength(1);
    const body = JSON.parse(String(embeddingCalls(calls)[0]?.init?.body)) as { input: string[] };
    expect(body.input).toHaveLength(2);
    // Every request is metered as its own embedding call, attributed to the run it belongs to.
    const rows = (await listAiUsageLedgerEntries()).filter((row) => row.runId === run.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ meteredKind: "embedding", purpose: "knowledge", outcome: "success" });

    // Both records got a real vector, and each got its own (the batch is read positionally).
    const [firstChunk] = await listKnowledgeChunks(first.id);
    const [secondChunk] = await listKnowledgeChunks(second.id);
    expect(firstChunk.vector).toHaveLength(2);
    expect(secondChunk.vector).toHaveLength(2);
    expect(firstChunk.vector).not.toEqual(secondChunk.vector);
  });

  it("leaves an index that is already current alone", async () => {
    await resetRuntime();
    await allowEveryAiBudgetCall();
    embedding();
    await prepareEmbeddingModel("qwen", "text-embedding-v4", "sk-stub");
    const record = await makeRecord("已经最新", "甲。\n\n乙。");
    await runIndex({ recordIds: [record.id] });

    const calls = embedding();
    const { outcome } = await runIndex({ recordIds: [record.id] });
    expect(outcome).toMatchObject({ kind: "succeeded", indexed: 0, skipped: 1 });
    // Nothing needed embedding, so nothing was asked and nothing was billed.
    expect(embeddingCalls(calls)).toHaveLength(0);
  });

  it("re-embeds an edited record and drops the chunk a shorter body no longer has", async () => {
    await resetRuntime();
    await allowEveryAiBudgetCall();
    embedding();
    await prepareEmbeddingModel("qwen", "text-embedding-v4", "sk-stub");
    // Long enough to be cut in two: the short paragraphs a fixture usually uses merge into one chunk.
    const record = await makeRecord("会编辑的知识", "甲。".repeat(500));
    await runIndex({ recordIds: [record.id] });
    expect(await listKnowledgeChunks(record.id)).toHaveLength(2);

    // Shorter: the trailing chunk has to go, or the index would still answer with text nobody has.
    await updateKnowledgeBase(record.id, { content: "只剩下这一段。" });
    const shorter = await runIndex({ recordIds: [record.id] });
    expect(shorter.outcome).toMatchObject({ indexed: 1, chunks: 1 });
    const chunks = await listKnowledgeChunks(record.id);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("只剩下这一段。");
  });

  it("is idempotent: a rebuild of the same records leaves one index", async () => {
    await resetRuntime();
    await allowEveryAiBudgetCall();
    embedding();
    await prepareEmbeddingModel("qwen", "text-embedding-v4", "sk-stub");
    const record = await makeRecord("重建两次", "乙。".repeat(500));

    await runIndex({ recordIds: [record.id] });
    const firstIds = (await listKnowledgeChunks(record.id)).map((chunk) => chunk.id);
    expect(firstIds).toHaveLength(2);
    const { outcome } = await runIndex({ recordIds: [record.id], scope: "rebuild" });

    // `rebuild` really re-embeds (that is the model-migration path), and the rows are the same rows.
    expect(outcome).toMatchObject({ indexed: 1, chunks: 2 });
    expect((await listKnowledgeChunks(record.id)).map((chunk) => chunk.id)).toEqual(firstIds);
  });

  it("fails with its own BUDGET_EXCEEDED code, and keeps what was already indexed", async () => {
    await resetRuntime();
    await allowEveryAiBudgetCall();
    embedding();
    await prepareEmbeddingModel("qwen", "text-embedding-v4", "sk-stub");
    const indexed = await makeRecord("先建好的", "甲。");
    await runIndex({ recordIds: [indexed.id] });
    const stored = (await listKnowledgeChunks(indexed.id)).map((chunk) => chunk.id);

    await refuseEveryAiBudgetCall();
    const pending = await makeRecord("被预算拒绝的", "乙。");
    const calls = embedding();
    const { outcome } = await runIndex({ recordIds: [pending.id, indexed.id] });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("unreachable");
    // The worker turns this code into a pause (CI-P7-03-B); it is deliberately not `EMBEDDING_FAILED`.
    expect(outcome.failure.code).toBe("BUDGET_EXCEEDED");
    expect(embeddingCalls(calls)).toHaveLength(0);
    // The record indexed before the refusal is untouched, and the refused one has no vectors at all.
    expect((await listKnowledgeChunks(indexed.id)).map((chunk) => chunk.id)).toEqual(stored);
    expect(await listKnowledgeChunks(pending.id)).toEqual([]);
    await allowEveryAiBudgetCall();
  });

  it("reads the index's state without spending anything", async () => {
    await resetRuntime();
    await allowEveryAiBudgetCall();
    embedding();
    await prepareEmbeddingModel("qwen", "text-embedding-v4", "sk-stub");
    const record = await makeRecord("摘要读数", "甲。");

    const before = await summarizeKnowledgeIndex(target);
    expect(before.pending).toBeGreaterThan(0);

    const calls = embedding();
    await runIndex({ recordIds: [record.id] });
    const after = await summarizeKnowledgeIndex(target);

    // The summary is a read: it made no provider call of its own, before or after.
    expect(embeddingCalls(calls)).toHaveLength(1);
    expect(after.ready).toBe(before.ready + 1);
    expect(after.chunks).toBeGreaterThanOrEqual(1);
  });
});
