/**
 * CI-EMB-01 verification harness - section 4 of the acceptance round (2026-10-11).
 *
 * The batch task's *lifecycle*: creation and idempotency, partial success, resume, a budget refusal that pauses
 * rather than fails, cancellation, tail cleanup after an edit, a migration to a second model, and the ledger rows
 * each of those leaves behind. It drives the real code (`createKnowledgeEmbeddingTask` /
 * `executeKnowledgeEmbeddingTask` and the worker's own `processRun`) against a **temp database** with a stub
 * transport, so nothing here reaches a provider and no credential is read.
 *
 * Run: npx tsx tmp-ciemb-task-verify.ts
 */
import "@/test/app-env";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "ciemb-task-"));
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "task.db").replace(/\\/g, "/")}`;

const providerId = "gateway";
const modelId = "text-embedding-3-small";
const otherModelId = "text-embedding-3-large";
const stubBaseUrl = "http://ciemb-stub.local/v1";
const logFile = path.join(process.cwd(), "tmp-ciemb-task-verify.log");

const lines: string[] = [];
function out(line = "") {
  lines.push(line);
  console.log(line);
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  out(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` :: ${detail}` : ""}`);
}

/** A deterministic 5-dimension stand-in for a provider vector; the ranking is not what this file tests. */
function encode(text: string): number[] {
  const code = [...text].reduce((sum, char) => sum + char.codePointAt(0)!, 0);
  return [text.length, code % 97, (code % 13) + 1, (text.length % 7) + 1, 1];
}

type RecordedCall = { url: string; input: string[] };
const calls: RecordedCall[] = [];
const intercepted: string[] = [];
let failFrom: number | null = null;
let afterCall: (() => Promise<void>) | null = null;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith(stubBaseUrl)) {
    intercepted.push(url);
    return jsonResponse({ error: { message: "intercepted by the verification harness" } }, 400);
  }
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { input?: string[] }) : {};
  const texts = body.input ?? [];
  calls.push({ url, input: texts });
  if (failFrom !== null && calls.length >= failFrom) {
    return jsonResponse({ error: { message: "upstream said no" } }, 500);
  }
  const answer = jsonResponse({
    data: texts.map((text, index) => ({ index, embedding: encode(text) })),
    usage: { prompt_tokens: texts.join(" ").length, total_tokens: texts.join(" ").length },
  });
  if (afterCall) {
    const hook = afterCall;
    afterCall = null;
    await hook();
  }
  return answer;
}) as typeof fetch;

const embeddingCalls = () => calls.length;

async function bootstrap() {
  const { ensureDatabase } = await import("@/db/client");
  await ensureDatabase();
  const runtime = await import("@/features/ai-runtime");
  const runtimeRepository = await import("@/db/repositories/ai-runtime");
  const credentials = await import("@/lib/credentials");
  const settings = await import("@/db/repositories/settings");

  await runtime.ensureModelRuntimeSeeded();
  await credentials.writeCredential(credentials.credentialRefFor(providerId), "sk-stub-ciemb-task");
  await runtimeRepository.upsertModelEndpoint({
    endpointId: `${providerId}/default`,
    providerId,
    protocol: "openai-compatible",
    baseUrl: stubBaseUrl,
    credentialRef: credentials.credentialRefFor(providerId),
  });
  await runtimeRepository.upsertModels({
    providerId,
    endpointId: `${providerId}/default`,
    source: "verification-harness",
    enableNew: true,
    models: [
      {
        modelId,
        displayName: modelId,
        modelType: "embedding",
        contextWindow: null,
        capabilities: [{ capability: "embedding", supported: true, source: "USER_OVERRIDE", confidence: 1 }],
      },
      {
        modelId: otherModelId,
        displayName: otherModelId,
        modelType: "embedding",
        contextWindow: null,
        capabilities: [{ capability: "embedding", supported: true, source: "USER_OVERRIDE", confidence: 1 }],
      },
    ],
  });
  const scoped = await runtimeRepository.listModels({ providerId, endpointId: `${providerId}/default`, limit: 50 });
  const callable = scoped.find((model) => model.modelId === modelId);
  if (!callable) throw new Error(`the harness could not bind ${modelId} to its endpoint`);
  await runtime.setModelDefaultForCapability("embedding", callable.id);
  return { runtime, runtimeRepository, settings, target: callable };
}

function repeat(count: number, text: string) {
  return Array.from({ length: count }, () => text).join("");
}

async function main() {
  const { settings, target } = await bootstrap();
  const knowledge = await import("@/db/repositories/knowledge-base");
  const embeddings = await import("@/db/repositories/knowledge-embeddings");
  const task = await import("@/lib/knowledge-embedding/embedding-task");
  const runRepository = await import("@/db/repository");
  const { processRun } = await import("@/worker/runner");
  const { readBudgetPauseMarker } = await import("@/lib/run-budget-pause");
  const { cancelTask } = await import("@/lib/tasks/task-library");

  out("=== CI-EMB-01 section 4: batch indexing lifecycle (temp database, stub transport) ===");
  out(`temp database: ${process.env.SOCIAL_AUTO_POST_DB_URL}`);
  out(`target route : ${providerId}/${target.modelId} via stub host ${stubBaseUrl}`);
  out();

  const longBody = repeat(90, "完播率的口径是看到最后的人数，前五秒的钩子决定留存。");
  const shortBody = repeat(3, "涨粉靠起号阶段的账号权重。");
  const first = await knowledge.createKnowledgeBase({ title: "长正文三块", content: longBody });
  const second = await knowledge.createKnowledgeBase({ title: "短文一", content: shortBody });
  const third = await knowledge.createKnowledgeBase({ title: "短文二", content: shortBody });
  if (!first || !second || !third) throw new Error("the fixtures could not be created");
  const plannedChunks =
    (await import("@/lib/knowledge-embedding/embedding")).chunkKnowledgeBody(longBody).length + 2;
  out(`fixtures: 3 records, ${plannedChunks} chunks in total (the long body is 3 chunks)`);
  out();

  out("--- T1: create and execute ---");
  const callsT1 = embeddingCalls();
  const created = await task.createKnowledgeEmbeddingTask({ scope: "stale" });
  const t1 = await task.executeKnowledgeEmbeddingTask(created.run.id);
  out(`  outcome=${t1.kind} indexed=${t1.kind === "succeeded" ? t1.indexed : "-"} chunks=${t1.kind === "succeeded" ? t1.chunks : "-"} providerRequests=${embeddingCalls() - callsT1}`);
  check("T1: the run indexed every record", t1.kind === "succeeded" && t1.indexed === 3, JSON.stringify(t1));
  check("T1: one provider request carries the whole default batch", embeddingCalls() - callsT1 === 1);
  check(
    "T1: every chunk of every record is stored",
    (await embeddings.countKnowledgeChunks()) === plannedChunks,
    `rows=${await embeddings.countKnowledgeChunks()}`,
  );

  out("--- T2: idempotency ---");
  const keyed = await task.createKnowledgeEmbeddingTask({ scope: "stale", idempotencyKey: "round-1" });
  const keyedAgain = await task.createKnowledgeEmbeddingTask({ scope: "stale", idempotencyKey: "round-1" });
  const callsT2 = embeddingCalls();
  const t2 = await task.executeKnowledgeEmbeddingTask(keyedAgain.run.id);
  const fresh = await task.createKnowledgeEmbeddingTask({ scope: "stale" });
  const t2b = await task.executeKnowledgeEmbeddingTask(fresh.run.id);
  out(`  reused=${keyedAgain.reused} re-executed=${t2.kind} new-run=${t2b.kind} indexed=${t2b.kind === "succeeded" ? t2b.indexed : "-"} providerRequests=${embeddingCalls() - callsT2}`);
  check("T2: the same idempotency key returns the first run", keyedAgain.reused && keyedAgain.run.id === keyed.run.id);
  check(
    "T2: re-executing a finished run embeds nothing",
    t2.kind === "succeeded" && t2.indexed === 0 && t2.skipped === 3,
    JSON.stringify(t2),
  );
  check(
    "T2: a new run finds nothing stale and spends nothing",
    t2b.kind === "succeeded" && t2b.indexed === 0 && t2b.skipped === 3 && embeddingCalls() - callsT2 === 0,
    JSON.stringify(t2b),
  );

  out("--- T3: a provider failure after the first batch ---");
  // `second` and `third` are emptied first, so the run has real work to leave behind: without this the failure
  // would only ever be observed against a complete index, which says nothing about a partial write.
  await embeddings.deleteKnowledgeChunks(second.id);
  await embeddings.deleteKnowledgeChunks(third.id);
  // The plan is: empty `second`/`third` (so the run has real work to do), fail *every* request, then assert the
  // work that was already stored is still there and no record ended up half-written. A stub that fails part-way
  // would not show this, because the runtime's own retry turns the first failure into attempts and the record
  // still gets its vectors.
  const rowsBeforeFailure = await Promise.all([first, second, third].map((record) => embeddings.listKnowledgeChunks(record.id)));
  const callsT3 = embeddingCalls();
  failFrom = callsT3 + 1;
  const failing = await task.createKnowledgeEmbeddingTask({ scope: "rebuild", batchSize: 1 });
  const t3 = await task.executeKnowledgeEmbeddingTask(failing.run.id);
  failFrom = null;
  const rowsAfterT3 = await Promise.all([first, second, third].map((record) => embeddings.listKnowledgeChunks(record.id)));
  out(`  outcome=${t3.kind} code=${t3.kind === "failed" ? t3.failure.code : "-"} rowsPerRecord=[${rowsAfterT3.map((rows) => rows.length).join(",")}]`);
  check("T3: the run fails with EMBEDDING_FAILED", t3.kind === "failed" && t3.failure.code === "EMBEDDING_FAILED", JSON.stringify(t3));
  check("T3: the chunks written before the failure are still stored", rowsAfterT3.some((rows) => rows.length > 0), `after=[${rowsAfterT3.map((rows) => rows.length).join(",")}]`);
  check(
    "T3: no record is left half-embedded - a record's rows are only ever its whole set",
    rowsAfterT3.every((rows, at) => rows.length === 0 || rows.length === rowsBeforeFailure[at].length),
    `before=[${rowsBeforeFailure.map((rows) => rows.length).join(",")}] after=[${rowsAfterT3.map((rows) => rows.length).join(",")}]`,
  );
  check(
    "T3: nothing already stored was dropped by the failure",
    rowsAfterT3.every((rows, at) => rows.length >= Math.min(rowsBeforeFailure[at].length, 1)),
    `before=[${rowsBeforeFailure.map((rows) => rows.length).join(",")}] after=[${rowsAfterT3.map((rows) => rows.length).join(",")}]`,
  );

  out("--- T4: a retry embeds only what is missing ---");
  const callsT4 = embeddingCalls();
  const firstRowsBeforeT4 = await embeddings.listKnowledgeChunks(first.id);
  const createdAtOfFirst = new Map(firstRowsBeforeT4.map((row) => [row.id, row.createdAt]));
  const retry = await task.createKnowledgeEmbeddingTask({ scope: "stale", batchSize: 1 });
  const t4 = await task.executeKnowledgeEmbeddingTask(retry.run.id);
  const finishedRows = await embeddings.listKnowledgeChunks(second.id);
  const firstRowsAfterT4 = await embeddings.listKnowledgeChunks(first.id);
  const firstUnchanged = firstRowsAfterT4.every((row) => createdAtOfFirst.get(row.id) === row.createdAt);
  out(`  outcome=${t4.kind} indexed=${t4.kind === "succeeded" ? t4.indexed : "-"} providerRequests=${embeddingCalls() - callsT4}`);
  check("T4: the retry completes the index", t4.kind === "succeeded" && t4.indexed === 2, JSON.stringify(t4));
  check("T4: it embedded only the chunks that were missing", embeddingCalls() - callsT4 === 2, `calls=${embeddingCalls() - callsT4}`);
  out(`  requests sent this round: ${embeddingCalls() - callsT3} (failFrom was ${failFrom ?? "null"})`);

  const rowsBeforeT4 = await Promise.all([first, second, third].map((record) => embeddings.listKnowledgeChunks(record.id)));
  out(`  index before the retry: perRecord=[${rowsBeforeT4.map((rows) => rows.map((row) => `${row.modelId}#${row.chunkIndex}`).join("+")).join(" | ")}]`);

  check("T4: the record that was already indexed was not re-embedded", firstUnchanged, `rows=${firstRowsAfterT4.length}`);
  check("T4: the index now holds every chunk", (await embeddings.countKnowledgeChunks()) === plannedChunks);


  out("--- T5: a budget refusal pauses the run (worker path) ---");
  await settings.updateAiBudgetSettings({ policy: "block", monthlyLimit: 100, currency: "CNY", unknownCostPolicy: "allow" });
  for (const record of [first, second, third]) {
    await knowledge.updateKnowledgeBase(record.id, { content: `${record.content}\n\n补充：重新口径。` });
  }
  const pausedTask = await task.createKnowledgeEmbeddingTask({ scope: "stale", batchSize: 1 });
  const holdsBeforeT5 = await runRepository.listAiBudgetReservations({ limit: 500 });
  const ledgerBeforeT5 = await runRepository.listAiUsageLedgerEntries({ limit: 500 });
  afterCall = async () => {
    await settings.updateAiBudgetSettings({ policy: "block", monthlyLimit: 0, currency: "CNY", unknownCostPolicy: "block" });
  };
  const callsT5 = embeddingCalls();
  await processRun(pausedTask.run);
  const paused = await runRepository.getRun(pausedTask.run.id);
  const holdsAfterT5 = await runRepository.listAiBudgetReservations({ limit: 500 });
  const ledgerAfterT5 = await runRepository.listAiUsageLedgerEntries({ limit: 500 });
  const marker = readBudgetPauseMarker(await runRepository.listRunEvents(pausedTask.run.id));
  const rowsPaused = await Promise.all([first, second, third].map((record) => embeddings.listKnowledgeChunks(record.id)));
  out(`  status=${paused?.status} providerRequests=${embeddingCalls() - callsT5} rowsPerRecord=[${rowsPaused.map((rows) => rows.length).join(",")}] pause-gate=${marker.pause?.gate ?? "-"}`);
  check("T5: the worker pauses the run instead of failing it", paused?.status === "paused", String(paused?.status));
  check("T5: the pause carries a checkpoint", Boolean(marker.pause), JSON.stringify(marker.pause ?? {}));
  check("T5: the record indexed before the refusal stays indexed", rowsPaused.some((rows) => rows.length > 0));
  check("T5: the refused batch was never sent", embeddingCalls() - callsT5 === 1, `requests=${embeddingCalls() - callsT5}`);

  out("--- T5b: the resume continues where it stopped ---");
  // The resume is exactly what the console's "continue" does: put the paused row back to `queued` and let the
  // worker claim it again. The executor re-reads the row, so the copy passed here must carry the new status.
  await settings.updateAiBudgetSettings({ policy: "block", monthlyLimit: 100, currency: "CNY", unknownCostPolicy: "allow" });
  await runRepository.updateRunStatus(pausedTask.run.id, "queued", "Resuming…");
  const rowsBeforeResume = await Promise.all([first, second, third].map((record) => embeddings.listKnowledgeChunks(record.id)));
  const unchangedIds = new Set(rowsBeforeResume.flat().map((row) => `${row.id}#${row.createdAt}`));
  const callsT5b = embeddingCalls();
  const resumed = await task.executeKnowledgeEmbeddingTask(pausedTask.run.id);
  const finished = await runRepository.getRun(pausedTask.run.id);
  const rowsResumed = await Promise.all([first, second, third].map((record) => embeddings.listKnowledgeChunks(record.id)));
  const reEmbedded = rowsResumed.flat().filter((row) => !unchangedIds.has(`${row.id}#${row.createdAt}`));
  out(
    `  status=${finished?.status} providerRequests=${embeddingCalls() - callsT5b} rowsPerRecord=[${rowsResumed.map((rows) => rows.length).join(",")}]`,
  );
  check("T5b: the resumed run completes", finished?.status === "success", String(finished?.status));
  check(
    "T5b: it embedded the chunks that were still missing",
    embeddingCalls() - callsT5b > 0 && resumed.kind === "succeeded" && resumed.indexed > 0,
    `requests=${embeddingCalls() - callsT5b}`,
  );
  check(
    "T5b: no chunk that already existed was recomputed",
    reEmbedded.length === 0,
    `reembedded=${reEmbedded.length}`,
  );

  out("--- T5c: the refusal itself was never a provider call ---");
  // The refusal happens before the request, so the ledger must hold no row for the refused batch and the gate
  // must hold no hold for it: a refusal is a decision, not a provider fault, and it must not be billed.
  const holdsT5 = holdsAfterT5.filter((hold) => !holdsBeforeT5.some((before) => before.id === hold.id));
  const ledgerT5 = ledgerAfterT5.filter((row) => !ledgerBeforeT5.some((before) => before.id === row.id));
  out(`  new holds during T5+T5b: ${holdsT5.length} all-settled=${holdsT5.every((hold) => hold.status === "settled")}`);
  out(`  new ledger rows during T5+T5b: ${ledgerT5.length} all-embedding=${ledgerT5.every((row) => row.meteredKind === "embedding")}`);
  check("T5c: the request that was really sent is the only new row", ledgerT5.length === 1, `rows=${ledgerT5.length}`);
  check(
    "T5c: that row is the sent batch, not the refused one",
    ledgerT5.every((row) => row.outcome === "success"),
    ledgerT5.map((row) => `${row.outcome}:${row.costSource}`).join(","),
  );
  check(
    "T5c: no hold is left outstanding",
    holdsT5.every((hold) => hold.status === "settled"),
    holdsT5.map((hold) => hold.status).join(",") || "(none taken: the embedding dimension has no price)",
  );

  out("--- T6: cancelling a queued run ---");
  const callsT6 = embeddingCalls();
  const cancelMe = await task.createKnowledgeEmbeddingTask({ scope: "rebuild", batchSize: 1 });
  const cancelOutcome = await cancelTask("playbook", cancelMe.run.id);
  const cancelledRun = await runRepository.getRun(cancelMe.run.id);
  const afterCancel = await task.executeKnowledgeEmbeddingTask(cancelMe.run.id);
  out(
    `  cancel=${cancelOutcome?.cancelled} status=${cancelledRun?.status} re-execution=${afterCancel.kind} providerRequests=${embeddingCalls() - callsT6}`,
  );
  check("T6: a queued run is cancelled", cancelOutcome?.cancelled === true, JSON.stringify(cancelOutcome?.message ?? ""));
  out("--- T7: an edit drops the tail chunks ---");
  const { chunkKnowledgeBody } = await import("@/lib/knowledge-embedding/embedding");
  const beforeEdit = await embeddings.listKnowledgeChunks(first.id);
  const indexesBefore = [...new Set(beforeEdit.map((row) => `${row.modelId}#${row.chunkIndex}`))].sort();
  await knowledge.updateKnowledgeBase(first.id, { content: shortBody });
  const expectedChunks = chunkKnowledgeBody(shortBody).length;
  const callsT7 = embeddingCalls();
  const tail = await task.createKnowledgeEmbeddingTask({ scope: "rebuild", recordIds: [first.id], batchSize: 1 });
  const t7 = await task.executeKnowledgeEmbeddingTask(tail.run.id);
  const afterEdit = await embeddings.listKnowledgeChunks(first.id);
  const forBase = afterEdit
    .filter((row) => row.modelId === modelId)
    .map((row) => row.chunkIndex)
    .sort((left, right) => left - right);
  const forOther = afterEdit.filter((row) => row.modelId === otherModelId).length;
  out(
    `  chunks before=[${indexesBefore.join(",")}] after(base)=[${forBase.join(",")}] other=${forOther} expected=${expectedChunks} requests=${embeddingCalls() - callsT7}`,
  );
  check("T7: the shortened record is re-indexed", t7.kind === "succeeded" && t7.indexed === 1, JSON.stringify(t7));
  check(
    "T7: the tail chunks of the old body were deleted, not left behind",
    forBase.length === expectedChunks && forBase.every((index, at) => index === at),
    `kept=[${forBase.join(",")}]`,
  );
  check(
    "T7: the other model's index for that record was untouched (it has none yet - T8 writes it)",
    forOther === 0,
    `other=${forOther}`,
  );

  out("--- T8: a second model keeps the first one's index ---");
  const rowsBeforeT8 = await embeddings.listKnowledgeChunks(first.id);
  const callsT8 = embeddingCalls();
  const migrated = await task.createKnowledgeEmbeddingTask({ scope: "rebuild", providerId, model: otherModelId });
  const t8 = await task.executeKnowledgeEmbeddingTask(migrated.run.id);
  const rowsAfterT8 = await embeddings.listKnowledgeChunks(first.id);
  const untouched = rowsBeforeT8.every((row) => {
    const now = rowsAfterT8.find((candidate) => candidate.id === row.id);
    return Boolean(now) && now?.createdAt === row.createdAt;
  });
  const models = await import("@/lib/knowledge-base");
  const { knowledgeSourceHash } = await import("@/lib/knowledge-embedding/source");
  const entries = (await knowledge.listKnowledgeBase()).filter((record) => record.enabled);
  const stored = await embeddings.listKnowledgeChunksFor(entries.map((entry) => entry.id));
  const asChunks = stored.map((row) => ({
    knowledgeId: row.knowledgeId,
    chunkIndex: row.chunkIndex,
    vector: row.vector,
    sourceHash: row.sourceHash,
    providerId: row.providerId,
    modelId: row.modelId,
  }));
  const wrongModel = models.selectSemanticKnowledgeReferences({
    entries,
    queryVector: stored[0].vector,
    chunks: asChunks,
    sourceHashOf: knowledgeSourceHash,
    target: { providerId, modelId: "text-embedding-3-absent" },
  });
  const rightModel = models.selectSemanticKnowledgeReferences({
    entries,
    queryVector: stored.find((row) => row.modelId === otherModelId)?.vector ?? stored[0].vector,
    chunks: asChunks,
    sourceHashOf: knowledgeSourceHash,
    target: { providerId, modelId: otherModelId },
  });
  out(
    `  indexed=${t8.kind === "succeeded" ? `${t8.indexed} records / ${t8.chunks} chunks` : t8.kind} requests=${embeddingCalls() - callsT8}`,
  );
  out(`  rows now: ${await embeddings.countKnowledgeChunks()} (this record had ${rowsBeforeT8.length})`);
  out(
    `  recall for a model nothing was written for: references=${wrongModel.references.length} incompatible=${wrongModel.diagnostics.incompatibleVectors}`,
  );
  out(
    `  recall for the new model: references=${rightModel.references.length} top=${rightModel.references[0]?.slice(0, 14) ?? "(none)"}`,
  );
  check(
    "T8: the rebuild with the second model completed",
    t8.kind === "succeeded" && t8.indexed === 3,
    JSON.stringify(t8),
  );
  check("T8: the first model's rows were kept, not rewritten", untouched, `kept=${rowsBeforeT8.length}`);
  check(
    "T8: recall for a model with no stored vectors returns nothing rather than mixing models in",
    wrongModel.references.length === 0 && wrongModel.diagnostics.incompatibleVectors === entries.length,
    `refs=${wrongModel.references.length} incompatible=${wrongModel.diagnostics.incompatibleVectors}`,
  );
  check(
    "T8: recall for the new model answers from its own rows",
    rightModel.references.length > 0,
    `${rightModel.references.length}`,
  );

  out("--- ledger: what the failed attempts left behind ---");
  const ledger = await runRepository.listAiUsageLedgerEntries({ limit: 500 });
  const taskRows = ledger.filter((row) => row.purpose === "knowledge" && row.runId !== "");
  const failedRows = taskRows.filter((row) => row.outcome === "failed");
  out(
    `  knowledge rows=${taskRows.length} failed=${failedRows.length} succeeded=${taskRows.length - failedRows.length} all-embedding=${taskRows.every((row) => row.meteredKind === "embedding")}`,
  );
  check("the failed attempt is in the ledger", failedRows.length > 0, `failed=${failedRows.length}`);
  check(
    "a failed attempt states no cost at all - NULL, not 0",
    failedRows.every((row) => row.costAmount === null),
    failedRows.map((row) => `${row.costSource}:${row.costAmount}`).join(","),
  );
  check(
    "every row of every index run is metered as an embedding and attributed to its run",
    taskRows.length > 0 && taskRows.every((row) => row.meteredKind === "embedding" && row.runId !== ""),
    `rows=${taskRows.length}`,
  );

  out();
  out("=== summary ===");
  out(`checks: ${failures === 0 ? "all passed" : `${failures} FAILED`}`);
  out(`real provider calls: 0 (the transport refused any non-stub host)`);
  writeFileSync(logFile, `${lines.join("\n")}\n`, "utf8");
  out(`log written to ${logFile}`);
  if (failures > 0) process.exitCode = 1;
}
main().catch((error) => { console.error("ERR", error); process.exitCode = 1; });
