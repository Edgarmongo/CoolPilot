import { createContentItem, createUsageRecord } from "@/db/repository";
import { listKnowledgeBase } from "@/db/repositories/knowledge-base";
import { getDefaultPosition, getPosition } from "@/db/repositories/positions";
import { generateStructured } from "@/lib/ai/generate";
import { postDraftSchema } from "@/lib/ai/schemas";
import {
  audiencePrompt,
  buildArticlePrompt,
  buildArticleSystemPrompt,
  imageCountValues,
  industryDomainPrompt,
  type AiWritingConfig,
  type AiWritingMaterial,
  type AiWritingPositioning,
  type OutputLanguage,
} from "@/lib/ai-writing";
import { fail, ok, parseJson } from "@/lib/api";
import { resolveArticleImages } from "@/lib/article-images";
import { selectKnowledgeReferences } from "@/lib/knowledge-base";
import { countTextCharacters } from "@/lib/usage";
import { contentGenerateSchema } from "@/lib/validation";
import { getWritingAgent } from "@/lib/writing-agents";
import type { PositionRecord } from "@/lib/types";

export const runtime = "nodejs";

/** Maps the legacy free-text language field onto an output-language code. */
function guessLanguage(value: string): OutputLanguage {
  const text = value.toLowerCase();
  if (text.includes("繁") || text.includes("traditional")) return "zh-TW";
  if (text.includes("english") || text === "en") return "en";
  if (text.includes("日本") || text.includes("japanese")) return "ja";
  return "zh-CN";
}

function toPositioning(position: PositionRecord | null): AiWritingPositioning | undefined {
  if (!position) return undefined;
  return {
    name: position.name,
    description: position.description,
    targetAudience: position.targetAudience,
    contentDirection: position.contentDirection,
    toneStyle: position.toneStyle,
    personaRole: position.personaRole,
    writingGuide: position.writingGuide,
    bannedWords: position.bannedWords,
  };
}

/**
 * Generates a ready-to-publish article from a topic. Shared by AI writing,
 * article creation, posts and videos, so positioning and the knowledge base
 * apply consistently to every generation entry point.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, contentGenerateSchema);
  if (parsed.error) return fail("Invalid generation payload", 400, parsed.error);
  const data = parsed.data;

  const positioning = data.positioningId ? await getPosition(data.positioningId) : await getDefaultPosition();

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

  const knowledge =
    config.knowledgeMode === "position" ? selectKnowledgeReferences(await listKnowledgeBase(), positioning?.id) : [];
  const agent = getWritingAgent(data.agentId);
  const materials: AiWritingMaterial = {
    topics: [],
    products: [],
    freeText: data.prompt ? `${data.topic}\n\n${data.prompt}` : data.topic,
  };

  const systemPrompt = [
    agent.systemPrompt,
    buildArticleSystemPrompt({ config, positioning: toPositioning(positioning) }),
  ]
    .filter(Boolean)
    .join("\n\n");
  const prompt = buildArticlePrompt({
    config,
    materials,
    knowledge,
    audienceLabel: audiencePrompt[config.audience],
    industryLabel: industryDomainPrompt[config.industry],
  });

  try {
    const result = await generateStructured({ prompt, systemPrompt, schema: postDraftSchema });
    const title = result.data.title.trim() || data.topic;
    const body = result.data.body.trim();
    const images = await resolveArticleImages({
      strategy: config.imageStrategy,
      target: imageCountValues[config.imageCount],
      productImagePaths: [],
      sourceUrls: [],
      title,
    });

    const item = await createContentItem({
      title,
      body,
      postReadyText: `${title}\n\n${body}`.trim(),
      sourceUrls: [],
      imagePath: images[0] ?? "",
      metadata: {
        type: data.type,
        images,
        prompt: data.prompt,
        topic: data.topic,
        generationType: "topic",
        agentId: agent.id,
        agentName: agent.name,
        provider: result.provider,
        model: result.model,
        positioningId: positioning?.id ?? "",
        aiWriting: { ...config },
      },
      status: "ready",
    });

    await createUsageRecord({
      provider: result.provider,
      model: result.model,
      kind: "article",
      status: "success",
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      totalTokens: result.usage?.totalTokens,
      wordCount: countTextCharacters(body),
      contentItemId: item?.id,
    });

    return ok({ item, provider: result.provider, model: result.model, images }, { status: 201 });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Generation failed", 502);
  }
}
