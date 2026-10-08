import { mainstreamModelCapabilities, type MainstreamModelCapability } from "./mainstream-model-catalog";
import { modelGatewayModels } from "./model-gateway-snapshot";

/**
 * The model list served by the model gateway (imported with
 * `scripts/import-gateway-models.ts`) is the source of truth for 系统 / 模型管理.
 * This module classifies those ids into vendors and capabilities so the page can
 * show the same grouping as the gateway console.
 */
export type GatewayVendor = {
  id: string;
  name: string;
  region: "global" | "cn";
  /** Ordered matchers: the first vendor that matches owns the model. */
  match: RegExp;
};

export const gatewayVendors: GatewayVendor[] = [
  { id: "anthropic", name: "Anthropic", region: "global", match: /^claude/i },
  { id: "openai", name: "OpenAI", region: "global", match: /^(gpt|o1|o3|o4|text-embedding|tts-|whisper|babbage|davinci|dall-e|chatgpt)/i },
  { id: "google", name: "Gemini", region: "global", match: /^(gemini|veo|imagen)/i },
  { id: "xai", name: "xAI", region: "global", match: /^grok/i },
  { id: "qwen", name: "通义千问", region: "cn", match: /^(qwen|qwq|qvq|wan|z-image)/i },
  { id: "zhipu", name: "智谱", region: "cn", match: /^glm/i },
  { id: "deepseek", name: "DeepSeek", region: "cn", match: /^deepseek/i },
  { id: "doubao", name: "豆包", region: "cn", match: /^doubao/i },
  { id: "hunyuan", name: "腾讯混元", region: "cn", match: /^(hy\d|hunyuan)/i },
  { id: "moonshot", name: "Kimi", region: "cn", match: /^kimi/i },
  { id: "minimax", name: "MiniMax", region: "cn", match: /^(minimax|speech-)|hailuo/i },
  { id: "kling", name: "可灵 Kling", region: "cn", match: /kling/i },
  { id: "pixverse", name: "PixVerse", region: "cn", match: /pixverse/i },
  { id: "vidu", name: "Vidu", region: "cn", match: /^vidu/i },
  { id: "mimo", name: "MiMo", region: "cn", match: /^mimo/i },
  { id: "xinghuo", name: "讯飞星火", region: "cn", match: /^spark/i },
  { id: "midjourney", name: "Midjourney", region: "global", match: /^mj[_ -]/i },
  { id: "flux", name: "FLUX", region: "global", match: /^flux/i },
  { id: "suno", name: "Suno", region: "global", match: /^suno/i },
  { id: "llama", name: "Llama", region: "global", match: /^llama/i },
  { id: "rerank", name: "Rerank / 检索", region: "global", match: /(rerank|bge|bce-)/i },
  { id: "other", name: "其他", region: "global", match: /.*/ },
];

/**
 * Capability matchers, most specific first. A model gets exactly one capability,
 * so image-to-video and video-upgrade families are pulled out before the generic
 * image match.
 */
const gatewayCapabilityRules: Array<{ capability: MainstreamModelCapability; match: RegExp }> = [
  { capability: "video", match: /(image2video|image-to-video|^mj_video)/i },
  { capability: "embedding", match: /(embedding|rerank|bge-|bce-)/i },
  { capability: "image", match: /(image|imagen|dall-e|seedream|seededit|cogview|^flux|^mj[_ -]|z-image|vidu-image)/i },
  { capability: "video", match: /(video|sora|veo|kling|seedance|pixverse|vidu|happyhorse|hailuo|i2v|t2v|r2v|wan\d)/i },
  { capability: "audio", match: /(tts|whisper|audio|speech|voice|music|suno|omni|transcribe|realtime)/i },
  { capability: "reasoning", match: /(^o1|^o3|^o4|reasoning|reasoner|thinking|-think|^qwq|^qvq|^deepseek-r)/i },
  { capability: "code", match: /(codex|coder|code|devstral|codegeex)/i },
];

export type GatewayCapabilityGroup = {
  capability: MainstreamModelCapability;
  models: string[];
};

export type GatewayVendorGroup = {
  id: string;
  name: string;
  region: "global" | "cn";
  total: number;
  capabilityGroups: GatewayCapabilityGroup[];
};

export function classifyGatewayVendor(model: string): GatewayVendor {
  const vendor = gatewayVendors.find((entry) => entry.match.test(model));
  return vendor ?? gatewayVendors[gatewayVendors.length - 1];
}

export function classifyGatewayCapability(model: string): MainstreamModelCapability {
  const rule = gatewayCapabilityRules.find((entry) => entry.match.test(model));
  return rule?.capability ?? "chat";
}

export function buildGatewayVendorGroups(models: readonly string[] = modelGatewayModels): GatewayVendorGroup[] {
  const groups = new Map<string, GatewayVendorGroup>();
  for (const model of models) {
    const vendor = classifyGatewayVendor(model);
    const capability = classifyGatewayCapability(model);
    const group = groups.get(vendor.id) ?? {
      id: vendor.id,
      name: vendor.name,
      region: vendor.region,
      total: 0,
      capabilityGroups: [],
    };
    const capabilityGroup = group.capabilityGroups.find((entry) => entry.capability === capability);
    if (capabilityGroup) {
      capabilityGroup.models.push(model);
    } else {
      group.capabilityGroups.push({ capability, models: [model] });
    }
    group.total += 1;
    groups.set(vendor.id, group);
  }

  const vendorOrder = new Map(gatewayVendors.map((vendor, index) => [vendor.id, index]));
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      capabilityGroups: [...group.capabilityGroups].sort(
        (a, b) => mainstreamModelCapabilities.indexOf(a.capability) - mainstreamModelCapabilities.indexOf(b.capability),
      ),
    }))
    .sort((a, b) => b.total - a.total || (vendorOrder.get(a.id) ?? 0) - (vendorOrder.get(b.id) ?? 0));
}

export function countGatewayModelsByCapability(
  models: readonly string[] = modelGatewayModels,
): Record<MainstreamModelCapability, number> {
  const counts = Object.fromEntries(mainstreamModelCapabilities.map((capability) => [capability, 0])) as Record<
    MainstreamModelCapability,
    number
  >;
  for (const model of models) {
    counts[classifyGatewayCapability(model)] += 1;
  }
  return counts;
}
