import {
  deleteDifyConnection,
  getDifyConnection,
  updateDifyConnection,
} from "@/db/repositories/dify-connections";
import { fail, ok, parseJson } from "@/lib/api";
import { difyConnectionPatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await parseJson(request, difyConnectionPatchSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const existing = await getDifyConnection(id);
  if (!existing) return fail("NOT_FOUND", 404);
  return ok(await updateDifyConnection(id, parsed.data));
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const existing = await getDifyConnection(id);
  if (!existing) return fail("NOT_FOUND", 404);
  await deleteDifyConnection(id);
  return ok({ deleted: true });
}
