import { deleteResearchMaterial, getResearchMaterial, updateResearchMaterial } from "@/db/repositories/research";
import { fail, ok, parseJson } from "@/lib/api";
import { derivedResearchStatus } from "@/lib/research";
import { researchMaterialPatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * One research material (CI-P3-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * `GET` exists because the generation entries read a material by id: the id has to arrive as data, and a
 * material that is gone answers 404 so the caller can say so instead of writing about nothing.
 *
 * `PATCH` edits what the user owns (title / kind / content / source url / tags) and nothing about the
 * read: `status`, `statusMessage` and `fetchedAt` are not in the payload at all, so an edit can neither
 * claim a successful read nor erase the record of one. One case does move the read state, and it has to:
 * re-pointing the source url means the stored text is no longer known to come from the new page, so the
 * read facts are cleared (`fetchedAt: null`, reason dropped) and the status goes back to what a record
 * with this content honestly is - `ready` when there is text to write from, `draft` when there is not.
 * The text itself is kept: it is the record's own material, and reading the new source is what replaces
 * it (`api/research/[id]/fetch`), not an edit.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const material = await getResearchMaterial(id);
  if (!material) return fail("NOT_FOUND", 404);
  return ok(material);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await parseJson(request, researchMaterialPatchSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const existing = await getResearchMaterial(id);
  if (!existing) return fail("NOT_FOUND", 404);

  const patch = parsed.data;
  const sourceUrl = patch.sourceUrl?.trim();
  const sourceChanged = sourceUrl !== undefined && sourceUrl !== existing.sourceUrl;
  const content = patch.content !== undefined ? patch.content : existing.content;
  const kind = patch.kind ?? existing.kind;
  if (kind === "url" && !(sourceUrl || existing.sourceUrl).trim()) {
    return fail("INVALID_PAYLOAD", 400, "a url material needs an http(s) source url");
  }
  return ok(
    await updateResearchMaterial(id, {
      ...patch,
      ...(sourceUrl !== undefined ? { sourceUrl } : {}),
      ...(sourceChanged
        ? { status: derivedResearchStatus(content), statusMessage: "", fetchedAt: null }
        : {}),
    }),
  );
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const existing = await getResearchMaterial(id);
  if (!existing) return fail("NOT_FOUND", 404);
  await deleteResearchMaterial(id);
  return ok({ deleted: true });
}
