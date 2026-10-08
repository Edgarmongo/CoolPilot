import { getPublishRecord, listPublishRecords } from "@/db/repository";
import { aiRuntime } from "@/features/ai-runtime";
import { metricInsightSchema } from "@/lib/ai/schemas";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { computeBaseline, interactionCount } from "@/lib/metrics";
import { metricInsightRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * AI attribution for a single piece of content. Runs with the user's own AI key.
 *
 * The model call goes straight to `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`):
 * provider order, model choice, key rotation, failover and usage are the runtime's business, and the
 * prompt plus the schema are all this route still owns. A failure keeps the runtime's own vocabulary
 * *and* its HTTP status (D-P3-3) - a missing credential is a 400, a cooled down key pool a 429, an
 * upstream error a 502 - so there is nothing to branch on here, and the legacy `MissingAIKeyError`
 * is no longer part of this route's contract.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, metricInsightRequestSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }
  const record = await getPublishRecord(parsed.data.publishRecordId);
  if (!record) {
    return fail("Publish record not found", 404);
  }

  const baseline = computeBaseline(await listPublishRecords(1000), record);
  const publishedAt = record.publishedAt ? new Date(record.publishedAt).toISOString() : "unknown";
  const prompt = [
    "You are a social-media performance analyst. Review one published piece and diagnose why it performed the way it did.",
    "Base your judgement strictly on the numbers below. Be specific and practical.",
    "",
    `Platform: ${record.platform}`,
    `Account: ${record.accountName}`,
    `Title: ${record.title}`,
    `Content type: ${record.contentType}`,
    `Published at: ${publishedAt}`,
    `Views/reads: ${record.views}`,
    `Interactions: ${interactionCount(record)} (likes ${record.likes}, comments ${record.comments}, shares ${record.shares}, favorites ${record.favorites})`,
    `This account's average views: ${baseline.accountAvgViews} (${baseline.accountCount} posts)`,
    `This platform's average views: ${baseline.platformAvgViews} (${baseline.platformCount} posts)`,
  ].join("\n");

  try {
    const response = await aiRuntime.chatStructured({
      messages: [{ role: "user", content: prompt }],
      schema: metricInsightSchema,
    });
    return ok({
      publishRecordId: record.id,
      ...response.data,
      provider: response.providerId,
      model: response.model,
      createdAt: Date.now(),
    });
  } catch (error) {
    // No local error taxonomy: `failFromError` keeps an `AppError`'s own code and status (the runtime
    // sets both) and falls back to 500 for anything else, which is what this route answered before.
    return failFromError(error, "AI_PROVIDER_FAILED", 500);
  }
}
