import { describe, expect, it } from "vitest";
import {
  formatDealAmountMinor,
  marketingLeadHasDeal,
  parseDealAmountInput,
  resolveMarketingLeadContentItem,
  resolveMarketingLeadDeal,
  summarizeMarketingLeads,
} from "./leads";
import type { MarketingLeadRecord } from "./types";

/**
 * 营销线索与成交 (CI-LEAD-01 of `docs/coolpilot-capability-integration-plan.md`) - the pure half.
 *
 * The cases that matter are the ones about money nobody entered: `null` must stay "未记录" (counted
 * apart, never summed as 0), an amount must keep its currency, and a deal must not be deleted by a write
 * that did not ask for it.
 */
function lead(overrides: Partial<MarketingLeadRecord> = {}): MarketingLeadRecord {
  return {
    id: "lead-1",
    name: "张三",
    contact: "",
    sourcePlatform: "",
    contentItemId: null,
    publishRecordId: null,
    status: "new",
    note: "",
    dealAmountMinor: null,
    dealCurrency: "",
    dealClosedAt: null,
    dealNote: "",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("金额口径", () => {
  it("reads a typed amount into minor units and refuses a third decimal", () => {
    expect(parseDealAmountInput("")).toEqual({ status: "empty" });
    expect(parseDealAmountInput("   ")).toEqual({ status: "empty" });
    expect(parseDealAmountInput("1200")).toEqual({ status: "ok", amountMinor: 120000 });
    expect(parseDealAmountInput("1200.5")).toEqual({ status: "ok", amountMinor: 120050 });
    expect(parseDealAmountInput("1200.50")).toEqual({ status: "ok", amountMinor: 120050 });
    expect(parseDealAmountInput("0")).toEqual({ status: "ok", amountMinor: 0 });
    // Not amounts: a separator, a sign, a third decimal, a bare dot.
    expect(parseDealAmountInput("1,200")).toEqual({ status: "invalid" });
    expect(parseDealAmountInput("-5")).toEqual({ status: "invalid" });
    expect(parseDealAmountInput("1.234")).toEqual({ status: "invalid" });
    expect(parseDealAmountInput(".5")).toEqual({ status: "invalid" });
  });

  it("shows a stored amount exactly, and an empty string for one nobody recorded", () => {
    expect(formatDealAmountMinor(120050)).toBe("1200.50");
    expect(formatDealAmountMinor(0)).toBe("0.00");
    expect(formatDealAmountMinor(null)).toBe("");
  });

  it("sums minor units as integers, so no total is float arithmetic", () => {
    const sum = [10, 20, 30].reduce((total, minor) => total + minor, 0);
    expect(formatDealAmountMinor(sum)).toBe("0.60");
  });
});

describe("成交写入规则", () => {
  it("keeps the stored deal for every field the write does not name", () => {
    const current = lead({ status: "won", dealAmountMinor: 120000, dealCurrency: "CNY", dealNote: "首单" });
    const outcome = resolveMarketingLeadDeal(current, "won", { dealNote: "复购" });
    expect(outcome).toEqual({
      ok: true,
      deal: { dealAmountMinor: 120000, dealCurrency: "CNY", dealClosedAt: null, dealNote: "复购" },
    });
  });

  it("allows 已成交 with no amount, and stores no currency for it", () => {
    const outcome = resolveMarketingLeadDeal(lead(), "won", {});
    expect(outcome).toEqual({
      ok: true,
      deal: { dealAmountMinor: null, dealCurrency: "", dealClosedAt: null, dealNote: "" },
    });
    // A closing date without an amount is allowed; the currency stays empty because there is no number.
    const dated = resolveMarketingLeadDeal(lead(), "won", { dealClosedAt: 1700000000000, dealCurrency: "CNY" });
    expect(dated).toEqual({
      ok: true,
      deal: { dealAmountMinor: null, dealCurrency: "", dealClosedAt: 1700000000000, dealNote: "" },
    });
  });

  it("refuses an amount with no currency instead of storing a number without a unit", () => {
    expect(resolveMarketingLeadDeal(lead(), "won", { dealAmountMinor: 120000 })).toEqual({
      ok: false,
      code: "LEAD_DEAL_CURRENCY_MISSING",
    });
    expect(resolveMarketingLeadDeal(lead(), "won", { dealAmountMinor: 120000, dealCurrency: "   " })).toEqual({
      ok: false,
      code: "LEAD_DEAL_CURRENCY_MISSING",
    });
  });

  it("refuses to move a deal-carrying lead out of 已成交, so nothing is deleted quietly", () => {
    const current = lead({ status: "won", dealAmountMinor: 120000, dealCurrency: "CNY", dealClosedAt: 5 });
    expect(resolveMarketingLeadDeal(current, "following", {})).toEqual({ ok: false, code: "LEAD_DEAL_RECORDED" });
    expect(resolveMarketingLeadDeal(current, "closed", { dealNote: "只改备注也不行" })).toEqual({
      ok: false,
      code: "LEAD_DEAL_RECORDED",
    });
    expect(marketingLeadHasDeal(current)).toBe(true);
    // A lead that never recorded a deal moves freely.
    expect(resolveMarketingLeadDeal(lead({ status: "won" }), "closed", {})).toEqual({
      ok: true,
      deal: { dealAmountMinor: null, dealCurrency: "", dealClosedAt: null, dealNote: "" },
    });
  });

  it("clears the deal only when the caller says so", () => {
    const current = lead({ status: "won", dealAmountMinor: 120000, dealCurrency: "CNY" });
    expect(resolveMarketingLeadDeal(current, "following", { dealCleared: true })).toEqual({
      ok: true,
      deal: { dealAmountMinor: null, dealCurrency: "", dealClosedAt: null, dealNote: "" },
    });
  });
});

describe("关联内容", () => {
  it("lets the publish record decide the content it went out with", () => {
    expect(resolveMarketingLeadContentItem({ publishRecordId: "rec-1", contentItemId: "other" }, "content-9")).toBe(
      "content-9",
    );
  });

  it("keeps a content the caller named when no record is given, and links nothing otherwise", () => {
    expect(resolveMarketingLeadContentItem({ contentItemId: " content-2 " }, null)).toBe("content-2");
    expect(resolveMarketingLeadContentItem({}, null)).toBeNull();
    expect(resolveMarketingLeadContentItem({ contentItemId: "   " }, null)).toBeNull();
  });
});

describe("汇总口径", () => {
  const contentTitles = new Map([["content-1", "夏季冰饮趋势"]]);

  it("counts every status, including the zeroes", () => {
    const summary = summarizeMarketingLeads([lead(), lead({ id: "lead-2", status: "won" })]);
    expect(summary.byStatus).toEqual({ new: 1, following: 0, won: 1, closed: 0 });
    expect(summary.total).toBe(2);
    expect(summary.open).toBe(1);
    expect(summary.won).toBe(1);
  });

  it("counts 已成交 without an amount apart instead of adding it as 0", () => {
    const summary = summarizeMarketingLeads([
      lead({ id: "a", status: "won" }),
      lead({ id: "b", status: "won", dealAmountMinor: 50000, dealCurrency: "CNY" }),
    ]);
    expect(summary.won).toBe(2);
    expect(summary.wonWithoutAmount).toBe(1);
    expect(summary.amounts).toEqual([{ currency: "CNY", amountMinor: 50000, deals: 1 }]);
  });

  it("never adds two currencies together, and lists the biggest first", () => {
    const summary = summarizeMarketingLeads([
      lead({ id: "a", status: "won", dealAmountMinor: 10000, dealCurrency: "CNY" }),
      lead({ id: "b", status: "won", dealAmountMinor: 20000, dealCurrency: "CNY" }),
      lead({ id: "c", status: "won", dealAmountMinor: 900, dealCurrency: "USD" }),
    ]);
    expect(summary.amounts).toEqual([
      { currency: "CNY", amountMinor: 30000, deals: 2 },
      { currency: "USD", amountMinor: 900, deals: 1 },
    ]);
  });

  it("groups by content, resolves titles, and keeps unlinked leads visible", () => {
    const summary = summarizeMarketingLeads(
      [
        lead({ id: "a", contentItemId: "content-1", status: "won", dealAmountMinor: 10000, dealCurrency: "CNY" }),
        lead({ id: "b", contentItemId: "content-1" }),
        lead({ id: "c", contentItemId: "content-gone" }),
        lead({ id: "d", status: "won", dealAmountMinor: 700, dealCurrency: "USD" }),
      ],
      contentTitles,
    );
    expect(summary.byContent).toHaveLength(2);
    expect(summary.byContent[0]).toMatchObject({
      contentItemId: "content-1",
      title: "夏季冰饮趋势",
      leads: 2,
      won: 1,
      amounts: [{ currency: "CNY", amountMinor: 10000, deals: 1 }],
    });
    // A content that no longer resolves keeps its leads; the title is simply empty.
    expect(summary.byContent[1]).toMatchObject({ contentItemId: "content-gone", title: "", leads: 1, won: 0 });
    expect(summary.unattributed).toEqual({ leads: 1, won: 1 });
    // The workspace-wide total holds every recorded deal, per currency, biggest first - including the
    // one whose lead is linked to a content.
    expect(summary.amounts).toEqual([
      { currency: "CNY", amountMinor: 10000, deals: 1 },
      { currency: "USD", amountMinor: 700, deals: 1 },
    ]);
  });

  it("answers an empty workspace with zeroes and empty lists, never with sample data", () => {
    expect(summarizeMarketingLeads([])).toEqual({
      total: 0,
      byStatus: { new: 0, following: 0, won: 0, closed: 0 },
      open: 0,
      won: 0,
      wonWithoutAmount: 0,
      amounts: [],
      byContent: [],
      unattributed: { leads: 0, won: 0 },
    });
  });
});

