import { z } from "zod";
import { createUsageRecord } from "@/db/repository";
import { aiRuntime } from "@/features/ai-runtime";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { beginAiBudgetCall, type AiBudgetCallHandle } from "@/lib/ai-budget-guard";
import { recordAiUsageCall, recordAiUsageFailure, type AiUsageCallContext } from "@/lib/ai-usage-ledger-recorder";
import { buildPositionDraftFromPrompt, emptyPositionDraft, normalizePositionDraft } from "@/lib/positions";
import { countTextCharacters } from "@/lib/usage";
import { positionGenerateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const aiPositionSchema = z.object({
  name: z.string(),
  description: z.string(),
  targetAudience: z.string(),
  contentDirection: z.string(),
  toneStyle: z.string(),
  personaRole: z.string(),
  personaSeeds: z.string(),
  writingGuide: z.string(),
});

const systemPrompt = [
  "你是资深自媒体运营顾问，擅长把一个模糊的想法拆成可直接投入生产的账号定位。",
  "请基于用户的一句话描述，输出整套写作智能体配置。",
  "字段要求：name 为 12 字以内的定位名称；description 为 60-200 字的定位描述；",
  "targetAudience 为具体人群画像；contentDirection 为 2-6 个关键词；toneStyle 为语气风格说明；",
  "personaRole 为 120-400 字的系统角色设定；personaSeeds 留空字符串；",
  "writingGuide 为 3-5 条写作准则，每条一行。全部使用简体中文。",
].join("\n");

/**
 * Turns one sentence into a whole writing profile for the "AI 生成定位" dialog.
 *
 * The model call goes straight to `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`): provider
 * order, model choice, key rotation, failover and structured-output validation are the runtime's business,
 * while the prompt, the schema, the draft normalisation below and the usage row stay this route's. The
 * answer is read through the runtime's own names (`providerId`, `model`, `usage`).
 *
 * The catch is deliberately *not* an error answer, and this is the second of the two routes §2.1 lists
 * that way (the other is `knowledge-base/ai-parse`): any AI failure - nothing configured, no usable
 * credential, a provider that is down, an answer that failed the schema twice - falls back to
 * `buildPositionDraftFromPrompt()` and still answers 200 with `source: "fallback"`. `failFromError` (and
 * with it D-P3-3's code/status pass-through) does not apply here: the dialog reads the draft or shows its
 * own failure message, and the payload guard the handler runs before the call is the only answer this
 * route words itself. The one thing that does change on this path is `reason`, which quotes the failure's
 * message and therefore now quotes the runtime's.
 *
 * A budget refusal (CI-P7-03) is the one exception to that fallback rule, and knowingly so: it is not an
 * AI failure but the user's own instruction to stop spending, so it is answered with the gate's
 * `AI_BUDGET_EXCEEDED` and its 402 rather than turned into a draft the dialog would present as generated.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, positionGenerateSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const prompt = parsed.data.prompt;
  // CI-P7-01-04. A generated profile is a draft the user has not saved yet, so there is no id to
  // attribute this call to: `purpose` is the accounting identity the ledger gets.
  const usageCall: AiUsageCallContext = { purpose: "position" };
  const draftPrompt = `用户想做这样的账号：${prompt}`;

  // CI-P7-03. The gate measures the same text the request carries and stands *outside* the try below, so
  // the refusal keeps the gate's own `AI_BUDGET_EXCEEDED` and 402 instead of becoming this route's
  // fallback draft (see the header: a refusal is the one thing that is not an AI failure).
  let budget: AiBudgetCallHandle;
  try {
    budget = await beginAiBudgetCall({
      identity: usageCall,
      purpose: usageCall.purpose,
      capabilities: ["chat"],
      inputText: draftPrompt,
    });
    // CI-P7-03-A: the hold's id travels onto this call's ledger rows, so what was held and what
    // was spent are compared by an id instead of correlated by purpose and time.
    usageCall.budgetReservationId = budget.reservationId ?? undefined;
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }

  try {
    const response = await aiRuntime.chatStructured({
      messages: [{ role: "user", content: draftPrompt }],
      systemPrompt,
      schema: aiPositionSchema,
    });
    await recordAiUsageCall({ ...usageCall, attempts: response.attempts });
    const draft = normalizePositionDraft({ ...emptyPositionDraft(response.data.name), ...response.data });
    await createUsageRecord({
      provider: response.providerId,
      model: response.model,
      kind: "profile",
      status: "success",
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
      totalTokens: response.usage?.totalTokens,
      wordCount: countTextCharacters(response.data.personaRole),
    });
    return ok({ draft, source: "ai" as const, provider: response.providerId, model: response.model });
  } catch (error) {
    // No provider configured / provider failure: fall back to a deterministic local draft. The
    // ledger keeps what the failure cost (usually nothing: an error with no trail means no request
    // was sent).
    await recordAiUsageFailure(usageCall, error);
    const draft = buildPositionDraftFromPrompt(prompt);
    return ok({
      draft,
      source: "fallback" as const,
      reason: error instanceof Error ? error.message : "unknown",
    });
  } finally {
    await budget.release();
  }
}
