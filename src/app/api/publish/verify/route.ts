import { getAccount } from "@/db/repository";
import { fail, ok } from "@/lib/api";
import { checkPublishResult, takePublishReceipt } from "@/lib/browser-preview";
import { recordPublishSuccess } from "@/lib/publish-facts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Assisted publish, step 2: poll whether the author has published on the live
 * session page (left the editor URL / success confirmation visible).
 *
 * Since C2 (`docs/creator-workflow-audit.md`) this is also where a verified success becomes a
 * fact: the same request that tells the dialog 已发布 writes the `publish_records` row and moves
 * the content item to `posted` (`src/lib/publish-facts.ts`).
 *
 * Two conditions, both required, and neither is the client's word: the check must report success,
 * and this process must still be holding the receipt of the draft that produced it. Success
 * without a receipt is a client claiming a fact the server cannot attribute to a content item, so
 * it is reported and nothing is written (D1). Taking the receipt consumes it, so the polls that
 * repeat while the dialog is still advancing cannot write a second row. If the write itself fails
 * the request is a 500 - the client keeps polling and the next poll finds no receipt, so the fact
 * is lost rather than duplicated: a real publish loses a row, a fake one never gets one.
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
  if (!result.published) return ok(result);

  const account = await getAccount(accountId);
  if (!account) return ok(result);
  const receipt = takePublishReceipt(accountId);
  if (!receipt) return ok(result);

  await recordPublishSuccess({ account, receipt, url: result.url, evidence: result.evidence });
  return ok(result);
}
