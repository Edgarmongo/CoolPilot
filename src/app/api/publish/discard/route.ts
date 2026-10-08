import { fail, ok } from "@/lib/api";
import { discardDraft } from "@/lib/browser-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Assisted publish, cleanup: when the author abandons the editor, best-effort
 * delete the draft that the prefill created. Platform-specific; not guaranteed.
 */
export async function POST(request: Request) {
  let accountId = "";
  try {
    const body = (await request.json()) as { accountId?: string } | undefined;
    accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";
  } catch {
    // ignore malformed body
  }
  if (!accountId) return fail("accountId is required", 400);

  const result = await discardDraft(accountId);
  return ok(result);
}
