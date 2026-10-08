import { deletePosition, getPosition, setDefaultPosition, updatePosition } from "@/db/repositories/positions";
import { fail, ok } from "@/lib/api";
import type { PositionDraft } from "@/lib/types";
import { positionDraftSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const patchableKeys = new Set(Object.keys(positionDraftSchema.shape));

/**
 * Keeps only the keys the client actually sent (and that the draft schema knows), so the
 * schema's field defaults can never clobber values already stored on the record.
 */
function definedPatch(raw: Record<string, unknown>, parsed: Record<string, unknown>): Partial<PositionDraft> {
  const patch: Record<string, unknown> = {};
  for (const key of patchableKeys) {
    if (!(key in raw)) continue;
    if (parsed[key] === undefined) continue;
    patch[key] = parsed[key];
  }
  return patch as Partial<PositionDraft>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const position = await getPosition(id);
  if (!position) return fail("NOT_FOUND", 404);
  return ok(position);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const existing = await getPosition(id);
  if (!existing) return fail("NOT_FOUND", 404);

  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = positionDraftSchema.partial().safeParse(raw);
  if (!parsed.success) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const updated = await updatePosition(id, definedPatch(raw, parsed.data as Record<string, unknown>));
  if (!updated) return fail("NOT_FOUND", 404);

  if (raw.isDefault === true) {
    await setDefaultPosition(id);
  }
  return ok(await getPosition(id));
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const existing = await getPosition(id);
  if (!existing) return fail("NOT_FOUND", 404);
  await deletePosition(id);
  return ok({ deleted: true });
}
