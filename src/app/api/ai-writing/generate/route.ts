import { createContentItem, createUsageRecord } from "@/db/repository";
import { listKnowledgeBase } from "@/db/repositories/knowledge-base";
import { getDefaultPosition, getPosition } from "@/db/repositories/positions";
import { listProducts } from "@/db/repositories/products";
import { aiRuntime } from "@/features/ai-runtime";
import { postDraftSchema } from "@/lib/ai/schemas";
import {
  audiencePrompt,
  buildArticlePrompt,
  buildArticleSystemPrompt,
  imageCountValues,
  industryDomainPrompt,
  type AiWritingMaterial,
  type AiWritingPositioning,
} from "@/lib/ai-writing";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { resolveArticleImages } from "@/lib/article-images";
import { selectKnowledgeReferences } from "@/lib/knowledge-base";
import { countTextCharacters } from "@/lib/usage";
import { aiWritingGenerateSchema } from "@/lib/validation";
import type { PositionRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * Generates one article draft from the console's material and stores it as a content item.
 *
 * The model call goes straight to `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`):
 * provider order, model choice, key rotation, failover and structured-output validation are the
 * runtime's business, while the prompt, the system prompt, the schema and everything after the call
 * (images, the content item, the usage row) stay this route's. A failure keeps the runtime's own code
 * *and* status (D-P3-3) instead of a 502 flattened from a message, so a missing credential is a 400
 * and a cooled down key pool a 429.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, aiWritingGenerateSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const { config, topics, productIds, freeText } = parsed.data;

  const position = config.positioningId ? await getPosition(config.positioningId) : await getDefaultPosition();
  const allProducts = await listProducts();
  const selectedProducts = productIds.length ? allProducts.filter((product) => productIds.includes(product.id)) : [];

  const materials: AiWritingMaterial = {
    topics: topics.map((topic) => ({ title: topic.title, source: topic.source, url: topic.url })),
    products: selectedProducts.map((product) => ({
      name: product.name,
      brand: product.brand,
      category: product.category,
      keywords: product.keywords,
      description: product.description,
      linkUrl: product.linkUrl,
    })),
    freeText,
  };

  const knowledge =
    config.knowledgeMode === "position" ? selectKnowledgeReferences(await listKnowledgeBase(), position?.id) : [];

  const systemPrompt = buildArticleSystemPrompt({ config, positioning: toPositioning(position) });
  const prompt = buildArticlePrompt({
    config,
    materials,
    knowledge,
    audienceLabel: audiencePrompt[config.audience],
    industryLabel: industryDomainPrompt[config.industry],
  });

  try {
    const response = await aiRuntime.chatStructured({
      messages: [{ role: "user", content: prompt }],
      systemPrompt,
      schema: postDraftSchema,
    });
    const title = response.data.title.trim() || topics[0]?.title || freeText.slice(0, 20) || "未命名文章";
    const body = response.data.body.trim();
    const sourceUrls = topics.map((topic) => topic.url).filter((url) => /^https?:\/\//i.test(url));

    const images = await resolveArticleImages({
      strategy: config.imageStrategy,
      target: imageCountValues[config.imageCount],
      productImagePaths: selectedProducts.map((product) => product.imagePath).filter(Boolean),
      sourceUrls,
      title,
    });

    const item = await createContentItem({
      title,
      body,
      postReadyText: `${title}\n\n${body}`.trim(),
      sourceUrls,
      imagePath: images[0] ?? "",
      metadata: {
        type: "article",
        images,
        aiWriting: { ...config, topics: topics.map((topic) => topic.title), productIds },
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

    return ok({ item, images, provider: response.providerId, model: response.model }, { status: 201 });
  } catch (error) {
    // No local error taxonomy: `failFromError` keeps an `AppError`'s own code and status (the runtime
    // sets both) and answers anything else with this route's long-standing 502.
    return failFromError(error, "AI_PROVIDER_FAILED", 502);
  }
}
