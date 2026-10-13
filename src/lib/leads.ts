import { apiErrorTranslationKey } from "@/lib/api-client";
import type { TranslationKey } from "@/lib/locale-resources";
import {
  marketingLeadStatuses,
  type MarketingLeadAmountTotal,
  type MarketingLeadContentTotal,
  type MarketingLeadRecord,
  type MarketingLeadStatus,
  type MarketingLeadSummary,
} from "@/lib/types";

/**
 * 营销线索与成交 (CI-LEAD-01 of `docs/coolpilot-capability-integration-plan.md`) - the pure half.
 *
 * This file opens no database and calls nothing: it is the vocabulary, the money arithmetic and the
 * write rules, so a console component and a test can both use them without a workspace - the same split
 * `@/lib/platform-version-view` and `@/lib/research-extraction/extraction` use.
 *
 * Five rules it exists to keep:
 *
 * 1. **未记录 is not 0.** A deal whose amount nobody entered stays `null`: it is counted out loud
 *    (`wonWithoutAmount`) and kept out of every sum, so nothing here turns "we do not know" into
 *    "worth nothing".
 * 2. **Money is integers.** Amounts are parsed, stored and summed in minor units (1/100, documented at
 *    `dealAmountMinorScale`), so no total is the result of float arithmetic over a currency.
 * 3. **A currency is never merged with another.** Sums are per currency, and a lead only ever adds to a
 *    total in the unit it stated.
 * 4. **A recorded deal is not deleted by accident.** Moving a lead out of 已成交 while it holds a deal
 *    is refused (`LEAD_DEAL_RECORDED`) unless the same call clears it, so "改回跟进中" cannot silently
 *    destroy an amount and a closing date.
 * 5. **A link that does not resolve is not a link.** Unlinked leads are counted as 未关联内容 instead of
 *    being attached to whatever content happens to share the platform.
 */

/** 待跟进 / 跟进中 / 已成交 / 已关闭. */
export const marketingLeadStatusLabelKeys: Record<MarketingLeadStatus, TranslationKey> = {
  new: "leadStatusNew",
  following: "leadStatusFollowing",
  won: "leadStatusWon",
  closed: "leadStatusClosed",
};

export function isMarketingLeadStatus(value: unknown): value is MarketingLeadStatus {
  return (marketingLeadStatuses as readonly string[]).includes(value as string);
}

/** True while something may still happen: 待跟进 and 跟进中. */
export function marketingLeadIsOpen(status: MarketingLeadStatus) {
  return status === "new" || status === "following";
}

/** The two write rules that can refuse, as stable names the console turns into a sentence. */
export const marketingLeadFailureCodes = ["LEAD_DEAL_RECORDED", "LEAD_DEAL_CURRENCY_MISSING"] as const;

export type MarketingLeadFailureCode = (typeof marketingLeadFailureCodes)[number];

/**
 * A refusal with a stable code, raised by `@/db/repositories/leads` and mapped to `error_<code>`.
 *
 * It carries the rule that refused the write, so the console can say "这条线索已记录成交金额" instead of
 * "failed", and a test can assert the exact reason.
 */
export class MarketingLeadFailure extends Error {
  constructor(
    public readonly code: MarketingLeadFailureCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "MarketingLeadFailure";
  }
}

export function isMarketingLeadFailure(error: unknown): error is MarketingLeadFailure {
  return error instanceof MarketingLeadFailure;
}

export function marketingLeadErrorKey(error: unknown, fallback: TranslationKey = "leadActionFailed"): TranslationKey {
  if (error instanceof MarketingLeadFailure) return `error_${error.code}` as TranslationKey;
  return apiErrorTranslationKey(error, fallback);
}

/**
 * Minor units are 1/100 for every currency this version records - a documented limitation, not a claim
 * about every currency: one without 2 decimals (JPY, KRW) would be shown with `.00`. Fixing that needs
 * a currency table this card deliberately does not add; the unit is stored next to the amount, so a
 * wrong scale is visible rather than hidden.
 */
export const dealAmountMinorScale = 100;

export type DealAmountParse = { status: "empty" } | { status: "ok"; amountMinor: number } | { status: "invalid" };

/** Reads a typed amount ("1200", "1200.5", "1200.50") into minor units. No separators, no sign. */
export function parseDealAmountInput(value: string): DealAmountParse {
  const text = value.trim();
  if (!text) return { status: "empty" };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { status: "invalid" };
  const [whole, fraction = ""] = text.split(".");
  const amountMinor = Number(whole) * dealAmountMinorScale + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amountMinor) ? { status: "ok", amountMinor } : { status: "invalid" };
}

/** The text a stored amount is shown (and edited) as; `''` when nothing was recorded. */
export function formatDealAmountMinor(amountMinor: number | null) {
  if (amountMinor === null) return "";
  const whole = Math.floor(amountMinor / dealAmountMinorScale);
  const fraction = String(amountMinor % dealAmountMinorScale).padStart(2, "0");
  return `${whole}.${fraction}`;
}

/** The deal half of a lead: the four columns a won lead may carry. */
export interface MarketingLeadDeal {
  dealAmountMinor: number | null;
  dealCurrency: string;
  dealClosedAt: number | null;
  dealNote: string;
}

export const emptyMarketingLeadDeal: MarketingLeadDeal = {
  dealAmountMinor: null,
  dealCurrency: "",
  dealClosedAt: null,
  dealNote: "",
};

/** What a write may say about the deal; every key is optional, so a patch touches only what it names. */
export interface MarketingLeadDealInput {
  dealAmountMinor?: number | null;
  dealCurrency?: string;
  dealClosedAt?: number | null;
  dealNote?: string;
  /** 明确清除：把线索改回非成交状态时必须显式给出，绝不隐含在其它字段里。 */
  dealCleared?: boolean;
}

/** True when this lead carries anything a reader would call 成交记录. */
export function marketingLeadHasDeal(
  lead: Pick<MarketingLeadRecord, "dealAmountMinor" | "dealCurrency" | "dealClosedAt" | "dealNote">,
) {
  return (
    lead.dealAmountMinor !== null ||
    lead.dealClosedAt !== null ||
    lead.dealCurrency.trim() !== "" ||
    lead.dealNote.trim() !== ""
  );
}

export type MarketingLeadDealOutcome =
  | { ok: true; deal: MarketingLeadDeal }
  | { ok: false; code: MarketingLeadFailureCode };

/**
 * What the deal half of a write becomes, given where the lead is going.
 *
 * The rules, in the order they apply:
 *
 * - `dealCleared` wins over everything else: the caller asked for it explicitly, and the result is an
 *   empty deal whatever the status is.
 * - A lead that ends up **not** 已成交 may not keep a deal. It is refused (`LEAD_DEAL_RECORDED`) rather
 *   than trimmed, because trimming here would delete a recorded amount without saying so.
 * - A lead that ends up 已成交 keeps every field the write does not name (so editing a note cannot wipe
 *   the amount) and may hold **no** deal at all - 已成交、未记录金额 is a real state, and
 *   `summarizeMarketingLeads` counts it separately.
 * - An amount must arrive with a unit (`LEAD_DEAL_CURRENCY_MISSING` otherwise). A closing date or a
 *   note without an amount is allowed, and then the currency is stored empty: there is no number for it
 *   to be the unit of.
 */
export function resolveMarketingLeadDeal(
  current: Pick<MarketingLeadRecord, "dealAmountMinor" | "dealCurrency" | "dealClosedAt" | "dealNote">,
  nextStatus: MarketingLeadStatus,
  input: MarketingLeadDealInput,
): MarketingLeadDealOutcome {
  if (input.dealCleared) return { ok: true, deal: { ...emptyMarketingLeadDeal } };
  if (nextStatus !== "won") {
    if (marketingLeadHasDeal(current)) return { ok: false, code: "LEAD_DEAL_RECORDED" };
    return { ok: true, deal: { ...emptyMarketingLeadDeal } };
  }
  const amount = input.dealAmountMinor === undefined ? current.dealAmountMinor : input.dealAmountMinor;
  const closedAt = input.dealClosedAt === undefined ? current.dealClosedAt : input.dealClosedAt;
  const note = input.dealNote === undefined ? current.dealNote : input.dealNote;
  const currency = (input.dealCurrency === undefined ? current.dealCurrency : input.dealCurrency).trim();
  if (amount === null) {
    return { ok: true, deal: { dealAmountMinor: null, dealCurrency: "", dealClosedAt: closedAt, dealNote: note } };
  }
  if (!currency) return { ok: false, code: "LEAD_DEAL_CURRENCY_MISSING" };
  return {
    ok: true,
    deal: { dealAmountMinor: amount, dealCurrency: currency, dealClosedAt: closedAt, dealNote: note },
  };
}

/**
 * Which content a written lead ends up linked to.
 *
 * A publish record knows its own content, so when both ids are given **the record decides** - the
 * alternative would be two columns disagreeing about which content produced a lead. A lead with no
 * publish record keeps the content the user picked, and a lead with neither is unlinked (`null`).
 */
export function resolveMarketingLeadContentItem(
  input: { contentItemId?: string | null; publishRecordId?: string | null },
  publishRecordContentItemId: string | null,
): string | null {
  if (input.publishRecordId) return publishRecordContentItemId;
  return input.contentItemId?.trim() ? input.contentItemId.trim() : null;
}

/**
 * The sums over a set of leads.
 *
 * Every number here counts rows that really exist: `wonWithoutAmount` is stated instead of being folded
 * into `amounts`, `unattributed` keeps unlinked leads visible instead of dropping them out of the
 * per-content view, and `amounts` holds one entry per currency because two currencies have no common
 * total.
 */
export function summarizeMarketingLeads(
  leads: readonly MarketingLeadRecord[],
  contentTitles: ReadonlyMap<string, string> = new Map(),
): MarketingLeadSummary {
  const byStatus: Record<MarketingLeadStatus, number> = { new: 0, following: 0, won: 0, closed: 0 };
  const amounts = new Map<string, MarketingLeadAmountTotal>();
  const byContent = new Map<string, MarketingLeadContentTotal>();
  const unattributed = { leads: 0, won: 0 };
  let wonWithoutAmount = 0;

  for (const lead of leads) {
    byStatus[lead.status] += 1;
    const won = lead.status === "won";
    const amount = won ? lead.dealAmountMinor : null;
    const currency = amount === null ? "" : lead.dealCurrency.trim();
    if (won && amount === null) wonWithoutAmount += 1;
    if (amount !== null && currency) {
      const total = amounts.get(currency) ?? { currency, amountMinor: 0, deals: 0 };
      total.amountMinor += amount;
      total.deals += 1;
      amounts.set(currency, total);
    }
    if (!lead.contentItemId) {
      unattributed.leads += 1;
      if (won) unattributed.won += 1;
      continue;
    }
    const entry = byContent.get(lead.contentItemId) ?? {
      contentItemId: lead.contentItemId,
      title: contentTitles.get(lead.contentItemId) ?? "",
      leads: 0,
      won: 0,
      amounts: [],
    };
    entry.leads += 1;
    if (won) {
      entry.won += 1;
      if (amount !== null && currency) {
        const row = entry.amounts.find((candidate) => candidate.currency === currency);
        if (row) {
          row.amountMinor += amount;
          row.deals += 1;
        } else {
          entry.amounts.push({ currency, amountMinor: amount, deals: 1 });
        }
      }
    }
    byContent.set(lead.contentItemId, entry);
  }

  return {
    total: leads.length,
    byStatus,
    open: byStatus.new + byStatus.following,
    won: byStatus.won,
    wonWithoutAmount,
    amounts: [...amounts.values()].sort(
      (left, right) => right.amountMinor - left.amountMinor || left.currency.localeCompare(right.currency),
    ),
    byContent: [...byContent.values()].sort(
      (left, right) => right.leads - left.leads || left.contentItemId.localeCompare(right.contentItemId),
    ),
    unattributed,
  };
}

/** Badge tone per status, so the console colours the four states the same way everywhere. */
export const marketingLeadStatusTones: Record<MarketingLeadStatus, "sky" | "amber" | "emerald" | "zinc"> = {
  new: "sky",
  following: "amber",
  won: "emerald",
  closed: "zinc",
};


