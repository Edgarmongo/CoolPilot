import { createPublishRecord, markContentItemPosted } from "@/db/repository";
import type { PublishDraftReceipt } from "@/lib/browser-preview-shared";
import type { AccountRecord, ContentItem, PublishRecord } from "@/lib/types";

/**
 * The publish fact (C2 of `docs/creator-workflow-audit.md`): the one place where "this content was
 * published to this account" becomes database state.
 *
 * It is deliberately not a publish service. It does not open a browser, does not decide whether a
 * publish happened, does not look an account up and does not know that a session exists - the
 * verify step has already made that judgement and hands the outcome here. What this module owns is
 * the pair of writes that must not drift apart: the `publish_records` row and the content item's
 * move to `posted`. Automatic publishing is not rejected, it is later: a future Workflow trigger
 * comes through this same door with its own evidence.
 *
 * The layer order it keeps is Browser -> fact -> database, never fact -> browser.
 */

export type PublishSuccessFact = {
  account: Pick<AccountRecord, "id" | "name" | "platform">;
  /** The receipt of the draft this success belongs to, taken from the session that drafted it. */
  receipt: PublishDraftReceipt;
  url: string;
  /** How the success was observed; stored verbatim so the row can explain itself later (D5). */
  evidence: string;
  /** Defaults to now - the moment the observation was made. */
  publishedAt?: number;
};

/**
 * Writes the fact and returns what it wrote.
 *
 * `title` and `contentType` come from the draft receipt rather than from the content item, because
 * metric sync matches a platform's post back to a record by title: the row has to describe the
 * publish that actually happened, not whatever the item reads as today.
 *
 * The record is written first. It *is* the fact and `posted` is its consequence, so a failure in
 * the second write leaves a record without a status move rather than a status move without a
 * record. A content item deleted between the draft and the verify keeps its record for the same
 * reason: the publish still happened.
 */
export async function recordPublishSuccess(fact: PublishSuccessFact): Promise<{
  record: PublishRecord | null;
  content: ContentItem | null;
}> {
  const record = await createPublishRecord({
    accountId: fact.account.id,
    accountName: fact.account.name,
    platform: fact.account.platform,
    contentItemId: fact.receipt.contentItemId,
    title: fact.receipt.title,
    contentType: fact.receipt.contentType,
    status: "published",
    url: fact.url,
    method: fact.receipt.method,
    terminal: fact.receipt.terminal,
    message: fact.evidence,
    publishedAt: fact.publishedAt ?? Date.now(),
  });

  const content = await markContentItemPosted(fact.receipt.contentItemId);

  return { record, content };
}
