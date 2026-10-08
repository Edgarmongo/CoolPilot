import { generateArticle } from "@/lib/article-generation";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { type AiWritingConfig, type AiWritingMaterial, type OutputLanguage } from "@/lib/ai-writing";
import { contentGenerateSchema } from "@/lib/validation";
import { getWritingAgent } from "@/lib/writing-agents";

export const runtime = "nodejs";

/** Maps the legacy free-text language field onto an output-language code. */
function guessLanguage(value: string): OutputLanguage {
  const text = value.toLowerCase();
  if (text.includes("繁") || text.includes("traditional")) return "zh-TW";
  if (text.includes("english") || text === "en") return "en";
  if (text.includes("日本") || text.includes("japanese")) return "ja";
  return "zh-CN";
}

/**
 * The article-creation entry point for a ready-to-publish article (C3 of
 * `docs/creator-workflow-audit.md`), shared by AI writing, article creation, posts and videos, so
 * positioning and the knowledge base apply consistently to every generation entry point.
 *
 * The route owns *who is asking*: the payload's schema and guard, the legacy `language` string it has
 * to guess a code from, the writing agent that prefixes the system prompt (F-C3-7 keeps the agent here
 * rather than in the service), the material it builds from `topic`/`prompt`, and the provenance this
 * entry records (`type`, `agentId`, `generationType`, ...). The article itself - positioning,
 * knowledge, prompts, the structured call, the images, the content item and the usage row - belongs to
 * `generateArticle()` (`@/lib/article-generation`), which `api/ai-writing/generate` uses too.
 *
 * The model call goes through `generateArticle` into `aiRuntime` (batch P3-A3 of
 * `docs/generate-migration-p3.md`): provider order, model choice, key rotation, failover and
 * structured-output validation are the runtime's business. The answer is read through the runtime's own
 * names (`providerId`, `model`, `usage`), and a failure keeps the runtime's code *and* status (D-P3-3)
 * instead of a 502 flattened from a message, so a missing credential is a 400 - the payload guard below
 * is the only error this route still words itself.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, contentGenerateSchema);
  if (parsed.error) return fail("Invalid generation payload", 400, parsed.error);
  const data = parsed.data;

  const config: AiWritingConfig = {
    materialSource: "free",
    articleStyle: data.articleStyle,
    industry: data.industry,
    wordCount: data.maxWords,
    audience: data.audience,
    targetPlatform: data.targetPlatform,
    coreKeywords: data.keywords,
    language: data.languageCode ?? guessLanguage(data.language),
    imageStrategy: data.imageStrategy,
    imageCount: data.imageCount,
    deAi: data.deAi,
    knowledgeMode: data.knowledgeMode,
    positioningId: data.positioningId,
  };

  const agent = getWritingAgent(data.agentId);
  const material: AiWritingMaterial = {
    topics: [],
    products: [],
    freeText: data.prompt ? `${data.topic}\n\n${data.prompt}` : data.topic,
  };

  try {
    const result = await generateArticle({
      positioningId: data.positioningId,
      config,
      material,
      systemPromptPrefix: agent.systemPrompt,
      titleFallback: data.topic,
      // A topic has no product photo and no source page, so this entry contributes no image source.
      imageSources: { productImagePaths: [], sourceUrls: [] },
      provenance: {
        type: data.type,
        prompt: data.prompt,
        topic: data.topic,
        generationType: "topic",
        agentId: agent.id,
        agentName: agent.name,
        aiWriting: { ...config },
      },
    });

    return ok(result, { status: 201 });
  } catch (error) {
    // No local error taxonomy: `failFromError` keeps an `AppError`'s own code and status (the runtime
    // sets both) and answers anything else with this route's long-standing 502.
    return failFromError(error, "AI_PROVIDER_FAILED", 502);
  }
}
