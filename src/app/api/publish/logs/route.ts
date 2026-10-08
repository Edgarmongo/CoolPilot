import { fail, ok } from "@/lib/api";
import { getPublishDebugLog, setPublishDebugEnabled } from "@/lib/publish-debug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Assisted publish: return the last run's step log for an account, so the run
 * panel can show/copy what the automation actually did — which selectors
 * matched, which buttons were clicked, how verification polled, and any
 * screenshots. Pass `debug: true|false` to turn on/off persisting the log and
 * screenshots to disk (otherwise gated by the `COOLPILOT_PUBLISH_DEBUG` env var).
 */
export async function POST(request: Request) {
  let accountId = "";
  try {
    const body = (await request.json()) as { accountId?: string; debug?: boolean } | undefined;
    accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";
    if (typeof body?.debug === "boolean") {
      setPublishDebugEnabled(body.debug);
    }
  } catch {
    // ignore malformed body
  }
  if (!accountId) return fail("accountId is required", 400);

  return ok(getPublishDebugLog(accountId));
}
