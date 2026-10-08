import { createPublishRecord, getAccount } from "@/db/repository";
import { fail, ok, parseJson } from "@/lib/api";
import { findAccountLoginBlock } from "@/lib/account-health";
import { publishToSite, type PublishSiteResult } from "@/lib/publish";
import type { PublishRecordStatus } from "@/lib/types";
import { publishInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

// Map a browser publish outcome onto a publish-log status.
const recordStatusByResult: Record<PublishSiteResult["status"], PublishRecordStatus> = {
  published: "published",
  drafted: "drafted",
  login_required: "failed",
  unsupported: "failed",
  failed: "failed",
};

export async function POST(request: Request) {
  const parsed = await parseJson(request, publishInputSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const { accountIds, title, text, imagePath, videoPath, publish, contentType, method, terminal, contentItemId } = parsed.data;
  const results: PublishSiteResult[] = [];

  for (const accountId of accountIds) {
    const site = await getAccount(accountId);
    if (!site) {
      results.push({ accountId, accountName: "", platform: "", status: "failed", error: "Site not found" });
      await createPublishRecord({
        accountId,
        title,
        contentType,
        method,
        terminal,
        contentItemId,
        status: "failed",
        message: "Site not found",
      });
      continue;
    }

    // Publish pre-check (账号健康度风控): when the last sign-in probe already
    // landed on the platform's login page, launching a browser would only fail
    // after a minute of work, so the account is reported as login_required.
    const loginBlock = await findAccountLoginBlock(site.id);
    if (loginBlock) {
      const message = `Login required (account health check @ ${new Date(loginBlock.checkedAt).toISOString()})`;
      results.push({
        accountId: site.id,
        accountName: site.name,
        platform: site.platform,
        status: "login_required",
        url: loginBlock.url,
        error: message,
      });
      await createPublishRecord({
        accountId: site.id,
        accountName: site.name,
        platform: site.platform,
        title,
        contentType,
        method,
        terminal,
        contentItemId,
        status: "failed",
        url: loginBlock.url,
        message,
      });
      continue;
    }

    const result = await publishToSite(site, { title, text, imagePath, videoPath, publish });
    results.push(result);
    const status = recordStatusByResult[result.status];
    await createPublishRecord({
      accountId: site.id,
      accountName: site.name,
      platform: site.platform,
      title,
      contentType,
      method,
      terminal,
      contentItemId,
      status,
      url: result.url ?? "",
      message: result.error ?? "",
      publishedAt: status === "published" ? Date.now() : undefined,
    });
  }

  return ok({ results });
}
