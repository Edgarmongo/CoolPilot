import { createContentItem, createUsageRecord } from "@/db/repository";
import { getBrand } from "@/db/repositories/brands";
import { listKnowledgeBase } from "@/db/repositories/knowledge-base";
import { getDefaultPosition, getPosition } from "@/db/repositories/positions";
import { aiRuntime, type StructuredChatResponse } from "@/features/ai-runtime";
import { postDraftSchema } from "@/lib/ai/schemas";
import {
  audiencePrompt,
  buildArticlePrompt,
  buildArticleSystemPrompt,
  imageCountValues,
  industryDomainPrompt,
  type AiWritingBrand,
  type AiWritingConfig,
  type AiWritingMaterial,
  type AiWritingPositioning,
} from "@/lib/ai-writing";
import { resolveArticleImages } from "@/lib/article-images";
import { beginAiBudgetCall } from "@/lib/ai-budget-guard";
import { contentImageAssetsKey, contentImageFailuresKey } from "@/lib/content-image-assets";
import { recordAiUsageCall, recordAiUsageFailure, type AiUsageCallContext } from "@/lib/ai-usage-ledger-recorder";
import { selectKnowledgeReferences } from "@/lib/knowledge-base";
import { countTextCharacters } from "@/lib/usage";
import type { BrandRecord, ContentItem, PositionRecord } from "@/lib/types";

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
 *   `aiRuntime.generateImage`, fetch an image itself or touch the artifacts directory. What it does own
 *   is what C4 asked for: the resolver's images are stored under their one stored shape, with the
 *   resolver's per-image identity and origin (`metadata.imageAssets`) and the remote addresses it could
 *   not localize (`metadata.imageLocalizationFailures`) written beside them.
 * - **Not the owner of the caller's facts.** The prompt's material, the title fallback, the image
 *   sources and the entry's provenance arrive as arguments and are stored verbatim. Only `images`,
 *   `imageAssets`, `imageLocalizationFailures`, `positioningId`, `brandId`, `brandVersion`, `provider`
 *   and `model` are added, because only this layer has them (F-C3-4).
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
  /**
   * The brand profile (品牌资料) this run writes as (CI-P2-02). Unlike the positioning there is no
   * default: absent or unknown means "no brand context", because a brand is an explicit selection and
   * writing as somebody else's brand is the one outcome P2-02-05 forbids.
   */
  brandId?: string;
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

/** The six fields a brand contributes to a prompt; `id`/`version` stay out, because prompts take text. */
function toBrand(brand: BrandRecord | null): AiWritingBrand | undefined {
  if (!brand) return undefined;
  return {
    name: brand.name,
    description: brand.description,
    targetAudience: brand.targetAudience,
    tone: brand.tone,
    keywords: brand.keywords,
    bannedWords: brand.bannedWords,
  };
}

/**
 * Generates one article and stores it, with the row that reports what it cost.
 *
 * The caller has already validated its own payload and built the four things only it knows (the
 * material, the title fallback, the image sources, the provenance); everything between the request and
 * the stored rows happens here. A positioning that is missing is not an error: the knowledge selection
 * then falls back to the entries that apply to every positioning, exactly as both entries did.
 *
 * A brand (CI-P2-02) is resolved the same way the positioning is, and a missing one is equally not an
 * error - it contributes nothing. What it must never do is contribute another brand's fields, which is
 * why this module reads the record by the id the request named and builds both prompts from that one
 * record (P2-02-05).
 */
export async function generateArticle(request: ArticleGenerationRequest): Promise<ArticleGenerationResult> {
  const { config } = request;

  const position = request.positioningId ? await getPosition(request.positioningId) : await getDefaultPosition();
  // An unknown id is "no brand", never a fallback: the alternative is an article that claims to be
  // written as a brand the caller did not choose.
  const brand = request.brandId ? await getBrand(request.brandId) : null;
  const knowledge =
    config.knowledgeMode === "position" ? selectKnowledgeReferences(await listKnowledgeBase(), position?.id) : [];

  // The prefix is the caller's (the writing agent's prompt); the positioning prompt is this module's.
  const systemPrompt = [
    request.systemPromptPrefix,
    buildArticleSystemPrompt({ config, positioning: toPositioning(position), brand: toBrand(brand) }),
  ]
    .filter(Boolean)
    .join("\n\n");
  const prompt = buildArticlePrompt({
    config,
    materials: request.material,
    knowledge,
    audienceLabel: audiencePrompt[config.audience],
    industryLabel: industryDomainPrompt[config.industry],
    brand: toBrand(brand),
  });

  // CI-P7-01-04. The business half of this call's ledger rows, built before the request so the
  // failure path can record the very same call. A request the provider rejected may still have been
  // billed, and the requests it made travel on the error (`attachModelAttempts` in the runtime).
  const usageCall: AiUsageCallContext = { purpose: "article" };

  // CI-P7-03. The budget gate stands between the prompt and the request, and it measures the very text
  // the request will carry. A refusal is thrown from here, *outside* the try below, so it is neither
  // written to the ledger (no request was sent, so there is nothing to account for) nor reworded as a
  // provider failure by the catch, which would blame a provider that was never asked.
  const budget = await beginAiBudgetCall({
    identity: usageCall,
    purpose: usageCall.purpose,
    capabilities: ["chat"],
    inputText: prompt,
  });
  // CI-P7-03-A: the hold's id travels onto this call's ledger rows, so what was held and what
  // was spent are compared by an id instead of correlated by purpose and time.
  usageCall.budgetReservationId = budget.reservationId ?? undefined;
  let response: StructuredChatResponse<typeof postDraftSchema>;
  try {
    response = await aiRuntime.chatStructured({
      messages: [{ role: "user", content: prompt }],
      systemPrompt,
      schema: postDraftSchema,
    });
  } catch (error) {
    await recordAiUsageFailure(usageCall, error);
    throw error;
  } finally {
    await budget.release();
  }
  const title = response.data.title.trim() || request.titleFallback;
  const body = response.data.body.trim();

  const resolved = await resolveArticleImages({
    strategy: config.imageStrategy,
    target: imageCountValues[config.imageCount],
    productImagePaths: request.imageSources.productImagePaths,
    sourceUrls: request.imageSources.sourceUrls,
    title,
  });
  const images = resolved.images;

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
      // C4: the identity and origin of each image, in the same order as the list above (cover first).
      // An item with no images adds no key, so its metadata stays the shape every earlier caller read.
      ...(resolved.assets.length > 0 ? { [contentImageAssetsKey]: resolved.assets } : {}),
      // And the honest half of a failure: a source page whose image could not be brought into the
      // workspace names itself here instead of leaving an unexplained gap in the list above.
      ...(resolved.skippedRemoteImages.length > 0
        ? { [contentImageFailuresKey]: resolved.skippedRemoteImages }
        : {}),
      positioningId: position?.id ?? "",

      // Which brand this was written as, and which version of it (P2-02-04). `brandVersion` is the
      // brand row's `updatedAt`, so "the brand was edited after this article was generated" is a
      // comparison two stored numbers answer, without keeping a second copy of the fields.
      brandId: brand?.id ?? "",
      brandVersion: brand?.updatedAt ?? 0,
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

  // CI-P7-01. The two tables answer different questions and both are written on purpose:
  // `usage_records` above is the count the 用量统计 page has always shown, and this is the ledger
  // entry: one row per request the runtime actually sent - a rotated key and a self-correcting
  // re-ask are charges of their own, not one call - plus what each of them cost. The article is
  // already stored at this point, so a ledger failure changes nothing the user can see: the recorder
  // swallows it and reports `failed` rather than throwing.
  await recordAiUsageCall({ ...usageCall, contentItemId: item?.id, attempts: response.attempts });

  return { item: item ?? null, images, provider: response.providerId, model: response.model };
}
