import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CI-P3-03-02/03/04/07: the distillation task against a real database and the real runtime.
 *
 * The model's own behaviour is not what this file pins - the schema is pinned in `./extraction.test.ts`
 * and the transport is stubbed here, exactly like the route tests. What it pins is what the *task* does
 * with whatever a model answers:
 *
 * - a distillation is a `runs` row of type `research_extraction`, so CI-P1-02's own view reports its
 *   canonical status, its progress from its own log and the material it wrote;
 * - the result is stored on the material the request named - with the version, the run, the model and the
 *   fingerprint of the text it read - while `content`, `status` and `transcript_json` stay untouched;
 * - **a failure leaves no result**: a refused model, an unusable answer and an empty one all end the task
 *   `failed` (with their own code) and move the material not at all;
 * - **a second run is a second version**, and the version it replaced is kept; a second *execution of the
 *   same run* stores nothing new;
 * - the two materials in one database cannot reach each other's text: each run reads the row it named.
 *
 * The temp database and the keyless runtime come from `@/test/route-harness`, which must be the first
 * `await` here (it pins the environment before anything that reads it loads).
 */

const { chatCalls, bodyOf, jsonReply, prepareChatModel, qwenCatalog, resetRuntime, stubFetch, unavailable } =
  await import("@/test/route-harness");
const task = await import("./extraction-task");
const contract = await import("./extraction");
const repository = await import("@/db/repository");
const research = await import("@/db/repositories/research");
const tasks = await import("@/lib/tasks/task-library");
const { sqlite } = await import("@/db/client");
const ledger = await import("@/db/repositories/ai-usage-ledger");
const budgetSettings = await import("@/db/repositories/settings");
const { inFlightAiBudgetReservations } = await import("@/lib/ai-budget-guard");

const sourceText = "七点以后冰饮最好卖，夜市摊位比商场高 40%。夜市摊位平均每小时出单 12 杯。";

/** A prompt answer that a model which understood the schema could produce for `sourceText`. */
const answer = {
  summary: "夜市比商场更好卖，七点之后是高峰。",
  keyPoints: ["七点以后是高峰", "夜市比商场高 40%"],
  facts: [
    { statement: "夜市摊位比商场高 40%", evidence: "夜市摊位比商场高 40%" },
    // No such sentence in the material: the run stores it, marks it unverified and leaves it out of any
    // writing prompt - but it is still part of the result the user can edit.
    { statement: "客单价 25 元", evidence: "客单价 25 元" },
  ],
  quotes: ["七点以后冰饮最好卖"],
  topicSuggestions: [{ title: "夜市冰饮选品指南", rationale: "出单数据支持这个方向。" }],
};

/** The transport of one successful call: the catalog read, then the answer. */
function chatRoutes(payload: unknown = answer) {
  return [
    { match: (url: string) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
    { match: (url: string) => url.includes("/chat/completions"), respond: () => jsonReply(payload) },
  ];
}

/**
 * Makes one model really callable, then resets the recorded calls.
 *
 * The order is the transport's, not this test's: `prepareChatModel()` syncs the provider catalog, so the
 * stub has to be in place *before* it runs - and the calls this test cares about are the ones after it,
 * which is why the stub is installed twice and the second array is the one returned.
 */
async function modelReady(payload: unknown = answer) {
  stubFetch(chatRoutes(payload));
  await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
  return stubFetch(chatRoutes(payload));
}

/** One stored material with real text, so the run has something to distil. */
async function materialWith(
  overrides: Partial<Parameters<typeof research.createResearchMaterial>[0]> = {},
) {
  const material = await research.createResearchMaterial({
    title: "夏季冰饮动销报告",
    kind: "url",
    sourceUrl: "https://example.com/research/summer-drinks",
    content: sourceText,
    ...overrides,
  });
  if (!material) throw new Error("the material fixture was not created");
  return material;
}

/** Runs one distillation to its terminal status and reads the outcome back. */
async function distill(materialId: string, payload: unknown = answer) {
  stubFetch(chatRoutes(payload));
  const { run } = await task.createResearchExtractionTask({ materialId });
  const outcome = await task.executeResearchExtractionTask(run.id);
  return { run, outcome };
}

describe("the research-distillation task", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
    // Each case starts from a workspace the previous case's result cannot leak into: a case that counts
    // materials or versions has to be counting only what it wrote.
    await sqlite.execute({ sql: "DELETE FROM research_materials" });
    await sqlite.execute({ sql: "DELETE FROM run_events" });
    await sqlite.execute({ sql: "DELETE FROM runs" });
  });

  it("stores the result on the material, describing where it came from", async () => {
    const calls = await modelReady();
    const material = await materialWith();

    const { run } = await task.createResearchExtractionTask({ materialId: material.id });
    const outcome = await task.executeResearchExtractionTask(run.id);

    expect(outcome.kind).toBe("succeeded");
    if (outcome.kind !== "succeeded") return;

    const stored = await research.getResearchMaterial(material.id);
    const extraction = stored?.extraction ?? null;
    expect(extraction).toMatchObject({
      revision: 1,
      taskId: run.id,
      providerId: "qwen",
      model: "qwen3-max",
      editedAt: null,
      materialId: material.id,
      materialTitle: material.title,
      materialKind: "url",
      sourceUrl: material.sourceUrl,
      sourceCharacters: sourceText.length,
      // The fingerprint of the text this version describes, so a later edit is comparable.
      sourceFingerprint: contract.researchExtractionSourceFingerprint(sourceText),
      ...answer,
    });
    // 1 the first version replaces nothing.
    expect(stored?.extractionHistory).toEqual([]);
    // The material's own text, its status and its transcript are not this write's business at all.
    expect(stored?.content).toBe(sourceText);
    expect(stored?.status).toBe("ready");
    expect(stored?.transcript).toBeNull();

    // The run, read through CI-P1-02's own view: a real status, real progress and the material it wrote.
    const view = await tasks.findTaskView(run.id);
    expect(view).toMatchObject({ type: "research_extraction", status: "succeeded", progress: 100 });
    const logs = await tasks.listTaskLogs("playbook", run.id);
    expect(logs.at(-1)?.data).toMatchObject({ materialId: material.id, revision: 1, unverifiedFacts: 1 });

    // What the model was asked: the system prompt as its own turn, and the material's own text as the user
    // turn - never a summary of it, and never the payload's text passed through the browser.
    const turns = bodyOf(chatCalls(calls)[0]).messages ?? [];
    expect(turns.find((message) => message.role === "system")?.content).toBe(contract.researchExtractionSystemPrompt);
    const prompt = turns.find((message) => message.role === "user")?.content ?? "";
    expect(prompt).toContain(`研究素材：${material.title}`);
    expect(prompt).toContain(`正文：\n${sourceText}`);
  });

  it("keeps two materials' results from each other's text", async () => {
    await modelReady();
    const first = await materialWith();
    const second = await materialWith({
      title: "秋季热饮报告",
      sourceUrl: "https://example.com/research/autumn-drinks",
      content: "秋季热饮在写字楼最好卖，客单价 18 元。",
    });
    const firstAnswer = answer;
    const secondAnswer = {
      summary: "写字楼是秋季热饮的主场。",
      keyPoints: ["写字楼最好卖"],
      facts: [{ statement: "客单价 18 元", evidence: "客单价 18 元" }],
      quotes: ["秋季热饮在写字楼最好卖"],
      topicSuggestions: [],
    };

    const one = await distill(first.id, firstAnswer);
    const calls = await modelReady(secondAnswer);
    const { run } = await task.createResearchExtractionTask({ materialId: second.id });
    await task.executeResearchExtractionTask(run.id);

    expect(one.outcome.kind).toBe("succeeded");
    const [storedFirst, storedSecond] = await Promise.all([
      research.getResearchMaterial(first.id),
      research.getResearchMaterial(second.id),
    ]);
    // Neither result mentions the other material's subject or text.
    expect(storedFirst?.extraction?.summary).toBe(firstAnswer.summary);
    expect(storedSecond?.extraction?.summary).toBe(secondAnswer.summary);
    expect(storedFirst?.extraction?.sourceUrl).toBe(first.sourceUrl);
    expect(storedSecond?.extraction?.sourceUrl).toBe(second.sourceUrl);
    expect(JSON.stringify(storedFirst?.extraction)).not.toContain("秋季热饮");
    expect(JSON.stringify(storedSecond?.extraction)).not.toContain("夜市");

    const prompt = bodyOf(chatCalls(calls)[0]).messages?.find((message) => message.role === "user")?.content ?? "";
    expect(prompt).toContain("秋季热饮在写字楼最好卖");
    expect(prompt).not.toContain(sourceText);
  });

  it("leaves no result behind when the model cannot be reached at all", async () => {
    // No credential and no enabled model: nothing can serve a chat call in this workspace.
    const material = await materialWith();
    const calls = stubFetch([]);

    const { run } = await task.createResearchExtractionTask({ materialId: material.id });
    const outcome = await task.executeResearchExtractionTask(run.id);

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    // A configuration answer, not a distillation failure: the console can point at the model settings.
    expect(outcome.failure.code).toBe("PROVIDER_UNAVAILABLE");
    expect(chatCalls(calls)).toEqual([]);
    expect((await research.getResearchMaterial(material.id))?.extraction).toBeNull();

    const view = await tasks.findTaskView(run.id);
    expect(view?.status).toBe("failed");
    const logs = await tasks.listTaskLogs("playbook", run.id);
    expect(logs.at(-1)?.data.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("leaves no result behind when the provider itself fails", async () => {
    await modelReady();
    const material = await materialWith();
    stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
      { match: (url) => url.includes("/chat/completions"), respond: unavailable },
    ]);

    const { run } = await task.createResearchExtractionTask({ materialId: material.id });
    const outcome = await task.executeResearchExtractionTask(run.id);

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.failure.code).toBe("EXTRACTION_FAILED");
    // A failed model call may not leave a successful-looking row anywhere: no version, no status, no text.
    const stored = await research.getResearchMaterial(material.id);
    expect(stored?.extraction).toBeNull();
    expect(stored?.extractionHistory).toEqual([]);
    expect(stored?.content).toBe(sourceText);
    expect(stored?.statusMessage).toBe("");
    expect((await tasks.findTaskView(run.id))?.status).toBe("failed");
  });

  it("refuses an answer the schema rejects, and one with nothing usable in it", async () => {
    await modelReady();
    const strict = await materialWith({ title: "严格素材" });

    // A model that answers twice with something the schema cannot read: the runtime retries once, and then
    // this task refuses - it never stores a half-parsed result.
    const calls = stubFetch(chatRoutes({ nope: true }));
    const { run } = await task.createResearchExtractionTask({ materialId: strict.id });
    const rejected = await task.executeResearchExtractionTask(run.id);

    expect(rejected.kind).toBe("failed");
    if (rejected.kind !== "failed") return;
    expect(rejected.failure.code).toBe("EXTRACTION_INVALID");
    // Two attempts: the first answer and the corrective retry.
    expect(chatCalls(calls)).toHaveLength(2);
    expect((await research.getResearchMaterial(strict.id))?.extraction).toBeNull();

    const empty = await materialWith({ title: "空白素材" });
    stubFetch(chatRoutes({ summary: " ", keyPoints: [], facts: [], quotes: [], topicSuggestions: [] }));
    const { run: emptyRun } = await task.createResearchExtractionTask({ materialId: empty.id });
    const outcome = await task.executeResearchExtractionTask(emptyRun.id);

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.failure.code).toBe("EXTRACTION_EMPTY");
    expect((await research.getResearchMaterial(empty.id))?.extraction).toBeNull();
  });

  it("refuses a material that is gone, one with no text, and a request that is not one", async () => {
    await modelReady();
    stubFetch(chatRoutes());

    const deleted = await materialWith({ title: "已被删除的素材" });
    const { run: missingRun } = await task.createResearchExtractionTask({ materialId: deleted.id });
    await research.deleteResearchMaterial(deleted.id);
    const missing = await task.executeResearchExtractionTask(missingRun.id);
    expect(missing.kind).toBe("failed");
    if (missing.kind === "failed") expect(missing.failure.code).toBe("MATERIAL_MISSING");

    const blank = await materialWith({ title: "只有标题", kind: "url", content: "" });
    const { run: blankRun } = await task.createResearchExtractionTask({ materialId: blank.id });
    const empty = await task.executeResearchExtractionTask(blankRun.id);
    expect(empty.kind).toBe("failed");
    if (empty.kind === "failed") expect(empty.failure.code).toBe("MATERIAL_EMPTY");

    // A `queued` row created by hand through `POST /api/runs` carries whatever the caller sent; the stored
    // request is what the executor reads, so junk lands on a named refusal instead of a crash.
    const handWritten = await repository.createRun({ playbookId: "research_extraction", params: {} });
    if (!handWritten) throw new Error("the hand-written run was not created");
    const invalid = await task.executeResearchExtractionTask(handWritten.id);
    expect(invalid.kind).toBe("failed");
    if (invalid.kind === "failed") expect(invalid.failure.code).toBe("REQUEST_INVALID");
    // None of the three refusals stored anything: the only material left has no result on it.
    const materials = await research.listResearchMaterials();
    expect(materials).toHaveLength(1);
    expect(materials.every((entry) => entry.extraction === null)).toBe(true);
  });

  it("keeps the version it replaced, and never overwrites the material's own text", async () => {
    await modelReady();
    const material = await materialWith();

    const first = await distill(material.id, answer);
    const second = await distill(material.id, { ...answer, summary: "夜市仍是主场，数据未变。", model: "v2" });

    expect(first.outcome.kind).toBe("succeeded");
    expect(second.outcome.kind).toBe("succeeded");
    if (second.outcome.kind !== "succeeded") return;

    const stored = await research.getResearchMaterial(material.id);
    expect(stored?.extraction).toMatchObject({ revision: 2, summary: "夜市仍是主场，数据未变。" });
    // The version it replaced is kept, with the run that produced it, so "第 2 版替换了第 1 版" is readable.
    expect(stored?.extractionHistory).toHaveLength(1);
    expect(stored?.extractionHistory[0]).toMatchObject({ revision: 1, taskId: first.run.id, summary: answer.summary });
    // Regenerating a distillation never rewrites the text it was distilled from.
    expect(stored?.content).toBe(sourceText);
    expect(stored?.sourceUrl).toBe(material.sourceUrl);
  });

  it("stores one version when the same task row is executed twice", async () => {
    await modelReady();
    const material = await materialWith();
    const { run } = await distill(material.id);

    // A worker in another process claiming a row this process is already driving: the row is put back to
    // `running` and executed again, which is exactly what the duplicate guard exists for.
    await repository.updateRunStatus(run.id, "running");
    const again = await task.executeResearchExtractionTask(run.id);

    expect(again.kind).toBe("succeeded");
    if (again.kind !== "succeeded") return;
    expect(again.extraction.revision).toBe(1);
    const stored = await research.getResearchMaterial(material.id);
    expect(stored?.extraction?.revision).toBe(1);
    // No second version, and the first one was not pushed into the history by a duplicate execution.
    expect(stored?.extractionHistory).toEqual([]);
    const logs = await tasks.listTaskLogs("playbook", run.id);
    expect(logs.some((entry) => entry.data.duplicateExecution === true)).toBe(true);
  });

  it("does not distil a task that already reached a terminal status", async () => {
    await modelReady();
    const material = await materialWith();
    const { run } = await distill(material.id);
    const calls = stubFetch(chatRoutes());

    const again = await task.executeResearchExtractionTask(run.id);

    expect(again.kind).toBe("skipped");
    // The model was not asked a second time for a row that is finished.
    expect(chatCalls(calls)).toEqual([]);
  });

  it("collapses a repeat submission that is still in flight, and honours an idempotency key", async () => {
    await modelReady();
    const material = await materialWith();
    const other = await materialWith({ title: "另一份素材" });

    const first = await task.createResearchExtractionTask({ materialId: material.id });
    const second = await task.createResearchExtractionTask({ materialId: material.id });
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    // A different material is a different run - the collapse is per material, not per workspace.
    const elsewhere = await task.createResearchExtractionTask({ materialId: other.id });
    expect(elsewhere.reused).toBe(false);
    expect(elsewhere.run.id).not.toBe(first.run.id);

    // A key names an operation, so that run answers it even after it settled.
    const keyed = await task.createResearchExtractionTask({ materialId: other.id, idempotencyKey: "podcast-42" });
    const keyedAgain = await task.createResearchExtractionTask({ materialId: other.id, idempotencyKey: "podcast-42" });
    expect(keyedAgain.reused).toBe(true);
    expect(keyedAgain.run.id).toBe(keyed.run.id);

    // Without a key a terminal run is history: 重新提炼 is a new run, which is how a new version is born.
    await distill(material.id);
    const deliberate = await task.createResearchExtractionTask({ materialId: material.id });
    expect(deliberate.reused).toBe(false);
    expect(deliberate.run.id).not.toBe(first.run.id);
  });

  it("starts a task once per process and lists it for the console", async () => {
    await modelReady();
    const material = await materialWith();
    stubFetch(chatRoutes());
    const { run } = await task.createResearchExtractionTask({ materialId: material.id });

    expect(task.startResearchExtractionTask(run.id)).toBe(true);
    // The same row cannot be started twice by this process; the second call is refused, not queued.
    expect(task.startResearchExtractionTask(run.id)).toBe(false);

    // The task runs in the background and takes most of a second even on an idle machine (measured
    // 670 ms alone, 947 ms next to two other files), so the default one-second `vi.waitFor` sits exactly
    // on the edge. When it timed out, this case ended while the run was still `running`, and that
    // leftover task kept working after the next case's `beforeEach` had unstubbed fetch: it then reached
    // the network, and a 401 marks the shared credential key `invalid`, which fails every later
    // `prepareChatModel` in this file with `MODEL_CREDENTIAL_UNAVAILABLE (invalid)`. Waiting long enough
    // that the run is always terminal before the case ends is what keeps the pool clean.
    await vi.waitFor(
      async () => {
        expect((await tasks.findTaskView(run.id))?.status).toBe("succeeded");
      },
      { timeout: 15_000, interval: 100 },
    );

    const listed = await task.listResearchExtractionTasks();
    expect(listed.map((entry) => entry.id)).toContain(run.id);
    expect(listed.every((entry) => entry.type === "research_extraction")).toBe(true);
  }, 20_000);
});

/**
 * CI-P7-03: the budget gate where it is really used - around a model call of this task, with the
 * settings, the price catalog and the ledger all real.
 *
 * The gate's own arithmetic and refusals are pinned in `@/lib/ai-budget-guard.test.ts`, so this block
 * pins what only a real call site can show: that a month inside its ceiling still distils, that a month
 * over it stops the run **before anything is sent** and leaves the ledger holding only what was really
 * spent, that a model with no price on file is refused rather than assumed to be free (and, under the
 * other policy, is allowed and recorded as unpaid-for rather than as 0), and that the hold is always
 * given back.
 */
describe("the budget gate at a real distillation", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
    // Each case counts what it wrote, so the ledger, the catalog and the settings start clean.
    await sqlite.execute({ sql: "DELETE FROM ai_usage_ledger" });
    await sqlite.execute({ sql: "DELETE FROM ai_model_prices" });
    await budgetSettings.updateAiBudgetSettings({
      policy: "off",
      monthlyLimit: null,
      currency: "CNY",
      unknownCostPolicy: "allow",
    });
  });

  /** A stated price on file, so the gate has a figure instead of `unpriced`. */
  async function priceQwenOnFile() {
    await ledger.createAiModelPrice({
      providerId: "qwen",
      meteredKind: "text",
      currency: "CNY",
      inputPerMillion: 1_000_000,
      outputPerMillion: 1_000_000,
      priceVersion: "2026-10",
      effectiveFrom: 1_700_000_000_000,
    });
  }

  it("distils while the month is inside its ceiling, and gives the hold back afterwards", async () => {
    await modelReady();
    await priceQwenOnFile();
    await budgetSettings.updateAiBudgetSettings({ policy: "block", monthlyLimit: 100 });
    const material = await materialWith();

    const calls = stubFetch(chatRoutes());
    const { run } = await task.createResearchExtractionTask({ materialId: material.id });
    const outcome = await task.executeResearchExtractionTask(run.id);

    expect(outcome.kind).toBe("succeeded");
    expect(chatCalls(calls).length).toBeGreaterThan(0);

    // A hold is not a charge: once the call is over the ledger row is what accounts for the money, and
    // nothing is left reserved against the rest of the month.
    expect(await inFlightAiBudgetReservations()).toEqual([]);
    const rows = await ledger.listAiUsageLedgerEntries({ limit: 100 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: "extraction", costSource: "computed", costCurrency: "CNY" });
  });

  it("stops the run before sending anything once the month is already over the ceiling", async () => {
    await modelReady();
    await priceQwenOnFile();
    await budgetSettings.updateAiBudgetSettings({ policy: "block", monthlyLimit: 1 });
    // A month that has already spent more than the ceiling, as a real row rather than a fixture number.
    await ledger.createAiUsageLedgerEntry({
      purpose: "seed-spend",
      providerId: "qwen",
      modelId: "qwen3-max",
      tokens: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      completeness: "reported",
      costAmount: 5,
      costCurrency: "CNY",
      costSource: "computed",
    });
    const material = await materialWith();
    const calls = stubFetch(chatRoutes());

    const { run } = await task.createResearchExtractionTask({ materialId: material.id });
    const outcome = await task.executeResearchExtractionTask(run.id);

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    // This task's own code, not `EXTRACTION_FAILED`: no provider was asked, so no provider failed.
    expect(outcome.failure.code).toBe("BUDGET_EXCEEDED");

    // Nothing was sent, and nothing was written about a call that never happened - only the seed remains.
    expect(chatCalls(calls)).toEqual([]);
    const rows = await ledger.listAiUsageLedgerEntries({ limit: 100 });
    expect(rows).toHaveLength(1);
    expect(rows[0].purpose).toBe("seed-spend");

    // The material keeps everything it had and gains no result.
    const stored = await research.getResearchMaterial(material.id);
    expect(stored?.extraction).toBeNull();
    expect(stored?.content).toBe(sourceText);

    // And the console can name it from the run it already reads.
    expect((await tasks.findTaskView(run.id))?.status).toBe("failed");
    expect((await tasks.listTaskLogs("playbook", run.id)).at(-1)?.data.code).toBe("BUDGET_EXCEEDED");
  });

  it("refuses a model with no price on file under the strict policy, and never reads it as free", async () => {
    await modelReady();
    const material = await materialWith();
    // No price row for this provider: the honest answer is "cost not stated", and the strict policy
    // refuses to send on that basis instead of assuming the call costs nothing.
    await budgetSettings.updateAiBudgetSettings({ policy: "warn", monthlyLimit: 1, unknownCostPolicy: "block" });
    const calls = stubFetch(chatRoutes());

    const { run } = await task.createResearchExtractionTask({ materialId: material.id });
    const outcome = await task.executeResearchExtractionTask(run.id);

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") expect(outcome.failure.code).toBe("BUDGET_EXCEEDED");
    expect(chatCalls(calls)).toEqual([]);
    expect((await research.getResearchMaterial(material.id))?.extraction).toBeNull();

    // Under the other policy the same unstated cost is allowed - and it is still not a 0: the ledger row
    // says `unpriced` with no amount, which is what "we do not know what this cost" looks like.
    await budgetSettings.updateAiBudgetSettings({ unknownCostPolicy: "allow" });
    const allowed = await distill(material.id);
    expect(allowed.outcome.kind).toBe("succeeded");
    const rows = await ledger.listAiUsageLedgerEntries({ limit: 100 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ costSource: "unpriced", costAmount: null });
    expect(await inFlightAiBudgetReservations()).toEqual([]);
  });

  it("keeps the runtime's own retry inside the one gated call it belongs to", async () => {
    await modelReady();
    await priceQwenOnFile();
    await budgetSettings.updateAiBudgetSettings({ policy: "block", monthlyLimit: 100 });
    const material = await materialWith();

    // An answer the schema cannot read twice: the runtime's single corrective retry happens inside the
    // gated call, so it is not a second gate decision - and the hold goes back when that call ends.
    const calls = stubFetch(chatRoutes({ nope: true }));
    const { run } = await task.createResearchExtractionTask({ materialId: material.id });
    const outcome = await task.executeResearchExtractionTask(run.id);

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") expect(outcome.failure.code).toBe("EXTRACTION_INVALID");
    expect(chatCalls(calls)).toHaveLength(2);
    expect(await inFlightAiBudgetReservations()).toEqual([]);

    // The failed call is accounted for as one extraction call rather than dropped, and the material
    // accepts no half-parsed result.
    const rows = await ledger.listAiUsageLedgerEntries({ limit: 100 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.purpose === "extraction")).toBe(true);
    expect((await research.getResearchMaterial(material.id))?.extraction).toBeNull();
  });
});
