import { createUsageRecord, getContentItem } from "@/db/repository";
import { generateText } from "@/lib/ai/generate";
import { industryDomainPrompt } from "@/lib/ai-writing";
import { htmlToPlainText, plainTextToHtml } from "@/lib/article-themes";
import { fail, ok, parseJson } from "@/lib/api";
import { countTextCharacters } from "@/lib/usage";
import { contentRewriteSchema, type ArticleRewriteMode, type ArticleRewriteStrength } from "@/lib/validation";

export const runtime = "nodejs";

/** Upper bound on how much source text is sent to the model. */
const maxRewriteInput = 8000;

const modeInstruction: Record<ArticleRewriteMode, string> = {
  polish:
    "在不改变事实、观点与结构的前提下润色文章：让语言更自然流畅，长短句交错，去掉机械的连接词与排比堆砌，读起来像真人写的。",
  platform: "按目标平台的调性调整语气与结构：更口语化、更贴近读者的阅读节奏，必要时拆分或合并段落，让内容更适合社交媒体传播。",
  risk: "对文本做风险迁移（降低风险）：弱化绝对化、夸大与承诺性表述，补充必要的前提与限定，涉及学术、医疗、金融等内容时保持严谨、克制、可核实。",
  tone: "转换语言风格，只优化表达方式：调整语气与用词，使其符合要求的风格特征，但不得改变原意与信息量。",
};

const strengthInstruction: Record<ArticleRewriteStrength, string> = {
  light: "改写强度：轻。尽量贴近原文，只做小幅润色。",
  medium: "改写强度：中。在保留原意的前提下明显优化表达。",
  heavy: "改写强度：重。可以较大幅度重写，但仍须保留原文的核心信息。",
};

/**
 * Rewrites an existing article with AI. Shared by the article editor's “AI 改写”
 * dialog so polish / platform / risk / tone passes run through one pipeline.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const existing = await getContentItem(id);
  if (!existing) return fail("NOT_FOUND", 404);

  const parsed = await parseJson(request, contentRewriteSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const data = parsed.data;

  const source = htmlToPlainText(existing.body).slice(0, maxRewriteInput);
  if (!source.trim()) return fail("EMPTY_CONTENT", 400);

  const banned = data.bannedWords.filter(Boolean);
  const instructions = [
    modeInstruction[data.mode],
    strengthInstruction[data.strength],
    `行业领域：${industryDomainPrompt[data.industry]}。`,
    data.styleFeatures ? `风格特征：${data.styleFeatures}。` : "",
    data.requiredTitle ? `标题需自然包含以下关键词：${data.requiredTitle}。` : "",
    data.customRequirements ? `补充要求：${data.customRequirements}。` : "",
    banned.length ? `禁止出现以下词语：${banned.join("、")}。` : "",
    "",
    "只输出改写后的文章正文，不要输出标题、解释、markdown 代码块或任何额外说明。",
  ].filter(Boolean);

  try {
    const result = await generateText({
      systemPrompt: "你是一位资深中文编辑，擅长在不改变原意的前提下改写文章。",
      prompt: `${instructions.join("\n")}\n\n原文：\n${source}`,
    });
    const bodyText = result.text.trim();
    if (!bodyText) return fail("EMPTY_RESULT", 502);

    await createUsageRecord({
      provider: result.provider,
      model: result.model,
      kind: "article",
      status: "success",
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      totalTokens: result.usage?.totalTokens,
      wordCount: countTextCharacters(bodyText),
      contentItemId: id,
    });

    // The editor shows a diff first and only persists the body once the user
    // confirms, so nothing is written to the article here.
    return ok({ text: bodyText, html: plainTextToHtml(bodyText), provider: result.provider, model: result.model });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Rewrite failed", 502);
  }
}
