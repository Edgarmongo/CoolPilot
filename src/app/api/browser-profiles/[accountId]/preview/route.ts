import { getAccount } from "@/db/repository";
import { fail, ok } from "@/lib/api";
import {
  getBrowserPreviewSession,
  startBrowserPreviewSession,
  stopBrowserPreviewSession,
} from "@/lib/browser-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params;
  const session = getBrowserPreviewSession(accountId);
  return ok({
    ...session,
    accountId: session.accountId || accountId,
  });
}

export async function POST(_request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params;
  const site = await getAccount(accountId);
  if (!site) {
    return fail("Site not found", 404);
  }

  const session = await startBrowserPreviewSession(site);
  if (session.status === "error") {
    return fail(session.error || "Failed to start browser preview", 500, session);
  }

  return ok(session);
}

export async function DELETE(_request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params;
  await stopBrowserPreviewSession(accountId);
  return ok({ accountId, stopped: true });
}