import { appendRunEvent, createRun, getRun, listRuns, updateRunStatus } from "@/db/repository";
import { getResearchMaterial, saveResearchExtraction } from "@/db/repositories/research";
import { AppError } from "@/lib/app-errors";
import { aiRuntime } from "@/features/ai-runtime";
import { beginAiBudgetCall, isAiBudgetRefusal, type AiBudgetCallHandle } from "@/lib/ai-budget-guard";
import { recordAiUsageCall, recordAiUsageFailure, type AiUsageCallContext } from "@/lib/ai-usage-ledger-recorder";
import { listTaskViews, taskScanLimit } from "@/lib/tasks/task-library";
import type { TaskView } from "@/lib/tasks/task-view";
import type { ResearchMaterialRecord, RunRecord } from "@/lib/types";
import {
  isResearchExtractionFailure,
  nextResearchExtractionRevision,
  researchExtractionEvidenceLocator,
  researchExtractionIsEmpty,
  researchExtractionOutputSchema,
  researchExtractionPlaybookId,
  researchExtractionRequestSchema,
  researchExtractionSourceFingerprint,
  researchExtractionSourcePromptText,
  researchExtractionSourceText,
  researchExtractionSystemPrompt,
  ResearchExtractionFailure,
  type ResearchExtractionFailureCode,
  type ResearchExtractionRecord,
  type ResearchExtractionRequest,
  type ResearchExtractionSource,
} from "./extraction";

/**
 * The research-distillation task as a task of the existing task system (CI-P3-03).
 *
 * A distillation is one row of `runs` with `playbook_id = research_extraction`, exactly like CI-P3-02's
 * transcription: no extraction table, no second status vocabulary, and the console reads it through
 * `GET /api/tasks/<id>` with real progress (from its own `run_events`), a real error and the existing
 * cancellation rule. The worker dispatches it like every other playbook (`src/worker/runner.ts`).
 *
 * It is a *task* rather than a plain route handler for the two reasons a task exists here: a distillation
 * over a long transcript or page is a model call that takes tens of seconds (so the request may not hold
 * it), and the run's own log is where "读到多少字、有几条事实在原文里找不到片段、换了哪个模型" belongs -
 * facts a response body would lose the moment the user closes the dialog.
 *
 * The rules it inherits from the transcription task, unchanged:
 *
 * - **In-process duplication is prevented by a set**, and cross-process duplication is made *harmless*
 *   instead: the write is idempotent per task (a run whose id already produced the current version does
 *   not produce a second one), so two executions of one row yield one version, not two.
 * - **A restart is not a hang.** A `running` row whose process died is converged by CI-P1-02's
 *   `reconcileInterruptedTasks`, which this file deliberately does not duplicate.
 * - **The material is written before the task is marked successful**, so a task that says `success`
 *   always has a stored result behind it - and a failure moves the material not at all.
 */

/** Where a caller polls the distillation task - the same shape `transcriptionTaskLookup()` builds. */
export function researchExtractionTaskLookup(taskId: string) {
  return `/api/tasks/${encodeURIComponent(taskId)}`;
}

/**
 * The outer budget of one run: a quarter of an hour.
 *
 * The model call carries its own timeout and the runtime its own failover; this is the last-resort guard
 * that keeps a provider which never settles from leaving a task `running` for ever.
 */
export const researchExtractionTaskBudgetMs = 15 * 60_000;

/** The five stages a run reports, so `deriveProgress()` has a real signal to read. */
const stageSteps = { prepare: 1, source: 2, model: 3, verify: 4, store: 5, done: 5, error: 5 } as const;

const researchExtractionStageTotal = 5;

export type ResearchExtractionTaskFailure = { code: ResearchExtractionFailureCode; message: string };

export type ResearchExtractionTaskOutcome =
  | {
      kind: "succeeded";
      run: RunRecord;
      /** The material the result was stored on. */
      materialId: string;
      /** The version this run stored (or the one it had already stored when it ran twice). */
      extraction: ResearchExtractionRecord;
    }
  | { kind: "failed"; run: RunRecord; failure: ResearchExtractionTaskFailure }
  /** The row was already terminal when this executor got it; nothing ran again. */
  | { kind: "skipped"; run: RunRecord; reason: string };

/** `queued` and `running` are the two statuses in which a row still has work ahead of it. */
function isInFlight(status: string) {
  return status === "queued" || status === "running";
}

function requestIssues(issues: ReadonlyArray<{ path: readonly PropertyKey[]; code: string }>) {
  return issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.code}`).join("; ");
}

/** The stored request of one distillation row, or a refusal naming what is wrong with it. */
function readStoredRequest(params: Record<string, unknown>): ResearchExtractionRequest {
  const parsed = researchExtractionRequestSchema.safeParse(params);
  if (!parsed.success) {
    throw new ResearchExtractionFailure("REQUEST_INVALID", requestIssues(parsed.error.issues));
  }
  return parsed.data;
}

/**
 * The run a repeat submission should reuse instead of starting another one.
 *
 * The two rules are the transcription task's, because the two promises are the same ones:
 *
 * - **With an `idempotencyKey`, the key decides.** Any earlier run carrying that key answers the
 *   submission, whatever its status - the caller asked for exactly-once and named the operation.
 * - **Without a key, only work in flight is collapsed.** A second submission while the first is still
 *   `queued`/`running` returns that task; once the first is terminal, a new submission is a new run -
 *   which is exactly what 重新提炼 means, and it is how a new version comes to exist.
 */
async function findReusableTask(request: ResearchExtractionRequest): Promise<RunRecord | null> {
  const candidates = (await listRuns(taskScanLimit)).filter((run) => run.playbookId === researchExtractionPlaybookId);
  if (request.idempotencyKey) {
    return (
      candidates.find((run) => {
        const stored = run.params.idempotencyKey;
        return typeof stored === "string" && stored === request.idempotencyKey;
      }) ?? null
    );
  }
  return candidates.find((run) => isInFlight(run.status) && run.params.materialId === request.materialId) ?? null;
}

export type CreatedResearchExtractionTask = {
  run: RunRecord;
  /** True when an earlier submission's task was returned instead of a new one being created. */
  reused: boolean;
};

/**
 * Creates the distillation task. The request is stored exactly as it was accepted, so a task's own record
 * shows what the caller asked for - and the executor re-reads it from there, which is why a `queued` row
 * created through `POST /api/runs` with junk parameters lands on `REQUEST_INVALID` instead of a crash.
 */
export async function createResearchExtractionTask(raw: unknown): Promise<CreatedResearchExtractionTask> {
  const parsed = researchExtractionRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ResearchExtractionFailure("REQUEST_INVALID", requestIssues(parsed.error.issues));
  }
  const request = parsed.data;

  const existing = await findReusableTask(request);
  if (existing) return { run: existing, reused: true };

  const run = await createRun({ playbookId: researchExtractionPlaybookId, params: request });
  if (!run) {
    throw new Error("The distillation task was created but could not be read back.");
  }
  return { run, reused: false };
}

/** A stored material as the run reads it: the text, plus the marks an excerpt can be located by. */
export function extractionSourceOf(material: ResearchMaterialRecord): ResearchExtractionSource {
  return {
    id: material.id,
    title: material.title,
    kind: material.kind,
    sourceUrl: material.sourceUrl,
    content: material.content,
    transcript: material.transcript,
  };
}

/**
 * One model call, with the runtime's own vocabulary mapped onto this task's codes.
 *
 * `chatStructured` already owns provider order, key rotation, failover and the single corrective retry;
 * what this function decides is what the caller is told. "Nothing can serve a chat call" is a
 * *configuration* answer and becomes `PROVIDER_UNAVAILABLE` - the same split CI-P3-02 made for a missing
 * speech-to-text model - while a model that answered twice with unusable JSON is `EXTRACTION_INVALID`:
 * the plan was real, its answer was not.
 */
async function askModel(runId: string, source: ResearchExtractionSource) {
  // CI-P7-01-04. The task row is this call's business identity, and the ledger row is written
  // before the mapping below turns the failure into this task's own vocabulary - a failed request
  // is still a request the provider may have billed for.
  const usageCall: AiUsageCallContext = { purpose: "extraction", runId };
  // The gate measures the same text the request will carry, so the prompt is built once and used twice.
  const prompt = researchExtractionSourcePromptText(source);

  // CI-P7-03. The gate runs before the request, and its refusal is *this task's* answer rather than the
  // model's: it is mapped to `BUDGET_EXCEEDED` out here, so it is neither written to the ledger (nothing was
  // sent, so there is nothing to bill) nor turned into `EXTRACTION_FAILED`, which would blame a provider
  // that was never asked. Anything else escaping the gate is a settings or ledger read failing, which the
  // executor maps exactly as it did before.
  let budget: AiBudgetCallHandle;
  try {
    budget = await beginAiBudgetCall({
      identity: usageCall,
      purpose: usageCall.purpose,
      capabilities: ["chat"],
      inputText: prompt,
    });
    // CI-P7-03-A: the hold's id travels onto this call's ledger rows, so what was held and what
    // was spent are compared by an id instead of correlated by purpose and time.
    usageCall.budgetReservationId = budget.reservationId ?? undefined;
  } catch (error) {
    if (isAiBudgetRefusal(error)) throw new ResearchExtractionFailure("BUDGET_EXCEEDED", error.message);
    throw error;
  }

  try {
    const answer = await aiRuntime.chatStructured({
      messages: [{ role: "user", content: prompt }],
      systemPrompt: researchExtractionSystemPrompt,
      schema: researchExtractionOutputSchema,
    });
    await recordAiUsageCall({ ...usageCall, attempts: answer.attempts });
    return answer;
  } catch (error) {
    await recordAiUsageFailure(usageCall, error);
    const code = error instanceof AppError ? error.code : "";
    const message = error instanceof Error ? error.message : String(error);
    if (code === "AI_STRUCTURED_OUTPUT_INVALID") {
      throw new ResearchExtractionFailure("EXTRACTION_INVALID", message);
    }
    if (
      code === "AI_PROVIDER_MISSING_KEY" ||
      code === "MODEL_CREDENTIAL_MISSING" ||
      code === "MODEL_CREDENTIAL_UNAVAILABLE" ||
      code === "MODEL_CAPABILITY_UNAVAILABLE" ||
      code === "MODEL_NOT_CONFIGURED"
    ) {
      throw new ResearchExtractionFailure(
        "PROVIDER_UNAVAILABLE",
        `the model gateway cannot serve a distillation right now: ${message}`,
      );
    }
    const killed = (error as { name?: string }).name === "TimeoutError";
    throw new ResearchExtractionFailure(killed ? "EXTRACTION_TIMEOUT" : "EXTRACTION_FAILED", message);
  } finally {
    await budget.release();
  }
}

/** How many of the model's facts and quotes the material's own text really contains. */
function verificationCounts(
  source: ResearchExtractionSource,
  output: { facts: { evidence: string }[]; quotes: string[] },
) {
  const facts = output.facts.map((fact) => researchExtractionEvidenceLocator(source, fact.evidence).verified);
  return {
    facts: facts.length,
    verifiedFacts: facts.filter(Boolean).length,
    unverifiedFacts: facts.filter((verified) => !verified).length,
    quotes: output.quotes.length,
    verifiedQuotes: output.quotes.filter((quote) => researchExtractionEvidenceLocator(source, quote).verified).length,
  };
}

/**
 * One model call under this run's outer budget (see `researchExtractionTaskBudgetMs`).
 *
 * The runtime enforces its own timeouts and failover; this race exists so that a provider which never
 * settles still ends the task, with a code the console can name.
 */
async function withBudget<T>(budgetMs: number, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ResearchExtractionFailure("EXTRACTION_TIMEOUT", `the run exceeded its ${budgetMs} ms budget`)),
          budgetMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Runs one distillation task: validate the stored request, read the material, ask the model, check every
 * excerpt against the material's own text, store the result, and write the terminal status.
 *
 * The order of the writers at the end matters as much as the work itself: the material is written
 * **before** the task is marked successful, so a task that says `success` always has a stored result
 * behind it - and a failure leaves the material exactly as it was, which is what makes a failed model call
 * unable to leave a false success state anywhere.
 */
export async function executeResearchExtractionTask(runId: string): Promise<ResearchExtractionTaskOutcome> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Distillation task "${runId}" does not exist.`);
  if (run.playbookId !== researchExtractionPlaybookId) {
    throw new Error(`Task "${runId}" is a "${run.playbookId}" task, not a distillation task.`);
  }
  if (!isInFlight(run.status)) {
    return { kind: "skipped", run, reason: `the task already reached "${run.status}"` };
  }

  /** Every line lands in `run_events` with the stage it belongs to, which is what progress reads. */
  const log = async (entry: {
    stage: keyof typeof stageSteps;
    message: string;
    level?: "info" | "warn" | "error";
    data?: Record<string, unknown>;
  }) => {
    await appendRunEvent(run.id, entry.message, entry.level ?? "info", {
      stage: entry.stage,
      current: stageSteps[entry.stage],
      total: researchExtractionStageTotal,
      ...(entry.data ?? {}),
    });
  };

  // Claiming writes `running`, which is what gives the task view a real `startedAt`.
  await updateRunStatus(run.id, "running");

  try {
    const request = readStoredRequest(run.params);
    const material = await getResearchMaterial(request.materialId);
    if (!material) {
      throw new ResearchExtractionFailure(
        "MATERIAL_MISSING",
        `research material "${request.materialId}" is not in the workspace any more`,
      );
    }
    const source = extractionSourceOf(material);
    const text = researchExtractionSourceText(source);
    if (!text) {
      throw new ResearchExtractionFailure("MATERIAL_EMPTY", `"${material.title}" has no text to distil`);
    }
    await log({
      stage: "prepare",
      message: `Distillation accepted: "${material.title}" (${material.kind}, ${text.length} characters of stored text)`,
      data: { materialId: material.id, materialKind: material.kind, sourceCharacters: text.length },
    });

    // Idempotence per task: a row that already stored its version does not store a second one. This is
    // what makes two executions of one row (this process plus a worker that claimed it) produce one
    // version instead of two.
    if (material.extraction?.taskId === run.id) {
      const existing = material.extraction;
      const message =
        `Distillation already stored as version ${existing.revision} of "${material.title}" ` +
        `(this task ran twice; nothing was distilled again)`;
      await updateRunStatus(run.id, "success", message);
      await appendRunEvent(run.id, message, "warn", {
        stage: "store",
        current: researchExtractionStageTotal,
        total: researchExtractionStageTotal,
        materialId: material.id,
        revision: existing.revision,
        duplicateExecution: true,
      });
      return { kind: "succeeded", run: (await getRun(run.id)) ?? run, materialId: material.id, extraction: existing };
    }

    const fingerprint = researchExtractionSourceFingerprint(text);
    await log({
      stage: "source",
      message: `Reading the stored text of "${material.title}"${material.transcript ? " (a transcript)" : ""}: ${text.length} characters`,
      data: { materialId: material.id, sourceFingerprint: fingerprint },
    });

    const answer = await withBudget(researchExtractionTaskBudgetMs, () => askModel(run.id, source));
    const output = answer.data;
    await log({
      stage: "model",
      message:
        `${answer.providerId}/${answer.model} answered with ${output.keyPoints.length} key points, ` +
        `${output.facts.length} facts, ${output.quotes.length} quotes and ${output.topicSuggestions.length} topic suggestions`,
      data: {
        providerId: answer.providerId,
        model: answer.model,
        retried: answer.retried,
        // The trail holds every request now, so the count this event has always reported is the
        // failures in it - the successful requests are not "previous attempts".
        attempts: answer.attempts.filter((attempt) => attempt.outcome === "failed").length,
      },
    });

    if (researchExtractionIsEmpty(output)) {
      throw new ResearchExtractionFailure("EXTRACTION_EMPTY", "the model answered with no usable result");
    }

    const counts = verificationCounts(source, output);
    await log({
      stage: "verify",
      message:
        `Checked against the material's own text: ${counts.verifiedFacts}/${counts.facts} facts and ` +
        `${counts.verifiedQuotes}/${counts.quotes} quotes appear in it` +
        (counts.unverifiedFacts > 0
          ? `; ${counts.unverifiedFacts} fact(s) carry no locatable excerpt and are stored as 未核实`
          : ""),
      level: counts.unverifiedFacts > 0 ? "warn" : "info",
      data: counts,
    });

    const revision = nextResearchExtractionRevision(material.extraction);
    const record: ResearchExtractionRecord = {
      ...output,
      revision,
      taskId: run.id,
      providerId: answer.providerId,
      model: answer.model,
      generatedAt: Date.now(),
      editedAt: null,
      materialId: material.id,
      materialTitle: material.title,
      materialKind: material.kind,
      sourceUrl: material.sourceUrl,
      sourceCharacters: text.length,
      sourceFingerprint: fingerprint,
    };
    await log({
      stage: "store",
      message:
        `Saving version ${revision} on "${material.title}" ` +
        `(replacing ${material.extraction ? `version ${material.extraction.revision}` : "nothing"})`,
      data: { materialId: material.id, revision, previousRevision: material.extraction?.revision ?? 0 },
    });
    const stored = await saveResearchExtraction(material.id, record);
    if (!stored?.extraction) {
      throw new ResearchExtractionFailure("EXTRACTION_FAILED", "the result could not be stored on the material");
    }

    const message =
      `Distilled "${material.title}" into version ${stored.extraction.revision} ` +
      `(${counts.verifiedFacts}/${counts.facts} facts located in the source, ${output.keyPoints.length} key points, ` +
      `${output.topicSuggestions.length} topic suggestions, ${answer.providerId}${answer.model ? `/${answer.model}` : ""})`;
    await updateRunStatus(run.id, "success", message);
    await appendRunEvent(run.id, message, "success", {
      stage: "done",
      current: researchExtractionStageTotal,
      total: researchExtractionStageTotal,
      materialId: material.id,
      revision: stored.extraction.revision,
      providerId: answer.providerId,
      model: answer.model,
      ...counts,
    });
    return {
      kind: "succeeded",
      run: (await getRun(run.id)) ?? run,
      materialId: material.id,
      extraction: stored.extraction,
    };
  } catch (error) {
    const failure: ResearchExtractionTaskFailure = isResearchExtractionFailure(error)
      ? { code: error.code, message: error.message }
      : {
          code: "EXTRACTION_FAILED",
          message: `EXTRACTION_FAILED: ${error instanceof Error ? error.message : String(error)}`,
        };
    await updateRunStatus(run.id, "failed", failure.message);
    await appendRunEvent(run.id, failure.message, "error", {
      stage: "error",
      current: researchExtractionStageTotal,
      total: researchExtractionStageTotal,
      code: failure.code,
    });
    return { kind: "failed", run: (await getRun(run.id)) ?? run, failure };
  }
}

/**
 * Task ids this process is currently executing.
 *
 * In-process only, and deliberately so, exactly like the transcription task's set: it stops the API route
 * from starting a second execution of a row it is already running. A worker in another process claiming
 * the same row is handled one level down, by the result write being idempotent per task.
 */
const runningExtractions = new Set<string>();

/**
 * Starts a task in the background and returns immediately.
 *
 * A distillation is a model call over a long text, so the API route must not hold the request open for it:
 * the row is created `queued`, the route answers with its id and where to poll, and this call moves it to
 * `running` and on to a terminal status while the dialog polls `GET /api/tasks/<id>`.
 */
export function startResearchExtractionTask(runId: string) {
  if (runningExtractions.has(runId)) return false;
  runningExtractions.add(runId);
  void executeResearchExtractionTask(runId)
    // The executor records its own failures on the task; a rejection here means the row itself vanished,
    // and there is nothing left to write it to.
    .catch(() => undefined)
    .finally(() => runningExtractions.delete(runId));
  return true;
}

/** The distillation tasks this workspace has, newest activity first (the console's own list). */
export async function listResearchExtractionTasks(limit = 20): Promise<TaskView[]> {
  const tasks = await listTaskViews({ kind: "playbook", limit: taskScanLimit });
  return tasks.filter((task) => task.type === researchExtractionPlaybookId).slice(0, limit);
}
