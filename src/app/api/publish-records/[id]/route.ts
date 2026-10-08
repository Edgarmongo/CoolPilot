import { deletePublishRecord, getPublishRecord, updatePublishRecord } from "@/db/repository";
import { fail, ok, parseJson } from "@/lib/api";
import { publishRecordPatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const record = await getPublishRecord(id);
  if (!record) {
    return fail("Publish record not found", 404);
  }
  return ok(record);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await parseJson(request, publishRecordPatchSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }
  const updated = await updatePublishRecord(id, parsed.data);
  if (!updated) {
    return fail("Publish record not found", 404);
  }
  return ok(updated);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const existing = await getPublishRecord(id);
  if (!existing) {
    return fail("Publish record not found", 404);
  }
  await deletePublishRecord(id);
  return ok({ id });
}
