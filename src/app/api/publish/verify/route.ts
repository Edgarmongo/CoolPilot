import { fail, ok } from "@/lib/api";
import { checkPublishResult } from "@/lib/browser-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Assisted publish, step 2: poll whether the author has published on the live
 * session page (left the editor URL / success confirmation visible).
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

  const result = await checkPublishResult(accountId);
  return ok(result);
}
