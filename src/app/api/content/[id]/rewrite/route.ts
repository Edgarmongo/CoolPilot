import { createUsageRecord, getContentItem } from "@/db/repository";
import { aiRuntime } from "@/features/ai-runtime";
import { industryDomainPrompt } from "@/lib/ai-writing";
import { htmlToPlainText, plainTextToHtml } from "@/lib/article-themes";
import { beginAiBudgetCall, type AiBudgetCallHandle } from "@/lib/ai-budget-guard";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { marketplaceExtensionIdOfContentItem } from "@/lib/content-item-listing";
import { recordAiUsageCall, recordAiUsageFailure, type AiUsageCallContext } from "@/lib/ai-usage-ledger-recorder";
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
 *
 * The model call goes straight to `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`): provider
 * order, model choice, key rotation, failover and cold-start catalog discovery are the runtime's business,
 * while reading the article by `[id]`, the source assembly and its cap, the rewrite instructions and
 * everything after the call (the trim, the guard, the usage row, the envelope) stay this route's. The answer
 * is read through the runtime's own names (`providerId`, `model`, `usage`).
 *
 * A3-3.2 moved the call boundary and deliberately left D-P3-3 to the routes that had adopted it, so this
 * file was the last text surface answering a flat 502. P3-C converged it: a failure now keeps the runtime's
 * own code *and* its HTTP status (credentials 400, a cooled-down pool 429, nothing configured 503, upstream
 * 502), which is what `failFromError` passed on from the day this route was migrated - the flat 502 was the
 * one thing that did not. The three answers this route still words itself are unchanged and are *not* runtime
 * errors: the `[id]` guard (404), the payload guard (400) and the empty-source guard (400 `EMPTY_CONTENT`),
 * plus the empty-answer guard (502 `EMPTY_RESULT`, kept because `chat()` has no schema to retry against).
 *
 * CI-P7-03 puts the budget gate in front of the request. Its refusal is not a provider failure either: a
 * call the policy refuses throws `AI_BUDGET_EXCEEDED` (402) *before* `aiRuntime` is reached, so it is
 * answered with the gate's own code and writes no ledger row - there was no request to record. What that
 * gate can and cannot promise is the gate's own constant (`aiBudgetEnforcement`), not a claim repeated here.
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

  // CI-P7-01-04. The article this rewrite belongs to is the call's business identity, and it is
  // known before the request, so the failure path below records the same call.
  //
  // CI-P7-05-03 (remaining surface). A rewrite is the same article's money, so it belongs to the same
  // listing - and this dialog sends no picker that could name one. What the call can read is the
  // provenance the generation *stored* on the article (`content-item-listing.ts`): the position it
  // resolved, when the storefront publishes it, else the catalogue agent the entry selected. Nothing is
  // inferred from the payload, and an article whose provenance names no published listing stays
  // unattributed.
  const usageCall: AiUsageCallContext = {
    purpose: "content-rewrite",
    contentItemId: id,
    extensionId: await marketplaceExtensionIdOfContentItem(existing),
  };

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

  // The gate measures the same text the request will carry, so the prompt is built once and used twice.
  const prompt = `${instructions.join("\n")}\n\n原文：\n${source}`;

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
    // failed instead is this route's unknown error - not a refusal it would be wrong to invent.
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }

  try {
    const response = await aiRuntime.chat({
      messages: [{ role: "user", content: prompt }],
      systemPrompt: "你是一位资深中文编辑，擅长在不改变原意的前提下改写文章。",
    });
    const bodyText = response.text.trim();
    // Recorded before the guard below reads the answer: the request was answered, and the provider
    // charged for it whether or not the answer turned out to be usable. `usage_records` (below) keeps
    // its old meaning and still counts only the rewrites that produced text.
    await recordAiUsageCall({ ...usageCall, attempts: response.attempts });
    if (!bodyText) return fail("EMPTY_RESULT", 502);

    await createUsageRecord({
      provider: response.providerId,
      model: response.model,
      kind: "article",
      status: "success",
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
      totalTokens: response.usage?.totalTokens,
      wordCount: countTextCharacters(bodyText),
      contentItemId: id,
    });

    // The editor shows a diff first and only persists the body once the user
    // confirms, so nothing is written to the article here.
    return ok({
      text: bodyText,
      html: plainTextToHtml(bodyText),
      provider: response.providerId,
      model: response.model,
    });
  } catch (error) {
    // D-P3-3 applied here by P3-C: `failFromError` keeps an `AppError`'s own code and status (the runtime sets
    // both) and answers anything else with this route's long-standing 502, which is all that ever reached the
    // dialog for a non-`AppError` failure.
    await recordAiUsageFailure(usageCall, error);
    return failFromError(error, "AI_PROVIDER_FAILED", 502);
  } finally {
    // The runtime's ledger row is what accounts for the money once the request is over; a hold that
    // outlived it would count the same call twice.
    await budget.release();
  }
}
