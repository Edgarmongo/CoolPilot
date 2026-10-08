import { describe, expect, it } from "vitest";
import {
  aiWritingStepIds,
  articleStyles,
  audiences,
  buildArticlePrompt,
  buildArticleSystemPrompt,
  defaultAiWritingConfig,
  imageCounts,
  imageStrategies,
  industryDomains,
  knowledgeModes,
  materialSources,
  outputLanguages,
  targetPlatformOptions,
  type AiWritingMaterial,
  type AiWritingPositioning,
} from "./ai-writing";

const material: AiWritingMaterial = {
  topics: [{ title: "八爪鱼养殖新政策", source: "百度热搜", url: "https://example.com/a" }],
  products: [
    {
      name: "绿源有机八爪鱼",
      brand: "绿源",
      category: "海产",
      keywords: ["有机", "八爪鱼"],
      description: "深海捕捞，急冻锁鲜",
      linkUrl: "https://example.com/p",
    },
  ],
  freeText: "强调冷链优势",
};

describe("ai writing config", () => {
  it("keeps the default config inside every catalogue", () => {
    expect(materialSources).toContain(defaultAiWritingConfig.materialSource);
    expect(articleStyles).toContain(defaultAiWritingConfig.articleStyle);
    expect(industryDomains).toContain(defaultAiWritingConfig.industry);
    expect(audiences).toContain(defaultAiWritingConfig.audience);
    expect(outputLanguages).toContain(defaultAiWritingConfig.language);
    expect(imageStrategies).toContain(defaultAiWritingConfig.imageStrategy);
    expect(imageCounts).toContain(defaultAiWritingConfig.imageCount);
    expect(knowledgeModes).toContain(defaultAiWritingConfig.knowledgeMode);
  });

  it("exposes the three wizard steps in order", () => {
    expect(aiWritingStepIds).toEqual(["material", "config", "output"]);
  });

  it("offers a generic platform option first", () => {
    expect(targetPlatformOptions[0]).toEqual({ value: "", label: "" });
    expect(targetPlatformOptions.length).toBeGreaterThan(1);
  });
});

describe("ai writing prompts", () => {
  it("includes the material, style, audience and language in the prompt", () => {
    const prompt = buildArticlePrompt({
      config: { ...defaultAiWritingConfig, wordCount: 1200, coreKeywords: "八爪鱼" },
      materials: material,
      knowledge: ["【养殖手册】保持水温 18 度"],
      audienceLabel: "年轻人",
      industryLabel: "美食",
    });
    expect(prompt).toContain("1200");
    expect(prompt).toContain("八爪鱼养殖新政策");
    expect(prompt).toContain("绿源有机八爪鱼");
    expect(prompt).toContain("强调冷链优势");
    expect(prompt).toContain("【养殖手册】");
    expect(prompt).toContain("八爪鱼");
  });

  it("adds the de-AI instruction only when enabled", () => {
    const positioning: AiWritingPositioning = {
      name: "海鲜号",
      description: "",
      targetAudience: "",
      contentDirection: "",
      toneStyle: "",
      personaRole: "你是海鲜美食作者。",
      writingGuide: "",
      bannedWords: [],
    };
    const on = buildArticleSystemPrompt({ config: { ...defaultAiWritingConfig, deAi: true }, positioning });
    const off = buildArticleSystemPrompt({ config: { ...defaultAiWritingConfig, deAi: false }, positioning });
    expect(on).toContain("你是海鲜美食作者。");
    expect(on).toContain("去 AI 味");
    expect(off).not.toContain("去 AI 味");
  });
});
