import { createUsageRecord, getContentItem } from "@/db/repository";
import { generateStructured } from "@/lib/ai/generate";
import { articleTranslationSchema } from "@/lib/ai/schemas";
import { htmlToPlainText } from "@/lib/article-themes";
import { fail, ok, parseJson } from "@/lib/api";
import { toParagraphs } from "@/lib/translation-layouts";
import { countTextCharacters } from "@/lib/usage";
import { contentTranslateSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Upper bound on how much source text is sent to the model. */
const maxTranslateInput = 8000;

/**
 * Translates an article into the language picked in the editor's “翻译” dialog.
 * Paragraphs come back aligned with the source so the dialog can lay them out as
 * “中文在前 / 逐段对照 / 仅译文”. Nothing is written to the article here — the
 * editor shows a diff and persists only after the user confirms.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const existing = await getContentItem(id);
  if (!existing) return fail("NOT_FOUND", 404);

  const parsed = await parseJson(request, contentTranslateSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const { targetLanguage } = parsed.data;

  const sourceTitle = (parsed.data.title?.trim() || existing.title).trim();
  const sourceText = (parsed.data.text?.trim() || htmlToPlainText(existing.body)).slice(0, maxTranslateInput);
  const sourceParagraphs = toParagraphs(sourceText);
  if (sourceParagraphs.length === 0) return fail("EMPTY_CONTENT", 400);

  const prompt = [
    `把下面的文章逐段翻译成${targetLanguage}。`,
    "要求：段落数量与顺序必须与原文完全一致（一段对一段），用词自然地道，不要逐字直译；只输出译文，不要添加解释、注释或编号。",
    `原标题：${sourceTitle}`,
    "原文（编号仅用于对照，不要输出编号）：",
    ...sourceParagraphs.map((text, index) => `${index + 1}. ${text}`),
  ].join("\n");

  try {
    const result = await generateStructured({
      systemPrompt: "你是一位专业翻译，擅长把自媒体文章逐段翻译成目标语言并保持段落一一对应。",
      prompt,
      schema: articleTranslationSchema,
    });
    const paragraphs = result.data.paragraphs.map((text) => text.trim()).filter(Boolean);
    if (paragraphs.length === 0) return fail("EMPTY_RESULT", 502);

    await createUsageRecord({
      provider: result.provider,
      model: result.model,
      kind: "article",
      status: "success",
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      totalTokens: result.usage?.totalTokens,
      wordCount: countTextCharacters(paragraphs.join("\n")),
      contentItemId: id,
    });

    return ok({
      title: result.data.title.trim() || sourceTitle,
      paragraphs,
      sourceTitle,
      sourceParagraphs,
      provider: result.provider,
      model: result.model,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Translation failed", 502);
  }
}
