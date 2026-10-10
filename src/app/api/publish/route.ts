import { createPublishRecord, getAccount } from "@/db/repository";
import { fail, ok, parseJson } from "@/lib/api";
import { findAccountLoginBlock } from "@/lib/account-health";
import { publishToSite, type PublishSiteResult } from "@/lib/publish";
import { summarizePublishResults } from "@/lib/publish-results";
import type { AccountRecord, PublishRecordStatus } from "@/lib/types";
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
    // One account, one entry: however this account ends up being handled, `results` gains exactly one
    // item for it, which is what keeps it index-aligned with `accountIds` (I1) in the middle of a batch.
    const entryIndex = results.length;
    let site: AccountRecord | null = null;

    try {
      site = await getAccount(accountId);
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
      // The platform's own answer is reported before it is recorded, because it is the only evidence
      // of what the platform did: a log write that fails must not be able to erase it (card §1.3 -
      // "the record was not written" is not "nothing was published").
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
    } catch (error) {
      // 5b of the card: the router itself threw for this account. The batch does not stop here - one
      // account this workspace cannot handle is no reason to leave the accounts after it unheard.
      const pushed = results[entryIndex];
      if (pushed) {
        // Its outcome was already known when the write failed (the write is the last step of every
        // branch above), so the entry stands and is merely marked: the mark is what
        // `summarizePublishResults` counts as `unexpected`, and replacing the entry - or dropping it -
        // would report a platform action that really happened as if it never had.
        results[entryIndex] = { ...pushed, errorKind: "unexpected" };
      } else {
        results.push({
          accountId,
          accountName: site?.name ?? "",
          platform: site?.platform ?? "",
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          errorKind: "unexpected",
        });
      }
    }
  }

  const summary = summarizePublishResults(results);

  // The five per-account statuses cannot express "the router never managed to handle this account", so
  // a batch it threw on is reported by how much of it is actually spoken for (5b of the card):
  //   - something delivered: the 200 still has an honest answer to give, and `summary.unexpected` says
  //     how many accounts were left unfinished;
  //   - nothing delivered: there is no account of the run at all, and a 200 would read as "nothing was
  //     published" - a claim the router is in no position to make.
  // The 500 carries `retrySafe: false`: without an idempotency key a platform action may have
  // happened, so retrying is the author's decision after checking the records, never the client's.
  if (summary.unexpected > 0 && summary.delivered === 0) {
    return fail("PUBLISH_RUN_FAILED", 500, { results, summary, retrySafe: false });
  }

  return ok({ results, summary });
}
