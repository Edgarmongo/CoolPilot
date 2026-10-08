import { detectCapabilities, mergeCapabilityRecords, modelTypeForCapabilities } from "./capability";
import type { CapabilityRecord, ModelCapability, ModelType, NormalizedModel } from "./contracts";

/**
 * Provider payloads → `NormalizedModel`.
 *
 * Every vendor returns a different shape, so raw JSON never reaches the database: each
 * protocol adapter normalizes first, and the capabilities the vendor *stated* are
 * tagged `PROVIDER_METADATA` while everything inferred from the id is tagged
 * `MODEL_CATALOG` by `detectCapabilities`.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function metadataCapabilities(capabilities: ModelCapability[], confidence = 1): CapabilityRecord[] {
  return capabilities.map((capability) => ({
    capability,
    supported: true,
    source: "PROVIDER_METADATA" as const,
    confidence,
  }));
}

function build(model: {
  modelId: string;
  displayName?: string;
  contextWindow?: number | null;
  stated?: CapabilityRecord[];
  modelType?: ModelType;
}): NormalizedModel {
  const displayName = model.displayName?.trim() || model.modelId;
  const capabilities = mergeCapabilityRecords(model.stated ?? [], detectCapabilities(model.modelId, displayName));
  return {
    modelId: model.modelId,
    displayName,
    contextWindow: model.contextWindow ?? null,
    capabilities,
    modelType: model.modelType ?? modelTypeForCapabilities(capabilities),
  };
}

/** `GET /models` of an OpenAI-compatible endpoint: `{ data: [{ id }] }`. */
export function normalizeOpenAICompatibleCatalog(payload: unknown): NormalizedModel[] {
  const models = asArray(asRecord(payload).data).map((entry) => asRecord(entry));
  const seen = new Set<string>();
  const normalized: NormalizedModel[] = [];
  for (const model of models) {
    const modelId = asString(model.id);
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    normalized.push(build({ modelId }));
  }
  return normalized;
}

/** OpenRouter `GET /models`: the catalog states modalities, params and context length. */
export function normalizeOpenRouterCatalog(payload: unknown): NormalizedModel[] {
  const models = asArray(asRecord(payload).data).map((entry) => asRecord(entry));
  const seen = new Set<string>();
  const normalized: NormalizedModel[] = [];
  for (const model of models) {
    const modelId = asString(model.id);
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);

    const architecture = asRecord(model.architecture);
    const modality = [
      asString(architecture.modality),
      ...asArray(architecture.input_modalities).map(asString),
      ...asArray(architecture.output_modalities).map(asString),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const [inputSide, outputSide = ""] = modality.split("->");
    const params = asArray(model.supported_parameters).map(asString);

    const stated: CapabilityRecord[] = [];
    if (/image/.test(inputSide ?? "")) stated.push(...metadataCapabilities(["vision"], 0.9));
    if (/image/.test(outputSide)) stated.push(...metadataCapabilities(["image_generation"]));
    if (/audio/.test(inputSide ?? "")) stated.push(...metadataCapabilities(["audio_input", "speech_to_text"], 0.7));
    if (/audio/.test(outputSide)) stated.push(...metadataCapabilities(["audio_output", "text_to_speech"], 0.7));
    if (/text/.test(outputSide)) stated.push(...metadataCapabilities(["chat"]));
    if (params.includes("tools")) stated.push(...metadataCapabilities(["tool_calling"]));
    if (params.includes("response_format") || params.includes("structured_outputs")) {
      stated.push(...metadataCapabilities(["structured_output"]));
    }
    if (params.includes("reasoning")) stated.push(...metadataCapabilities(["reasoning"]));

    normalized.push(
      build({
        modelId,
        displayName: asString(model.name) || modelId,
        contextWindow: asNumber(asRecord(model.top_provider).context_length) ?? asNumber(model.context_length),
        stated,
      }),
    );
  }
  return normalized;
}

/**
 * Gemini `GET /v1beta/models`. The API states which generation methods a model
 * supports, which pins `chat` / `embedding` for certain; everything else stays a
 * `MODEL_CATALOG` guess.
 */
export function normalizeGeminiCatalog(payload: unknown): NormalizedModel[] {
  const models = asArray(asRecord(payload).models).map((entry) => asRecord(entry));
  const seen = new Set<string>();
  const normalized: NormalizedModel[] = [];
  for (const model of models) {
    const name = asString(model.name).replace(/^models\//, "");
    const modelId = asString(model.baseModelId) || name;
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);

    const methods = asArray(model.supportedGenerationMethods).map(asString);
    const stated: CapabilityRecord[] = [];
    if (methods.includes("generateContent")) {
      stated.push(...metadataCapabilities(["chat"]));
    }
    if (methods.includes("embedContent") || methods.includes("batchEmbedContents")) {
      stated.push(...metadataCapabilities(["embedding"]));
    }
    if (stated.length === 0) continue;

    normalized.push(
      build({
        modelId,
        displayName: asString(model.displayName) || modelId,
        contextWindow: asNumber(model.inputTokenLimit),
        stated,
      }),
    );
  }
  return normalized;
}

/**
 * Model ids from the bundled/imported gateway snapshot (no vendor metadata at all).
 * Seeds the catalog *knowledge* layer; never claims a model is callable.
 */
export function normalizeGatewayModelIds(ids: readonly string[]): NormalizedModel[] {
  const seen = new Set<string>();
  const normalized: NormalizedModel[] = [];
  for (const raw of ids) {
    const modelId = raw.trim();
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    normalized.push(build({ modelId }));
  }
  return normalized;
}
