import { createContentItem, createUsageRecord } from "@/db/repository";
import { listKnowledgeBase } from "@/db/repositories/knowledge-base";
import { getDefaultPosition, getPosition } from "@/db/repositories/positions";
import { listProducts } from "@/db/repositories/products";
import { generateStructured } from "@/lib/ai/generate";
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
import { fail, ok, parseJson } from "@/lib/api";
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
    const result = await generateStructured({ prompt, systemPrompt, schema: postDraftSchema });
    const title = result.data.title.trim() || topics[0]?.title || freeText.slice(0, 20) || "未命名文章";
    const body = result.data.body.trim();
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
        provider: result.provider,
        model: result.model,
      },
      status: "ready",
    });

    await createUsageRecord({
      provider: result.provider,
      model: result.model,
      kind: "article",
      status: "success",
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      totalTokens: result.usage?.totalTokens,
      wordCount: countTextCharacters(body),
      contentItemId: item?.id,
    });

    return ok({ item, images, provider: result.provider, model: result.model }, { status: 201 });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Generation failed", 502);
  }
}
