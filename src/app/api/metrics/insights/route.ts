import { getPublishRecord, listPublishRecords } from "@/db/repository";
import { generateStructured, metricInsightSchema, MissingAIKeyError } from "@/lib/ai";
import { fail, ok, parseJson } from "@/lib/api";
import { computeBaseline, interactionCount } from "@/lib/metrics";
import { metricInsightRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** AI attribution for a single piece of content. Runs with the user's own AI key. */
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
    const result = await generateStructured({ prompt, schema: metricInsightSchema });
    return ok({
      publishRecordId: record.id,
      ...result.data,
      provider: result.provider,
      model: result.model,
      createdAt: Date.now(),
    });
  } catch (error) {
    if (error instanceof MissingAIKeyError) {
      return fail(error.message, 400);
    }
    return fail(error instanceof Error ? error.message : "Failed to generate insight", 500);
  }
}
