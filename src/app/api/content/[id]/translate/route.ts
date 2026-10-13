import { createUsageRecord, getContentItem } from "@/db/repository";
import { aiRuntime } from "@/features/ai-runtime";
import { articleTranslationSchema } from "@/lib/ai/schemas";
import { htmlToPlainText } from "@/lib/article-themes";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { beginAiBudgetCall, type AiBudgetCallHandle } from "@/lib/ai-budget-guard";
import { marketplaceExtensionIdOfContentItem } from "@/lib/content-item-listing";
import { recordAiUsageCall, recordAiUsageFailure, type AiUsageCallContext } from "@/lib/ai-usage-ledger-recorder";
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
 *
 * The model call goes straight to `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`): provider
 * order, model choice, key rotation, failover and structured-output validation are the runtime's business,
 * while reading the article by `[id]`, the source-text assembly, the translator prompt, the schema and
 * everything after the call (the trim/filter, the usage row, the envelope) stay this route's. The answer
 * is read through the runtime's own names (`providerId`, `model`, `usage`), and a failure keeps the
 * runtime's code *and* status (D-P3-3) instead of a 502 flattened from a message - the `[id]` guard, the
 * payload guard and the empty-source guard are the only answers this route still words itself.
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

  // CI-P7-01-04. The article being translated is this call's business identity, known before the
  // request; a translation that needed the runtime's self-correcting re-ask is two ledger rows,
  // because both requests were really sent.
  //
  // CI-P7-05-03 (remaining surface): the same attribution a rewrite carries, from the same stored
  // provenance - a translation is that article's money too, and the dialog names no listing of its own.
  const usageCall: AiUsageCallContext = {
    purpose: "content-translate",
    contentItemId: id,
    extensionId: await marketplaceExtensionIdOfContentItem(existing),
  };

  const prompt = [
    `把下面的文章逐段翻译成${targetLanguage}。`,
    "要求：段落数量与顺序必须与原文完全一致（一段对一段），用词自然地道，不要逐字直译；只输出译文，不要添加解释、注释或编号。",
    `原标题：${sourceTitle}`,
    "原文（编号仅用于对照，不要输出编号）：",
    ...sourceParagraphs.map((text, index) => `${index + 1}. ${text}`),
  ].join("\n");

  let budget: AiBudgetCallHandle;
  try {
    budget = await beginAiBudgetCall({
      identity: usageCall,
      purpose: usageCall.purpose,
      capabilities: ["chat"],
      inputText: prompt,
    });
    // CI-P7-03-A: the hold's id travels onto this call's ledger rows, so what was held and what
    // was spent are compared by an id instead of correlated by purpose and time.
    usageCall.budgetReservationId = budget.reservationId ?? undefined;
  } catch (error) {
    // `failFromError` keeps the gate's `AI_BUDGET_EXCEEDED` and its 402; a settings or ledger read that
    // failed instead is this route's unknown error - not a refusal it would be wrong to invent. A refusal
    // never reaches the catch below, so nothing writes a "provider failed" row for a call nobody sent.
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }

  try {
    const response = await aiRuntime.chatStructured({
      messages: [{ role: "user", content: prompt }],
      systemPrompt: "你是一位专业翻译，擅长把自媒体文章逐段翻译成目标语言并保持段落一一对应。",
      schema: articleTranslationSchema,
    });
    const paragraphs = response.data.paragraphs.map((text) => text.trim()).filter(Boolean);
    // Recorded before the guard: the request was answered and charged for, even if the answer has
    // no paragraphs to show. Each entry of `attempts` becomes its own row.
    await recordAiUsageCall({ ...usageCall, attempts: response.attempts });
    if (paragraphs.length === 0) return fail("EMPTY_RESULT", 502);

    await createUsageRecord({
      provider: response.providerId,
      model: response.model,
      kind: "article",
      status: "success",
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
      totalTokens: response.usage?.totalTokens,
      wordCount: countTextCharacters(paragraphs.join("\n")),
      contentItemId: id,
    });

    return ok({
      title: response.data.title.trim() || sourceTitle,
      paragraphs,
      sourceTitle,
      sourceParagraphs,
      provider: response.providerId,
      model: response.model,
    });
  } catch (error) {
    // No local error taxonomy: `failFromError` keeps an `AppError`'s own code and status (the runtime
    // sets both) and answers anything else with this route's long-standing 502.
    await recordAiUsageFailure(usageCall, error);
    return failFromError(error, "AI_PROVIDER_FAILED", 502);
  } finally {
    await budget.release();
  }
}
