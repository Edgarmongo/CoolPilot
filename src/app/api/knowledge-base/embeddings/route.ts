import { resolveRoute } from "@/features/ai-runtime";
import { fail, ok, parseJson } from "@/lib/api";
import { isKnowledgeEmbeddingFailure } from "@/lib/knowledge-embedding/embedding";
import {
  createKnowledgeEmbeddingTask,
  knowledgeEmbeddingTaskLookup,
  listKnowledgeEmbeddingTasks,
  startKnowledgeEmbeddingTask,
  summarizeKnowledgeIndex,
} from "@/lib/knowledge-embedding/embedding-task";
import { findTaskView } from "@/lib/tasks/task-library";
import { knowledgeEmbeddingCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The knowledge index of CI-EMB-01 (D10: an explicit entry, never a synchronous call on save).
 *
 *   GET  /api/knowledge-base/embeddings -> { summary, model, tasks }
 *   POST /api/knowledge-base/embeddings -> { taskId, lookup, reused, started, task }
 *
 * **`GET` reads and never spends.** It plans the index against the model the runtime would use for an embedding
 * call - so the "needs indexing" count is the same computation a run performs - and reports what is already
 * stored, plus the recent index tasks. No provider is called, and nothing is written: a screen can poll it.
 *
 * **`POST` creates a task and starts it in this process.** Indexing a knowledge base is a batch of model calls,
 * so the request must not hold it: the route answers with the task's id and where to poll, exactly as
 * `POST /api/transcription` and the distillation entry do. `reused` means an earlier submission (same
 * `idempotencyKey`, or a run still in flight) answered instead of a second row; `started` means this call began
 * the execution here. Either way the caller polls `lookup`.
 *
 * `scope: "rebuild"` is the explicit "recompute everything" - which is how a model change is migrated (D4),
 * because nothing rebuilds the index on its own.
 */
export async function GET() {
  const tasks = await listKnowledgeEmbeddingTasks(10);
  try {
    // The same route resolution an embedding call makes, so the summary describes the index a query would use.
    const resolution = await resolveRoute({ capabilities: ["embedding"], capability: "embedding" });
    const candidate = resolution.candidate;
    if (!candidate) {
      return ok({
        model: null,
        missing: resolution.explanation?.missing ?? ["embedding"],
        summary: null,
        tasks,
      });
    }
    const target = { providerId: candidate.provider.providerId, modelId: candidate.model.modelId };
    return ok({ model: target, missing: [], summary: await summarizeKnowledgeIndex(target), tasks });
  } catch (error) {
    // A summary that cannot be read is reported as such rather than as an empty index: "nothing is indexed" and
    // "we could not find out" are different answers.
    return ok({
      model: null,
      missing: [],
      summary: null,
      tasks,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, knowledgeEmbeddingCreateSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  try {
    const { run, reused } = await createKnowledgeEmbeddingTask(parsed.data);
    const inFlight = run.status === "queued" || run.status === "running";
    const started = inFlight ? startKnowledgeEmbeddingTask(run.id) : false;
    const task = (await findTaskView(run.id)) ?? null;
    return ok({ taskId: run.id, lookup: knowledgeEmbeddingTaskLookup(run.id), reused, started, task }, {
      status: reused ? 200 : 201,
    });
  } catch (error) {
    if (isKnowledgeEmbeddingFailure(error)) {
      return fail("INVALID_PAYLOAD", 400, { code: error.code, message: error.message });
    }
    throw error;
  }
}