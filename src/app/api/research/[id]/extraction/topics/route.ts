import { getResearchMaterial } from "@/db/repositories/research";
import { createTopic } from "@/db/repositories/topics";
import { fail, ok, parseJson } from "@/lib/api";
import { researchExtractionTopicSource } from "@/lib/research-extraction/extraction";
import { researchExtractionTopicSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Turns one 选题建议 of a stored extraction into a real topic (CI-P3-03-06).
 *
 *   POST /api/research/<id>/extraction/topics  { index } -> { topic, extractionRevision }
 *
 * The entry exists because this is a *hand-off*, not a copy: the topic is created through the same
 * repository call the topic dialog uses, with the suggestion's own title and rationale, and it records
 * where the idea came from (`source: research_extraction`, the material's `sourceUrl`, and the material's
 * id in `research_material_id`). What it deliberately does *not* do is send the material's text anywhere:
 * a suggestion is the model's idea, so a topic built from one is the user's own topic from that point on -
 * the writing flow still reads the material only when the user selects it.
 *
 * The index is what identifies a suggestion (results are stored in the order the model produced them), and
 * an index that names nothing is refused rather than clamped: "把第 3 条变成选题" must not silently create
 * the second one.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await parseJson(request, researchExtractionTopicSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const material = await getResearchMaterial(id);
  if (!material) return fail("NOT_FOUND", 404);
  const extraction = material.extraction;
  if (!extraction) {
    return fail("NOT_FOUND", 404, { reason: "no extraction has been stored for this material" });
  }

  const suggestion = extraction.topicSuggestions[parsed.data.index];
  if (!suggestion || !suggestion.title.trim()) {
    return fail("INVALID_PAYLOAD", 400, {
      index: parsed.data.index,
      available: extraction.topicSuggestions.length,
    });
  }

  const topic = await createTopic({
    title: suggestion.title.trim(),
    description: suggestion.rationale.trim(),
    source: researchExtractionTopicSource,
    sourceUrl: material.sourceUrl,
    researchMaterialId: material.id,
  });
  return ok({ topic, extractionRevision: extraction.revision }, { status: 201 });
}
