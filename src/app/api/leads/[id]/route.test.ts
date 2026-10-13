import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `GET` / `PATCH` / `DELETE /api/leads/[id]` (CI-LEAD-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The case that matters most is the refusal: a `PATCH` that would move a lead carrying a deal out of
 * 已成交 answers `400 LEAD_DEAL_RECORDED` **and leaves the stored row exactly as it was** - no amount and
 * no closing date is removed by a write that did not ask for it. Clearing a deal is a separate, explicit
 * intent (`dealCleared: true`), and a `PATCH` that names no link never unlinks a lead by omission.
 *
 * The temp database is pinned before the route is imported; the imports below are therefore `await`s.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-leads-item-route-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "leads.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { DELETE, GET, PATCH } = await import("./route");
const { createMarketingLead, getMarketingLead } = await import("@/db/repositories/leads");
const { createContentItem, createPublishRecord } = await import("@/db/repository");

/** The route as Next.js calls it: the `[id]` segment arrives as a promise the handler awaits. */
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const get = (id: string) => GET(new Request(`http://localhost/api/leads/${encodeURIComponent(id)}`), params(id));

function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/leads/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params(id),
  );
}

const remove = (id: string) =>
  DELETE(new Request(`http://localhost/api/leads/${encodeURIComponent(id)}`, { method: "DELETE" }), params(id));

describe("GET /api/leads/[id]", () => {
  it("answers the stored lead, and 404 for one that is gone", async () => {
    const created = await createMarketingLead({ name: "张三", contact: "13800000000", sourcePlatform: "知乎" });

    const response = await get(created!.id);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { id: created!.id, name: "张三", contact: "13800000000", status: "new", dealAmountMinor: null },
    });

    const missing = await get("no-such-lead");
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("PATCH /api/leads/[id]", () => {
  it("keeps every field the patch does not name", async () => {
    const created = await createMarketingLead({ name: "李四", contact: "lisi@example.com", sourcePlatform: "小红书" });

    const response = await patch(created!.id, { note: "明天回访" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { name: "李四", contact: "lisi@example.com", sourcePlatform: "小红书", note: "明天回访" },
    });
  });

  it("records a complete deal when the lead becomes 已成交", async () => {
    const created = await createMarketingLead({ name: "王五" });

    const response = await patch(created!.id, {
      status: "won",
      dealAmountMinor: 120000,
      dealCurrency: "CNY",
      dealClosedAt: 1700000000000,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "won", dealAmountMinor: 120000, dealCurrency: "CNY", dealClosedAt: 1700000000000 },
    });
    const stored = await getMarketingLead(created!.id);
    expect(stored?.dealAmountMinor).toBe(120000);
  });

  it("accepts 已成交 with no amount, so a won lead without a figure is a real state", async () => {
    const created = await createMarketingLead({ name: "冯六" });

    const response = await patch(created!.id, { status: "won" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "won", dealAmountMinor: null, dealCurrency: "" },
    });
  });

  it("refuses to move a deal-carrying lead out of 已成交, and leaves the stored row exactly as it was", async () => {
    const created = await createMarketingLead({
      name: "成交甲",
      status: "won",
      deal: { dealAmountMinor: 88000, dealCurrency: "CNY", dealClosedAt: 1700000000000, dealNote: "首单" },
    });

    const response = await patch(created!.id, { status: "following" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "LEAD_DEAL_RECORDED" });
    const stored = await getMarketingLead(created!.id);
    // Nothing was trimmed to make the write succeed: the amount, the unit and the date are all still there.
    expect(stored).toMatchObject({
      status: "won",
      dealAmountMinor: 88000,
      dealCurrency: "CNY",
      dealClosedAt: 1700000000000,
      dealNote: "首单",
    });
  });

  it("clears the deal only when the same body says so", async () => {
    const created = await createMarketingLead({
      name: "成交乙",
      status: "won",
      deal: { dealAmountMinor: 5000, dealCurrency: "CNY" },
    });

    const response = await patch(created!.id, { status: "following", dealCleared: true });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "following", dealAmountMinor: null, dealCurrency: "", dealClosedAt: null, dealNote: "" },
    });
  });

  it("refuses an amount with no currency on an edit too", async () => {
    const created = await createMarketingLead({ name: "成交丙" });

    const response = await patch(created!.id, { status: "won", dealAmountMinor: 5000 });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "LEAD_DEAL_CURRENCY_MISSING" });
    expect((await getMarketingLead(created!.id))?.dealAmountMinor).toBeNull();
  });

  it("links a lead to the content of the record it names, and unlinks when asked to", async () => {
    const content = await createContentItem({ title: "夏季冰饮趋势", body: "正文", postReadyText: "正文" });
    const record = await createPublishRecord({ contentItemId: content!.id, platform: "知乎", status: "published" });
    const created = await createMarketingLead({ name: "王五" });

    const linked = await patch(created!.id, { publishRecordId: record!.id });
    expect(linked.status).toBe(200);
    await expect(linked.json()).resolves.toMatchObject({
      data: { publishRecordId: record!.id, contentItemId: content!.id },
    });

    // Naming no record is how a link is removed; the derived content goes with it.
    const unlinked = await patch(created!.id, { publishRecordId: null });
    await expect(unlinked.json()).resolves.toMatchObject({ data: { publishRecordId: null, contentItemId: null } });
  });

  it("refuses a record that does not exist, and answers 404 for a lead that is gone", async () => {
    const created = await createMarketingLead({ name: "钱七" });

    const badRecord = await patch(created!.id, { publishRecordId: "no-such-record" });
    expect(badRecord.status).toBe(400);
    await expect(badRecord.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect((await getMarketingLead(created!.id))?.publishRecordId).toBeNull();

    expect((await patch("no-such-lead", { note: "x" })).status).toBe(404);
  });
});

describe("DELETE /api/leads/[id]", () => {
  it("removes the lead and nothing else, and answers 404 the second time", async () => {
    const created = await createMarketingLead({ name: "孙八", status: "won", deal: { dealAmountMinor: 100, dealCurrency: "CNY" } });

    const response = await remove(created!.id);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { deleted: true } });
    expect(await getMarketingLead(created!.id)).toBeNull();
    expect((await get(created!.id)).status).toBe(404);
    expect((await remove(created!.id)).status).toBe(404);
  });
});

