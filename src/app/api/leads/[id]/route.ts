import { getPublishRecord } from "@/db/repository";
import { deleteMarketingLead, getMarketingLead, updateMarketingLead } from "@/db/repositories/leads";
import { fail, ok, parseJson } from "@/lib/api";
import { isMarketingLeadFailure, resolveMarketingLeadContentItem } from "@/lib/leads";
import { marketingLeadUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One lead of CI-LEAD-01.
 *
 *   GET    /api/leads/<id> -> the stored lead
 *   PATCH  /api/leads/<id> -> the updated lead
 *   DELETE /api/leads/<id> -> { deleted: true }
 *
 * **`PATCH` is a patch.** A field it does not name keeps its stored value, and the link is only
 * reconsidered when the body names a link - a lead is never unlinked by omission. When it does name a
 * publish record, `resolveMarketingLeadContentItem` decides the content (the record's own content wins);
 * a record that does not exist is refused rather than written.
 *
 * **The deal rule is applied by the repository against the stored row**, so moving a lead out of 已成交
 * while it holds a deal answers `400 LEAD_DEAL_RECORDED` unless the same body carries
 * `dealCleared: true`. Nothing here trims an amount to make a write succeed.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const lead = await getMarketingLead(id);
  if (!lead) return fail("NOT_FOUND", 404);
  return ok(lead);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await parseJson(request, marketingLeadUpdateSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const existing = await getMarketingLead(id);
  if (!existing) return fail("NOT_FOUND", 404);
  const body = parsed.data;
  const namesLink = body.contentItemId !== undefined || body.publishRecordId !== undefined;
  const publishRecord = body.publishRecordId ? await getPublishRecord(body.publishRecordId) : null;
  if (body.publishRecordId && !publishRecord) {
    return fail("INVALID_PAYLOAD", 400, {
      code: "PUBLISH_RECORD_NOT_FOUND",
      message: `publish record ${body.publishRecordId} does not exist`,
    });
  }
  try {
    const updated = await updateMarketingLead(id, {
      name: body.name,
      contact: body.contact,
      sourcePlatform: body.sourcePlatform,
      contentItemId: namesLink
        ? resolveMarketingLeadContentItem(body, publishRecord?.contentItemId ?? null)
        : undefined,
      publishRecordId: body.publishRecordId === undefined ? undefined : body.publishRecordId,
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
    if (!updated) return fail("NOT_FOUND", 404);
    return ok(updated);
  } catch (error) {
    if (isMarketingLeadFailure(error)) return fail(error.code, 400, { message: error.message });
    throw error;
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const existing = await getMarketingLead(id);
  if (!existing) return fail("NOT_FOUND", 404);
  await deleteMarketingLead(id);
  return ok({ deleted: true });
}
