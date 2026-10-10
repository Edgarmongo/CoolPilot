import { listProducts } from "@/db/repositories/products";
import { linkTopicContentItem } from "@/db/repositories/topics";
import { generateArticle } from "@/lib/article-generation";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import type { AiWritingMaterial } from "@/lib/ai-writing";
import { aiWritingGenerateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The console wizard's entry point for one article draft (C3 of `docs/creator-workflow-audit.md`).
 *
 * The route owns *who is asking*: the payload's schema, its guard, the product material, the usable
 * topic urls and the provenance this entry wants to remember. The article itself - positioning,
 * knowledge, prompts, the structured call, the images, the content item and the usage row - belongs to
 * `generateArticle()` (`@/lib/article-generation`), which `api/content/generate` uses too.
 *
 * What only this entry knows: `topics`/`productIds`/`freeText` are its own payload shape, the selected
 * products are read here because they are both material and image source (F-C3-5), this console's title
 * fallback is `topic -> freeText -> "未命名文章"`, and the source urls are the same topic urls the stored
 * article records and the image resolver may read. `topicId` (CI-P2-01) is provenance of the same kind:
 * the text already travelled as `freeText`, and this id is what lets the stored article and the topic
 * point at each other afterwards.
 *
 * The model call goes through `generateArticle` into `aiRuntime` (batch P3-A3 of
 * `docs/generate-migration-p3.md`): provider order, model choice, key rotation, failover and
 * structured-output validation are the runtime's business. A failure is not translated here - it keeps
 * the runtime's own code *and* status (D-P3-3) instead of a 502 flattened from a message, so a missing
 * credential is a 400 and a cooled down key pool a 429.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, aiWritingGenerateSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const { config, topics, productIds, freeText, topicId } = parsed.data;

  const allProducts = await listProducts();
  const selectedProducts = productIds.length ? allProducts.filter((product) => productIds.includes(product.id)) : [];

  const material: AiWritingMaterial = {
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

  // The images may read the topic pages, and the stored article records the same list.
  const sourceUrls = topics.map((topic) => topic.url).filter((url) => /^https?:\/\//i.test(url));

  try {
    const result = await generateArticle({
      positioningId: config.positioningId,
      brandId: config.brandId,
      config,
      material,
      titleFallback: topics[0]?.title || freeText.slice(0, 20) || "未命名文章",
      imageSources: {
        productImagePaths: selectedProducts.map((product) => product.imagePath).filter(Boolean),
        sourceUrls,
      },
      provenance: {
        type: "article",
        aiWriting: { ...config, topics: topics.map((topic) => topic.title), productIds },
        ...(topicId ? { topicId } : {}),
      },
    });

    // The topic keeps a link back (P2-01-05). Neither a topic that has since been deleted nor a link
    // write that fails may turn a stored article into an error: the article is the primary effect and
    // is already committed, so this is reported and the response still carries the generation.
    if (topicId && result.item) {
      try {
        await linkTopicContentItem(topicId, result.item.id);
      } catch (error) {
        console.warn(`[ai-writing] Could not link topic ${topicId} to content ${result.item.id}.`, error);
      }
    }

    return ok(result, { status: 201 });
  } catch (error) {
    // No local error taxonomy: `failFromError` keeps an `AppError`'s own code and status (the runtime
    // sets both) and answers anything else with this route's long-standing 502.
    return failFromError(error, "AI_PROVIDER_FAILED", 502);
  }
}
