import type { TranslationKey } from "@/lib/locale-resources";
import { accountPlatforms } from "@/lib/types";

export const aiWritingStepIds = ["material", "config", "output"] as const;
export type AiWritingStepId = (typeof aiWritingStepIds)[number];

export const aiWritingStepLabelKeys: Record<AiWritingStepId, TranslationKey> = {
  material: "awStepMaterial",
  config: "awStepConfig",
  output: "awStepOutput",
};

/** Where the article's raw material comes from (step 1 tabs). */
export const materialSources = ["hot", "product", "free"] as const;
export type MaterialSource = (typeof materialSources)[number];

export const materialSourceLabelKeys: Record<MaterialSource, TranslationKey> = {
  hot: "awSourceHot",
  product: "awSourceProduct",
  free: "awSourceFree",
};

export const articleStyles = ["advertorial", "review", "recommend", "science", "story", "brand"] as const;
export type ArticleStyle = (typeof articleStyles)[number];

export const articleStyleLabelKeys: Record<ArticleStyle, TranslationKey> = {
  advertorial: "awStyleAdvertorial",
  review: "awStyleReview",
  recommend: "awStyleRecommend",
  science: "awStyleScience",
  story: "awStyleStory",
  brand: "awStyleBrand",
};

export const articleStylePrompt: Record<ArticleStyle, string> = {
  advertorial: "软文推广：把品牌与产品信息自然嵌入内容，先讲痛点与场景，再给方案，避免硬广腔调。",
  review: "产品测评：以真实体验为主线，给参数、对比与优缺点，最后给出适用人群和购买建议。",
  recommend: "种草推荐：从真实使用需求出发，推荐理由具体、有细节，结尾给清单式总结。",
  science: "知识科普：先把概念讲清楚，再拆解原理与常见误区，最后给可执行建议。",
  story: "故事叙述：用人物和场景推动情节，有冲突与转折，情感真实，不做说教。",
  brand: "品牌故事：讲清品牌起点、关键选择与价值观，让读者产生认同与共鸣。",
};

export const articleStyleHelperKeys: Record<ArticleStyle, TranslationKey> = {
  advertorial: "awStyleAdvertorialHint",
  review: "awStyleReviewHint",
  recommend: "awStyleRecommendHint",
  science: "awStyleScienceHint",
  story: "awStyleStoryHint",
  brand: "awStyleBrandHint",
};

export const articleStyleTemplateKeys: Record<ArticleStyle, TranslationKey> = {
  advertorial: "awStyleAdvertorialTemplate",
  review: "awStyleReviewTemplate",
  recommend: "awStyleRecommendTemplate",
  science: "awStyleScienceTemplate",
  story: "awStyleStoryTemplate",
  brand: "awStyleBrandTemplate",
};

export const industryDomains = [
  "general",
  "food",
  "beauty",
  "tech",
  "education",
  "health",
  "finance",
  "home",
  "travel",
  "parenting",
] as const;
export type IndustryDomain = (typeof industryDomains)[number];

export const industryDomainLabelKeys: Record<IndustryDomain, TranslationKey> = {
  general: "awIndustryGeneral",
  food: "awIndustryFood",
  beauty: "awIndustryBeauty",
  tech: "awIndustryTech",
  education: "awIndustryEducation",
  health: "awIndustryHealth",
  finance: "awIndustryFinance",
  home: "awIndustryHome",
  travel: "awIndustryTravel",
  parenting: "awIndustryParenting",
};

export const aiWritingWordCountMin = 300;
export const aiWritingWordCountMax = 3000;
export const aiWritingWordCountStep = 100;
export const aiWritingKeywordsMaxLength = 30;

export const audiences = ["unlimited", "young", "mom", "office", "senior", "student", "developer", "xiaohongshu"] as const;
export type Audience = (typeof audiences)[number];

export const audienceLabelKeys: Record<Audience, TranslationKey> = {
  unlimited: "awAudienceUnlimited",
  young: "awAudienceYoung",
  mom: "awAudienceMom",
  office: "awAudienceOffice",
  senior: "awAudienceSenior",
  student: "awAudienceStudent",
  developer: "awAudienceDeveloper",
  xiaohongshu: "awAudienceXiaohongshu",
};

export const outputLanguages = ["zh-CN", "zh-TW", "en", "ja"] as const;
export type OutputLanguage = (typeof outputLanguages)[number];

export const outputLanguageLabelKeys: Record<OutputLanguage, TranslationKey> = {
  "zh-CN": "awLangSimplified",
  "zh-TW": "awLangTraditional",
  en: "awLangEnglish",
  ja: "awLangJapanese",
};

/** Language name handed to the model. */
export const outputLanguagePrompt: Record<OutputLanguage, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文（香港）",
  en: "English",
  ja: "日本語",
};

/** Plain-text labels handed to the model (independent of the console locale). */
export const industryDomainPrompt: Record<IndustryDomain, string> = {
  general: "",
  food: "美食",
  beauty: "美妆",
  tech: "科技",
  education: "教育",
  health: "健康",
  finance: "财经",
  home: "家居",
  travel: "旅行",
  parenting: "母婴",
};

export const audiencePrompt: Record<Audience, string> = {
  unlimited: "不限（通用/大众）",
  young: "年轻人（18-30岁）",
  mom: "宝妈/家庭主妇",
  office: "职场白领",
  senior: "中老年人（50岁+）",
  student: "学生群体",
  developer: "技术开发者",
  xiaohongshu: "小红书女性用户",
};

export const imageStrategies = ["mixed", "product", "web", "ai"] as const;
export type ImageStrategy = (typeof imageStrategies)[number];

export const imageStrategyLabelKeys: Record<ImageStrategy, TranslationKey> = {
  mixed: "awImgMixed",
  product: "awImgProduct",
  web: "awImgWeb",
  ai: "awImgAi",
};

export const imageCounts = ["few", "standard", "many"] as const;
export type ImageCount = (typeof imageCounts)[number];

export const imageCountLabelKeys: Record<ImageCount, TranslationKey> = {
  few: "awCountFew",
  standard: "awCountStandard",
  many: "awCountMany",
};

export const imageCountValues: Record<ImageCount, number> = { few: 1, standard: 3, many: 6 };

export const knowledgeModes = ["position", "off"] as const;
export type KnowledgeMode = (typeof knowledgeModes)[number];

export const knowledgeModeLabelKeys: Record<KnowledgeMode, TranslationKey> = {
  position: "awKnowledgeModePosition",
  off: "awKnowledgeModeOff",
};

/** `""` means the generic "not platform-specific" option. */
export const targetPlatformOptions: Array<{ value: string; label: string }> = [
  { value: "", label: "" },
  ...accountPlatforms.map((platform) => ({ value: platform, label: platform })),
];

export type AiWritingConfig = {
  materialSource: MaterialSource;
  articleStyle: ArticleStyle;
  industry: IndustryDomain;
  wordCount: number;
  audience: Audience;
  targetPlatform: string;
  coreKeywords: string;
  language: OutputLanguage;
  imageStrategy: ImageStrategy;
  imageCount: ImageCount;
  deAi: boolean;
  knowledgeMode: KnowledgeMode;
  /** Empty string = the account's default positioning. */
  positioningId: string;
  /**
   * The brand profile (品牌资料) this run writes as (CI-P2-02); empty string = none. It travels as an
   * id rather than a copy of the fields, so the prompt is always built from the record that exists at
   * generation time - the same record whose `updatedAt` the article stores as its brand version.
   */
  brandId: string;
};

export const defaultAiWritingConfig: AiWritingConfig = {
  materialSource: "hot",
  articleStyle: "advertorial",
  industry: "general",
  wordCount: 800,
  audience: "unlimited",
  targetPlatform: "",
  coreKeywords: "",
  language: "zh-CN",
  imageStrategy: "mixed",
  imageCount: "standard",
  deAi: true,
  knowledgeMode: "position",
  positioningId: "",
  brandId: "",
};

export type AiWritingMaterialTopic = { title: string; source: string; url: string };
export type AiWritingMaterialProduct = {
  name: string;
  brand: string;
  category: string;
  keywords: string[];
  description: string;
  linkUrl: string;
};

export type AiWritingMaterial = {
  topics: AiWritingMaterialTopic[];
  products: AiWritingMaterialProduct[];
  freeText: string;
};

export type AiWritingPositioning = {
  name: string;
  description: string;
  targetAudience: string;
  contentDirection: string;
  toneStyle: string;
  personaRole: string;
  writingGuide: string;
  bannedWords: string[];
};

/** The six fields a brand profile (品牌资料) contributes to a prompt (P2-02-03). */
export type AiWritingBrand = {
  name: string;
  description: string;
  targetAudience: string;
  tone: string;
  keywords: string[];
  bannedWords: string[];
};

/**
 * Order-preserving de-duplication for the banned list, which has two sources (P2-02-03): a word the
 * positioning bans and a word the brand bans are both words this article must not use, and listing
 * either one twice only invites the model to quote it.
 */
function uniqueWords(values: string[]) {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const value of values) {
    const word = value.trim();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

function materialsBlock(material: AiWritingMaterial) {
  const parts: string[] = [];
  if (material.topics.length) {
    parts.push(`热点选题：\n${material.topics.map((topic) => `- ${topic.title}（来源：${topic.source}）`).join("\n")}`);
  }
  if (material.products.length) {
    parts.push(
      `产品资料：\n${material.products
        .map((product) => {
          const meta = [product.brand, product.category].filter(Boolean).join(" / ");
          const keywords = product.keywords.length ? `（关键词：${product.keywords.join("、")}）` : "";
          return `- ${product.name}${meta ? ` / ${meta}` : ""}：${product.description || "（无描述）"}${keywords}`;
        })
        .join("\n")}`,
    );
  }
  if (material.freeText.trim()) {
    parts.push(`自定义素材：\n${material.freeText.trim()}`);
  }
  return parts.join("\n\n") || "（没有额外素材，请围绕主题自行发挥）";
}

export function buildArticleSystemPrompt(input: {
  config: AiWritingConfig;
  positioning?: AiWritingPositioning;
  /** The brand profile (品牌资料) this run writes as; absent means "no brand context" (CI-P2-02). */
  brand?: AiWritingBrand;
}): string {
  const { config, positioning, brand } = input;
  const lines: string[] = [];
  lines.push(positioning?.personaRole?.trim() || "你是一位资深自媒体写作助手，擅长创作可直接发布的社交媒体文章。");
  if (positioning) {
    if (positioning.toneStyle) lines.push(`语气风格：${positioning.toneStyle}`);
    if (positioning.contentDirection) lines.push(`内容方向：${positioning.contentDirection}`);
    if (positioning.writingGuide) lines.push(`写作准则：\n${positioning.writingGuide}`);
  }
  // The brand's identity and voice are system-level, like the positioning's: they govern how the
  // article sounds rather than what it is about (P2-02-03).
  if (brand) {
    if (brand.name) lines.push(`品牌：${brand.name}`);
    if (brand.description) lines.push(`品牌简介：${brand.description}`);
    if (brand.targetAudience) lines.push(`品牌目标受众：${brand.targetAudience}`);
    if (brand.tone) lines.push(`品牌语气：${brand.tone}`);
  }
  const bannedWords = uniqueWords([...(positioning?.bannedWords ?? []), ...(brand?.bannedWords ?? [])]);
  if (bannedWords.length) lines.push(`禁止出现：${bannedWords.join("、")}`);
  if (config.deAi) {
    lines.push("去 AI 味：使用自然口语化表达，句式长短交错，避免排比堆砌与机械过渡词，读起来像真人写的。");
  }
  return lines.join("\n");
}

export function buildArticlePrompt(input: {
  config: AiWritingConfig;
  materials: AiWritingMaterial;
  knowledge: string[];
  audienceLabel: string;
  industryLabel: string;
  /** The selected brand profile; its audience and keywords are prompt-level material (CI-P2-02). */
  brand?: AiWritingBrand;
}): string {
  const { config, materials, knowledge, brand } = input;
  const lines = [
    `请写一篇约 ${config.wordCount} 字的文章。`,
    `写作风格：${articleStylePrompt[config.articleStyle]}`,
    `输出语言：${outputLanguagePrompt[config.language]}。`,
    input.industryLabel ? `行业领域：${input.industryLabel}。` : "",
    `目标受众：${input.audienceLabel}。`,
    brand?.targetAudience ? `品牌目标受众：${brand.targetAudience}。` : "",
    brand?.keywords.length ? `品牌关键词：${brand.keywords.join("、")}，请自然融入正文，不要生硬堆砌。` : "",
    config.targetPlatform ? `发布平台：${config.targetPlatform}，请适配该平台的语气与篇幅。` : "",
    config.coreKeywords ? `标题需自然包含以下关键词：${config.coreKeywords}。` : "",
    "",
    "可用素材：",
    materialsBlock(materials),
  ].filter(Boolean);

  if (knowledge.length) {
    lines.push("", "可参考的知识库资料：");
    for (const entry of knowledge) lines.push(`- ${entry}`);
  }

  lines.push(
    "",
    "要求：标题 20 字以内且有吸引力；正文分段清晰、有具体细节；不要编造无法核实的数据；不要输出任何 markdown 代码块或额外说明。",
  );
  return lines.join("\n");
}
