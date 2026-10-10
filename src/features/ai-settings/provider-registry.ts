import type { LocalAIProvider, LocalAgentSettings, LocalImageProvider } from "@/lib/types";

export type AIProviderConfig = {
  provider: LocalAIProvider;
  displayNameKey: string;
  keyField: "geminiKey" | "groqKey" | "openAIKey" | "openRouterKey";
  defaultBaseUrl: string;
  baseUrlEnv?: string;
  modelEnv?: string;
  supportsCustomBaseUrl: boolean;
};

export type AIProviderAttempt = {
  provider: LocalAIProvider;
  key: string;
  model: string;
  baseUrl: string;
};

export const aiProviderRegistry = {
  gemini: {
    provider: "gemini",
    displayNameKey: "providerGemini",
    keyField: "geminiKey",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    baseUrlEnv: "GEMINI_BASE_URL",
    modelEnv: "GEMINI_MODEL",
    supportsCustomBaseUrl: false,
  },
  groq: {
    provider: "groq",
    displayNameKey: "providerGroq",
    keyField: "groqKey",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    baseUrlEnv: "GROQ_BASE_URL",
    modelEnv: "GROQ_MODEL",
    supportsCustomBaseUrl: false,
  },
  openai: {
    provider: "openai",
    displayNameKey: "providerOpenAI",
    keyField: "openAIKey",
    defaultBaseUrl: "https://api.openai.com/v1",
    baseUrlEnv: "OPENAI_BASE_URL",
    modelEnv: "OPENAI_MODEL",
    supportsCustomBaseUrl: true,
  },
  openrouter: {
    provider: "openrouter",
    displayNameKey: "providerOpenRouter",
    keyField: "openRouterKey",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    modelEnv: "OPENROUTER_MODEL",
    supportsCustomBaseUrl: true,
  },
} satisfies Record<LocalAIProvider, AIProviderConfig>;

export const aiProviderOrder: LocalAIProvider[] = ["gemini", "groq", "openai", "openrouter"];

function envValue(name: string | undefined) {
  return name ? process.env[name] : undefined;
}

export function resolveProviderBaseUrl(provider: LocalAIProvider, settings?: LocalAgentSettings | null) {
  const config = aiProviderRegistry[provider];
  if (provider === "openai") {
    return settings?.openAIBaseUrl || envValue(config.baseUrlEnv) || config.defaultBaseUrl;
  }
  if (provider === "openrouter") {
    return settings?.openRouterBaseUrl || envValue(config.baseUrlEnv) || config.defaultBaseUrl;
  }
  return envValue(config.baseUrlEnv) || config.defaultBaseUrl;
}

export function resolveProviderModel(provider: LocalAIProvider, settings?: LocalAgentSettings | null) {
  const config = aiProviderRegistry[provider];
  if (provider === "gemini") {
    return settings?.geminiModel || envValue(config.modelEnv) || "";
  }
  if (provider === "groq") {
    return settings?.groqModel || envValue(config.modelEnv) || "";
  }
  if (provider === "openai") {
    return settings?.openAIModel || envValue(config.modelEnv) || "";
  }
  if (provider === "openrouter") {
    return settings?.openRouterModel || envValue(config.modelEnv) || "";
  }
  return envValue(config.modelEnv) || "";
}

export function orderedProviders(preferred?: LocalAIProvider, settings?: LocalAgentSettings | null) {
  return Array.from(new Set([preferred ?? settings?.textProvider ?? "gemini", ...aiProviderOrder]));
}

/**
 * Provider identity the *image* credential/endpoint uses once it is independent of the text
 * provider (CI-AI-IMG-CONFIG-02, decisions Q1/Q2). The value is the credential slug today
 * (`credential://openai-image/default`, `OPENAI_IMAGE_API_KEYS`) and becomes the runtime
 * `providerId` when the seed creates that provider (CI-AI-IMG-CONFIG-03).
 *
 * Gemini keeps its own identity because it serves both text and image from the same host but the
 * user must be able to hold separate keys; no custom base URL exists for Gemini, so no URL field is
 * invented for it (Q2).
 */
export const imageProviderIds = {
  openai: "openai-image",
  gemini: "gemini-image",
} as const satisfies Record<LocalImageProvider, string>;

export function imageProviderIdFor(provider: LocalImageProvider) {
  return imageProviderIds[provider];
}

export const imageProviderOrder: LocalImageProvider[] = ["openai", "gemini"];

/**
 * What 系统 / 模型管理 calls the image providers. They are rows of their own, next to the text
 * provider that shares their vendor, because endpoint, credential and model are all configurable
 * independently (`syncImageProviderSettings()` in the runtime registry).
 */
export const imageProviderDisplayName: Record<LocalImageProvider, string> = {
  openai: "OpenAI (image)",
  gemini: "Gemini (image)",
};

/** The legacy env var an image model name may come from (`AIProviderConfig.modelEnv` has the text ones). */
export const imageProviderModelEnv: Record<LocalImageProvider, string> = {
  openai: "OPENAI_IMAGE_MODEL",
  gemini: "GEMINI_IMAGE_MODEL",
};

/**
 * The endpoint an image provider calls (CI-AI-IMG-CONFIG-03).
 *
 * Gemini serves images from the host its protocol defines and has no custom base URL field at all
 * (Q2), so it resolves exactly like its text side - `GEMINI_BASE_URL` is an operator setting, not a
 * text-provider value, and inventing a second field for it would claim a capability the protocol does
 * not have.
 *
 * The OpenAI-compatible image endpoint comes from the *image* field and from nothing else. It
 * deliberately does not fall back to `openAIBaseUrl`, to `OPENAI_BASE_URL` or to
 * `https://api.openai.com/v1`: an image request must never be signed against an endpoint the user did
 * not name for images (Q4, as ruled for CI-AI-IMG-CONFIG-03), and an invented endpoint would be a
 * silent inheritance of the text configuration this split exists to remove. Empty therefore means
 * "no image endpoint is configured" - the registry then has no endpoint to route to and the runtime
 * answers with its own structured failure instead of calling anything.
 */
export function resolveImageProviderBaseUrl(provider: LocalImageProvider, settings?: LocalAgentSettings | null) {
  if (provider === "gemini") {
    return resolveProviderBaseUrl("gemini", settings);
  }
  return (settings?.openAIImageBaseUrl ?? "").trim();
}

/** The image model of a provider: the settings form first, then the legacy env var. Never a text model. */
export function resolveImageProviderModel(provider: LocalImageProvider, settings?: LocalAgentSettings | null) {
  const configured = provider === "gemini" ? settings?.geminiImageModel : settings?.openAIImageModel;
  return (configured ?? "").trim() || envValue(imageProviderModelEnv[provider]) || "";
}
