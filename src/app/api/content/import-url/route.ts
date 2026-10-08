import { createContentItem, createUsageRecord } from "@/db/repository";
import { fail, ok, parseJson } from "@/lib/api";
import { fetchArticleText, rewriteArticle } from "@/lib/scraper";
import { importUrlSchema } from "@/lib/validation";
import { countTextCharacters } from "@/lib/usage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await parseJson(request, importUrlSchema);
  if (parsed.error) {
    return fail("Invalid URL import payload", 400, parsed.error);
  }
  const article = await fetchArticleText(parsed.data.url);
  const content = parsed.data.rewrite
    ? await rewriteArticle({
        title: article.title || parsed.data.url,
        text: article.text,
        maxWords: parsed.data.maxWords,
        language: parsed.data.language,
      })
    : {
        title: article.title || parsed.data.url,
        body: article.text.slice(0, parsed.data.maxWords * 2),
        postReadyText: article.text.slice(0, parsed.data.maxWords * 2),
        provider: "local",
        model: "none",
        usage: undefined,
      };

  const item = await createContentItem({
    title: content.title,
    body: content.body,
    postReadyText: content.postReadyText,
    sourceUrls: [parsed.data.url],
    imagePath: article.imageUrl,
    metadata: {
      provider: content.provider,
      model: content.model,
      sourceTitle: article.title,
      generationType: parsed.data.rewrite ? "url_rewrite" : "url_import",
    },
    status: "ready",
  });
  if (parsed.data.rewrite) {
    await createUsageRecord({
      provider: content.provider,
      model: content.model,
      kind: "article",
      status: "success",
      inputTokens: content.usage?.inputTokens,
      outputTokens: content.usage?.outputTokens,
      totalTokens: content.usage?.totalTokens,
      wordCount: countTextCharacters(content.postReadyText || content.body),
      contentItemId: item?.id,
    });
  }
  return ok({ item }, { status: 201 });
}
