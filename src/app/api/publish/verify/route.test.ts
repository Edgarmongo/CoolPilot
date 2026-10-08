import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `POST /api/publish/verify` (C2 of `docs/creator-workflow-audit.md`) - the seam where an
 * assisted publish stops being UI state and becomes a fact.
 *
 * Before C2 the verified success existed only in `publish-run-panel`'s tab state: the
 * `publish_records` row was written by a different flow (`/api/publish`) and the content item's
 * `posted` status only by the threads worker, so "the author published" and "the database knows"
 * were unrelated events. What these cases pin is the contract that replaced it - a verified
 * success writes exactly one `publish_records` row *and* moves the item to `posted`, and every
 * other answer writes nothing at all:
 *
 *   - the poll that repeats after the dialog has already advanced (D1: one draft, one fact)
 *   - the author still sitting in the editor, and the same author publishing a minute later
 *   - a success the server cannot attribute to a draft it made (success without a receipt)
 *   - no live session at all
 *   - the content item deleted between the draft and the verify (the fact outlives it)
 *
 * A fake session stands in for the live page (`src/test/browser-session-fixture.ts`), so nothing
 * here needs Playwright, a platform account or the network. The temp database is pinned before
 * anything that reads it is imported, which is why the imports below are `await`s.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-publish-verify-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "publish.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { POST } = await import("./route");
const { createAccount, createContentItem, deleteContentItem, getContentItem, listPublishRecords } =
  await import("@/db/repository");
const { rememberPublishDraft } = await import("@/lib/browser-preview");
const { closeFakeSessions, openFakeSession } = await import("@/test/browser-session-fixture");

/** The page a fake session shows - the fixture's own notion of one, not a second declaration. */
type FakePage = Parameters<typeof openFakeSession>[1];

/** The platform's draft page, as the editor pattern sees it. */
const editorUrl = "https://www.threads.net/post/edit/threads-1";
/** Where the author lands once the post is live. */
const publishedUrl = "https://www.threads.net/@coolpilot/post/abc123";

const verify = (accountId: string) =>
  POST(
    new Request("http://localhost/api/publish/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId }),
    }),
  );

async function mustCreateAccount() {
  const account = await createAccount({ name: "CoolPilot", platform: "Threads", url: "https://www.threads.net/" });
  if (!account) throw new Error("account was not created");
  return account;
}

async function mustCreateItem(title: string) {
  return createContentItem({
    title,
    body: `<p>${title} 的正文。</p>`,
    postReadyText: `${title} 的正文。`,
    status: "ready",
  });
}

/**
 * An account with one content item and an open draft on it - the middle of the assisted flow,
 * just before the author clicks publish.
 */
async function seedDraft(page: FakePage, title = "桌面收纳指南") {
  const account = await mustCreateAccount();
  const item = await mustCreateItem(title);
  const session = openFakeSession(account.id, page);
  rememberPublishDraft(account.id, {
    contentItemId: item.id,
    title,
    contentType: "article",
    method: "manual",
    terminal: "local",
  });
  return { account, item, session };
}

/** Every record this file's database holds; the "writes nothing" cases compare before and after. */
const recordCount = async () => (await listPublishRecords()).length;

const recordsFor = async (itemId: string) =>
  (await listPublishRecords()).filter((record) => record.contentItemId === itemId);

afterEach(() => {
  closeFakeSessions();
});

describe("POST /api/publish/verify", () => {
  it("writes one published record and moves the item to posted when the session left the editor", async () => {
    const { account, item } = await seedDraft({ url: publishedUrl });

    const response = await verify(account.id);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, data: { published: true, url: publishedUrl } });

    const records = await recordsFor(item.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      accountId: account.id,
      accountName: "CoolPilot",
      platform: "Threads",
      contentItemId: item.id,
      // Title and type come from the draft, not from a re-read of the item: metric sync matches a
      // platform post back to a record by title.
      title: "桌面收纳指南",
      contentType: "article",
      status: "published",
      url: publishedUrl,
      method: "manual",
      terminal: "local",
      // D5: the row carries the observation that authorized it.
      message: `session left the editor URL at ${publishedUrl}`,
    });
    expect(records[0].publishedAt).toBeGreaterThan(0);
    expect((await getContentItem(item.id))?.status).toBe("posted");
  });

  it("keeps the record at one when the dialog polls the same success again", async () => {
    const { account, item } = await seedDraft({ url: publishedUrl });
    await verify(account.id);
    const before = await recordCount();

    const response = await verify(account.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { published: true } });
    // The receipt was consumed by the first success, so the repeating poll has nothing to record.
    expect(await recordCount()).toBe(before);
    expect(await recordsFor(item.id)).toHaveLength(1);
    expect((await getContentItem(item.id))?.status).toBe("posted");
  });

  it("keeps the record when the content item was deleted after the draft", async () => {
    const { account, item } = await seedDraft({ url: publishedUrl });
    // The author publishes and then throws the local draft away. The publish happened, and deleting
    // what it came from does not undo it: the fact outlives the content item it was attributed to.
    await deleteContentItem(item.id);

    await verify(account.id);

    const records = await recordsFor(item.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      contentItemId: item.id,
      status: "published",
      url: publishedUrl,
    });
    // The consequence of the fact went with the item, and that is a no-op rather than a failure.
    expect(await getContentItem(item.id)).toBeNull();
  });

  it("writes nothing while the author is still in the editor, and records it once they publish", async () => {
    const { account, item, session } = await seedDraft({ url: editorUrl, bodyText: "发布 保存草稿" });
    const before = await recordCount();

    const stillEditing = await verify(account.id);

    await expect(stillEditing.json()).resolves.toMatchObject({
      data: { published: false, url: editorUrl, evidence: `still the editor URL ${editorUrl}` },
    });
    expect(await recordCount()).toBe(before);
    expect(await recordsFor(item.id)).toHaveLength(0);
    expect((await getContentItem(item.id))?.status).toBe("ready");

    // The author publishes a minute later: a failed check does not spend the receipt.
    session.show({ url: publishedUrl });
    await verify(account.id);

    const records = await recordsFor(item.id);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("published");
    expect((await getContentItem(item.id))?.status).toBe("posted");
  });

  it("records the confirmation branch too, with its own evidence", async () => {
    const { account, item } = await seedDraft({ url: editorUrl, bodyText: "发布成功，去看看吧" });

    await verify(account.id);

    // Success can be reported while the page is still the editor - the phrase is the observation.
    const records = await recordsFor(item.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      url: editorUrl,
      message: `success confirmation visible at ${editorUrl}`,
      status: "published",
    });
    expect((await getContentItem(item.id))?.status).toBe("posted");
  });

  it("writes nothing when the reported success has no draft receipt behind it", async () => {
    const account = await mustCreateAccount();
    const item = await mustCreateItem("没有收据的内容");
    // A session showing something other than the editor, but this process never drafted on it:
    // the verify answer alone is a client claim, and a claim is not a fact (D1 / D2).
    openFakeSession(account.id, { url: publishedUrl });
    const before = await recordCount();

    const response = await verify(account.id);

    await expect(response.json()).resolves.toMatchObject({ data: { published: true, url: publishedUrl } });
    expect(await recordCount()).toBe(before);
    expect(await recordsFor(item.id)).toHaveLength(0);
    expect((await getContentItem(item.id))?.status).toBe("ready");
  });

  it("reports not published, and writes nothing, without a live session", async () => {
    const account = await mustCreateAccount();
    const before = await recordCount();

    const response = await verify(account.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { published: false, url: "", evidence: "no live session page" },
    });
    expect(await recordCount()).toBe(before);
  });

  it("keeps answering 400 for a payload without an account id", async () => {
    const response = await verify("   ");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, message: "accountId is required" });
  });
});
