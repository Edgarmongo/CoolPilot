import { deleteBrand, getBrand, updateBrand } from "@/db/repositories/brands";
import { fail, ok, parseJson } from "@/lib/api";
import { brandPatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * One brand profile (CI-P2-02 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * `GET` exists because the writing wizard reads a brand back when a saved config carries its id: the
 * id has to arrive as data, and a brand that is gone answers 404 instead of silently writing as
 * "no brand". Deleting is allowed because a brand is a user-authored record with no lifecycle of its
 * own (unlike a topic, it has no archive state); articles keep the id and the version they were
 * written with, so a deletion does not rewrite history.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const brand = await getBrand(id);
  if (!brand) return fail("NOT_FOUND", 404);
  return ok(brand);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await parseJson(request, brandPatchSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const existing = await getBrand(id);
  if (!existing) return fail("NOT_FOUND", 404);
  return ok(await updateBrand(id, parsed.data));
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const existing = await getBrand(id);
  if (!existing) return fail("NOT_FOUND", 404);
  await deleteBrand(id);
  return ok({ deleted: true });
}
