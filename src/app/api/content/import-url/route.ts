import { createContentItem, createUsageRecord } from "@/db/repository";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { fetchArticleText, rewriteArticle } from "@/lib/scraper";
import { importUrlSchema } from "@/lib/validation";
import { countTextCharacters } from "@/lib/usage";

export const runtime = "nodejs";

/**
 * Imports one URL as a content item, optionally rewriting it into a post draft.
 *
 * Two different failures run through this handler: reading the page (`fetchArticleText()`, a plain `Error`
 * carrying the HTTP status) and the AI rewrite behind `rewriteArticle()` - the runtime's own `AppError`s for
 * anything credential-shaped, and the scraper's `AI rewrite failed: …` wrapper for the rest (batch P3-A1
 * changed that vocabulary, not that shape). Until P3-C the route had no error answer at all: an exception
 * escaped the handler and the client's `apiPost` could only report `Request failed with 500`, because the body
 * was not this API's envelope. P3-C (M2 of `docs/generate-migration-p3.md`) adds it: an `AppError` leaves with
 * its own code and status (D-P3-3 - a credential problem is a 400 the UI can explain), and every other failure
 * answers the flat 500 `UNKNOWN_ERROR` this path already produced, only readable now.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, importUrlSchema);
  if (parsed.error) {
    return fail("Invalid URL import payload", 400, parsed.error);
  }
  try {
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
  } catch (error) {
    // No local error taxonomy: the runtime's own code and status when the failure is an `AppError` (D-P3-3),
    // and the flat 500 this path has always ended in for everything else - a page that would not load, the
    // scraper's wrapped AI failure, a database error. The difference P3-C makes is that the client can read
    // the reason at all.
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}
