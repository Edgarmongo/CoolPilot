import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `GET` / `POST /api/leads` (CI-LEAD-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Four contracts are pinned here, and they are the ones the business chain rests on:
 *
 * - An empty workspace answers an empty list with zeroed counters - there is no sample lead and no
 *   estimated conversion anywhere in the payload.
 * - The link is derived, not guessed: a lead naming a publish record takes that record's own content
 *   (and, when the caller typed no platform, that record's platform), and a record that does not exist
 *   is refused instead of written.
 * - Amounts travel in minor units, and an amount with no currency is refused (`LEAD_DEAL_CURRENCY_MISSING`)
 *   rather than stored as a bare number.
 * - The read resolves what the rows name: titles for the contents, platform/url for the records.
 *
 * The temp database is pinned before the route is imported; the imports below are therefore `await`s.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-leads-route-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "leads.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { GET, POST } = await import("./route");
const { createContentItem, createPublishRecord } = await import("@/db/repository");
const { listMarketingLeads } = await import("@/db/repositories/leads");

const listUrl = "http://localhost/api/leads";

function postRequest(body: unknown) {
  return new Request(listUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function payloadOf() {
  const response = await GET(new Request(listUrl));
  return (await response.json()).data as {
    leads: Array<{ id: string; name: string }>;
    summary: {
      total: number;
      open: number;
      won: number;
      wonWithoutAmount: number;
      amounts: Array<{ currency: string; amountMinor: number; deals: number }>;
      byContent: Array<{ contentItemId: string; title: string; leads: number; won: number }>;
      unattributed: { leads: number; won: number };
    };
    contents: Array<{ id: string; title: string }>;
    publishes: Array<{ id: string; platform: string; url: string }>;
  };
}

describe("GET /api/leads", () => {
  it("answers an empty workspace with zeroes, not with a sample lead", async () => {
    const response = await GET(new Request(listUrl));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        leads: [],
        summary: {
          total: 0,
          open: 0,
          won: 0,
          wonWithoutAmount: 0,
          amounts: [],
          byContent: [],
          unattributed: { leads: 0, won: 0 },
        },
        contents: [],
        publishes: [],
      },
    });
  });
});

describe("POST /api/leads", () => {
  it("records a lead with only a name, as 待跟进 and 未关联内容", async () => {
    const response = await POST(postRequest({ name: "李四" }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({
      name: "李四",
      contact: "",
      sourcePlatform: "",
      status: "new",
      contentItemId: null,
      publishRecordId: null,
      dealAmountMinor: null,
      dealCurrency: "",
      dealClosedAt: null,
    });
    expect((await listMarketingLeads()).some((row) => row.id === payload.data.id)).toBe(true);
  });

  it("takes the content and the platform from the publish record a lead names", async () => {
    const content = await createContentItem({ title: "夏季冰饮趋势", body: "正文", postReadyText: "正文" });
    const record = await createPublishRecord({
      contentItemId: content!.id,
      platform: "知乎",
      title: "夏季冰饮趋势",
      url: "https://example.com/post/1",
      status: "published",
    });

    const response = await POST(postRequest({ name: "王五", publishRecordId: record!.id }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({
      publishRecordId: record!.id,
      contentItemId: content!.id,
      sourcePlatform: "知乎",
    });
  });

  it("keeps a platform the user typed instead of overwriting it with the record's", async () => {
    const content = await createContentItem({ title: "另一篇", body: "正文", postReadyText: "正文" });
    const record = await createPublishRecord({ contentItemId: content!.id, platform: "小红书", status: "published" });

    const response = await POST(postRequest({ name: "赵六", publishRecordId: record!.id, sourcePlatform: "朋友介绍" }));

    await expect(response.json()).resolves.toMatchObject({ data: { sourcePlatform: "朋友介绍" } });
  });

  it("refuses a record that does not exist instead of writing a link to nowhere", async () => {
    const before = (await listMarketingLeads()).length;

    const response = await POST(postRequest({ name: "钱七", publishRecordId: "no-such-record" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect((await listMarketingLeads()).length).toBe(before);
  });

  it("refuses an amount with no currency, and stores nothing", async () => {
    const before = (await listMarketingLeads()).length;

    const response = await POST(postRequest({ name: "孙八", status: "won", dealAmountMinor: 120000 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "LEAD_DEAL_CURRENCY_MISSING" });
    expect((await listMarketingLeads()).length).toBe(before);
  });

  it("records a deal that arrives complete, in minor units", async () => {
    const response = await POST(
      postRequest({
        name: "周九",
        status: "won",
        dealAmountMinor: 120050,
        dealCurrency: "CNY",
        dealClosedAt: 1700000000000,
        dealNote: "首单",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "won", dealAmountMinor: 120050, dealCurrency: "CNY", dealClosedAt: 1700000000000 },
    });
  });

  it("refuses a body that is not JSON with the payload guard, not a 500", async () => {
    const response = await POST(
      new Request(listUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "not json" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("refuses a nameless lead: a row nobody can address is not a lead", async () => {
    const response = await POST(postRequest({ name: "   " }));
    expect(response.status).toBe(400);
  });
});

describe("GET /api/leads 的汇总与解析", () => {
  it("resolves the titles and records the stored leads name, and sums them honestly", async () => {
    const content = await createContentItem({ title: "夜市摆摊复盘", body: "正文", postReadyText: "正文" });
    const record = await createPublishRecord({
      contentItemId: content!.id,
      platform: "知乎",
      title: "夜市摆摊复盘",
      url: "https://example.com/post/2",
      status: "published",
    });

    // Deltas, not totals: this file shares one database, so earlier cases are part of the answer too.
    const before = await payloadOf();
    await POST(
      postRequest({ name: "成交甲", publishRecordId: record!.id, status: "won", dealAmountMinor: 88000, dealCurrency: "CNY" }),
    );
    await POST(postRequest({ name: "成交乙", publishRecordId: record!.id, status: "won" }));
    await POST(postRequest({ name: "待跟进甲" }));
    const after = await payloadOf();

    expect(after.summary.total - before.summary.total).toBe(3);
    expect(after.summary.won - before.summary.won).toBe(2);
    // 成交乙 is 已成交 with no amount: counted here, and absent from the money totals.
    expect(after.summary.wonWithoutAmount - before.summary.wonWithoutAmount).toBe(1);
    const cny = (payload: typeof after) =>
      payload.summary.amounts.find((total) => total.currency === "CNY")?.amountMinor ?? 0;
    expect(cny(after) - cny(before)).toBe(88000);
    expect(after.summary.unattributed.leads - before.summary.unattributed.leads).toBe(1);
    const grouped = after.summary.byContent.find((row) => row.contentItemId === content!.id);
    expect(grouped).toMatchObject({ title: "夜市摆摊复盘", leads: 2, won: 2 });
    expect(after.contents.map((row) => row.id)).toContain(content!.id);
    const recordLink = after.publishes.find((row) => row.id === record!.id);
    expect(recordLink).toMatchObject({ platform: "知乎", url: "https://example.com/post/2" });
  });
});

