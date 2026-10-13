import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The knowledge index's HTTP entry (CI-EMB-01, D10).
 *
 *   POST /api/knowledge-base/embeddings -> create a task, start it here, answer where to poll
 *   GET  /api/knowledge-base/embeddings -> the index's state and the recent tasks, spending nothing
 *
 * The two things this file is about are the two things a route can get wrong on top of the layers beneath it:
 * the *envelope* (`taskId` + `lookup`, a 201 for a new task and a 200 for a reused one) and the fact that `GET`
 * is a read - it resolves the model it would use and reports the index, without calling a provider or writing a
 * row.
 */
const {
  allowEveryAiBudgetCall,
  embeddingCalls,
  embeddingRoute,
  jsonRequest,
  jsonResponse,
  prepareEmbeddingModel,
  resetRuntime,
  stubFetch,
} = await import("@/test/route-harness");
const { GET, POST } = await import("./route");
const { createKnowledgeBase } = await import("@/db/repositories/knowledge-base");
const { listKnowledgeChunks } = await import("@/db/repositories/knowledge-embeddings");
const { findTaskView } = await import("@/lib/tasks/task-library");

/** The catalog the fixture's sync reads: one embedding model, so it can be enabled. */
const catalogRoute = {
  match: (url: string) => url.endsWith("/models"),
  respond: () => jsonResponse({ data: [{ id: "text-embedding-v4" }] }),
};

const request = (body: unknown) => jsonRequest("http://localhost/api/knowledge-base/embeddings", body);

/** Polls the task system the way the console does, until the run reaches a terminal status. */
async function settle(taskId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const view = await findTaskView(taskId);
    if (view && view.status !== "queued" && view.status !== "running") return view;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`the task ${taskId} never settled`);
}

describe("knowledge embeddings route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a task, runs it and answers with where to poll", async () => {
    await resetRuntime();
    await allowEveryAiBudgetCall();
    stubFetch([catalogRoute, embeddingRoute([[1, 0]])]);
    await prepareEmbeddingModel("qwen", "text-embedding-v4", "sk-stub");
    const record = await createKnowledgeBase({ title: "要去向量化的知识", content: "甲。" });
    if (!record) throw new Error("the knowledge fixture was not created");

    const payload = { scope: "stale", idempotencyKey: "route-test-key" };
    const response = await POST(request(payload));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { taskId: string; lookup: string; reused: boolean; started: boolean } };
    expect(body.data.reused).toBe(false);
    expect(body.data.started).toBe(true);
    expect(body.data.lookup).toBe(`/api/tasks/${body.data.taskId}`);

    // The entry really runs the task: the record ends up with a vector, and the task reports success.
    const view = await settle(body.data.taskId);
    // `succeeded` is the task view's word for the run's `success` (CI-P1-02's vocabulary).
    expect(view.status).toBe("succeeded");
    expect(await listKnowledgeChunks(record.id)).toHaveLength(1);

    // The *same* submission answers with the same task and a 200 - the key decides, whatever the status.
    const again = await POST(request(payload));
    expect(again.status).toBe(200);
    const reused = (await again.json()) as { data: { taskId: string; reused: boolean; started: boolean } };
    expect(reused.data).toMatchObject({ taskId: body.data.taskId, reused: true, started: false });
  });

  it("reads the index's state without spending anything", async () => {
    await resetRuntime();
    await allowEveryAiBudgetCall();
    const calls = stubFetch([catalogRoute, embeddingRoute([[1, 0]])]);
    await prepareEmbeddingModel("qwen", "text-embedding-v4", "sk-stub");
    await createKnowledgeBase({ title: "读数用", content: "乙。" });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        model: { providerId: string; modelId: string } | null;
        summary: { records: number; pending: number } | null;
        tasks: unknown[];
      };
    };
    expect(body.data.model).toEqual({ providerId: "qwen", modelId: "text-embedding-v4" });
    expect(body.data.summary?.records).toBeGreaterThan(0);
    expect(body.data.summary?.pending).toBeGreaterThan(0);
    // A read that spent nothing: no embeddings request was made to answer it.
    expect(embeddingCalls(calls)).toHaveLength(0);
  });

  it("says the index cannot be read rather than reporting an empty one", async () => {
    await resetRuntime();
    await allowEveryAiBudgetCall();
    stubFetch([catalogRoute]);

    const response = await GET();
    const body = (await response.json()) as { data: { model: unknown; summary: unknown; missing: string[] } };
    // No model can embed here, so there is nothing to report - and the answer names the capability instead of
    // pretending the index holds nothing.
    expect(body.data.model).toBeNull();
    expect(body.data.summary).toBeNull();
    expect(body.data.missing).toContain("embedding");
  });

  it("refuses a payload that is not an index request", async () => {
    await resetRuntime();
    const response = await POST(request({ scope: "everything" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; ok: boolean };
    // The API's own envelope: `ok: false` plus the error's code and message (never a bare string).
    expect(body.ok).toBe(false);
    expect(body.code).toBe("INVALID_PAYLOAD");
  });
});