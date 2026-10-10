import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PublishDraftReceipt } from "@/lib/browser-preview-shared";

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
 *   - the author still sitting in the editor, the draft page whose URL no editor pattern matches,
 *     and the same author publishing a minute later
 *   - the session parked on the platform's own home with the draft still on it (the C2 smoke: a
 *     page that moved is not a page holding a post) - reported as `unknown` since C2-1b, which is the
 *     answer that state was missing
 *   - a page that moved with nothing at all to explain it: `unknown` again, and nothing written
 *   - a confirmation the platform showed for two seconds, captured at the moment it appeared (C2-1c)
 *   - a receipt with no editor URL, where the page's own shape is all that is left to go on (the
 *     smoke's baseline row stored the editor itself as the post URL)
 *   - a publish that landed on the platform's own success screen, which still has to be recorded
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

/** Where the draft was made - what the receipt records, and what the verify compares against (C2 fix A). */
const editorUrl = "https://www.threads.net/post/edit/threads-1";
/** Where the author lands once the post is live. */
const publishedUrl = "https://www.threads.net/@coolpilot/post/abc123";

/**
 * What every draft seeded here has in common: a prefill the platform editor took (C2-1a).
 *
 * The verify never reads these fields - it decides from the live page - but a receipt has to carry
 * them, because that is what a real draft does since C2-1a. Annotated rather than inferred, so the
 * literals stay the evidence union's own values instead of widening to `string`.
 */
const preparedDraft: Pick<PublishDraftReceipt, "drafted" | "evidence"> = {
  drafted: true,
  evidence: { title: "filled", text: "filled", media: "not_offered" },
};

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
 *
 * `page` is the *draft* page: the receipt records its URL as `editorUrl`, which is what the
 * verify's URL branch compares the live page against (C2 fix A). A case that wants the author to
 * have published moves the same session on with `session.show(...)`.
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
    editorUrl: page.url,
    ...preparedDraft,
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
    const { account, item, session } = await seedDraft({ url: editorUrl });
    // The author publishes from the editor, so the session leaves the page the draft was made on.
    session.show({ url: publishedUrl });

    const response = await verify(account.id);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, data: { published: true, outcome: "published", url: publishedUrl } });

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
      // D5: the row carries the observation that authorized it - and since C2-1b it also says which
      // kind of platform statement it was: a permalink namespace, not a page change.
      message: `session left the editor URL at ${publishedUrl} (post URL)`,
    });
    expect(records[0].publishedAt).toBeGreaterThan(0);
    expect((await getContentItem(item.id))?.status).toBe("posted");
  });

  it("writes nothing while the session sits on a draft URL no editor pattern matches", async () => {
    // 小红书 opens its editor at `.../publish/publish?from=menu&target=video`, which marks it as an
    // editor in no way at all: the prefill finishes with the session exactly there, and the first
    // poll read that unmoved page as "the author left the editor" and wrote a published fact for a
    // post nobody had sent (C2 fix A). What the page is compared against is now the URL the draft
    // was made on, whatever shape that URL has.
    const draftUrl = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video";
    const { account, item } = await seedDraft({ url: draftUrl, bodyText: "发布 存草稿" });
    const before = await recordCount();

    const response = await verify(account.id);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, data: { published: false, url: draftUrl } });
    expect(body.data.evidence).toMatch(/still the editor URL/);
    expect(await recordCount()).toBe(before);
    expect(await recordsFor(item.id)).toHaveLength(0);
    expect((await getContentItem(item.id))?.status).not.toBe("posted");
  });

  it("writes nothing when the platform only switched steps on the draft page", async () => {
    // Same page, same path: `?target=video` -> `?target=image` is the author picking a different
    // tab of the editor, not a post going out. A comparison of whole URLs would read the tab switch
    // as "left the editor" and write a fact from it (C2 fix A).
    const videoTab = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video";
    const imageTab = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image";
    const { account, item, session } = await seedDraft({ url: videoTab });
    session.show({ url: imageTab });
    const before = await recordCount();

    const response = await verify(account.id);
    const body = await response.json();

    expect(body).toMatchObject({ data: { published: false, url: imageTab } });
    expect(body.data.evidence).toMatch(/still the editor URL/);
    expect(await recordCount()).toBe(before);
    expect(await recordsFor(item.id)).toHaveLength(0);
    expect((await getContentItem(item.id))?.status).not.toBe("posted");
  });

  it("keeps the record at one when the dialog polls the same success again", async () => {
    const { account, item, session } = await seedDraft({ url: editorUrl });
    session.show({ url: publishedUrl });
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
    const { account, item, session } = await seedDraft({ url: editorUrl });
    session.show({ url: publishedUrl });
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
      data: { published: false, outcome: "waiting", url: editorUrl, evidence: `still the editor URL ${editorUrl}` },
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
    // the verify answer alone is a client claim, and a claim is not a fact (D1 / D2). The claim
    // survives on purpose - a post-shaped page with no receipt URL is also what the poll after a
    // success sees, once that success has spent the receipt, and it has to keep reading as published
    // there - but nothing is written from it.
    openFakeSession(account.id, { url: publishedUrl });
    const before = await recordCount();

    const response = await verify(account.id);

    await expect(response.json()).resolves.toMatchObject({ data: { published: true, url: publishedUrl } });
    expect(await recordCount()).toBe(before);
    expect(await recordsFor(item.id)).toHaveLength(0);
    expect((await getContentItem(item.id))?.status).toBe("ready");
  });

  it("writes nothing when the session parked on the platform's own home with the draft still on it", async () => {
    // The C2 smoke: 小红书 handed the live session back to `creator.xiaohongshu.com/new/home` six
    // minutes after the prefill, and the URL branch - comparing paths, finding no editor pattern and
    // no success phrase - read the move itself as a publish. The panel flipped to 已发布, closed the
    // session and took the author's prefilled editor with it, and a row landed against an item the
    // smoke never drafted. Landing on the platform's own home is navigation, not a post. C2-1b gives
    // that observation an answer of its own (`unknown`) instead of the binary `published: false`, so
    // the run panel can say what it does not know instead of going quiet about it - and the row stays
    // unwritten either way.
    const draftUrl = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video";
    const homeUrl = "https://creator.xiaohongshu.com/new/home";
    const { account, item, session } = await seedDraft({ url: draftUrl });
    session.show({ url: homeUrl });
    const before = await recordCount();

    const response = await verify(account.id);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, data: { published: false, outcome: "unknown", url: homeUrl } });
    expect(body.data.evidence).toMatch(/not a post/);
    expect(await recordCount()).toBe(before);
    expect(await recordsFor(item.id)).toHaveLength(0);
    expect((await getContentItem(item.id))?.status).not.toBe("posted");
  });

  it("writes nothing when the receipt carries no editor URL to compare a page against", async () => {
    // The smoke's baseline row (`Pwv6r3_bAN7OvkDMFYcIh`): it stores a *post* URL that is the editor
    // page, with the message "session left the editor URL at <the editor>". It came from a draft
    // whose receipt recorded no page at all - the prefill finished before the editor had an address -
    // so the check compared the live page against nothing, took the unmoved editor for a move, and
    // wrote a fact from a pageless receipt. With no draft page to compare, the page's own shape is
    // all that is left - and the editor is a composer, so it is not a post.
    const editor = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video";
    const account = await mustCreateAccount();
    const item = await mustCreateItem("无地址的草稿");
    openFakeSession(account.id, { url: editor });
    rememberPublishDraft(account.id, {
      contentItemId: item.id,
      title: "无地址的草稿",
      contentType: "video",
      method: "manual",
      terminal: "local",
      editorUrl: "",
      ...preparedDraft,
    });
    const before = await recordCount();

    const response = await verify(account.id);
    const body = await response.json();

    expect(body).toMatchObject({ data: { published: false, url: editor } });
    expect(body.data.evidence).toBe(`no draft receipt, and the page is not a post: ${editor}`);
    expect(await recordCount()).toBe(before);
    expect(await recordsFor(item.id)).toHaveLength(0);
    expect((await getContentItem(item.id))?.status).not.toBe("posted");
  });

  it("still records a publish that landed on the platform's own success screen", async () => {
    // The other side of the narrowing, and the reason the composer guard is not a plain blocklist of
    // `/publish/...`: 小红书 confirms a published note on a page under the composer's own path, and a
    // check that rejected every creation-shaped URL would turn the smoke's real click into a missing
    // fact. A URL that says success is the post's own page.
    const draftUrl = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video";
    const successUrl = "https://creator.xiaohongshu.com/publish/success?target=video";
    const { account, item, session } = await seedDraft({ url: draftUrl });
    session.show({ url: successUrl });

    await verify(account.id);

    const records = await recordsFor(item.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      status: "published",
      url: successUrl,
      message: `session left the editor URL at ${successUrl} (success page)`,
    });
    expect((await getContentItem(item.id))?.status).toBe("posted");
  });

  it("reports unknown, and writes nothing, when the page moved and nothing explains it", async () => {
    // C2-1b's new answer, and the whole point of it: there is a move and there is no statement. The
    // author navigated somewhere that is neither the draft page nor a URL the platform serves a post
    // on. Before C2-1b the move itself was the evidence, which is how the smoke wrote two published
    // rows for notes nobody sent; now the move is navigation, the answer is `unknown`, and the fact
    // is withheld with the author left in control.
    const { account, item, session } = await seedDraft({ url: editorUrl });
    const somewhereElse = "https://www.threads.net/settings/profile";
    session.show({ url: somewhereElse });
    const before = await recordCount();

    const response = await verify(account.id);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, data: { published: false, outcome: "unknown", url: somewhereElse } });
    expect(body.data.evidence).toMatch(/navigation only/);
    expect(await recordCount()).toBe(before);
    expect(await recordsFor(item.id)).toHaveLength(0);
    expect((await getContentItem(item.id))?.status).not.toBe("posted");
  });

  it("records a confirmation the page showed while the poll was not looking", async () => {
    // C2-1c's other half. A platform that confirms and then redirects to its own home leaves the
    // confirmation on screen for about as long as the poll interval, so a check that only reads the
    // live page lands on the home and answers `unknown` for a post that really exists. The journal
    // kept what the page said at the moment it moved - 小红书 confirms while the editor is still the
    // page - so the fact is recorded from the observation instead of being lost with the toast.
    const draftUrl = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video";
    const homeUrl = "https://creator.xiaohongshu.com/new/home";
    const { account, item, session } = await seedDraft({ url: draftUrl });

    session.show({ url: homeUrl }, { cause: "platform", excerpt: "发布成功 笔记已发布" });

    await verify(account.id);

    const records = await recordsFor(item.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      status: "published",
      url: homeUrl,
      message: `success confirmation "发布成功" seen at ${homeUrl} and captured when it appeared`,
    });
    expect((await getContentItem(item.id))?.status).toBe("posted");
  });

  it("records a confirmation the platform-signal witness kept for the page", async () => {
    // The same evidence captured the other way: the init script watches the page between polls and
    // keeps the phrase with the moment and URL it saw it on. `page.evaluate` is what the verify asks;
    // the fixture answers with what the witness would be holding.
    const draftUrl = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video";
    const homeUrl = "https://creator.xiaohongshu.com/new/home";
    const account = await mustCreateAccount();
    const item = await mustCreateItem("确认后跳走的笔记");
    openFakeSession(account.id, { url: homeUrl }, "CoolPilot", [
      // Seen while the editor was still the page - which is where 小红书 says it, and why the URL the
      // confirmation was seen on is worth storing.
      { at: Date.now() + 5000, url: draftUrl, text: "发布成功" },
    ]);
    rememberPublishDraft(account.id, {
      contentItemId: item.id,
      title: "确认后跳走的笔记",
      contentType: "video",
      method: "manual",
      terminal: "local",
      editorUrl: draftUrl,
      ...preparedDraft,
    });

    await verify(account.id);

    const records = await recordsFor(item.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      status: "published",
      url: homeUrl,
      message: `success confirmation "发布成功" seen at ${draftUrl} and captured when it appeared`,
    });
    expect((await getContentItem(item.id))?.status).toBe("posted");
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
