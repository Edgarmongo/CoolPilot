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
  type AiWritingBrand,
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

/**
 * The brand profile as a generation input (P2-02-03 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Two brands are built on purpose: the assertions that matter are not only "the selected brand is in
 * the prompt" but "the other one is not" (P2-02-05), because a prompt that quietly mixes two brands is
 * the failure the card names.
 */
const clipboardBrand: AiWritingBrand = {
  name: "Clipversity",
  description: "跨境内容工作室",
  targetAudience: "做外贸的中小团队",
  tone: "专业但不生硬",
  keywords: ["选品", "跨境"],
  bannedWords: ["绝对", "最好用"],
};

const seafoodBrand: AiWritingBrand = {
  name: "绿源海鲜",
  description: "深海捕捞，急冻锁鲜",
  targetAudience: "注重食材的年轻家庭",
  tone: "亲切具体，少用夸张词",
  keywords: ["冷链", "有机"],
  bannedWords: ["包治百病"],
};

describe("brand context in the prompts", () => {
  it("puts the brand's identity and voice in the system prompt, and bans its words", () => {
    const system = buildArticleSystemPrompt({
      config: defaultAiWritingConfig,
      positioning: undefined,
      brand: clipboardBrand,
    });

    expect(system).toContain("品牌：Clipversity");
    expect(system).toContain("品牌简介：跨境内容工作室");
    expect(system).toContain("品牌目标受众：做外贸的中小团队");
    expect(system).toContain("品牌语气：专业但不生硬");
    expect(system).toContain("禁止出现：绝对、最好用");
    // The other brand is nowhere near this prompt.
    expect(system).not.toContain(seafoodBrand.name);
    expect(system).not.toContain(seafoodBrand.tone);
    expect(system).not.toContain("包治百病");
  });

  it("puts the brand's audience and keywords in the article prompt", () => {
    const prompt = buildArticlePrompt({
      config: defaultAiWritingConfig,
      materials: material,
      knowledge: [],
      audienceLabel: "职场白领",
      industryLabel: "",
      brand: clipboardBrand,
    });

    expect(prompt).toContain("品牌目标受众：做外贸的中小团队。");
    expect(prompt).toContain("品牌关键词：选品、跨境");
    // The other brand contributes nothing - not its voice line, not its keywords. Its *words* do appear
    // in this material (the product copy and the free text), so the check pins the brand's own rendering
    // rather than the bare word, which the material would make a false positive.
    expect(prompt).not.toContain("品牌：绿源海鲜");
    expect(prompt).not.toContain(`品牌目标受众：${seafoodBrand.targetAudience}`);
    expect(prompt).not.toContain("品牌关键词：冷链、有机");
  });

  it("merges the two banned lists once, so a word both sources ban is said once", () => {
    const positioning: AiWritingPositioning = {
      name: "海鲜号",
      description: "",
      targetAudience: "",
      contentDirection: "",
      toneStyle: "",
      personaRole: "你是海鲜美食作者。",
      writingGuide: "",
      bannedWords: ["绝对", "自夸"],
    };

    const system = buildArticleSystemPrompt({ config: defaultAiWritingConfig, positioning, brand: seafoodBrand });

    expect(system).toContain("禁止出现：绝对、自夸、包治百病");
    expect(system.match(/绝对/g)).toHaveLength(1);
  });

  it("adds nothing when no brand is selected, which is what the other entries do", () => {
    const withBrand = buildArticleSystemPrompt({ config: defaultAiWritingConfig, brand: seafoodBrand });
    const without = buildArticleSystemPrompt({ config: defaultAiWritingConfig });

    expect(without).not.toContain("品牌");
    expect(without).not.toContain("禁止出现");
    expect(withBrand.length).toBeGreaterThan(without.length);

    const prompt = buildArticlePrompt({
      config: defaultAiWritingConfig,
      materials: material,
      knowledge: [],
      audienceLabel: "职场白领",
      industryLabel: "",
    });
    expect(prompt).not.toContain("品牌目标受众");
    expect(prompt).not.toContain("品牌关键词");
  });
});
