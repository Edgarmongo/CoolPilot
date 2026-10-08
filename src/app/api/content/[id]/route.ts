import { deleteContentItem, getContentItem, updateContentItem } from "@/db/repository";
import { fail, ok, parseJson } from "@/lib/api";
import { contentPatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const item = await getContentItem(id);
  if (!item) return fail("NOT_FOUND", 404);
  return ok(item);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await parseJson(request, contentPatchSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const existing = await getContentItem(id);
  if (!existing) return fail("NOT_FOUND", 404);
  const { images, themeId, ...rest } = parsed.data;
  const updated = await updateContentItem(id, {
    ...rest,
    images,
    metadata: themeId ? { themeId } : undefined,
    // Clearing the image list must also clear the cover path.
    imagePath: images ? (images[0] ?? "") : undefined,
  });
  return ok(updated);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const existing = await getContentItem(id);
  if (!existing) return fail("NOT_FOUND", 404);
  await deleteContentItem(id);
  return ok({ deleted: true });
}
