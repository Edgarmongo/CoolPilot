import { deleteAccount, updateAccount } from "@/db/repository";
import { fail, ok, parseJson } from "@/lib/api";
import { siteInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await parseJson(request, siteInputSchema.partial());
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }
  return ok(await updateAccount(id, parsed.data));
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await deleteAccount(id);
  return ok({ deleted: true });
}
