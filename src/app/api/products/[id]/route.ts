import { deleteProduct, getProduct, updateProduct } from "@/db/repositories/products";
import { fail, ok, parseJson } from "@/lib/api";
import { productPatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await parseJson(request, productPatchSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const existing = await getProduct(id);
  if (!existing) return fail("NOT_FOUND", 404);
  return ok(await updateProduct(id, parsed.data));
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const existing = await getProduct(id);
  if (!existing) return fail("NOT_FOUND", 404);
  await deleteProduct(id);
  return ok({ deleted: true });
}
