import { appendRunEvent, createRun, getRun, listRuns, updateRunStatus } from "@/db/repository";
import { createResearchMaterial, listResearchMaterials, recordResearchFetch } from "@/db/repositories/research";
import { taskScanLimit, listTaskViews } from "@/lib/tasks/task-library";
import type { TaskView } from "@/lib/tasks/task-view";
import type { RunRecord } from "@/lib/types";
import {
  chooseTranscriptionProvider,
  resolveTranscriptionSource,
  type TranscriptionLogEntry,
  type TranscriptionSource,
} from "./providers";
import {
  TranscriptionFailure,
  isTranscriptionFailure,
  transcriptBody,
  transcriptMetadataSchema,
  transcriptionRunRequestSchema,
  type TranscriptionFailureCode,
  type TranscriptionProviderId,
  type TranscriptionRunRequest,
  type TranscriptionSegmentRecord,
} from "./transcription";

/**
 * The transcription task as a task of the existing task system (CI-P3-02).
 *
 * A transcription is one row of `runs` with `playbook_id = media_transcription`, exactly like CI-P1-04's
 * render task: no transcription table, no second status vocabulary, and the console reads it through
 * `GET /api/tasks/<id>` with real progress (from its own `run_events`), a real error and the existing
 * cancellation rule. The worker dispatches it like every other playbook (`src/worker/runner.ts`), and the
 * API route runs it in-process because a transcript takes minutes - which is the one thing this file has
 * to get right about concurrency:
 *
 * - **In-process duplication is prevented by a set.** `startTranscriptionTask()` refuses to run a task it
 *   is already running in this process.
 * - **Cross-process duplication cannot be prevented by this build** (the repository hands out no
 *   compare-and-set claim), so it is made *harmless* instead: the material write is idempotent per task
 *   (`findMaterialByTaskId()`), which means two executions of one row produce one transcript and one
 *   material, not two.
 * - **A restart is not a hang.** A `running` row whose process died is converged to `failed`/`interrupted`
 *   by CI-P1-02's reconciliation (`reconcileInterruptedTasks`), which this file deliberately does not
 *   duplicate.
 *
 * The transcript is written through the repository entry that already means "something was really read"
 * (`recordResearchFetch`), because a transcription *is* a read of a source: the row ends `ready` with the
 * text the engine produced, and a failed run writes the material not at all.
 */

/** The task type a transcription row carries (`runs.playbook_id`); one literal, shared by every writer. */
export const transcriptionPlaybookId = "media_transcription";

/** Where a caller polls the transcription task - the same shape CI-P1-03's `toolTaskLookup()` builds. */
export function transcriptionTaskLookup(taskId: string) {
  return `/api/tasks/${encodeURIComponent(taskId)}`;
}

/**
 * The outer budget of one run.
 *
 * It is a last-resort guard, not the timeout a user experiences: each engine enforces its own (the model
 * gateway call ten minutes, the OS recognizer a multiple of the media's own length, capped at
 * forty-five). This one exists so that an engine that never returns cannot leave a task `running` for
 * ever - the task view would otherwise show a spinner as the only outcome a run can have.
 */
export const transcriptionTaskBudgetMs = 60 * 60_000;

/** The five stages a run reports, so `deriveProgress()` has a real signal to read. */
const stageSteps = { prepare: 1, engine: 2, decode: 2, recognize: 3, provider: 2, store: 4, done: 5, error: 5 } as const;

const transcriptionStageTotal = 5;

export type TranscriptionTaskFailure = { code: TranscriptionFailureCode; message: string };

export type TranscriptionTaskOutcome =
  | {
      kind: "succeeded";
      run: RunRecord;
      /** The research material the transcript was written to. */
      materialId: string;
      providerId: TranscriptionProviderId;
      model: string;
      text: string;
      segments: TranscriptionSegmentRecord[];
      notes: string[];
    }
  | { kind: "failed"; run: RunRecord; failure: TranscriptionTaskFailure }
  /** The row was already terminal when this executor got it; nothing ran again. */
  | { kind: "skipped"; run: RunRecord; reason: string };

/** `queued` and `running` are the two statuses in which a row still has work ahead of it. */
function isInFlight(status: string) {
  return status === "queued" || status === "running";
}

function requestIssues(issues: ReadonlyArray<{ path: readonly PropertyKey[]; code: string }>) {
  return issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.code}`).join("; ");
}

/** The stored request of one transcription row, or a refusal naming what is wrong with it. */
function readStoredRequest(params: Record<string, unknown>): TranscriptionRunRequest {
  const parsed = transcriptionRunRequestSchema.safeParse(params);
  if (!parsed.success) {
    throw new TranscriptionFailure("REQUEST_INVALID", requestIssues(parsed.error.issues));
  }
  return parsed.data;
}

/** True when two requests name the same media file. */
function sameSource(params: Record<string, unknown>, request: TranscriptionRunRequest) {
  return params.sourceRoot === request.sourceRoot && params.sourceFileName === request.sourceFileName;
}

/**
 * The run a repeat submission should reuse instead of starting another one.
 *
 * Two rules, deliberately different, because the two cases are different promises:
 *
 * - **With an `idempotencyKey`, the key decides.** Any earlier run carrying that key answers the
 *   submission, whatever its status - the caller asked for exactly-once and named the operation.
 * - **Without a key, only work in flight is collapsed.** A second submission while the first is still
 *   `queued`/`running` returns that task instead of queueing a duplicate; once the first is terminal, a
 *   new submission is a new run, because "transcribe it again" is a legitimate thing to ask for.
 */
async function findReusableTask(request: TranscriptionRunRequest): Promise<RunRecord | null> {
  const candidates = (await listRuns(taskScanLimit)).filter((run) => run.playbookId === transcriptionPlaybookId);
  if (request.idempotencyKey) {
    return (
      candidates.find((run) => {
        const stored = run.params.idempotencyKey;
        return typeof stored === "string" && stored === request.idempotencyKey;
      }) ?? null
    );
  }
  return candidates.find((run) => isInFlight(run.status) && sameSource(run.params, request)) ?? null;
}

export type CreatedTranscriptionTask = {
  run: RunRecord;
  /** True when an earlier submission's task was returned instead of a new one being created. */
  reused: boolean;
};

/**
 * Creates the transcription task. The request is stored exactly as it was accepted (`runs.params_json` is
 * the request, not the outcome), so a task's own record shows what the caller asked for - and the
 * executor re-reads it from there, which is why a `queued` row created through `POST /api/runs` with junk
 * parameters lands on `REQUEST_INVALID` instead of crashing an engine.
 */
export async function createTranscriptionTask(raw: unknown): Promise<CreatedTranscriptionTask> {
  const parsed = transcriptionRunRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TranscriptionFailure("REQUEST_INVALID", requestIssues(parsed.error.issues));
  }
  const request = parsed.data;

  const existing = await findReusableTask(request);
  if (existing) return { run: existing, reused: true };

  const run = await createRun({ playbookId: transcriptionPlaybookId, params: request });
  if (!run) {
    throw new Error("The transcription task was created but could not be read back.");
  }
  return { run, reused: false };
}


/** The material an earlier execution of this same task already wrote, if there is one. */
async function findMaterialByTaskId(taskId: string) {
  const materials = await listResearchMaterials();
  return materials.find((material) => material.transcript?.taskId === taskId) ?? null;
}

/** A title for a material this run creates: what the caller asked for, else the file's own name. */
function materialTitle(request: TranscriptionRunRequest, source: TranscriptionSource) {
  const asked = request.title.trim();
  if (asked) return asked;
  const dot = source.fileName.lastIndexOf(".");
  return dot > 0 ? source.fileName.slice(0, dot) : source.fileName;
}

/**
 * Writes the transcript into a research material (P3-02-05).
 *
 * Three cases, in this order, and the order is the whole point:
 *
 * 1. **The request named a material** - it is updated, so "transcribe again into this material" replaces
 *    the text instead of leaving two rows behind.
 * 2. **This task already wrote one** - it is updated, which is what makes a doubly-executed row produce
 *    one material instead of two.
 * 3. **Otherwise a new material is created**, carrying the source file, the engine and the segments: a
 *    transcript row stays self-describing after the task's own log is gone.
 */
async function writeTranscriptMaterial(input: {
  request: TranscriptionRunRequest;
  source: TranscriptionSource;
  taskId: string;
  providerId: string;
  model: string;
  language: string;
  durationMs: number | null;
  responseFormat: "verbose_json" | "json" | "local";
  segments: TranscriptionSegmentRecord[];
  body: string;
}) {
  const transcriptJson = JSON.stringify(
    transcriptMetadataSchema.parse({
      taskId: input.taskId,
      providerId: input.providerId,
      model: input.model,
      language: input.language,
      durationMs: input.durationMs,
      sourceRoot: input.source.root,
      sourceFileName: input.source.fileName,
      sourceSizeBytes: input.source.sizeBytes,
      responseFormat: input.responseFormat,
      segments: input.segments,
      createdAt: Date.now(),
    }),
  );
  const statusMessage = `转录 ${input.source.fileName} · ${input.providerId}${input.model ? `/${input.model}` : ""}`;
  const fetchedAt = Date.now();

  const target = input.request.materialId
    ? input.request.materialId
    : ((await findMaterialByTaskId(input.taskId))?.id ?? "");

  if (target) {
    const updated = await recordResearchFetch(target, {
      status: "ready",
      content: input.body,
      statusMessage,
      transcriptJson,
      fetchedAt,
    });
    // A material deleted between the request and the write is not resurrected by id; the transcript is
    // still worth keeping, so the create below runs instead.
    if (updated) return updated;
  }

  return createResearchMaterial({
    title: materialTitle(input.request, input.source),
    kind: input.source.kind,
    content: input.body,
    sourceUrl: input.request.sourceUrl,
    fileName: input.source.fileName,
    status: "ready",
    statusMessage,
    transcriptJson,
    fetchedAt,
  });
}


/**
 * Runs one transcription task: validate the stored request, pick an engine, recognise, store the
 * transcript, and write the terminal status.
 *
 * The order of the two writers at the end matters as much as the work itself: the material is written
 * **before** the task is marked successful, so a task that says `success` always has a material behind it
 * - and a failure leaves the material exactly as it was, because nothing was written.
 */
export async function executeTranscriptionTask(runId: string): Promise<TranscriptionTaskOutcome> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Transcription task "${runId}" does not exist.`);
  if (run.playbookId !== transcriptionPlaybookId) {
    throw new Error(`Task "${runId}" is a "${run.playbookId}" task, not a transcription task.`);
  }
  if (!isInFlight(run.status)) {
    return { kind: "skipped", run, reason: `the task already reached "${run.status}"` };
  }

  /** Every engine line lands in `run_events` with the stage it belongs to, which is what progress reads. */
  const log = async (entry: TranscriptionLogEntry) => {
    const step = stageSteps[entry.stage as keyof typeof stageSteps] ?? 1;
    await appendRunEvent(run.id, entry.message, entry.level ?? "info", {
      stage: entry.stage,
      current: entry.progress?.current ?? step,
      total: entry.progress?.total ?? transcriptionStageTotal,
      ...(entry.data ?? {}),
    });
  };

  // Claiming writes `running`, which is what gives the task view a real `startedAt`.
  await updateRunStatus(run.id, "running");

  try {
    const request = readStoredRequest(run.params);
    const source = await resolveTranscriptionSource({
      root: request.sourceRoot,
      fileName: request.sourceFileName,
    });
    await log({
      stage: "prepare",
      message: `Transcription accepted: "${source.fileName}" (${source.sizeBytes} bytes, ${source.kind}) from the ${source.root} section`,
      data: { sourceRoot: source.root, sourceFileName: source.fileName, sourceBytes: source.sizeBytes },
    });

    const chosen = await chooseTranscriptionProvider(request.providerId);
    for (const attempt of chosen.tried) {
      if (attempt.available) continue;
      await log({
        stage: "provider",
        level: "warn",
        message: `Not running on ${attempt.providerId}: ${attempt.detail}`,
        data: { providerId: attempt.providerId, available: false },
      });
    }
    await log({
      stage: "provider",
      message: `Running on ${chosen.provider.id} (${chosen.availability.detail})`,
      data: { providerId: chosen.provider.id, requestedProviderId: request.providerId },
    });

    const result = await withBudget(transcriptionTaskBudgetMs, () =>
      chosen.provider.transcribe({ source, language: request.language, log }),
    );

    const body = transcriptBody(result.text, result.segments);
    if (!body) {
      throw new TranscriptionFailure("TRANSCRIPTION_EMPTY", "the engine returned no text for this file");
    }

    await log({
      stage: "store",
      message: `Saving the transcript as a research material (${body.length} characters, ${result.segments.length} segments)`,
    });
    const material = await writeTranscriptMaterial({
      request,
      source,
      taskId: run.id,
      providerId: result.providerId,
      model: result.model,
      language: result.language,
      durationMs: result.durationMs,
      responseFormat: result.responseFormat,
      segments: result.segments,
      body,
    });
    if (!material) {
      throw new TranscriptionFailure("TRANSCRIPTION_FAILED", "the transcript could not be stored");
    }

    const message =
      `Transcript of "${source.fileName}" stored as "${material.title}" ` +
      `(${body.length} chars, ${result.segments.length} segments, ${result.providerId}${result.model ? `/${result.model}` : ""})`;
    await updateRunStatus(run.id, "success", message);
    await appendRunEvent(run.id, message, "success", {
      stage: "done",
      current: transcriptionStageTotal,
      total: transcriptionStageTotal,
      materialId: material.id,
      providerId: result.providerId,
      model: result.model,
      language: result.language,
      durationMs: result.durationMs,
      responseFormat: result.responseFormat,
      segments: result.segments.length,
      characters: body.length,
      notes: result.notes,
    });

    return {
      kind: "succeeded",
      run: (await getRun(run.id)) ?? run,
      materialId: material.id,
      providerId: result.providerId,
      model: result.model,
      text: body,
      segments: result.segments,
      notes: result.notes,
    };
  } catch (error) {
    const failure: TranscriptionTaskFailure = isTranscriptionFailure(error)
      ? { code: error.code, message: error.message }
      : {
          code: "TRANSCRIPTION_FAILED",
          message: `TRANSCRIPTION_FAILED: ${error instanceof Error ? error.message : String(error)}`,
        };
    await updateRunStatus(run.id, "failed", failure.message);
    await appendRunEvent(run.id, failure.message, "error", {
      stage: "error",
      current: transcriptionStageTotal,
      total: transcriptionStageTotal,
      code: failure.code,
    });
    return { kind: "failed", run: (await getRun(run.id)) ?? run, failure };
  }
}


/**
 * One engine call under this run's outer budget (see `transcriptionTaskBudgetMs`).
 *
 * The engines enforce their own timeouts and kill their own child processes; this race exists so that a
 * provider which never settles still ends the task, with a code the console can name.
 */
async function withBudget<T>(budgetMs: number, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new TranscriptionFailure("TRANSCRIPTION_TIMEOUT", `the run exceeded its ${budgetMs} ms budget`)),
          budgetMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Task ids this process is currently executing.
 *
 * In-process only, and deliberately so: it stops the API route from starting a second execution of a row
 * it is already running. A worker in another process claiming the same row is handled one level down, by
 * the material write being idempotent per task.
 */
const runningTranscriptions = new Set<string>();

/**
 * Starts a task in the background and returns immediately.
 *
 * A transcript takes minutes, so the API route must not hold the request open for it: the row is created
 * `queued`, the route answers with its id and where to poll, and this call moves it to `running` and on
 * to a terminal status while the console polls `GET /api/tasks/<id>` - the same shape CI-P1-04's render
 * tool reports, with the wall-clock difference the two really have.
 */
export function startTranscriptionTask(runId: string) {
  if (runningTranscriptions.has(runId)) return false;
  runningTranscriptions.add(runId);
  void executeTranscriptionTask(runId)
    // The executor records its own failures on the task; a rejection here means the row itself vanished,
    // and there is nothing left to write it to.
    .catch(() => undefined)
    .finally(() => runningTranscriptions.delete(runId));
  return true;
}

/** The transcription tasks this workspace has, newest activity first (the console's own list). */
export async function listTranscriptionTasks(limit = 20): Promise<TaskView[]> {
  const tasks = await listTaskViews({ kind: "playbook", limit: taskScanLimit });
  return tasks.filter((task) => task.type === transcriptionPlaybookId).slice(0, limit);
}

