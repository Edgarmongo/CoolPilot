import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, ensureDatabase } from "@/db/client";
import { marketingLeads } from "@/db/schema";
import {
  MarketingLeadFailure,
  emptyMarketingLeadDeal,
  isMarketingLeadStatus,
  resolveMarketingLeadDeal,
  type MarketingLeadDealInput,
} from "@/lib/leads";
import type { MarketingLeadRecord, MarketingLeadStatus } from "@/lib/types";

/**
 * 营销线索与成交 (CI-LEAD-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The same shape `./topics` and `./products` chose: one local table, four verbs, no service layer. Two
 * things are worth naming here, because they are the reason this file exists instead of a generic
 * upsert:
 *
 * - **The deal rule is enforced on write, not on read.** `updateMarketingLead` runs
 *   `resolveMarketingLeadDeal` against the stored row before it writes, so "已成交改回跟进中" is refused
 *   (`LEAD_DEAL_RECORDED`) instead of quietly clearing an amount. The caller (the route) turns that
 *   refusal into the matching HTTP code; nothing here swallows it.
 * - **This layer links nothing.** `contentItemId` / `publishRecordId` are written exactly as given -
 *   deciding that a publish record's own content wins is `resolveMarketingLeadContentItem`'s job, and the
 *   route calls it before this function so there is one place where that rule lives.
 */

function now() {
  return Date.now();
}

function toMarketingLead(row: typeof marketingLeads.$inferSelect): MarketingLeadRecord {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact,
    sourcePlatform: row.sourcePlatform,
    contentItemId: row.contentItemId ?? null,
    publishRecordId: row.publishRecordId ?? null,
    // A hand-written row naming no known status is read as 待跟进 rather than crashing or inventing a
    // fifth state; every row this file writes carries a status from the vocabulary.
    status: isMarketingLeadStatus(row.status) ? row.status : "new",
    note: row.note,
    dealAmountMinor: row.dealAmountMinor ?? null,
    dealCurrency: row.dealCurrency,
    dealClosedAt: row.dealClosedAt ?? null,
    dealNote: row.dealNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** What a create or an update may carry. Every optional field means "leave it as it is" on an update. */
export interface MarketingLeadWrite {
  name?: string;
  contact?: string;
  sourcePlatform?: string;
  contentItemId?: string | null;
  publishRecordId?: string | null;
  status?: MarketingLeadStatus;
  note?: string;
  deal?: MarketingLeadDealInput;
}

export async function listMarketingLeads(filter: { limit?: number } = {}) {
  await ensureDatabase();
  const limit = Math.min(Math.max(Math.floor(filter.limit ?? 500), 1), 2000);
  const rows = await db
    .select()
    .from(marketingLeads)
    .orderBy(desc(marketingLeads.createdAt))
    .limit(limit);
  return rows.map(toMarketingLead);
}

export async function getMarketingLead(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(marketingLeads).where(eq(marketingLeads.id, id)).limit(1);
  return row ? toMarketingLead(row) : null;
}

export async function createMarketingLead(input: MarketingLeadWrite & { name: string }) {
  await ensureDatabase();
  const id = nanoid();
  const createdAt = now();
  const status = input.status ?? "new";
  // A create runs the same deal rule against an empty lead, so a brand-new 已成交 row cannot be born
  // with an amount and no currency, and a new 待跟进 row cannot arrive carrying a deal.
  const deal = resolveMarketingLeadDeal(emptyMarketingLeadDeal, status, input.deal ?? {});
  if (!deal.ok) throw new MarketingLeadFailure(deal.code, `创建线索时被拒绝：${deal.code}`);
  await db.insert(marketingLeads).values({
    id,
    name: input.name,
    contact: input.contact ?? "",
    sourcePlatform: input.sourcePlatform ?? "",
    contentItemId: input.contentItemId ?? null,
    publishRecordId: input.publishRecordId ?? null,
    status,
    note: input.note ?? "",
    ...deal.deal,
    createdAt,
    updatedAt: createdAt,
  });
  return getMarketingLead(id);
}

/** Answers `null` for a lead that is gone instead of resurrecting it. Throws on a refused deal write. */
export async function updateMarketingLead(id: string, patch: MarketingLeadWrite) {
  await ensureDatabase();
  const current = await getMarketingLead(id);
  if (!current) return null;
  const nextStatus = patch.status ?? current.status;
  const deal = resolveMarketingLeadDeal(current, nextStatus, patch.deal ?? {});
  if (!deal.ok) throw new MarketingLeadFailure(deal.code, `线索「${current.name}」的成交记录需显式清除`);
  await db
    .update(marketingLeads)
    .set({
      name: patch.name ?? current.name,
      contact: patch.contact ?? current.contact,
      sourcePlatform: patch.sourcePlatform ?? current.sourcePlatform,
      contentItemId: patch.contentItemId === undefined ? current.contentItemId : patch.contentItemId,
      publishRecordId: patch.publishRecordId === undefined ? current.publishRecordId : patch.publishRecordId,
      status: nextStatus,
      note: patch.note ?? current.note,
      ...deal.deal,
      updatedAt: now(),
    })
    .where(eq(marketingLeads.id, id));
  return getMarketingLead(id);
}

export async function deleteMarketingLead(id: string) {
  await ensureDatabase();
  await db.delete(marketingLeads).where(eq(marketingLeads.id, id));
}
