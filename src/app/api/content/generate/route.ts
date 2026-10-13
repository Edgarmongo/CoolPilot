import { getResearchMaterial } from "@/db/repositories/research";
import { getTopic, linkTopicContentItem } from "@/db/repositories/topics";
import { generateArticle } from "@/lib/article-generation";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { type AiWritingConfig, type AiWritingMaterial, type OutputLanguage } from "@/lib/ai-writing";
import { researchMaterialPromptText, researchMaterialSourceUrls } from "@/lib/research";
import { researchExtractionPromptText } from "@/lib/research-extraction/extraction";
import { topicMaterialText } from "@/lib/topics";
import type { ResearchMaterialRecord, TopicRecord } from "@/lib/types";
import { contentGenerateSchema } from "@/lib/validation";
import { getWritingAgent } from "@/lib/writing-agents";

export const runtime = "nodejs";

/** Maps the legacy free-text language field onto an output-language code. */
function guessLanguage(value: string): OutputLanguage {
  const text = value.toLowerCase();
  if (text.includes("繁") || text.includes("traditional")) return "zh-TW";
  if (text.includes("english") || text === "en") return "en";
  if (text.includes("日本") || text.includes("japanese")) return "ja";
  return "zh-CN";
}

/**
 * The material the prompt receives (P2-03-02 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * A topic the caller named and this route could read contributes its own stored fields, worded exactly
 * as the wizard's step 1 words the topic it carries into the form (`topicMaterialText`): a topic
 * selected here and a topic opened from the topic list therefore reach the model as the same material,
 * instead of two vocabularies for the same row. The user's subject line is added only when it says
 * something the topic does not, and the free-form supplement always is - so no edit is dropped and
 * nothing is repeated back at the model.
 *
 * A research material (CI-P3-01) joins the same list through `researchMaterialPromptText`: its own stored
 * text, with its source labelled as a source. A material whose page was never read contributes its title
 * and its link and no invented 正文 - the prompt is never handed text that only looks like the page.
 */
function materialTextOf(
  data: { topic: string; prompt: string },
  topic: TopicRecord | null,
  research: ResearchMaterialRecord | null,
  extractionText: string,
) {
  const subject = data.topic.trim();
  return [
    topic ? topicMaterialText(topic) : "",
    research ? researchMaterialPromptText(research) : "",
    extractionText,
    subject && subject !== topic?.title.trim() ? subject : "",
    data.prompt,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The article-creation entry point for a ready-to-publish article (C3 of
 * `docs/creator-workflow-audit.md`), shared by AI writing, article creation, posts and videos, so
 * positioning and the knowledge base apply consistently to every generation entry point.
 *
 * The route owns *who is asking*: the payload's schema and guard, the legacy `language` string it has
 * to guess a code from, the writing agent that prefixes the system prompt (F-C3-7 keeps the agent here
 * rather than in the service), the material it builds from `topic`/`prompt`/`topicId`, and the
 * provenance this entry records (`type`, `agentId`, `generationType`, ...). The article itself -
 * positioning, brand, knowledge, prompts, the structured call, the images, the content item and the
 * usage row - belongs to `generateArticle()` (`@/lib/article-generation`), which
 * `api/ai-writing/generate` uses too.
 *
 * Three facts CI-P2-03 made this entry's own:
 *
 * - The **topic** it names is read, not trusted as provenance: the row's own fields become material and
 *   its source page becomes an image source, exactly the way the wizard's `topicId` already carries the
 *   topic's text (P2-01-04). An id that resolves to nothing contributes nothing and is *not* written to
 *   the provenance, so a stored article never claims a topic it did not read.
 * - The **brand** it names travels as `brandId` (config *and* request) instead of the hard-coded empty
 *   string this entry used to write - the last open item of P2-02-05. The lookup and the "an unknown id
 *   means no brand, never another brand" rule stay in `generateArticle`, so the two entries share one
 *   brand contract.
 * - The topic it produced an article for keeps a link back (`linkTopicContentItem`, P2-01-05), written
 *   *after* the article exists and never able to turn a stored article into an error.
 *
 * CI-P3-01 adds a third input of exactly the same shape: a **research material** (研究素材). The id is
 * read, not trusted - the row's own text becomes material (`researchMaterialPromptText`), its source page
 * joins the image sources only when that text actually came with it (`researchMaterialSourceUrls`), and
 * the provenance records the row that was read plus the version it was read at, so "the material was
 * edited after this article" stays a comparison of two stored numbers. An id that resolves to nothing is
 * answered with a 404 rather than ignored, because a material is the source text and not a hint - and a
 * material deleted before the run is never silently swapped for another one.
 *
 * CI-P3-03 adds the material's **研究提炼** to that same hand-off, behind an explicit flag
 * (`includeResearchExtraction`). Without the flag this entry composes exactly the material it composed
 * before - which is what keeps every existing client and every existing test's prompt byte-identical - and
 * with it the digest is appended, with only the facts and quotes whose excerpts are locatable in the
 * material's own text. The provenance records the version that travelled, so an article written from
 * version 2 of a distillation says so.
 *
 * The model call goes through `generateArticle` into `aiRuntime` (batch P3-A3 of
 * `docs/generate-migration-p3.md`): provider order, model choice, key rotation, failover and
 * structured-output validation are the runtime's business. The answer is read through the runtime's own
 * names (`providerId`, `model`, `usage`), and a failure keeps the runtime's code *and* status (D-P3-3)
 * instead of a 502 flattened from a message, so a missing credential is a 400 - the payload guard below
 * is the only error this route still words itself.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, contentGenerateSchema);
  if (parsed.error) return fail("Invalid generation payload", 400, parsed.error);
  const data = parsed.data;

  const topic = data.topicId ? await getTopic(data.topicId) : null;
  /**
   * The research material this run is written from (CI-P3-01).
   *
   * Unlike the topic - a subject hint whose absence leaves the caller's own subject line in charge - a
   * material *is* the source text, so an id that names nothing is answered instead of ignored: an article
   * that silently came out without the material the user chose is exactly the "静默替换/静默降级" the card
   * refuses. A row that resolves is used; a row that does not is a 404 the client can explain.
   */
  const research = data.researchMaterialId ? await getResearchMaterial(data.researchMaterialId) : null;
  if (data.researchMaterialId && !research) {
    return fail("NOT_FOUND", 404, "the selected research material no longer exists");
  }

  const config: AiWritingConfig = {
    materialSource: "free",
    articleStyle: data.articleStyle,
    industry: data.industry,
    wordCount: data.maxWords,
    audience: data.audience,
    targetPlatform: data.targetPlatform,
    coreKeywords: data.keywords,
    language: data.languageCode ?? guessLanguage(data.language),
    imageStrategy: data.imageStrategy,
    imageCount: data.imageCount,
    deAi: data.deAi,
    knowledgeMode: data.knowledgeMode,
    positioningId: data.positioningId,
    // The selection travels in the config as well as in the request (CI-P2-03): the stored `aiWriting`
    // summary keeps what the caller asked for, while `metadata.brandId` - written by `generateArticle` -
    // records the brand that was actually read, so an id that named nothing stays visible as asked-for.
    brandId: data.brandId,
  };

  const agent = getWritingAgent(data.agentId);
  /**
   * The stored 研究提炼 of that material, when the caller asked for it (CI-P3-03-06).
   *
   * Two conditions, and both are needed: the caller must have asked (`includeResearchExtraction`), and the
   * material must really carry a result (`extraction !== null`). The digest is composed here from the
   * stored record *and* the material's text, because that is where "which of these facts can be located in
   * the source" is decided - an unlocatable fact never travels, and the block says how many were left out.
   */
  const extractionApplied =
    research && data.includeResearchExtraction && research.extraction
      ? { record: research.extraction, text: researchExtractionPromptText(research.extraction, research) }
      : null;

  const material: AiWritingMaterial = {
    topics: [],
    products: [],
    freeText: materialTextOf(data, topic, research, extractionApplied?.text ?? ""),
  };

  // A topic carries no product photo, and neither does a material: the stored source pages are the only
  // image sources this entry can offer, and each joins only when it is a real http(s) page the run
  // actually used - the same filter the wizard applies to its topic urls, plus the material's own rule
  // that a page which contributed no text is not a source of this article (P3-01-05).
  const sourceUrls = [
    ...(topic && /^https?:\/\//i.test(topic.sourceUrl) ? [topic.sourceUrl] : []),
    ...(research ? researchMaterialSourceUrls(research) : []),
  ];

  try {
    const result = await generateArticle({
      positioningId: data.positioningId,
      brandId: data.brandId,
      config,
      material,
      systemPromptPrefix: agent.systemPrompt,
      // CI-P7-05-03: the picker's own id, so the ledger can name the listing these rows ran as when
      // the storefront publishes it. `generateArticle` combines it with the position it resolves.
      extensionAgentId: agent.id,
      titleFallback: data.topic,
      imageSources: { productImagePaths: [], sourceUrls },
      provenance: {
        type: data.type,
        prompt: data.prompt,
        topic: data.topic,
        generationType: "topic",
        agentId: agent.id,
        agentName: agent.name,
        aiWriting: { ...config },
        ...(topic ? { topicId: topic.id } : {}),
        // Which material was read, and which version of it (P3-01-04). `updatedAt` is the same version
        // number a brand records, so "the material changed after this article" needs no second copy.
        ...(research
          ? { researchMaterialId: research.id, researchMaterialVersion: research.updatedAt }
          : {}),
        // Which version of the distillation reached the prompt, when one did (CI-P3-03). Written only
        // when a digest was really composed, so "this article was written with the extraction" is a fact
        // of the stored article rather than a flag someone set.
        ...(extractionApplied
          ? {
              researchExtractionRevision: extractionApplied.record.revision,
              researchExtractionTaskId: extractionApplied.record.taskId,
            }
          : {}),
      },
    });

    // The topic keeps a link back (P2-01-05). Neither a topic that has since been deleted nor a link
    // write that fails may turn a stored article into an error: the article is the primary effect and is
    // already committed, so this is reported and the response still carries the generation - the order
    // `api/ai-writing/generate` chose for the same link.
    if (topic && result.item) {
      try {
        await linkTopicContentItem(topic.id, result.item.id);
      } catch (error) {
        console.warn(`[content-generate] Could not link topic ${topic.id} to content ${result.item.id}.`, error);
      }
    }

    return ok(result, { status: 201 });
  } catch (error) {
    // No local error taxonomy: `failFromError` keeps an `AppError`'s own code and status (the runtime
    // sets both) and answers anything else with this route's long-standing 502.
    return failFromError(error, "AI_PROVIDER_FAILED", 502);
  }
}
