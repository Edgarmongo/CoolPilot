import { getAccount } from "@/db/repository";
import { fail, ok } from "@/lib/api";
import { startBrowserPreviewSession } from "@/lib/browser-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params;
  const site = await getAccount(accountId);
  if (!site) {
    return fail("Site not found", 404);
  }

  let headless = false;
  try {
    const body = (await request.json()) as { headless?: boolean } | undefined;
    headless = Boolean(body?.headless);
  } catch {
    // ignore malformed body; default to a visible window
  }

  const session = await startBrowserPreviewSession(site, { bringToFront: !headless, headless });
  if (session.status === "error") {
    return fail(session.error || "Failed to open browser profile", 500, session);
  }

  return ok({
    launched: true,
    accountId,
    profilePath: site.profilePath,
    session,
  });
}
