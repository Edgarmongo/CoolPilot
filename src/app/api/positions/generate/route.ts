import { z } from "zod";
import { createUsageRecord } from "@/db/repository";
import { aiRuntime } from "@/features/ai-runtime";
import { fail, ok, parseJson } from "@/lib/api";
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
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, positionGenerateSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const prompt = parsed.data.prompt;
  try {
    const response = await aiRuntime.chatStructured({
      messages: [{ role: "user", content: `用户想做这样的账号：${prompt}` }],
      systemPrompt,
      schema: aiPositionSchema,
    });
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
    // No provider configured / provider failure: fall back to a deterministic local draft.
    const draft = buildPositionDraftFromPrompt(prompt);
    return ok({
      draft,
      source: "fallback" as const,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}
