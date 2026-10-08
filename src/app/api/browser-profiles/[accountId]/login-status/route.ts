import { getAccount } from "@/db/repository";
import { getBrowserLoginState } from "@/lib/browser-preview";
import { fail, ok } from "@/lib/api";
import { getPublishProfile } from "@/lib/publish-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await context.params;
  const site = await getAccount(accountId);
  if (!site) {
    return fail("Site not found", 404);
  }

  const profile = await getPublishProfile(site.platform);
  const state = await getBrowserLoginState(accountId, profile.loginTextPatterns);
  return ok(state);
}
