import { z } from "zod";
import { createKnowledgeBase } from "@/db/repositories/knowledge-base";
import { getPosition } from "@/db/repositories/positions";
import { createUsageRecord } from "@/db/repository";
import { aiRuntime } from "@/features/ai-runtime";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { beginAiBudgetCall, type AiBudgetCallHandle } from "@/lib/ai-budget-guard";
import { recordAiUsageCall, recordAiUsageFailure, type AiUsageCallContext } from "@/lib/ai-usage-ledger-recorder";
import {
  guessKnowledgeCategory,
  isKnowledgeBaseCategory,
  isKnowledgeBaseWeight,
  parseKnowledgeFromRawText,
} from "@/lib/knowledge-base";
import { marketplaceExtensionIdOf } from "@/lib/marketplace-attribution";
import { countTextCharacters } from "@/lib/usage";
import { knowledgeBaseSmartImportSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const aiKnowledgeSchema = z.object({
  title: z.string(),
  content: z.string(),
  category: z.string(),
  weight: z.string(),
  tags: z.array(z.string()),
});

const systemPrompt = [
  "你是知识库整理助手，负责把用户粘贴的原始内容（文章、网页正文、笔记、聊天记录等）结构化为一条知识条目。",
  "字段要求：title 为 24 字以内、能概括内容的知识标题；",
  "content 为整理后的正文，保留关键事实与数据，去除导航、广告、页脚等噪音，使用简体中文；",
  "category 只能取以下之一：product（产品）、industry（行业）、brand（品牌）、faq（常见问答）、formula（配方）、reference（参考资料）、other（其他）；",
  "weight 只能取 high、medium、low 之一，表示检索权重；",
  "tags 为 0-6 个简短的标签。",
].join("\n");

/**
 * Turns a paste into one knowledge entry for the "Smart import" dialog.
 *
 * The model call goes straight to `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`): provider
 * order, model choice, key rotation, failover and structured-output validation are the runtime's business,
 * while the prompt, the schema, the vocabulary normalisation below and everything written to the database
 * stay this route's. The answer is read through the runtime's own names (`providerId`, `model`, `usage`).
 *
 * The catch is deliberately *not* an error answer, and that is this route's difference from the rest of
 * batch A3-2: any AI failure - nothing configured, no usable credential, a provider that is down, an
 * answer that failed the schema twice - falls back to `parseKnowledgeFromRawText()` and still answers 201
 * with `source: "fallback"`, so the pasted text is never lost. `failFromError` (and with it D-P3-3's
 * code/status pass-through) does not apply here: there is no failure for the dialog to read, and the
 * payload guard the handler runs before the call is the only answer this route words itself.
 *
 * A budget refusal (CI-P7-03) is the one exception, and knowingly so: it is not an AI failure but the
 * user's own instruction to stop spending, so it is answered with the gate's `AI_BUDGET_EXCEEDED` and its
 * 402 rather than absorbed into a local parse the user would read as a successful smart import.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, knowledgeBaseSmartImportSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const raw = parsed.data.content;
  const positionId = parsed.data.positionId;
  // CI-P7-01-04. The entry the model produces is a knowledge row, which the ledger has no column
  // for, and the paste carries no id of its own - so `purpose` is the accounting identity.
  //
  // CI-P7-05-03. The exception is the extension this entry is created *for*: the payload already
  // named the position the knowledge will belong to (`positionId`, stored on the row below), and a
  // published position is a Marketplace listing. That attribution used to be dropped here, which
  // left the dialog's money unattributed even when the user had published an agent for exactly this
  // work. An id that resolves to nothing - or to a position that is not published - contributes no
  // listing, so the call stays honestly unattributed rather than named after a draft.
  const position = positionId ? await getPosition(positionId) : null;
  const usageCall: AiUsageCallContext = {
    purpose: "knowledge",
    extensionId: marketplaceExtensionIdOf({ position }),
  };
  const prompt = `请把以下原始内容整理成一条知识条目：\n\n${raw.slice(0, 8000)}`;

  // CI-P7-03. ... (see the header: a refusal is not an AI failure, so it is answered rather than absorbed)
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
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }

  try {
    const response = await aiRuntime.chatStructured({
      messages: [{ role: "user", content: prompt }],
      systemPrompt,
      schema: aiKnowledgeSchema,
    });
    // Recorded as soon as the answer arrives, not after the row is stored: the request was billed
    // either way, and the catch below only writes again when a *runtime* error carried a trail.
    await recordAiUsageCall({ ...usageCall, attempts: response.attempts });
    const data = response.data;
    const category = isKnowledgeBaseCategory(data.category) ? data.category : guessKnowledgeCategory(`${data.title}\n${data.content}`);
    const weight = isKnowledgeBaseWeight(data.weight) ? data.weight : "medium";
    const item = await createKnowledgeBase({
      title: data.title.trim() || parseKnowledgeFromRawText(raw).title,
      content: data.content.trim() || raw.trim(),
      category,
      weight,
      origin: "ai",
      tags: data.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
      positionId,
    });
    await createUsageRecord({
      provider: response.providerId,
      model: response.model,
      kind: "knowledge",
      status: "success",
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
      totalTokens: response.usage?.totalTokens,
      wordCount: countTextCharacters(data.content),
    });
    return ok({ item, source: "ai" as const, provider: response.providerId, model: response.model }, { status: 201 });
  } catch (error) {
    // No provider configured / provider failure: fall back to a deterministic local parse. The
    // ledger gets the failed requests first (an error with no trail - nothing configured - writes
    // nothing, which is the truth rather than a gap).
    await recordAiUsageFailure(usageCall, error);
    const draft = parseKnowledgeFromRawText(raw);
    const item = await createKnowledgeBase({ ...draft, origin: "ai", positionId });
    return ok({ item, source: "fallback" as const }, { status: 201 });
  } finally {
    await budget.release();
  }
}
