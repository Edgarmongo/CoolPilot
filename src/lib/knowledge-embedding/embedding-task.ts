import { appendRunEvent, createRun, getRun, listRuns, updateRunStatus } from "@/db/repository";
import { listKnowledgeChunksFor, replaceKnowledgeChunks, type KnowledgeChunkWrite } from "@/db/repositories/knowledge-embeddings";
import { listKnowledgeBase } from "@/db/repositories/knowledge-base";
import { aiRuntime, resolveRoute } from "@/features/ai-runtime";
import { beginAiBudgetCall, isAiBudgetRefusal, type AiBudgetCallHandle } from "@/lib/ai-budget-guard";
import { recordAiUsageCall, recordAiUsageFailure, type AiUsageCallContext } from "@/lib/ai-usage-ledger-recorder";
import { listTaskViews, taskScanLimit } from "@/lib/tasks/task-library";
import type { TaskView } from "@/lib/tasks/task-view";
import type { RunRecord } from "@/lib/types";
import {
  chunkKnowledgeBody,
  isKnowledgeEmbeddingFailure,
  knowledgeEmbeddingInput,
  knowledgeEmbeddingRequestSchema,
  knowledgeEmbeddingState,
  KnowledgeEmbeddingFailure,
  type KnowledgeEmbeddingFailureCode,
  type KnowledgeEmbeddingRequest,
  type KnowledgeEmbeddingState,
} from "./embedding";
import { knowledgeChunkHash, knowledgeSourceHash } from "./source";

/**
 * The knowledge-index task as a task of the existing task system (CI-EMB-01, D10).
 *
 * It is one row of `runs` with `playbook_id = knowledge_embedding`, exactly like CI-P3-02's transcription and
 * CI-P3-03's distillation: no new scheduler, no new status vocabulary, and the console reads it through
 * `GET /api/tasks/<id>` with real progress from its own `run_events`, a real error and the existing
 * cancellation rule. The worker dispatches it like every other playbook (`src/worker/runner.ts`), and the API
 * entry runs it in-process because indexing a whole knowledge base takes minutes - so the request must not hold
 * it, and the caller polls.
 *
 * The four properties D10 asks for, and where each one comes from:
 *
 * - **Only what needs it.** A record is planned only when its vectors for the target model are missing, stale
 *   (its source hash moved on) or written for another model. `scope: "rebuild"` is the explicit "do it again
 *   anyway", which is the migration path a model change uses (D4).
 * - **A retry cannot duplicate.** Chunk ids are stable per record, chunk *and* model, and a write replaces the
 *   record's rows for that model - so a second execution of the same run produces the same index, and every
 *   record already finished is skipped on the resume.
 * - **A refused batch is not a failed batch.** A budget refusal stops the run with `BUDGET_EXCEEDED`, which the
 *   worker turns into a *pause* (CI-P7-03-B) rather than a failure: the records already indexed stay indexed,
 *   and a resume asks the budget again.
 * - **Every request is metered.** One gate and one ledger row per provider request, with
 *   `meteredKind: "embedding"`, the run's id for attribution, and the batch's own text as the input the gate
 *   measures.
 */

/** The task type a knowledge-index row carries (`runs.playbook_id`); one literal, shared by every writer. */
export const knowledgeEmbeddingPlaybookId = "knowledge_embedding";

/** Where a caller polls the index task - the same shape `transcriptionTaskLookup()` builds. */
export function knowledgeEmbeddingTaskLookup(taskId: string) {
  return `/api/tasks/${encodeURIComponent(taskId)}`;
}

/**
 * The outer budget of one run: half an hour.
 *
 * It is a last-resort guard, not the timeout a user experiences - each provider request has its own (the
 * adapter's two minutes) and the runtime its own failover. This one exists so that a provider which never
 * settles cannot leave a task `running` for ever, and so that a whole-index run has a ceiling.
 */
export const knowledgeEmbeddingTaskBudgetMs = 30 * 60_000;

export type KnowledgeEmbeddingTaskFailure = { code: KnowledgeEmbeddingFailureCode; message: string };

export type KnowledgeEmbeddingTaskOutcome =
  | {
      kind: "succeeded";
      run: RunRecord;
      providerId: string;
      modelId: string;
      /** Records whose index was written by this run. */
      indexed: number;
      /** Records left alone because they were already current for the target model. */
      skipped: number;
      /** Chunk rows written across those records. */
      chunks: number;
    }
  | { kind: "failed"; run: RunRecord; failure: KnowledgeEmbeddingTaskFailure }
  /** The row was already terminal when this executor got it; nothing ran again. */
  | { kind: "skipped"; run: RunRecord; reason: string };

/** `queued` and `running` are the two statuses in which a row still has work ahead of it. */
function isInFlight(status: string) {
  return status === "queued" || status === "running";
}

function requestIssues(issues: ReadonlyArray<{ path: readonly PropertyKey[]; code: string }>) {
  return issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.code}`).join("; ");
}

/** The stored request of one index row, or a refusal naming what is wrong with it. */
function readStoredRequest(params: Record<string, unknown>): KnowledgeEmbeddingRequest {
  const parsed = knowledgeEmbeddingRequestSchema.safeParse(params);
  if (!parsed.success) {
    throw new KnowledgeEmbeddingFailure("REQUEST_INVALID", requestIssues(parsed.error.issues));
  }
  return parsed.data;
}

/**
 * The run a repeat submission should reuse instead of starting another one.
 *
 * Both rules are the transcription task's, because both promises are the same: with an `idempotencyKey` the key
 * decides, and without one only work still in flight is collapsed - a second rebuild request while the first is
 * `queued`/`running` returns that task, while a request after it finished is a new run, which is exactly what
 * "rebuild the index" means.
 */
async function findReusableTask(request: KnowledgeEmbeddingRequest): Promise<RunRecord | null> {
  const candidates = (await listRuns(taskScanLimit)).filter((run) => run.playbookId === knowledgeEmbeddingPlaybookId);
  if (request.idempotencyKey) {
    return (
      candidates.find((run) => {
        const stored = run.params.idempotencyKey;
        return typeof stored === "string" && stored === request.idempotencyKey;
      }) ?? null
    );
  }
  return candidates.find((run) => isInFlight(run.status)) ?? null;
}

export type CreatedKnowledgeEmbeddingTask = {
  run: RunRecord;
  /** True when an earlier submission's task was returned instead of a new one being created. */
  reused: boolean;
};

/**
 * Creates the index task. The request is stored exactly as it was accepted, so the task's own record shows what
 * the caller asked for - and the executor re-reads it from there, which is why a `queued` row created through
 * `POST /api/runs` with junk parameters lands on `REQUEST_INVALID` instead of a crash.
 */
export async function createKnowledgeEmbeddingTask(raw: unknown): Promise<CreatedKnowledgeEmbeddingTask> {
  const parsed = knowledgeEmbeddingRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new KnowledgeEmbeddingFailure("REQUEST_INVALID", requestIssues(parsed.error.issues));
  }
  const request = parsed.data;

  const existing = await findReusableTask(request);
  if (existing) return { run: existing, reused: true };

  const run = await createRun({ playbookId: knowledgeEmbeddingPlaybookId, params: request });
  if (!run) {
    throw new Error("The knowledge index task was created but could not be read back.");
  }
  return { run, reused: false };
}

/**
 * The model the index is built for (D4).
 *
 * A named pair is used as given; otherwise the runtime's own `embedding` route decides, exactly as it would for
 * the query side. The pair is then **pinned** on every request this run sends, which is a deliberate difference
 * from a query: an index built for one model has to be *one* model, because a mid-run failover would leave a
 * record half-embedded by two models and no query could then compare against all of it. So a provider failure
 * fails the run (and the run can be resumed), instead of quietly moving the index.
 */
async function resolveTarget(request: KnowledgeEmbeddingRequest): Promise<{ providerId: string; modelId: string }> {
  const named =
    request.providerId && request.model
      ? { providerId: request.providerId, modelId: request.model }
      : null;
  if (named) return named;

  const resolution = await resolveRoute({
    capabilities: ["embedding"],
    capability: "embedding",
    model: request.model,
    providerId: request.providerId,
  });
  const candidate = resolution.candidate;
  if (!candidate) {
    const missing = resolution.explanation?.missing ?? ["embedding"];
    throw new KnowledgeEmbeddingFailure(
      "PROVIDER_UNAVAILABLE",
      `no configured model can embed text (missing: ${missing.join(", ")})`,
    );
  }
  return { providerId: candidate.provider.providerId, modelId: candidate.model.modelId };
}

/** One record's plan: the chunks its body has now, and what has to be embedded. */
type PlannedRecord = {
  record: Awaited<ReturnType<typeof listKnowledgeBase>>[number];
  chunks: string[];
  chunkHashes: string[];
  sourceHash: string;
  /** `ready` records are left alone unless the request asked for a rebuild. */
  state: ReturnType<typeof knowledgeEmbeddingState>;
};

/**
 * What one run has to do, decided before a single provider request is sent.
 *
 * Planning first is what keeps "only what needs it" true and testable: the states a record can be in are the
 * pure function's four, so the decision to spend money on it is one comparison rather than an accident of the
 * loop's order.
 */
function planRecords(input: {
  records: Awaited<ReturnType<typeof listKnowledgeBase>>;
  chunks: Awaited<ReturnType<typeof listKnowledgeChunksFor>>;
  target: { providerId: string; modelId: string };
  scope: KnowledgeEmbeddingRequest["scope"];
}) {
  const rowsByKnowledgeId = new Map<string, typeof input.chunks>();
  for (const chunk of input.chunks) {
    const list = rowsByKnowledgeId.get(chunk.knowledgeId);
    if (list) list.push(chunk);
    else rowsByKnowledgeId.set(chunk.knowledgeId, [chunk]);
  }

  const planned: PlannedRecord[] = [];
  const byState: Record<KnowledgeEmbeddingState, number> = {
    ready: 0,
    missing: 0,
    stale: 0,
    incompatible: 0,
  };
  let skipped = 0;
  let empty = 0;
  for (const record of input.records) {
    const chunks = chunkKnowledgeBody(record.content);
    const chunkHashes = chunks.map(knowledgeChunkHash);
    const sourceHash = knowledgeSourceHash(record);
    const rows = rowsByKnowledgeId.get(record.id) ?? [];
    const forTarget = rows.filter(
      (row) => row.providerId === input.target.providerId && row.modelId === input.target.modelId,
    );
    const storedModels = [...new Set(rows.map((row) => `${row.providerId}:${row.modelId}`))].map((key) => {
      const [providerId, modelId] = key.split(":");
      return { providerId, modelId };
    });
    const state = knowledgeEmbeddingState({
      expectedChunks: chunks.length,
      stored: forTarget,
      storedModels,
      sourceHash,
      expectedChunkHashes: chunkHashes,
    });
    byState[state] += 1;
    // A record nobody wrote a body for has nothing to embed, so it is counted on its own rather than as
    // "already current" - the two are different answers to "why is this record not in the index".
    if (chunks.length === 0) empty += 1;
    if (state === "ready" && input.scope !== "rebuild") {
      skipped += 1;
      continue;
    }
    planned.push({ record, chunks, chunkHashes, sourceHash, state });
  }
  return { planned, skipped, byState, empty };
}

/** One chunk waiting for its vector: the unit a batch carries and a write consumes. */
type PendingChunk = { knowledgeId: string; chunkIndex: number; text: string; input: string };

/**
 * One provider request for a batch of chunk texts, with its own gate and its own ledger rows (D1, CI-P7-03).
 *
 * The gate measures the same text the request will carry, and its refusal is mapped to this task's own
 * `BUDGET_EXCEEDED` so the worker can pause the run instead of failing it - while the ledger stays untouched,
 * because a refused call was never sent and there is nothing to bill.
 */
async function embedBatch(
  runId: string,
  target: { providerId: string; modelId: string },
  batch: PendingChunk[],
): Promise<number[][]> {
  const usageCall: AiUsageCallContext = { purpose: "knowledge", runId, meteredKind: "embedding" };
  const input = batch.map((item) => item.input);

  let budget: AiBudgetCallHandle;
  try {
    budget = await beginAiBudgetCall({
      identity: { runId },
      purpose: usageCall.purpose,
      meteredKind: "embedding",
      capability: "embedding",
      capabilities: ["embedding"],
      providerId: target.providerId,
      modelId: target.modelId,
      inputText: input.join("\n"),
    });
    usageCall.budgetReservationId = budget.reservationId ?? undefined;
  } catch (error) {
    if (isAiBudgetRefusal(error)) throw new KnowledgeEmbeddingFailure("BUDGET_EXCEEDED", error.message);
    throw error;
  }

  try {
    // The target is pinned: an index is built by one model, and a failover mid-run would leave a record in a
    // state no query could compare against (D4).
    const answer = await aiRuntime.embed({
      input,
      providerId: target.providerId,
      model: target.modelId,
    });
    await recordAiUsageCall({ ...usageCall, attempts: answer.attempts });
    return answer.vectors;
  } catch (error) {
    await recordAiUsageFailure(usageCall, error);
    const code = (error as { code?: string }).code ?? "";
    if (
      code === "MODEL_CREDENTIAL_MISSING" ||
      code === "MODEL_CREDENTIAL_UNAVAILABLE" ||
      code === "MODEL_CAPABILITY_UNAVAILABLE" ||
      code === "MODEL_NOT_CONFIGURED"
    ) {
      throw new KnowledgeEmbeddingFailure("PROVIDER_UNAVAILABLE", `${code}: ${String((error as Error).message ?? "")}`);
    }
    throw new KnowledgeEmbeddingFailure("EMBEDDING_FAILED", `${code || "unexpected error"}: ${String((error as Error).message ?? "")}`);
  } finally {
    await budget.release();
  }
}

/**
 * The run's outer budget (see `knowledgeEmbeddingTaskBudgetMs`).
 *
 * The provider requests carry their own timeouts; this race exists so that a provider which never settles still
 * ends the task, with a code the console can name - and so a whole-index run cannot hang for ever.
 */
async function withBudget<T>(budgetMs: number, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new KnowledgeEmbeddingFailure("EMBEDDING_TIMEOUT", `the run exceeded its ${budgetMs} ms budget`)),
          budgetMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Executes one index run: plan, embed in batches, write, report.
 *
 * The order is the point of the card. The plan decides what is stale *before* a single request is sent; each
 * batch is gated and metered as its own call; a record is written only once every one of its chunks has a
 * vector, so a record is never left half-indexed; and a failure anywhere leaves the already-written records
 * stored, which is what makes "resume and retry" cheap instead of a rerun.
 */
export async function executeKnowledgeEmbeddingTask(runId: string): Promise<KnowledgeEmbeddingTaskOutcome> {
  const run = await getRun(runId);
  if (!run) throw new Error(`The knowledge index run ${runId} does not exist.`);
  if (!isInFlight(run.status)) return { kind: "skipped", run, reason: `the run is already ${run.status}` };

  await updateRunStatus(run.id, "running", "Preparing the knowledge index…");
  try {
    const request = readStoredRequest(run.params);
    await appendRunEvent(run.id, `準備知識庫向量生成（範圍：${request.scope}）`, "info", { stage: "prepare" });
    const target = await resolveTarget(request);

    const all = await listKnowledgeBase();
    const records = request.recordIds.length > 0 ? all.filter((record) => request.recordIds.includes(record.id)) : all;
    const stored = await listKnowledgeChunksFor(records.map((record) => record.id));
    const { planned, skipped } = planRecords({ records, chunks: stored, target, scope: request.scope });
    await appendRunEvent(
      run.id,
      `掃描 ${records.length} 條知識：需向量化 ${planned.length} 條，已是最新 ${skipped} 條，模型 ${target.providerId}/${target.modelId}`,
      "info",
      { stage: "scan", current: 0, total: planned.length, records: records.length, skipped },
    );

    const pending: PendingChunk[] = [];
    for (const plan of planned) {
      plan.chunks.forEach((text, chunkIndex) => {
        pending.push({
          knowledgeId: plan.record.id,
          chunkIndex,
          text,
          input: knowledgeEmbeddingInput(plan.record, text),
        });
      });
    }

    const vectors = new Map<string, { vector: number[]; dimensions: number }>();
    let indexed = 0;
    let chunksWritten = 0;

    await withBudget(knowledgeEmbeddingTaskBudgetMs, async () => {
      for (let start = 0; start < pending.length; start += request.batchSize) {
        const batch = pending.slice(start, start + request.batchSize);
        const answers = await embedBatch(run.id, target, batch);
        batch.forEach((item, index) => {
          const vector = answers[index] ?? [];
          vectors.set(`${item.knowledgeId}#${item.chunkIndex}`, { vector, dimensions: vector.length });
        });

        // A record is written only when every one of its chunks has a vector, so the index never holds a record
        // that is half embedded - and a failure above leaves the *whole* record for the retry.
        for (const plan of planned) {
          const complete = plan.chunks.every((_, chunkIndex) => vectors.has(`${plan.record.id}#${chunkIndex}`));
          if (!complete) continue;
          const writes: KnowledgeChunkWrite[] = plan.chunks.map((text, chunkIndex) => {
            const entry = vectors.get(`${plan.record.id}#${chunkIndex}`) as { vector: number[]; dimensions: number };
            return {
              chunkIndex,
              text,
              chunkHash: plan.chunkHashes[chunkIndex],
              sourceHash: plan.sourceHash,
              dimensions: entry.dimensions,
              vector: entry.vector,
            };
          });
          const storedRows = await replaceKnowledgeChunks(plan.record.id, target, writes);
          if (storedRows.length !== writes.length) {
            throw new KnowledgeEmbeddingFailure(
              "STORAGE_FAILED",
              `"${plan.record.title}" has ${storedRows.length} of ${writes.length} chunks stored`,
            );
          }
          chunksWritten += writes.length;
          indexed += 1;
          for (let chunkIndex = 0; chunkIndex < plan.chunks.length; chunkIndex += 1) {
            vectors.delete(`${plan.record.id}#${chunkIndex}`);
          }
        }

        await appendRunEvent(run.id, `已寫入 ${indexed}/${planned.length} 條知識`, "info", {
          stage: "embed",
          current: indexed,
          total: planned.length,
        });
      }
    });

    const message =
      `Indexed ${indexed} of ${planned.length} knowledge records (${chunksWritten} chunks) with ` +
      `${target.providerId}/${target.modelId}` +
      (skipped > 0 ? `, ${skipped} already current` : "");
    await updateRunStatus(run.id, "success", message);
    await appendRunEvent(run.id, message, "success", {
      stage: "done",
      current: planned.length,
      total: planned.length,
      indexed,
      skipped,
      chunks: chunksWritten,
      providerId: target.providerId,
      modelId: target.modelId,
    });
    return {
      kind: "succeeded",
      run: (await getRun(run.id)) ?? run,
      providerId: target.providerId,
      modelId: target.modelId,
      indexed,
      skipped,
      chunks: chunksWritten,
    };
  } catch (error) {
    const failure: KnowledgeEmbeddingTaskFailure = isKnowledgeEmbeddingFailure(error)
      ? { code: error.code, message: error.message }
      : {
          code: "EMBEDDING_FAILED",
          message: `EMBEDDING_FAILED: ${error instanceof Error ? error.message : String(error)}`,
        };
    await updateRunStatus(run.id, "failed", failure.message);
    await appendRunEvent(run.id, failure.message, "error", { stage: "error", code: failure.code });
    return { kind: "failed", run: (await getRun(run.id)) ?? run, failure };
  }
}

/**
 * Task ids this process is currently executing.
 *
 * In-process only, and deliberately so, exactly like the transcription and distillation tasks: it stops the API
 * entry from starting a second execution of a row it is already running. A worker in another process claiming
 * the same row is handled one level down, by a write that replaces a record's chunks *for a model* rather than
 * appending to them.
 */
const runningEmbeddings = new Set<string>();

/** Starts a task in the background and returns immediately. */
export function startKnowledgeEmbeddingTask(runId: string) {
  if (runningEmbeddings.has(runId)) return false;
  runningEmbeddings.add(runId);
  void executeKnowledgeEmbeddingTask(runId)
    // The executor records its own failures on the task; a rejection here means the row itself vanished, and
    // there is nothing left to write it to.
    .catch(() => undefined)
    .finally(() => runningEmbeddings.delete(runId));
  return true;
}

/** The index tasks this workspace has, newest activity first (the console's own list). */
export async function listKnowledgeEmbeddingTasks(limit = 20): Promise<TaskView[]> {
  const tasks = await listTaskViews({ kind: "playbook", limit: taskScanLimit });
  return tasks.filter((task) => task.type === knowledgeEmbeddingPlaybookId).slice(0, limit);
}

/** How the whole index reads right now, for the settings screen's own line about it. */
export type KnowledgeIndexSummary = {
  /** Every knowledge record in the workspace. */
  records: number;
  /** Records that contribute no chunk at all (nobody wrote a body). */
  empty: number;
  /** Records whose index is current for the target model. */
  ready: number;
  /** Records with no vectors for the target model, or with vectors of another model. */
  pending: number;
  missing: number;
  stale: number;
  incompatible: number;
  /** Chunk rows stored for every model, which is what the index physically holds. */
  chunks: number;
};

/**
 * Reads the index's state without writing anything and without calling a provider.
 *
 * It is the same planning the task does, which is the point: the number a user sees ("3 records need indexing")
 * is computed by the code that would do the indexing, so it cannot disagree with what a run then does.
 */
export async function summarizeKnowledgeIndex(target: {
  providerId: string;
  modelId: string;
}): Promise<KnowledgeIndexSummary> {
  const records = await listKnowledgeBase();
  const chunks = await listKnowledgeChunksFor(records.map((record) => record.id));
  const { planned, byState, empty } = planRecords({ records, chunks, target, scope: "stale" });
  return {
    records: records.length,
    empty,
    ready: byState.ready - empty,
    pending: planned.length,
    missing: byState.missing,
    stale: byState.stale,
    incompatible: byState.incompatible,
    chunks: chunks.length,
  };
}




