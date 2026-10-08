import { z } from "zod";
import { createUsageRecord } from "@/db/repository";
import { fail, ok, parseJson } from "@/lib/api";
import { generateStructured } from "@/lib/ai/generate";
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

export async function POST(request: Request) {
  const parsed = await parseJson(request, positionGenerateSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const prompt = parsed.data.prompt;
  try {
    const result = await generateStructured({
      prompt: `用户想做这样的账号：${prompt}`,
      systemPrompt,
      schema: aiPositionSchema,
    });
    const draft = normalizePositionDraft({ ...emptyPositionDraft(result.data.name), ...result.data });
    await createUsageRecord({
      provider: result.provider,
      model: result.model,
      kind: "profile",
      status: "success",
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      totalTokens: result.usage?.totalTokens,
      wordCount: countTextCharacters(result.data.personaRole),
    });
    return ok({ draft, source: "ai" as const, provider: result.provider, model: result.model });
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
