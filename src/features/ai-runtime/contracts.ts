import type { TranslationKey } from "@/lib/locale-resources";

/**
 * Shared vocabulary of the AI runtime. Nothing here touches the database or the
 * network so it can be imported from client components, route handlers and tests.
 */

/** Capability vocabulary. An Agent asks for these, never for a provider name. */
export const modelCapabilities = [
  "chat",
  "reasoning",
  "vision",
  "audio_input",
  "audio_output",
  "tool_calling",
  "structured_output",
  "image_generation",
  "video_generation",
  "text_to_speech",
  "speech_to_text",
  "embedding",
  "rerank",
] as const;

export type ModelCapability = (typeof modelCapabilities)[number];

export const modelCapabilityLabelKeys: Record<ModelCapability, TranslationKey> = {
  chat: "modelCapabilityChat",
  reasoning: "modelCapabilityReasoning",
  vision: "aiCapabilityVision",
  audio_input: "aiCapabilityAudioInput",
  audio_output: "aiCapabilityAudioOutput",
  tool_calling: "aiCapabilityToolCalling",
  structured_output: "aiCapabilityStructuredOutput",
  image_generation: "modelCapabilityImage",
  video_generation: "modelCapabilityVideo",
  text_to_speech: "aiCapabilityTextToSpeech",
  speech_to_text: "aiCapabilitySpeechToText",
  embedding: "modelCapabilityEmbedding",
  rerank: "aiCapabilityRerank",
};

export function isModelCapability(value: string | null | undefined): value is ModelCapability {
  return Boolean(value) && (modelCapabilities as readonly string[]).includes(value as string);
}

/** Where a capability row came from - surfaced in the UI so guesses stay visible. */
export const modelCapabilitySources = ["USER_OVERRIDE", "PROBE_TEST", "PROVIDER_METADATA", "MODEL_CATALOG"] as const;

export type ModelCapabilitySource = (typeof modelCapabilitySources)[number];

/** Higher wins when two rows describe the same capability. */
export const capabilitySourcePriority: Record<ModelCapabilitySource, number> = {
  USER_OVERRIDE: 4,
  PROBE_TEST: 3,
  PROVIDER_METADATA: 2,
  MODEL_CATALOG: 1,
};

export function isModelCapabilitySource(value: string): value is ModelCapabilitySource {
  return (modelCapabilitySources as readonly string[]).includes(value);
}

/** UI labels for where a capability claim came from. */
export const modelCapabilitySourceLabelKeys: Record<ModelCapabilitySource, TranslationKey> = {
  PROVIDER_METADATA: "aiRegistrySourceProviderMetadata",
  MODEL_CATALOG: "aiRegistrySourceModelCatalog",
  PROBE_TEST: "aiRegistrySourceProbeTest",
  USER_OVERRIDE: "aiRegistrySourceUserOverride",
};

/**
 * Wire protocols. The protocol belongs to the *endpoint*, not the provider: one
 * vendor can expose an OpenAI-compatible endpoint and a native one at the same time.
 */
export const modelProtocols = ["openai-compatible", "gemini", "anthropic"] as const;

export type ModelProtocol = (typeof modelProtocols)[number];

export const modelProtocolLabelKeys: Record<ModelProtocol, TranslationKey> = {
  "openai-compatible": "aiProtocolOpenAICompatible",
  gemini: "aiProtocolGemini",
  anthropic: "aiProtocolAnthropic",
};

export function isModelProtocol(value: string | null | undefined): value is ModelProtocol {
  return Boolean(value) && (modelProtocols as readonly string[]).includes(value as string);
}

/** Coarse model kind derived from the resolved capabilities. */
export const modelTypes = ["chat", "reasoning", "image", "video", "audio", "embedding", "unknown"] as const;

export type ModelType = (typeof modelTypes)[number];

export function isModelType(value: string | null | undefined): value is ModelType {
  return Boolean(value) && (modelTypes as readonly string[]).includes(value as string);
}

export type CapabilityRecord = {
  capability: ModelCapability;
  supported: boolean;
  source: ModelCapabilitySource;
  confidence: number;
};

export type ModelProviderRecord = {
  providerId: string;
  name: string;
  region: string;
  docsUrl: string;
  apiKeyUrl: string;
  enabled: boolean;
  source: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type ModelEndpointRecord = {
  endpointId: string;
  providerId: string;
  name: string;
  protocol: ModelProtocol;
  baseUrl: string;
  credentialRef: string;
  enabled: boolean;
  isDefault: boolean;
  status: string;
  lastCheckAt: number | null;
  lastCheckMessage: string;
  createdAt: number;
  updatedAt: number;
};

export type ModelRecord = {
  id: string;
  providerId: string;
  endpointId: string;
  modelId: string;
  displayName: string;
  modelType: ModelType;
  contextWindow: number | null;
  enabled: boolean;
  source: string;
  syncedAt: number | null;
  capabilities: CapabilityRecord[];
  createdAt: number;
  updatedAt: number;
};

/** One model as returned by a provider catalog before it reaches the registry. */
export type NormalizedModel = {
  modelId: string;
  displayName: string;
  modelType: ModelType;
  contextWindow: number | null;
  capabilities: CapabilityRecord[];
};

export type ModelSyncRecord = {
  providerId: string;
  endpointId: string;
  status: "ok" | "error";
  modelCount: number;
  message: string;
  startedAt: number;
  finishedAt: number;
};

export type ModelProbeRecord = {
  modelRowId: string;
  capability: ModelCapability;
  status: "ok" | "failed" | "unsupported";
  latencyMs: number;
  message: string;
  probedAt: number;
};

/**
 * Health of one API key inside a credential (`docs/model-layer-spec.md` §5.2).
 *
 * Keys are addressed by a one-way fingerprint, never by their value, so this state can
 * live in SQLite: `invalid` / `forbidden` mean "do not use again until the user says so",
 * `rate_limited` carries a `cooldownUntil`, and `disabled` is a manual switch.
 */
export const credentialKeyStatuses = ["unknown", "ok", "invalid", "forbidden", "rate_limited", "disabled"] as const;

export type CredentialKeyStatus = (typeof credentialKeyStatuses)[number];

export function isCredentialKeyStatus(value: string | null | undefined): value is CredentialKeyStatus {
  return Boolean(value) && (credentialKeyStatuses as readonly string[]).includes(value as string);
}

/** UI labels for a key's health, so 系统 / 模型管理 never has to guess. */
export const credentialKeyStatusLabelKeys: Record<CredentialKeyStatus, TranslationKey> = {
  unknown: "aiCredentialKeyStatusUnknown",
  ok: "aiCredentialKeyStatusOk",
  invalid: "aiCredentialKeyStatusInvalid",
  forbidden: "aiCredentialKeyStatusForbidden",
  rate_limited: "aiCredentialKeyStatusRateLimited",
  disabled: "aiCredentialKeyStatusDisabled",
};

/** UI labels for why a key is out of rotation. */
export const credentialKeySkipReasonLabelKeys: Record<CredentialKeySkipReason, TranslationKey> = {
  "cooling-down": "aiCredentialKeySkipCoolingDown",
  invalid: "aiCredentialKeyStatusInvalid",
  forbidden: "aiCredentialKeyStatusForbidden",
  disabled: "aiCredentialKeyStatusDisabled",
};

/** Statuses that still take part in rotation. */
export function isUsableCredentialKeyStatus(status: CredentialKeyStatus) {
  return status === "unknown" || status === "ok";
}

export type CredentialKeyRecord = {
  id: string;
  credentialRef: string;
  providerId: string;
  /** SHA-256 of the secret, hex. The secret itself never reaches the database. */
  fingerprint: string;
  label: string;
  masked: string;
  status: CredentialKeyStatus;
  cooldownUntil: number | null;
  lastCheckAt: number | null;
  lastUsedAt: number | null;
  useCount: number;
  errorCount: number;
  createdAt: number;
  updatedAt: number;
};

/** Why a key was not used, so an empty rotation set can explain itself. */
export type CredentialKeySkipReason = "cooling-down" | "invalid" | "forbidden" | "disabled";

export type CredentialKeyHealth = CredentialKeyRecord & {
  /** Present when the key is currently excluded from rotation. */
  skipReason?: CredentialKeySkipReason;
  /** True when this key was selected for the current call. */
  selected?: boolean;
};

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  /** Inline images (base64 payload or https URL) attached to this message. */
  images?: string[];
  name?: string;
  toolCallId?: string;
};

export type ChatToolDescriptor = {
  name: string;
  description?: string;
  /** JSON schema of the tool arguments. */
  parameters?: Record<string, unknown>;
};

export type ChatToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  /** Pin an exact model id; when omitted the runtime routes by capability. */
  model?: string;
  /** Pin an exact provider; the candidate chain shrinks to that provider only. */
  providerId?: string;
  /**
   * Soft preference: this provider's models are ordered first, but the chain still falls
   * through to other providers when they fail. The legacy per-call `provider` argument
   * means this, not a pin. Defaults to the user's configured text provider.
   */
  preferProviderId?: string;
  capability?: ModelCapability;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  tools?: ChatToolDescriptor[];
  systemPrompt?: string;
  /**
   * Use keys the pool would skip (cooling down, marked invalid). Only meant for
   * troubleshooting from the UI - the default is to rotate to a healthy key.
   */
  forceUnhealthyCredential?: boolean;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

/** How the runtime picked the model - shown in the UI and logged in run events. */
export type ModelRouteReason = "explicit-model" | "capability-default" | "capability-match" | "provider-default";

export type ModelRequirement = {
  /** Capabilities the call needs; all of them must be satisfied. */
  capabilities?: ModelCapability[];
  /** Preferred entry point of the requirement, used first when ordering candidates. */
  capability?: ModelCapability;
  /** Hard filter: only this provider's endpoints are considered. */
  providerId?: string;
  /**
   * Ordering hint only: candidates of this provider come first, everything else still
   * follows. Soft preference never removes a candidate, so failover keeps working.
   */
  preferProviderId?: string;
  model?: string;
  minContextWindow?: number;
  /** When true (default) candidates without a resolvable credential are dropped. */
  requireCredential?: boolean;
};

export type ModelRoute = {
  reason: ModelRouteReason;
  providerId: string;
  endpointId: string;
  modelRowId: string;
  modelId: string;
  protocol: ModelProtocol;
  /** Models that also satisfied the requirement, best first (excluding the pick). */
  alternatives: string[];
  requirement: ModelRequirement;
};

/** Why one request existed: the question itself, or a re-ask after an unusable answer. */
export type ModelAttemptKind = "answer" | "self-correction";

/** How one request ended. A rejected key is `failed`; a request that answered is `success`. */
export type ModelAttemptOutcome = "success" | "failed";

/**
 * One request the runtime sent, and what came back (CI-P7-01-04).
 *
 * The trail is the AI usage ledger's unit of account: one entry, one row, in the order the
 * requests went out. So a call that burned a rotated key and then a model failover before the
 * answer is three entries and three rows - not one - and a structured call that had to re-ask is
 * two *successful* entries, because those are two requests the provider charged for.
 *
 * `usage` is what *this* request reported, never the sum of the call. Merging it (which is what
 * `StructuredChatResponse.usage` still does, for a caller that only wants to display a total) is
 * precisely what left the ledger unable to say that a re-ask cost a second time.
 *
 * A `failed` entry carries no `usage`: nothing came back to measure. That is a different statement
 * from "it used nothing", and the ledger keeps them apart (`cost_amount` stays NULL, never 0).
 */
export type ModelAttempt = {
  /** `answer` is the request carrying the question; `self-correction` is a re-ask. */
  kind: ModelAttemptKind;
  /**
   * How this request ended. A key the provider rejected is `failed`; the first answer of a
   * structured call that had to be re-asked is a `success` - the request worked, its payload was
   * not usable, and the provider billed for it either way.
   */
  outcome: ModelAttemptOutcome;
  providerId: string;
  modelId: string;
  /** The endpoint the request went out through, so a failover is visible as a different endpoint. */
  endpointId: string;
  /**
   * Masked label of the key that signed this request (`****1234`), never the key. `""` means the
   * runtime could not name one: no key was available at all (so nothing was sent), or the failure
   * was not a key-level one and the pool threw before it reported which key was in use. The ledger
   * stores the label as it stands and never infers billing from it.
   */
  credentialLabel: string;
  /** Why it failed, or `""` when it produced a payload. */
  error: string;
  /** What the provider reported for this request alone, or absent when it reported nothing. */
  usage?: TokenUsage;
};

export type ChatResponse = {
  text: string;
  toolCalls: ChatToolCall[];
  model: string;
  providerId: string;
  /** Masked label of the key that signed the call (`****1234`), never the key. */
  credentialLabel: string;
  /**
   * Every request this call sent, in order; the last entry is the one that produced this response.
   * Failed entries carry `error`, the winner carries `usage`.
   *
   * This used to hold the failures only, which made "which key was rejected" answerable and "what
   * actually ran" not - and left a caller (and the ledger) unable to see the shape of the call it
   * had just paid for. `usage` above is this response's own figure; `attempts[i].usage` is what
   * each request reported.
   */
  attempts: ModelAttempt[];
  usage?: TokenUsage;
  route: ModelRoute;
};

export type ImageGenerationRequest = {
  prompt: string;
  size?: string;
  model?: string;
  providerId?: string;
  forceUnhealthyCredential?: boolean;
};

export type ImageGenerationResponse = {
  images: Array<{ base64: string; mimeType: string }>;
  model: string;
  providerId: string;
  credentialLabel: string;
  attempts: ModelAttempt[];
  route: ModelRoute;
};

/**
 * One stretch of recognised speech.
 *
 * A segment is what the *engine* reported, never a split this app made: `startMs`/`endMs` are the
 * engine's own marks, and an engine that answers without segmentation yields no segments at all rather
 * than one segment spanning a duration nobody measured (CI-P3-02 of
 * `docs/coolpilot-capability-integration-plan.md`).
 */
export type TranscriptionSegment = {
  index: number;
  /**
   * Milliseconds from the start of the media, or `null` when the engine did not report a position.
   *
   * Nullable on purpose: the OpenAI-compatible wire format carries absolute segment times, while the
   * Windows recognizer reports how long each utterance lasted but not where it sat in the file. A
   * timestamp nobody measured is recorded as absent, never approximated into a number a user would
   * read as a fact (CI-P3-02).
   */
  startMs: number | null;
  endMs: number | null;
  text: string;
};

/**
 * A speech-to-text request: the bytes to recognise, plus the hints an engine may honour.
 *
 * `bytes` is a `Uint8Array` and not a path, because this module is importable from a client component
 * and a path here would hand the decision "which file is read" to the adapter instead of the caller.
 */
export type TranscriptionRequest = {
  audio: { name: string; mimeType: string; bytes: Uint8Array };
  /** A BCP-47-ish hint (`en-US`, `zh-CN`); an adapter sends what its wire format accepts. */
  language?: string;
  /** Optional vocabulary/context hint, for engines that support one. */
  prompt?: string;
  model?: string;
  providerId?: string;
  preferProviderId?: string;
  forceUnhealthyCredential?: boolean;
};

export type TranscriptionResponse = {
  text: string;
  /** Empty when the engine answered without segmentation. Never invented from the text. */
  segments: TranscriptionSegment[];
  /** What the engine reported, or "" when it reported nothing. */
  language: string;
  /** Milliseconds, or `null` when no duration was reported. */
  durationMs: number | null;
  /**
   * How the engine was actually asked to answer.
   *
   * `verbose_json` carries segments, language and duration; `json` carries text alone. A provider that
   * refuses the richer format is not a failure - it is a transcript without time marks, and this field
   * is what says so, instead of an empty `segments` array having to mean two different things.
   */
  responseFormat: "verbose_json" | "json";
  model: string;
  providerId: string;
  credentialLabel: string;
  attempts: ModelAttempt[];
  route: ModelRoute;
};

export type ModelCandidate = {
  model: ModelRecord;
  provider: ModelProviderRecord;
  endpoint: ModelEndpointRecord;
  credentialRef: string;
  hasCredential: boolean;
  /** Capabilities of the requirement that this model satisfies, with sources. */
  matched: CapabilityRecord[];
};

/**
 * Intent → required capabilities. Upper layers (Agent, AI writing, canvas) describe
 * what they want to do, and this table decides which capabilities must be present.
 */
export const modelIntents = [
  "chat",
  "reasoning",
  "vision-analysis",
  "structured-output",
  "tool-calling",
  "image-generation",
  "video-generation",
  "speech",
  "transcription",
  "embedding",
  "rerank",
] as const;

export type ModelIntent = (typeof modelIntents)[number];

export const intentRequirements: Record<ModelIntent, { modelType: ModelType; capabilities: ModelCapability[] }> = {
  chat: { modelType: "chat", capabilities: ["chat"] },
  reasoning: { modelType: "reasoning", capabilities: ["chat", "reasoning"] },
  "vision-analysis": { modelType: "chat", capabilities: ["chat", "vision"] },
  "structured-output": { modelType: "chat", capabilities: ["chat", "structured_output"] },
  "tool-calling": { modelType: "chat", capabilities: ["chat", "tool_calling"] },
  "image-generation": { modelType: "image", capabilities: ["image_generation"] },
  "video-generation": { modelType: "video", capabilities: ["video_generation"] },
  speech: { modelType: "audio", capabilities: ["text_to_speech"] },
  transcription: { modelType: "audio", capabilities: ["speech_to_text"] },
  embedding: { modelType: "embedding", capabilities: ["embedding"] },
  rerank: { modelType: "embedding", capabilities: ["rerank"] },
};

export function requirementForIntent(intent: ModelIntent, extra: Partial<ModelRequirement> = {}): ModelRequirement {
  const requirements = intentRequirements[intent];
  return {
    capabilities: requirements.capabilities,
    capability: requirements.capabilities[requirements.capabilities.length - 1],
    ...extra,
  };
}
