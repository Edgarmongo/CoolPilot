import { createContentItem, createUsageRecord } from "@/db/repository";
import { listKnowledgeBase } from "@/db/repositories/knowledge-base";
import { getDefaultPosition, getPosition } from "@/db/repositories/positions";
import { aiRuntime } from "@/features/ai-runtime";
import { postDraftSchema } from "@/lib/ai/schemas";
import {
  audiencePrompt,
  buildArticlePrompt,
  buildArticleSystemPrompt,
  imageCountValues,
  industryDomainPrompt,
  type AiWritingConfig,
  type AiWritingMaterial,
  type AiWritingPositioning,
} from "@/lib/ai-writing";
import { resolveArticleImages } from "@/lib/article-images";
import { selectKnowledgeReferences } from "@/lib/knowledge-base";
import { countTextCharacters } from "@/lib/usage";
import type { ContentItem, PositionRecord } from "@/lib/types";

/**
 * Article generation (C3 of `docs/creator-workflow-audit.md`, `docs/generation-service-audit.md`): the
 * one place where a writing config plus its material become a stored article.
 *
 * It is the tail both generation entries used to own twice - `api/content/generate` (article creation,
 * posts, videos) and `api/ai-writing/generate` (the console wizard) ran the same nine steps, and the
 * eight that belong to the article itself live here now: the positioning lookup, the knowledge
 * selection, the system prompt, the article prompt, the structured model call, the image resolution,
 * the `content_items` row and the `usage_records` row. The ninth step (the entry's own provenance blob)
 * stays with the entry, because only the entry knows it.
 *
 * What it is deliberately not (audit §5):
 *
 * - **Not a screen.** It may know that a content item exists, never that a screen does: no `next/*`, no
 *   `@/lib/api`, no `@/lib/editor-link`. The caller turns the returned item's id into a link, which is
 *   what keeps C1's hand-off out of here.
 * - **Not an image implementation.** Images are *resolved* by `lib/article-images.ts`, whose AI stage
 *   crosses the domain boundary exactly once, through `generateImageFile()`. This module must not call
 *   `aiRuntime.generateImage`, fetch an image itself or touch the artifacts directory, and it must not
 *   re-shape `metadata.images`: what an image's value means (local path, remote URL, bare file name) is
 *   C4's question, so the list is passed through untouched.
 * - **Not the owner of the caller's facts.** The prompt's material, the title fallback, the image
 *   sources and the entry's provenance arrive as arguments and are stored verbatim. Only `images`,
 *   `positioningId`, `provider` and `model` are added, because only this layer has them (F-C3-4).
 *
 * Three orderings are kept on purpose. The model writes the title and `titleFallback` is used *only*
 * when it comes back empty (F-C3-3), the title and body are trimmed before anything is stored, and the
 * content item is written *before* the usage row - a failure between the two leaves a visible article
 * without a cost row, the same "record first" order C2 chose (audit §5).
 *
 * Errors are not translated here. The model call's failures keep the runtime's own code and status
 * (D-P3-3) and the routes keep `failFromError`, so this function lets everything it did not cause
 * propagate untouched.
 *
 * One consequence of composing the metadata here: its keys are written provenance-first, so the stored
 * `metadata` JSON's key order differs from what each entry wrote before (as does
 * `api/content/generate`'s envelope order, which now follows this result shape). Both are object-key
 * order - read by name everywhere, asserted by no test.
 */

export type ArticleGenerationRequest = {
  /** Both entries resolve the same way: this id, or the account's default position when it is empty. */
  positioningId?: string;
  /** The writing config both entries converge on; `AiWritingConfig` stays shared vocabulary. */
  config: AiWritingConfig;
  /** The prompt's material: topics and products as records, the free text raw. */
  material: AiWritingMaterial;
  /** The writing agent's prompt, prefixed to the system prompt. Entry B only today. */
  systemPromptPrefix?: string;
  /** Used only when the model answers with an empty title - never invented by this module (F-C3-3). */
  titleFallback: string;
  /** Material-derived, so the caller assembles it (F-C3-5). Two empty lists mean "no image source". */
  imageSources: { productImagePaths: string[]; sourceUrls: string[] };
  /** The entry's own provenance (`type`, `aiWriting`, `topic`, `agentId`, ...), stored verbatim. */
  provenance: Record<string, unknown>;
};

/** The shape both entries already answer with, and the shape both clients already read. */
export type ArticleGenerationResult = {
  item: ContentItem | null;
  images: string[];
  provider: string;
  model: string;
};

/** The eight fields a positioning contributes to a prompt; byte-identical in both entries before C3. */
function toPositioning(position: PositionRecord | null): AiWritingPositioning | undefined {
  if (!position) return undefined;
  return {
    name: position.name,
    description: position.description,
    targetAudience: position.targetAudience,
    contentDirection: position.contentDirection,
    toneStyle: position.toneStyle,
    personaRole: position.personaRole,
    writingGuide: position.writingGuide,
    bannedWords: position.bannedWords,
  };
}

/**
 * Generates one article and stores it, with the row that reports what it cost.
 *
 * The caller has already validated its own payload and built the four things only it knows (the
 * material, the title fallback, the image sources, the provenance); everything between the request and
 * the stored rows happens here. A positioning that is missing is not an error: the knowledge selection
 * then falls back to the entries that apply to every positioning, exactly as both entries did.
 */
export async function generateArticle(request: ArticleGenerationRequest): Promise<ArticleGenerationResult> {
  const { config } = request;

  const position = request.positioningId ? await getPosition(request.positioningId) : await getDefaultPosition();
  const knowledge =
    config.knowledgeMode === "position" ? selectKnowledgeReferences(await listKnowledgeBase(), position?.id) : [];

  // The prefix is the caller's (the writing agent's prompt); the positioning prompt is this module's.
  const systemPrompt = [
    request.systemPromptPrefix,
    buildArticleSystemPrompt({ config, positioning: toPositioning(position) }),
  ]
    .filter(Boolean)
    .join("\n\n");
  const prompt = buildArticlePrompt({
    config,
    materials: request.material,
    knowledge,
    audienceLabel: audiencePrompt[config.audience],
    industryLabel: industryDomainPrompt[config.industry],
  });

  const response = await aiRuntime.chatStructured({
    messages: [{ role: "user", content: prompt }],
    systemPrompt,
    schema: postDraftSchema,
  });
  const title = response.data.title.trim() || request.titleFallback;
  const body = response.data.body.trim();

  const images = await resolveArticleImages({
    strategy: config.imageStrategy,
    target: imageCountValues[config.imageCount],
    productImagePaths: request.imageSources.productImagePaths,
    sourceUrls: request.imageSources.sourceUrls,
    title,
  });

  const item = await createContentItem({
    title,
    body,
    postReadyText: `${title}\n\n${body}`.trim(),
    // One list, two consumers: the item's sources and the pages the image resolver may read.
    sourceUrls: request.imageSources.sourceUrls,
    imagePath: images[0] ?? "",
    metadata: {
      ...request.provenance,
      images,
      positioningId: position?.id ?? "",
      provider: response.providerId,
      model: response.model,
    },
    status: "ready",
  });

  await createUsageRecord({
    provider: response.providerId,
    model: response.model,
    kind: "article",
    status: "success",
    inputTokens: response.usage?.inputTokens,
    outputTokens: response.usage?.outputTokens,
    totalTokens: response.usage?.totalTokens,
    wordCount: countTextCharacters(body),
    contentItemId: item?.id,
  });

  return { item: item ?? null, images, provider: response.providerId, model: response.model };
}
