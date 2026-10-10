import { describe, expect, it } from "vitest";

/**
 * CI-P7-02-04 / CI-P7-02-05 over HTTP: the data channel behind the 调用明细 tab.
 *
 * The arithmetic is pinned where it lives (`src/lib/ai-usage-ledger.test.ts`). What only this file
 * can check is what the route is responsible for: that one answer is one row per request including
 * the ones that failed, that a retry's type comes from the predecessor row the route looked up, that
 * a call's figure covers all of its requests, and that the business chain is resolved from real
 * records rather than filled in.
 *
 * The harness pins the temp database before anything that reads it loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
await import("@/test/route-harness");

const { GET } = await import("./route");
const { createAiUsageLedgerEntry } = await import("@/db/repositories/ai-usage-ledger");
const { createContentItem, createRun } = await import("@/db/repository");
const { usageRangeStart } = await import("@/lib/usage");

type CallsPayload = {
  ok: boolean;
  code?: string;
  data?: {
    range: number;
    from: number;
    to: number;
    filters: { purpose: string; outcome: string; costSource: string; model: string; retryOnly: boolean };
    scan: { rows: number; limit: number; truncated: boolean; traceCapped: boolean };
    matched: number;
    totals: {
      attempts: number;
      retries: number;
      costAmount: number;
      unpricedAttempts: number;
      unmeasuredAttempts: number;
      costIsComplete: boolean;
    };
    matchedCostByCurrency: Array<{ currency: string; amount: number; attempts: number }>;
    offset: number;
    limit: number;
    hasMore: boolean;
    calls: Array<{
      entry: {
        id: string;
        purpose: string;
        outcome: string;
        modelId: string;
        costAmount: number | null;
        costSource: string;
        costCurrency: string;
        credentialLabel: string;
      };
      quantity: Record<string, unknown>;
      retry: {
        kind: string;
        parent: { id: string; outcome: string; attemptIndex: number } | null;
        parentOutsideScan: boolean;
        changed: string[];
      };
      group: {
        rootId: string;
        attempts: number;
        failedRequests: number;
        index: number;
        costByCurrency: Array<{ currency: string; amount: number; attempts: number }>;
        unpricedAttempts: number;
        costIsComplete: boolean;
      };
      trace: {
        content: { id: string; title: string; status: string; found: boolean } | null;
        task: { id: string; kind: string; type: string; status: string; rawStatus: string } | null;
        taskRef: string | null;
        nodeId: string;
        outputAssetId: string;
      };
    }>;
    byContent: Array<{
      contentItemId: string;
      content: { title: string; found: boolean } | null;
      attempts: number;
      unpricedAttempts: number;
      costIsComplete: boolean;
      costByCurrency: Array<{ currency: string; amount: number }>;
    }>;
    options: {
      purposes: string[];
      outcomes: string[];
      costSources: string[];
      models: Array<{ key: string; label: string }>;
    };
  };
};

async function getCalls(query = "") {
  const response = await GET(new Request(`http://localhost/api/ai-cost-center/calls${query}`));
  return { status: response.status, body: (await response.json()) as CallsPayload };
}

/** Every case below is about a real answer, so a missing body is a failure rather than a `?.`. */
function dataOf(body: CallsPayload) {
  if (!body.data) throw new Error(`the route answered without data (code: ${body.code ?? "none"})`);
  return body.data;
}

/** The writer's own contract: a row that cannot be read back is a failure of this fixture. */
async function seedLedger(input: Parameters<typeof createAiUsageLedgerEntry>[0]) {
  const row = await createAiUsageLedgerEntry(input);
  if (!row) throw new Error("the ledger row could not be read back");
  return row;
}

describe("/api/ai-cost-center/calls", () => {
  it("answers one row per request, reads the retry off the chain, and covers every request in the call total", async () => {
    const content = await createContentItem({
      title: "Ledger article",
      body: "body text",
      postReadyText: "post ready",
    });
    const run = await createRun({ playbookId: "research_extraction" });
    if (!run) throw new Error("the run could not be read back");

    // One call, three requests: a rotated key (failed, unpriced), the answer, and a self-correction.
    const createdAt = Date.now() - 60_000;
    const first = await seedLedger({
      purpose: "cc-calls-chain",
      outcome: "failed",
      providerId: "cc-provider",
      modelId: "cc-model",
      credentialLabel: "****0001",
      attemptIndex: 0,
      taskId: run.id,
      contentItemId: content.id,
      nodeId: "planner",
      tokens: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
      completeness: "unknown",
      costAmount: null,
      costSource: "unpriced",
      createdAt,
    });
    const second = await seedLedger({
      purpose: "cc-calls-chain",
      outcome: "success",
      providerId: "cc-provider",
      modelId: "cc-model",
      credentialLabel: "****0002",
      attemptIndex: 1,
      parentUsageId: first.id,
      taskId: run.id,
      contentItemId: content.id,
      nodeId: "planner",
      tokens: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 },
      completeness: "reported",
      costAmount: 0.5,
      costCurrency: "CNY",
      costSource: "computed",
      createdAt,
    });
    const third = await seedLedger({
      purpose: "cc-calls-chain",
      outcome: "success",
      providerId: "cc-provider",
      modelId: "cc-model",
      credentialLabel: "****0002",
      attemptIndex: 2,
      parentUsageId: second.id,
      taskId: run.id,
      contentItemId: content.id,
      nodeId: "planner",
      tokens: { inputTokens: 500_000, outputTokens: 0, totalTokens: 500_000 },
      completeness: "reported",
      costAmount: 0.25,
      costCurrency: "CNY",
      costSource: "computed",
      createdAt,
    });

    const answer = await getCalls("?purpose=cc-calls-chain&range=7");
    expect(answer.status).toBe(200);
    expect(answer.body.ok).toBe(true);
    const data = dataOf(answer.body);

    // One row per request, in the order they were sent - a retry is not merged into the winner.
    expect(data.matched).toBe(3);
    expect(data.calls.map((call) => call.entry.id)).toEqual([first.id, second.id, third.id]);
    expect(data.calls.map((call) => call.retry.kind)).toEqual([
      "first-request",
      "after-failed-request",
      "self-correction",
    ]);
    // Each kind was read from the predecessor row, not from the attempt number.
    expect(data.calls[1].retry.parent).toMatchObject({ id: first.id, outcome: "failed" });
    expect(data.calls[2].retry.parent).toMatchObject({ id: second.id, outcome: "success" });
    expect(data.calls[1].retry.changed).toEqual(["credential"]);

    // The call's figure covers its failed request's empty row and both successful ones.
    expect(data.calls[0].group).toMatchObject({
      rootId: first.id,
      attempts: 3,
      failedRequests: 1,
      index: 0,
      unpricedAttempts: 1,
      costIsComplete: false,
    });
    expect(data.calls[2].group.costByCurrency).toEqual([{ currency: "CNY", amount: 0.75, attempts: 2 }]);
    expect(data.totals).toMatchObject({
      attempts: 3,
      retries: 2,
      costAmount: 0.75,
      unpricedAttempts: 1,
      unmeasuredAttempts: 0,
      costIsComplete: false,
    });
    expect(data.matchedCostByCurrency).toEqual([{ currency: "CNY", amount: 0.75, attempts: 2 }]);
    // A request nobody could price keeps `null` all the way to the screen.
    expect(data.calls[0].entry.costAmount).toBeNull();
    expect(data.calls[0].entry.costSource).toBe("unpriced");

    // 内容 → 业务任务 → 执行节点 → 模型调用, every hop read from a real record.
    expect(data.calls[0].trace.content).toMatchObject({
      id: content.id,
      title: "Ledger article",
      status: "ready",
      found: true,
    });
    expect(data.calls[0].trace.task).toMatchObject({ id: run.id, kind: "playbook", type: "research_extraction" });
    expect(data.calls[0].trace.taskRef).toBe("taskId");
    expect(data.calls[0].trace.nodeId).toBe("planner");

    // 单篇内容成本: the same window's requests, grouped by the content they named.
    expect(data.byContent[0]).toMatchObject({
      contentItemId: content.id,
      attempts: 3,
      unpricedAttempts: 1,
      costIsComplete: false,
    });
    expect(data.byContent[0].content).toMatchObject({ title: "Ledger article", found: true });

    // The filter choices are the window's own values, and the scan is reported as complete.
    expect(data.options.purposes).toContain("cc-calls-chain");
    expect(data.options.models.map((model) => model.key)).toContain("cc-provider::cc-model");
    expect(data.options.costSources).toEqual(expect.arrayContaining(["computed", "unpriced"]));
    expect(data.scan).toMatchObject({ limit: 5000, truncated: false, traceCapped: false });
  });

  it("says what it cannot resolve instead of filling the chain in", async () => {
    const run = await createRun({ playbookId: "video_render" });
    if (!run) throw new Error("the run could not be read back");
    const createdAt = Date.now() - 30_000;

    const orphan = await seedLedger({
      purpose: "cc-calls-orphan",
      outcome: "failed",
      attemptIndex: 1,
      parentUsageId: "no-such-row",
      contentItemId: "no-such-content",
      runId: run.id,
      meteredKind: "image",
      quantity: { image: 2 },
      costAmount: null,
      costSource: "unknown",
      createdAt,
    });
    // A request that named no content item at all: it must still be counted somewhere.
    await seedLedger({
      purpose: "cc-calls-orphan",
      attemptIndex: 0,
      contentItemId: "",
      costAmount: null,
      costSource: "unpriced",
      createdAt: createdAt - 1,
    });

    const data = dataOf((await getCalls("?purpose=cc-calls-orphan")).body);

    // A recorded predecessor nobody can read is reported, not guessed at.
    expect(data.calls[0].retry).toMatchObject({
      kind: "unresolved-predecessor",
      parentUsageId: "no-such-row",
      parent: null,
      parentOutsideScan: true,
    });
    // A content item that no longer exists is named as missing rather than as unnamed.
    expect(data.calls[0].trace.content).toMatchObject({ id: "no-such-content", found: false, title: "" });
    // With an empty `taskId`, the automation run is what resolves the task - and the page says which.
    expect(data.calls[0].trace.taskRef).toBe("runId");
    expect(data.calls[0].trace.task).toMatchObject({ id: run.id, kind: "playbook", type: "video_render" });
    // The modality units the recorder stored come back as an object, not as raw JSON.
    expect(data.calls[0].quantity).toEqual({ image: 2 });
    expect(data.calls[0].entry.id).toBe(orphan.id);

    // The rows that named no content item keep their own group: not dropped, not merged into another.
    const unattributed = data.byContent.find((group) => group.contentItemId === "");
    expect(unattributed).toMatchObject({ attempts: 1, unpricedAttempts: 1, costIsComplete: false });
  });

  it("never quotes the window's figures for a filtered set, and pages the list", async () => {
    const base = Date.now() - 120_000;
    for (let index = 0; index < 3; index += 1) {
      await seedLedger({
        purpose: "cc-calls-page",
        providerId: "cc-page",
        modelId: `m${index}`,
        attemptIndex: 0,
        tokens: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
        completeness: "reported",
        costAmount: 0.1,
        costCurrency: "CNY",
        costSource: "computed",
        createdAt: base + index * 1_000,
      });
    }
    // A row older than the window: it is not part of the answer, and cannot move any figure in it.
    await seedLedger({
      purpose: "cc-calls-page",
      providerId: "cc-page",
      modelId: "ancient",
      costAmount: 9,
      costCurrency: "CNY",
      costSource: "computed",
      createdAt: usageRangeStart(7) - 1,
    });

    const firstPage = dataOf((await getCalls("?purpose=cc-calls-page&limit=2")).body);
    expect(firstPage.matched).toBe(3);
    expect(firstPage.calls.map((call) => call.entry.modelId)).toEqual(["m2", "m1"]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.limit).toBe(2);
    expect(firstPage.totals.costAmount).toBe(0.3);
    expect(firstPage.matchedCostByCurrency).toEqual([{ currency: "CNY", amount: 0.3, attempts: 3 }]);

    const secondPage = dataOf((await getCalls("?purpose=cc-calls-page&limit=2&offset=2")).body);
    expect(secondPage.calls.map((call) => call.entry.modelId)).toEqual(["m0"]);
    expect(secondPage.hasMore).toBe(false);
    // Both pages describe the same matched set, not the rows they happen to show.
    expect(secondPage.matched).toBe(3);
    expect(secondPage.totals.attempts).toBe(3);

    // A value the product does not know is not an error: it is simply no filter.
    const nonsense = dataOf(
      (await getCalls("?purpose=cc-calls-page&outcome=bogus&source=bogus&model=nonsense&range=999")).body,
    );
    expect(nonsense.matched).toBe(3);
    expect(nonsense.filters).toMatchObject({ outcome: "", costSource: "", model: "", retryOnly: false });
    expect(nonsense.range).toBe(7);
    expect(nonsense.from).toBe(usageRangeStart(7));

    // The window is the one the overview and 用量统计 use.
    expect(dataOf((await getCalls("?purpose=cc-calls-page&range=30")).body).from).toBe(usageRangeStart(30));
    expect(dataOf((await getCalls("?range=30")).body).range).toBe(30);
  });

  it("lists only the requests that were not their call's first when asked, and keeps the call whole", async () => {
    const createdAt = Date.now() - 10_000;
    const first = await seedLedger({
      purpose: "cc-calls-retry-only",
      attemptIndex: 0,
      tokens: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
      completeness: "reported",
      costAmount: 0.1,
      costCurrency: "CNY",
      costSource: "computed",
      createdAt,
    });
    const second = await seedLedger({
      purpose: "cc-calls-retry-only",
      attemptIndex: 1,
      parentUsageId: first.id,
      outcome: "failed",
      tokens: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
      completeness: "reported",
      costAmount: 0.2,
      costCurrency: "CNY",
      costSource: "computed",
      createdAt,
    });

    const data = dataOf((await getCalls("?purpose=cc-calls-retry-only&retry=1")).body);
    expect(data.filters.retryOnly).toBe(true);
    expect(data.matched).toBe(1);
    expect(data.calls.map((call) => call.entry.id)).toEqual([second.id]);
    // The listed request still reports the whole call, so the filter cannot make a call look smaller.
    expect(data.calls[0].group).toMatchObject({ rootId: first.id, attempts: 2, index: 1, failedRequests: 1 });
    expect(data.calls[0].group.costByCurrency).toEqual([{ currency: "CNY", amount: 0.3, attempts: 2 }]);
    // And the money figure follows the filter: it is the matched request's, not the call's.
    expect(data.totals.costAmount).toBe(0.2);
  });
});
