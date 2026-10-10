import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PublishSiteResult } from "@/lib/publish";

/**
 * `POST /api/publish` (E2E-FIX-01 of `docs/e2e-fix-01-implementation-card.md`) - the batch contract:
 * the five per-account outcomes callers already read, plus the top-level `summary` that makes a
 * half-succeeded batch distinguishable from a successful one without counting by hand.
 *
 * The compatibility claim of plan A is pinned here as a fact about these cases: T1-T5 and T8 assert
 * exactly what phase B wrote down *before* the implementation changed, so `results` still means what
 * it meant. The one expectation phase C was allowed to rewrite is T6 - a batch whose log write fails
 * used to leave the handler as a bare `500` with no envelope, and is now the structured
 * `PUBLISH_RUN_FAILED` body carrying `details.results` / `details.summary` / `details.retrySafe`.
 * T7 covers the other half of 5b: a batch that already delivered something keeps its honest `200` and
 * names the account the router threw on in `summary.unexpected`.
 *
 * Two seams are faked and the rest is real, and that split is the point of the fixture:
 *   - `publishToSite` is mocked (`@/lib/publish`), because driving a real platform editor is
 *     Playwright's business - no case here starts a browser;
 *   - `createPublishRecord` and `getAccount` are wrapped by a partial mock of `@/db/repository` behind
 *     two switches that are off by default (the failing log write of T6, the throwing lookup of T7),
 *     which is the only way to make the route's own calls fail: the route holds module-load-time
 *     bindings, so `spyOn` cannot reliably replace them;
 *   - everything else is the real thing - the accounts table, the sign-in pre-check
 *     (`findAccountLoginBlock` over `saveAccountHealthSnapshot`), and the publish log the assertions
 *     read back through `listPublishRecords`. The `login_required` case gets there by storing a real
 *     probe result, not by faking the answer it produces.
 *
 * The temp database is pinned before anything that reads it is imported, which is why the imports
 * below are `await`s (`src/app/api/publish/draft/route.test.ts` opens the same way).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-publish-run-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "publish.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

/** What the platform run answers. The route only passes it through, so it is mutable per case. */
type PlatformAnswer = Pick<PublishSiteResult, "status" | "url" | "error">;

const platform = vi.hoisted(() => ({
  /** The accounts `publishToSite` was asked about, in order. */
  calls: [] as string[],
  answer: { status: "published", url: "" } as PlatformAnswer,
}));

vi.mock("@/lib/publish", () => ({
  publishToSite: async (site: { id: string; name: string; platform: string }) => {
    platform.calls.push(site.id);
    // Shaped like the real function's success path (`src/lib/publish.ts:73-88`): identity comes from
    // the account the route resolved, the outcome from the platform.
    return { accountId: site.id, accountName: site.name, platform: site.platform, ...platform.answer };
  },
}));

/** The two default-off switches that make the route's own calls fail (T6 and T7 of §4.2). */
const repositoryFault = vi.hoisted(() => ({
  /** `createPublishRecord` throws: the workspace cannot write down what happened. */
  failRecordWrite: false,
  /** `getAccount` throws for exactly this id: the batch reaches an account it cannot even look up. */
  throwForAccountId: null as string | null,
}));

vi.mock("@/db/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/repository")>();
  return {
    ...actual,
    getAccount: async (id: string) => {
      if (repositoryFault.throwForAccountId === id) throw new Error("account store is down");
      return actual.getAccount(id);
    },
    createPublishRecord: async (input: Parameters<typeof actual.createPublishRecord>[0]) => {
      if (repositoryFault.failRecordWrite) throw new Error("publish log is down");
      return actual.createPublishRecord(input);
    },
  };
});

const { POST } = await import("./route");
const { createAccount, listPublishRecords } = await import("@/db/repository");
const { saveAccountHealthSnapshot } = await import("@/db/repositories/account-health");

/** What the platform answers when the run published. */
const publishedUrl = "https://www.threads.net/@coolpilot/post/abc123";
/** Where the sign-in probe says it landed when the account is signed out. */
const loginUrl = "https://www.threads.net/login";

const publishRun = (body: Record<string, unknown>) =>
  POST(
    new Request("http://localhost/api/publish", {
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

/** The log rows written for one account - the record the route is responsible for. */
async function recordsFor(accountId: string) {
  return (await listPublishRecords(500)).filter((row) => row.accountId === accountId);
}

async function recordCount() {
  return (await listPublishRecords(500)).length;
}

/**
 * The real pre-check input: a stored probe that landed on the login wall, which is what
 * `findLoginBlock` blocks on (`src/lib/account-risk.ts:281-285`). The snapshot is one
 * workspace-wide row, so every case that needs a block writes its own.
 */
async function blockOnLoginWall(accountId: string) {
  const checkedAt = Date.now();
  await saveAccountHealthSnapshot({
    checkedAt,
    checks: [{ accountId, status: "signed_out", reason: "login_url", url: loginUrl, checkedAt }],
  });
}

afterEach(() => {
  repositoryFault.failRecordWrite = false;
  repositoryFault.throwForAccountId = null;
  platform.calls.length = 0;
  platform.answer = { status: "published", url: "" };
});

describe("POST /api/publish", () => {
  it("answers published, and logs one dated row, for an account the platform took", async () => {
    const account = await mustCreateAccount();
    platform.answer = { status: "published", url: publishedUrl };

    const response = await publishRun({ accountIds: [account.id], title: "桌面收纳指南", text: "正文" });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    // The result is the account's identity plus the platform's outcome and nothing else: callers read
    // `data.results` field by field, so an added field would be a compatibility change (I1).
    expect(payload.data.results).toEqual([
      {
        accountId: account.id,
        accountName: "CoolPilot",
        platform: "Threads",
        status: "published",
        url: publishedUrl,
      },
    ]);
    const records = await recordsFor(account.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "published", url: publishedUrl, title: "桌面收纳指南" });
    // A published row is dated; no other outcome in this contract sets `publishedAt`.
    expect(records[0].publishedAt).toBeTypeOf("number");
    expect(platform.calls).toEqual([account.id]);
    // Phase C addition (the phase B assertions above are untouched): the body now carries the verdict
    // those results add up to, and a fully delivered single-account batch is `succeeded`.
    expect(payload.data.summary).toMatchObject({
      requested: 1,
      published: 1,
      delivered: 1,
      unexpected: 0,
      other: 0,
      outcome: "succeeded",
    });
  });

  it("answers 200 failed Site not found, and still logs the attempt, for an account that is not there", async () => {
    // I3: a stale id is a business failure, not an error status - the author has to see the row.
    const response = await publishRun({ accountIds: ["no-such-account"], title: "桌面收纳指南" });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.results).toEqual([
      { accountId: "no-such-account", accountName: "", platform: "", status: "failed", error: "Site not found" },
    ]);
    const records = await recordsFor("no-such-account");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "failed", message: "Site not found", url: "" });
    expect(records[0].publishedAt).toBeUndefined();
    // The platform is never asked about an account this workspace does not have.
    expect(platform.calls).toHaveLength(0);
    // Phase C addition: a missing account is a business failure the summary counts as such - and not
    // `unexpected`, because the router never threw on it.
    expect(payload.data.summary).toMatchObject({
      requested: 1,
      failed: 1,
      unexpected: 0,
      delivered: 0,
      outcome: "failed",
    });
  });

  it("walks a mixed batch in the order asked, one row per account, and stops the blocked one at the pre-check", async () => {
    const account = await mustCreateAccount();
    const blocked = await mustCreateAccount();
    await blockOnLoginWall(blocked.id);
    // An id this case owns, so the row count below speaks about this batch and not about T2's attempt.
    const missingId = "no-such-account-missing";

    const response = await publishRun({
      accountIds: [account.id, blocked.id, missingId],
      title: "桌面收纳指南",
      text: "正文",
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    // I1: `results` stays index-aligned with `accountIds`, whatever the outcomes are.
    expect(payload.data.results.map((result: PublishSiteResult) => result.accountId)).toEqual([
      account.id,
      blocked.id,
      missingId,
    ]);
    expect(payload.data.results.map((result: PublishSiteResult) => result.status)).toEqual([
      "published",
      "login_required",
      "failed",
    ]);
    const rowCount = (await listPublishRecords(500)).filter((row) =>
      [account.id, blocked.id, missingId].includes(row.accountId ?? ""),
    ).length;
    expect(rowCount).toBe(3);
    // One batch, one account the platform was actually asked about: the blocked account is answered
    // from the stored probe (a browser launch would only fail a minute later).
    expect(platform.calls).toEqual([account.id]);
    // Phase C addition: three accounts, three different outcomes - the shape a caller can no longer
    // misread as "everything worked", and the one `outcome` value that means "check the results".
    expect(payload.data.summary).toMatchObject({
      requested: 3,
      published: 1,
      drafted: 0,
      loginRequired: 1,
      failed: 1,
      delivered: 1,
      unexpected: 0,
      outcome: "partial",
    });
  });

  it("answers 400 INVALID_PAYLOAD, and writes nothing at all, for an empty account list", async () => {
    const before = await recordCount();

    const response = await publishRun({ accountIds: [], title: "桌面收纳指南" });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    // The regression E2E-04 step 3 pins: a rejected payload reaches no platform and no log row.
    expect(await recordCount()).toBe(before);
    expect(platform.calls).toHaveLength(0);
  });

  it("answers 200 failed with the platform's own message when the run could not succeed", async () => {
    // 5a, and phase C must not change it: `publishToSite` catches the platform run itself
    // (`src/lib/publish.ts:80-88`) and *returns* the failure, so the route never sees a rejection and
    // the batch still answers 200. A platform that refused is a business result, not a server fault.
    const account = await mustCreateAccount();
    platform.answer = { status: "failed", error: "selector not found" };

    const response = await publishRun({ accountIds: [account.id], title: "桌面收纳指南" });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.results).toEqual([
      {
        accountId: account.id,
        accountName: "CoolPilot",
        platform: "Threads",
        status: "failed",
        error: "selector not found",
      },
    ]);
    const records = await recordsFor(account.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "failed", message: "selector not found" });
    expect(records[0].publishedAt).toBeUndefined();
    // Phase C addition: the platform refused and the route did not, so the batch is an all-failed
    // verdict with `unexpected: 0` - 5b is for the router's own faults, not for a business answer.
    expect(payload.data.summary).toMatchObject({
      requested: 1,
      failed: 1,
      unexpected: 0,
      delivered: 0,
      outcome: "failed",
    });
  });

  it("answers the structured PUBLISH_RUN_FAILED when the log write fails and nothing was delivered", async () => {
    // T6, the one expectation phase C was allowed to rewrite (phase B pinned the bare-500 snapshot).
    //
    // `createPublishRecord` is the last step of every branch, so by the time it throws the platform has
    // already answered. This batch delivered nothing, and a `200` would read as "nothing was published"
    // - a claim the router is in no position to make. The 500 carries the whole account of the run the
    // route did manage to assemble, instead of leaving the client with no envelope at all (the pre-fix
    // shape `content/import-url/route.test.ts:181-183` describes).
    const account = await mustCreateAccount();
    platform.answer = { status: "failed", error: "platform said no" };
    repositoryFault.failRecordWrite = true;

    const response = await publishRun({ accountIds: [account.id], title: "桌面收纳指南" });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toMatchObject({ ok: false, code: "PUBLISH_RUN_FAILED" });
    expect(payload.details.retrySafe).toBe(false);
    expect(payload.details.summary).toMatchObject({
      requested: 1,
      failed: 1,
      unexpected: 1,
      delivered: 0,
      outcome: "failed",
    });
    // The account is still readable in the error body, and its platform answer is kept as it stands -
    // marked as router-caused, never replaced or dropped: "the record was not written" is not the same
    // statement as "nothing was published".
    expect(payload.details.results).toEqual([
      {
        accountId: account.id,
        accountName: "CoolPilot",
        platform: "Threads",
        status: "failed",
        error: "platform said no",
        errorKind: "unexpected",
      },
    ]);
    // What broke is the workspace's own record of an attempt the platform had already answered.
    expect(platform.calls).toEqual([account.id]);
    expect(await recordsFor(account.id)).toHaveLength(0);
  });

  it("answers 200 for a batch that already delivered, naming the account the router threw on", async () => {
    // T7, case A of §1.3: something was delivered, so the batch still has an honest 200 to give - and
    // `summary.unexpected` is what tells the caller one account was left unfinished. A 500 here would
    // hide the account the platform really took.
    const delivered = await mustCreateAccount();
    const unavailableId = "no-such-account-unavailable";
    platform.answer = { status: "published", url: publishedUrl };
    repositoryFault.throwForAccountId = unavailableId;

    const response = await publishRun({
      accountIds: [delivered.id, unavailableId],
      title: "桌面收纳指南",
      text: "正文",
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.summary).toMatchObject({
      requested: 2,
      published: 1,
      delivered: 1,
      failed: 1,
      unexpected: 1,
      outcome: "partial",
    });
    // I1 still holds through the router's own failure: one entry per account, index-aligned.
    expect(payload.data.results.map((result: PublishSiteResult) => result.accountId)).toEqual([
      delivered.id,
      unavailableId,
    ]);
    // Nothing was known about this account - the lookup itself threw - so no name or platform is
    // claimed for it.
    expect(payload.data.results[1]).toEqual({
      accountId: unavailableId,
      accountName: "",
      platform: "",
      status: "failed",
      error: "account store is down",
      errorKind: "unexpected",
    });
    // An unhandled failure later in the batch cannot un-publish the account that really was taken.
    const records = await recordsFor(delivered.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "published", url: publishedUrl });
    expect(platform.calls).toEqual([delivered.id]);
  });

  it("reports login_required from a stored sign-in probe, without asking the platform", async () => {
    // T8 / B4: the pre-check is the real one - the probe result is written through
    // `saveAccountHealthSnapshot` and read back by the route's own `findAccountLoginBlock`.
    const account = await mustCreateAccount();
    await blockOnLoginWall(account.id);

    const response = await publishRun({ accountIds: [account.id], title: "桌面收纳指南" });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.results).toHaveLength(1);
    expect(payload.data.results[0]).toMatchObject({
      accountId: account.id,
      accountName: "CoolPilot",
      platform: "Threads",
      status: "login_required",
      url: loginUrl,
    });
    expect(payload.data.results[0].error).toContain("Login required");
    // The whole point of the pre-check: a browser would have opened a login page for nothing.
    expect(platform.calls).toHaveLength(0);
    const records = await recordsFor(account.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "failed", url: loginUrl });
    expect(records[0].message).toContain("Login required");
    expect(records[0].publishedAt).toBeUndefined();
    // Phase C addition: the blocked account is counted as `loginRequired`, not as `failed`, and nothing
    // was delivered - the verdict behind the "nothing was submitted" banner.
    expect(payload.data.summary).toMatchObject({
      requested: 1,
      loginRequired: 1,
      failed: 0,
      delivered: 0,
      unexpected: 0,
      outcome: "failed",
    });
  });
});

