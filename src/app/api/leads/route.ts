import { getPublishRecord, listContentItemRefs, listPublishRecords } from "@/db/repository";
import { createMarketingLead, listMarketingLeads } from "@/db/repositories/leads";
import { fail, ok, parseJson } from "@/lib/api";
import {
  isMarketingLeadFailure,
  resolveMarketingLeadContentItem,
  summarizeMarketingLeads,
} from "@/lib/leads";
import type { MarketingLeadPayload } from "@/lib/types";
import { marketingLeadCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 营销线索与成交 (CI-LEAD-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 *   GET  /api/leads -> { leads, summary, contents, publishes }
 *   POST /api/leads -> the created lead
 *
 * **The read is a read.** `GET` answers the rows that exist plus the sums over them, and the two link
 * lists hold only the ids those rows really name - a content or a publish record that is gone is simply
 * absent, and the lead pointing at it stays in the list (`/api/content/lifecycle` does the same for
 * records whose content disappeared). An empty database answers `leads: []` with every counter at 0:
 * there is no sample data and no estimated conversion anywhere in this payload.
 *
 * **A stored amount is never a float here.** Amounts arrive as minor units (the console parses the
 * typed text with `parseDealAmountInput` before it calls this route), so nothing is rounded on the
 * server and no sum is float arithmetic.
 *
 * **来源平台 is filled from the record the user chose, never guessed.** When a lead names a publish
 * record and the caller left `sourcePlatform` empty, the platform is read off that record - it is what
 * the record itself says, not an inference from a URL or a title. A lead with no record keeps whatever
 * the user typed (which may be nothing).
 */
export async function GET(request: Request) {
  const rawLimit = Number(new URL(request.url).searchParams.get("limit") || 500);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 2000) : 500;
  const leads = await listMarketingLeads({ limit });
  const contentIds = [...new Set(leads.map((lead) => lead.contentItemId).filter((id): id is string => Boolean(id)))];
  const publishIds = [...new Set(leads.map((lead) => lead.publishRecordId).filter((id): id is string => Boolean(id)))];
  const contents = await listContentItemRefs(contentIds);
  const contentTitles = new Map(contents.map((item) => [item.id, item.title]));
  // Publish records are read through the same list the lifecycle reader uses and then filtered to the
  // ids asked for: there is no bulk by-id read for records, and 2000 rows is that reader's own ceiling.
  const publishes = (await listPublishRecords(2000)).filter((record) => publishIds.includes(record.id));
  const payload: MarketingLeadPayload = {
    leads,
    summary: summarizeMarketingLeads(leads, contentTitles),
    contents: contents.map((item) => ({ id: item.id, title: item.title })),
    publishes: publishes.map((record) => ({
      id: record.id,
      title: record.title,
      platform: record.platform,
      url: record.url,
    })),
  };
  return ok(payload);
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, marketingLeadCreateSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const body = parsed.data;
  // A named record that does not exist is refused instead of written: a lead linked to a record nobody
  // can open would look like a link while leading nowhere.
  const publishRecord = body.publishRecordId ? await getPublishRecord(body.publishRecordId) : null;
  if (body.publishRecordId && !publishRecord) {
    return fail("INVALID_PAYLOAD", 400, {
      code: "PUBLISH_RECORD_NOT_FOUND",
      message: `publish record ${body.publishRecordId} does not exist`,
    });
  }
  try {
    const lead = await createMarketingLead({
      name: body.name,
      contact: body.contact,
      sourcePlatform: body.sourcePlatform || publishRecord?.platform || "",
      contentItemId: resolveMarketingLeadContentItem(body, publishRecord?.contentItemId ?? null),
      publishRecordId: body.publishRecordId ?? null,
      status: body.status,
      note: body.note,
      deal: {
        dealAmountMinor: body.dealAmountMinor,
        dealCurrency: body.dealCurrency,
        dealClosedAt: body.dealClosedAt,
        dealNote: body.dealNote,
        dealCleared: body.dealCleared,
      },
    });
    return ok(lead, { status: 201 });
  } catch (error) {
    if (isMarketingLeadFailure(error)) return fail(error.code, 400, { message: error.message });
    throw error;
  }
}
