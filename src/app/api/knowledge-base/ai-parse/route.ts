import { z } from "zod";
import { createKnowledgeBase } from "@/db/repositories/knowledge-base";
import { createUsageRecord } from "@/db/repository";
import { aiRuntime } from "@/features/ai-runtime";
import { fail, ok, parseJson } from "@/lib/api";
import {
  guessKnowledgeCategory,
  isKnowledgeBaseCategory,
  isKnowledgeBaseWeight,
  parseKnowledgeFromRawText,
} from "@/lib/knowledge-base";
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
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, knowledgeBaseSmartImportSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const raw = parsed.data.content;
  const positionId = parsed.data.positionId;

  try {
    const response = await aiRuntime.chatStructured({
      messages: [{ role: "user", content: `请把以下原始内容整理成一条知识条目：\n\n${raw.slice(0, 8000)}` }],
      systemPrompt,
      schema: aiKnowledgeSchema,
    });
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
  } catch {
    // No provider configured / provider failure: fall back to a deterministic local parse.
    const draft = parseKnowledgeFromRawText(raw);
    const item = await createKnowledgeBase({ ...draft, origin: "ai", positionId });
    return ok({ item, source: "fallback" as const }, { status: 201 });
  }
}
