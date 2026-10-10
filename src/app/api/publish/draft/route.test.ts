import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `POST /api/publish/draft` (C2 of `docs/creator-workflow-audit.md`) - where the server starts
 * knowing what it is publishing.
 *
 * The route always did the drafting; what it lost until C2 was identity. The panel sent
 * `contentItemId` and the content type, the schema accepted them, and the destructure threw them
 * away, so by the time `/api/publish/verify` reported success there was nothing left that could
 * say *which* content item had been published. These cases pin the fix: a draft hands its session
 * a receipt (content item, title, type, method, terminal), and the receipt is what verify later
 * has to still find in order to write a fact.
 *
 * Two properties matter here. The receipt is server-owned - it lands on the session that performed
 * the draft, not in the client's next request. And it is consumable exactly once: `takePublishReceipt`
 * is the only reader, and reading is taking, which is the idempotency the verify route relies on (D1).
 *
 * Since C2-1a the route has a second half to its answer: not only the page it landed on, but what
 * that page *took* (`drafted` and its per-field `evidence`). Both reach the client and both land on
 * the receipt, so "a draft was prepared" is the prefill's observation rather than the route's 200.
 *
 * `preparePublishDraft` itself is mocked - driving a real platform editor is Playwright's business,
 * not this contract's - so the cases stay about the receipt.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-publish-draft-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "publish.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

/** The mocked prefill's answer, mutable per case: the route has to pass on what it is given. */
const prepare = vi.hoisted(() => ({
  result: {
    url: "https://www.threads.net/post/edit/threads-1",
    drafted: true,
    evidence: { title: "filled", text: "filled", media: "not_offered" },
    loginRequired: false,
  },
}));

vi.mock("@/lib/publish", () => ({
  preparePublishDraft: async () => prepare.result,
}));

const { POST } = await import("./route");
const { createAccount } = await import("@/db/repository");
const { takePublishReceipt } = await import("@/lib/browser-preview");
const { closeFakeSessions, openFakeSession } = await import("@/test/browser-session-fixture");

const draftUrl = "http://localhost/api/publish/draft";

const draft = (body: Record<string, unknown>) =>
  POST(
    new Request(draftUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

async function mustCreateAccount() {
  const account = await createAccount({ name: "CoolPilot", platform: "Threads", url: "https://www.threads.net/" });
  if (!account) throw new Error("account was not created");
  return account;
}

afterEach(() => {
  closeFakeSessions();
  // Back to the default answer, so one case's refused prefill cannot decide the next one's receipt.
  prepare.result.drafted = true;
  prepare.result.evidence = { title: "filled", text: "filled", media: "not_offered" };
  prepare.result.loginRequired = false;
});

describe("POST /api/publish/draft", () => {
  it("hands the session the content it drafted, so a later verify can attribute the publish", async () => {
    const account = await mustCreateAccount();
    openFakeSession(account.id, { url: "https://www.threads.net/" });

    const response = await draft({
      accountIds: [account.id],
      title: "桌面收纳指南",
      text: "桌面收纳指南 的正文。",
      contentType: "article",
      method: "manual",
      terminal: "local",
      contentItemId: "item-1",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        accountId: account.id,
        url: "https://www.threads.net/post/edit/threads-1",
        // C2-1a: the panel decides between "ready to edit" and "the page took nothing" from this, so
        // the observation the prefill made has to reach it - and the receipt below keeps the same
        // answer, so what was prepared does not depend on the client having read it.
        drafted: true,
        evidence: { title: "filled", text: "filled", media: "not_offered" },
      },
    });
    expect(takePublishReceipt(account.id)).toMatchObject({
      contentItemId: "item-1",
      title: "桌面收纳指南",
      contentType: "article",
      method: "manual",
      terminal: "local",
      // Where the draft landed, so a verify can tell "the author is still on the draft page" from
      // "the session moved on" without guessing from the URL's shape (C2 fix A).
      editorUrl: "https://www.threads.net/post/edit/threads-1",
      drafted: true,
      evidence: { title: "filled", text: "filled", media: "not_offered" },
      draftedAt: expect.any(Number),
    });
  });

  it("passes on a draft the platform page refused, so the panel does not call it an editor", async () => {
    const account = await mustCreateAccount();
    openFakeSession(account.id, { url: "https://www.threads.net/" });
    // 小红书's creator home, as the smoke measured it: the run answers with the page it reached and
    // says the page took none of the content.
    prepare.result = {
      url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video",
      drafted: false,
      evidence: { title: "empty", text: "empty", media: "not_offered" },
      loginRequired: false,
    };

    const response = await draft({
      accountIds: [account.id],
      title: "桌面收纳指南",
      text: "桌面收纳指南 的正文。",
      contentType: "article",
      contentItemId: "item-4",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { drafted: false, evidence: { title: "empty", text: "empty" } },
    });
    // The receipt records the refusal too. The draft still happened on the platform - the author may
    // well finish it by hand - so the receipt is not withheld; what it carries is what the run saw.
    expect(takePublishReceipt(account.id)).toMatchObject({
      contentItemId: "item-4",
      drafted: false,
      evidence: { title: "empty", text: "empty", media: "not_offered" },
    });
  });

  it("passes on a login wall rather than reporting a prepared draft", async () => {
    const account = await mustCreateAccount();
    openFakeSession(account.id, { url: "https://www.threads.net/" });
    // The other way a run ends without a draft: the platform wanted a sign-in, so nothing was offered
    // and nothing is claimed - the panel has to send the author to Account Management, not to a login
    // page it calls an editor.
    prepare.result = {
      url: "https://www.threads.net/login",
      drafted: false,
      evidence: { title: "not_offered", text: "not_offered", media: "not_offered" },
      loginRequired: true,
    };

    const response = await draft({ accountIds: [account.id], title: "桌面收纳指南", contentItemId: "item-5" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { drafted: false, loginRequired: true },
    });
  });

  it("remembers nothing for a draft that names no content item", async () => {
    const account = await mustCreateAccount();
    openFakeSession(account.id, { url: "https://www.threads.net/" });

    // The draft still happens (the author can publish it by hand); it just has no identity, so
    // there is nothing a fact could be attributed to - and an unattributable success writes nothing.
    const response = await draft({ accountIds: [account.id], title: "没有来源的草稿", text: "正文" });

    expect(response.status).toBe(200);
    expect(takePublishReceipt(account.id)).toBeNull();
  });

  it("spends a receipt when it is taken, and only then", async () => {
    const account = await mustCreateAccount();
    openFakeSession(account.id, { url: "https://www.threads.net/" });
    await draft({ accountIds: [account.id], title: "桌面收纳指南", contentType: "article", contentItemId: "item-2" });

    expect(takePublishReceipt(account.id)).toMatchObject({ contentItemId: "item-2" });
    // One draft, one fact: the second reader finds nothing left to record.
    expect(takePublishReceipt(account.id)).toBeNull();
  });

  it("keeps answering 404 for an account that is not there, without a receipt", async () => {
    const response = await draft({ accountIds: ["no-such-account"], title: "桌面收纳指南", contentItemId: "item-3" });

    expect(response.status).toBe(404);
    expect(takePublishReceipt("no-such-account")).toBeNull();
  });
});
