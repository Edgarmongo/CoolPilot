import { deleteKnowledgeBase, getKnowledgeBase, updateKnowledgeBase } from "@/db/repositories/knowledge-base";
import { fail, ok, parseJson } from "@/lib/api";
import { knowledgeBasePatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await parseJson(request, knowledgeBasePatchSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const existing = await getKnowledgeBase(id);
  if (!existing) return fail("NOT_FOUND", 404);
  return ok(await updateKnowledgeBase(id, parsed.data));
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const existing = await getKnowledgeBase(id);
  if (!existing) return fail("NOT_FOUND", 404);
  await deleteKnowledgeBase(id);
  return ok({ deleted: true });
}
