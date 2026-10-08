import type { TranslationKey } from "@/lib/locale-resources";
import type { LocalAIProvider } from "@/lib/types";

/**
 * Vendor metadata for the 系统 / 模型管理 catalog.
 *
 * The model lists themselves come from the imported model gateway snapshot
 * (`model-gateway-snapshot.ts`); this registry only describes the vendors we can
 * document or reach directly: docs, API key console, the OpenAI-compatible
 * endpoint, and which local provider can serve that vendor.
 */
export const mainstreamModelCapabilities = ["chat", "reasoning", "code", "image", "video", "audio", "embedding"] as const;

export type MainstreamModelCapability = (typeof mainstreamModelCapabilities)[number];

export const mainstreamCapabilityLabelKeys: Record<MainstreamModelCapability, TranslationKey> = {
  chat: "modelCapabilityChat",
  reasoning: "modelCapabilityReasoning",
  code: "modelCapabilityCode",
  image: "modelCapabilityImage",
  video: "modelCapabilityVideo",
  audio: "modelCapabilityAudio",
  embedding: "modelCapabilityEmbedding",
};

export type MainstreamProviderStatus = "ready" | "key-only" | "missing-key" | "external";

export const mainstreamProviderStatusLabelKeys: Record<MainstreamProviderStatus, TranslationKey> = {
  ready: "modelStatusReady",
  "key-only": "modelStatusKeyOnly",
  "missing-key": "modelStatusMissingKey",
  external: "modelStatusExternal",
};

export type MainstreamVendorMetadata = {
  /** Must match the vendor id produced by the gateway classifier. */
  id: string;
  name: string;
  region: "global" | "cn";
  docsUrl: string;
  apiKeyUrl?: string;
  /** OpenAI-compatible endpoint this app can point a local provider at. */
  compatibleBaseUrl?: string;
  /** Local provider that serves this vendor; omitted when the app cannot call it directly. */
  localProvider?: LocalAIProvider;
};

export const mainstreamVendorRegistry: MainstreamVendorMetadata[] = [
  {
    id: "openai",
    name: "OpenAI",
    region: "global",
    docsUrl: "https://platform.openai.com/docs/models",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    compatibleBaseUrl: "https://api.openai.com/v1",
    localProvider: "openai",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    region: "global",
    docsUrl: "https://docs.anthropic.com/en/docs/about-claude/models/overview",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    localProvider: "openrouter",
  },
  {
    id: "google",
    name: "Gemini",
    region: "global",
    docsUrl: "https://ai.google.dev/gemini-api/docs/models",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    localProvider: "gemini",
  },
  {
    id: "xai",
    name: "xAI",
    region: "global",
    docsUrl: "https://docs.x.ai/docs/models",
    apiKeyUrl: "https://console.x.ai/",
    compatibleBaseUrl: "https://api.x.ai/v1",
    localProvider: "openai",
  },
  {
    id: "qwen",
    name: "通义千问",
    region: "cn",
    docsUrl: "https://help.aliyun.com/zh/model-studio/models",
    apiKeyUrl: "https://bailian.console.aliyun.com/?apiKey=1",
    compatibleBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    localProvider: "openai",
  },
  {
    id: "zhipu",
    name: "智谱",
    region: "cn",
    docsUrl: "https://docs.bigmodel.cn/cn/guide/start/model-overview",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    compatibleBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    localProvider: "openai",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    region: "cn",
    docsUrl: "https://api-docs.deepseek.com/zh-cn/",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    compatibleBaseUrl: "https://api.deepseek.com/v1",
    localProvider: "openai",
  },
  {
    id: "doubao",
    name: "豆包",
    region: "cn",
    docsUrl: "https://www.volcengine.com/docs/82379",
    apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    compatibleBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    localProvider: "openai",
  },
  {
    id: "hunyuan",
    name: "腾讯混元",
    region: "cn",
    docsUrl: "https://cloud.tencent.com/document/product/1729",
    apiKeyUrl: "https://console.cloud.tencent.com/hunyuan/api-key",
    compatibleBaseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    localProvider: "openai",
  },
  {
    id: "moonshot",
    name: "Kimi",
    region: "cn",
    docsUrl: "https://platform.moonshot.cn/docs",
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    compatibleBaseUrl: "https://api.moonshot.cn/v1",
    localProvider: "openai",
  },
  {
    id: "minimax",
    name: "MiniMax",
    region: "cn",
    docsUrl: "https://platform.minimaxi.com/document",
    compatibleBaseUrl: "https://api.minimaxi.com/v1",
    localProvider: "openai",
  },
  {
    id: "xinghuo",
    name: "讯飞星火",
    region: "cn",
    docsUrl: "https://www.xfyun.cn/doc/spark/HTTP%E8%B0%83%E7%94%A8%E6%96%87%E6%A1%A3.html",
    apiKeyUrl: "https://console.xfyun.cn/services/cbm",
    compatibleBaseUrl: "https://spark-api-open.xf-yun.com/v1",
    localProvider: "openai",
  },
  {
    id: "midjourney",
    name: "Midjourney",
    region: "global",
    docsUrl: "https://docs.midjourney.com/",
  },
  {
    id: "llama",
    name: "Llama",
    region: "global",
    docsUrl: "https://www.llama.com/docs/model-cards-and-prompt-formats/",
    localProvider: "groq",
  },
];

export function findMainstreamVendor(vendorId: string): MainstreamVendorMetadata | null {
  return mainstreamVendorRegistry.find((vendor) => vendor.id === vendorId) ?? null;
}

export function normalizeEndpoint(value: string | undefined) {
  return (value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}
