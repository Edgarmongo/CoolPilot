import { getResearchMaterial, updateResearchExtraction } from "@/db/repositories/research";
import { fail, ok, parseJson } from "@/lib/api";
import {
  isResearchExtractionFailure,
  researchExtractionIsStale,
} from "@/lib/research-extraction/extraction";
import {
  createResearchExtractionTask,
  extractionSourceOf,
  researchExtractionTaskLookup,
  startResearchExtractionTask,
} from "@/lib/research-extraction/extraction-task";
import { findTaskView } from "@/lib/tasks/task-library";
import { researchExtractionCreateSchema, researchExtractionEditSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One material's 研究提炼 of CI-P3-03 of `docs/coolpilot-capability-integration-plan.md`.
 *
 *   GET    /api/research/<id>/extraction -> { extraction, history, stale, ... }
 *   POST   /api/research/<id>/extraction -> { taskId, lookup, reused, started, task }
 *   PATCH  /api/research/<id>/extraction -> the edited extraction
 *
 * **The stored result is read, never the run.** `GET` answers the material's own columns - the current
 * version and the ones it replaced - plus `stale`, which the *shared* pure function computes by comparing
 * the stored fingerprint with the material's text as it is now. So "素材改过了，这份提炼是旧的" is a
 * comparison of two values, not a timestamp nobody can interpret.
 *
 * **`POST` creates a task and starts it**, because a distillation is a model call over a long text and the
 * request may not be held open for it. The two flags say what happened, exactly as `POST /api/transcription`
 * does: `reused` - an earlier submission (same `idempotencyKey`, or a run still in flight for this
 * material) answered instead of a second row; `started` - this call began the execution in this process.
 * Either way the caller's job is the same: poll `lookup`.
 *
 * **`PATCH` edits the current version and nothing else.** It cannot create one (a material with no
 * extraction answers 404 - there is nothing to edit), it cannot touch `content`, and it cannot rewrite the
 * run a version came from: `updateResearchExtraction` stamps `editedAt` and leaves `revision`, `taskId`
 * and `model` exactly as the run wrote them.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const material = await getResearchMaterial(id);
  if (!material) return fail("NOT_FOUND", 404);
  const source = extractionSourceOf(material);
  return ok({
    materialId: material.id,
    materialTitle: material.title,
    /** The material's own version number (`updatedAt`), the same one an article records. */
    materialVersion: material.updatedAt,
    extraction: material.extraction,
    history: material.extractionHistory,
    stale: material.extraction ? researchExtractionIsStale(material.extraction, source) : false,
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await parseJson(request, researchExtractionCreateSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const material = await getResearchMaterial(id);
  if (!material) return fail("NOT_FOUND", 404);
  // A material with no text is refused *before* a task exists: the executor would refuse it a second
  // later anyway (`MATERIAL_EMPTY`), and a task nobody can finish is worse than an honest 400.
  if (!extractionSourceOf(material).content.trim()) {
    return fail("INVALID_PAYLOAD", 400, {
      code: "MATERIAL_EMPTY",
      message: `"${material.title}" has no text to distil`,
    });
  }

  try {
    const { run, reused } = await createResearchExtractionTask({
      materialId: id,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    const inFlight = run.status === "queued" || run.status === "running";
    const started = inFlight ? startResearchExtractionTask(run.id) : false;
    // The view is read back from the task system rather than composed here: the status a caller polls is
    // the one CI-P1-02 gave that row, including the `running` the execution above may already have written.
    const task = (await findTaskView(run.id)) ?? null;
    return ok({ taskId: run.id, lookup: researchExtractionTaskLookup(run.id), reused, started, task }, {
      status: reused ? 200 : 201,
    });
  } catch (error) {
    if (isResearchExtractionFailure(error)) {
      return fail("INVALID_PAYLOAD", 400, { code: error.code, message: error.message });
    }
    throw error;
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await parseJson(request, researchExtractionEditSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const existing = await getResearchMaterial(id);
  if (!existing) return fail("NOT_FOUND", 404);
  if (!existing.extraction) {
    return fail("NOT_FOUND", 404, { reason: "no extraction has been stored for this material" });
  }

  const updated = await updateResearchExtraction(id, parsed.data);
  if (!updated?.extraction) return fail("NOT_FOUND", 404);
  return ok(updated.extraction);
}
