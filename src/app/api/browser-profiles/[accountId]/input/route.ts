import { dispatchBrowserInput } from "@/lib/browser-preview";
import { fail, ok, parseJson } from "@/lib/api";
import { browserInputSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params;
  const parsed = await parseJson(request, browserInputSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  try {
    await dispatchBrowserInput(accountId, parsed.data);
    return ok({ ok: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Input dispatch failed", 500);
  }
}
