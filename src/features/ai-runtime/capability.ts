import {
  capabilitySourcePriority,
  isModelCapability,
  type CapabilityRecord,
  type ModelCapability,
  type ModelCapabilitySource,
  type ModelRecord,
  type ModelRequirement,
  type ModelType,
} from "./contracts";

/**
 * Capability detection.
 *
 * Four layers feed the same capability rows (highest priority wins per capability):
 *   1. `PROVIDER_METADATA` - what the vendor API itself told us during a sync.
 *   2. `MODEL_CATALOG`     - the curated rules below, applied to the model id/name.
 *   3. `PROBE_TEST`        - a real request that either worked or did not (`probe.ts`).
 *   4. `USER_OVERRIDE`     - what the user set by hand in 系统 / 模型管理.
 *
 * Only the rules are guesses, so they carry a confidence below 1 and the UI shows the
 * source of every capability chip. Nothing downstream may assume that a model name
 * implies a capability - it asks the registry.
 */

type CapabilityRule = {
  capabilities: ModelCapability[];
  confidence: number;
  match: RegExp;
};

/** Most specific first: the first matching rule wins. */
const capabilityRules: CapabilityRule[] = [
  { capabilities: ["rerank"], confidence: 0.9, match: /(rerank|bge-reranker|bce-rerank)/i },
  { capabilities: ["embedding"], confidence: 0.9, match: /(embedding|embed-|bge-|bce-|text-embedding|^bge)/i },
  {
    capabilities: ["image_generation"],
    confidence: 0.7,
    match: /(image|imagen|dall-e|seedream|seededit|cogview|^flux|^mj[_ -]|z-image|vidu-image|nano-banana|gpt-image)/i,
  },
  {
    capabilities: ["video_generation"],
    confidence: 0.7,
    match: /(video|sora|veo|kling|seedance|pixverse|vidu|happyhorse|hailuo|i2v|t2v|r2v|wan\d)/i,
  },
  { capabilities: ["text_to_speech"], confidence: 0.6, match: /(tts|speech-|voice-|audio-speech)/i },
  {
    capabilities: ["speech_to_text"],
    confidence: 0.6,
    match: /(whisper|transcribe|asr|speech-to-text|audio-transcribe)/i,
  },
  {
    capabilities: ["audio_input", "audio_output"],
    confidence: 0.5,
    match: /(omni|realtime|audio-preview|gemini-live|qwen-audio|gpt-4o-audio)/i,
  },
  {
    capabilities: ["chat", "reasoning"],
    confidence: 0.6,
    match: /(^o1|^o3|^o4|reasoning|reasoner|thinking|-think|^qwq|deepseek-r|magistral)/i,
  },
  {
    // Explicit vision markers in the model name.
    capabilities: ["chat", "vision"],
    confidence: 0.6,
    match: /((^|[\s\-_/])(vl|vlm|vision)[\s\-_/]*|qvq|internvl|llava|pixtral|glm-4v|step-1v|yi-vision|gemma-?3)/i,
  },
  {
    // Multimodal flagship families: text + image in, tools and JSON out.
    capabilities: ["chat", "vision", "tool_calling", "structured_output"],
    confidence: 0.5,
    match: /(^gpt-4o|^gpt-4-turbo|^gpt-4-vision|^gpt-5|^gemini-\d|^claude-3|^claude-4)/i,
  },
  {
    // Text-first families where tool calling and JSON mode are the useful claims.
    capabilities: ["chat", "tool_calling", "structured_output"],
    confidence: 0.5,
    match: /(^gpt-4|^gpt-3\.5|^o1|^o3|^o4|^claude-|^gemini|^qwen3|^qwen-max|^qwen-plus|^glm-4|deepseek-chat|deepseek-v3|kimi-k|moonshot-v1|^grok-|^doubao-|hunyuan-|mistral-large|llama-3\.[13]|^yi-|^minimax-|^abab|^ernie|command-r|^mimo|^spark)/i,
  },
  {
    capabilities: ["chat"],
    confidence: 0.5,
    match: /(^gpt|^o\d|^claude|^gemini|^qwen|^glm|^deepseek|^doubao|^kimi|^moonshot|^hunyuan|^hy\d|^grok|^llama|^mimo|^spark|^minimax|^abab|^ernie|^mistral|^mixtral|^phi|^command|^step-|^yi-|^internlm|^baichuan|^chatglm)/i,
  },
];

/**
 * Layer 2: name based detection. Returns one entry per capability, all tagged
 * `MODEL_CATALOG` so the UI never presents a guess as vendor metadata.
 */
export function detectCapabilities(modelId: string, displayName = ""): CapabilityRecord[] {
  const haystack = `${modelId} ${displayName}`.trim();
  const rule = capabilityRules.find((entry) => entry.match.test(haystack));
  if (!rule) return [];
  return rule.capabilities.map((capability) => ({
    capability,
    supported: true,
    source: "MODEL_CATALOG" as ModelCapabilitySource,
    confidence: rule.confidence,
  }));
}

/** Keeps one record per capability: highest source priority, then confidence. */
export function mergeCapabilityRecords(...groups: CapabilityRecord[][]): CapabilityRecord[] {
  const best = new Map<ModelCapability, CapabilityRecord>();
  for (const record of groups.flat()) {
    if (!isModelCapability(record.capability)) continue;
    const current = best.get(record.capability);
    const better =
      !current ||
      capabilitySourcePriority[record.source] > capabilitySourcePriority[current.source] ||
      (capabilitySourcePriority[record.source] === capabilitySourcePriority[current.source] &&
        record.confidence > current.confidence);
    if (better) {
      best.set(record.capability, record);
    }
  }
  return Array.from(best.values());
}

export function modelTypeForCapabilities(capabilities: CapabilityRecord[]): ModelType {
  const supported = new Set(capabilities.filter((entry) => entry.supported).map((entry) => entry.capability));
  if (supported.has("image_generation")) return "image";
  if (supported.has("video_generation")) return "video";
  if (supported.has("embedding") || supported.has("rerank")) return "embedding";
  if (supported.has("text_to_speech") || supported.has("speech_to_text")) return "audio";
  if (supported.has("audio_input") || supported.has("audio_output")) return "audio";
  if (supported.has("reasoning")) return "reasoning";
  if (supported.has("chat")) return "chat";
  return "unknown";
}

export function supportedCapabilities(model: Pick<ModelRecord, "capabilities">): Set<ModelCapability> {
  return new Set(model.capabilities.filter((entry) => entry.supported).map((entry) => entry.capability));
}

/** Capabilities a requirement needs: the explicit list plus its entry point. */
export function requiredCapabilities(requirement: ModelRequirement): ModelCapability[] {
  const list = [...(requirement.capabilities ?? [])];
  if (requirement.capability && !list.includes(requirement.capability)) {
    list.push(requirement.capability);
  }
  return list;
}

export function matchedCapabilities(model: Pick<ModelRecord, "capabilities">, requirement: ModelRequirement) {
  const required = requiredCapabilities(requirement);
  return model.capabilities.filter((entry) => entry.supported && required.includes(entry.capability));
}

export function missingCapabilities(model: Pick<ModelRecord, "capabilities">, requirement: ModelRequirement) {
  const supported = supportedCapabilities(model);
  return requiredCapabilities(requirement).filter((capability) => !supported.has(capability));
}

/**
 * Why a requirement could not be met. The runtime reports the *last* bottleneck
 * instead of a generic failure, so the UI can tell the user exactly what to fix.
 */
export const capabilityFailureReasons = [
  "no-models-synced",
  "model-not-found",
  "provider-filtered",
  "endpoint-disabled",
  "credential-missing",
  "capability-missing",
  "context-window-too-small",
  "provider-disabled",
] as const;

export type CapabilityFailureReason = (typeof capabilityFailureReasons)[number];

export type CapabilityExplanation = {
  reason: CapabilityFailureReason;
  /** Capabilities that no usable model could provide (empty when the gap is elsewhere). */
  missing: ModelCapability[];
};

/** Last bottleneck wins: a model that fails only on the credential is the real blocker. */
export function explainRequirement(
  requirement: ModelRequirement,
  models: ModelRecord[],
): CapabilityExplanation {
  const required = requiredCapabilities(requirement);
  if (models.length === 0) {
    return { reason: "no-models-synced", missing: required };
  }

  if (requirement.model) {
    const pinned = models.filter((model) => model.modelId === requirement.model);
    if (pinned.length === 0) {
      return { reason: "model-not-found", missing: [] };
    }
    const missing = missingCapabilities(pinned[0], requirement);
    return missing.length > 0 ? { reason: "capability-missing", missing } : { reason: "credential-missing", missing: [] };
  }

  if (requirement.providerId && !models.some((model) => model.providerId === requirement.providerId)) {
    return { reason: "provider-filtered", missing: [] };
  }

  const enabled = models.filter((model) => model.enabled);
  if (enabled.length === 0) {
    return { reason: "provider-disabled", missing: [] };
  }

  const capable = enabled.filter((model) => missingCapabilities(model, requirement).length === 0);
  if (capable.length === 0) {
    const closest = enabled
      .map((model) => missingCapabilities(model, requirement))
      .sort((a, b) => a.length - b.length)[0];
    return { reason: "capability-missing", missing: closest ?? required };
  }

  // Everything else is satisfied, so the remaining gap is the credential (or the
  // endpoint) - the caller passes models with unusable endpoints already dropped.
  return { reason: "credential-missing", missing: [] };
}
