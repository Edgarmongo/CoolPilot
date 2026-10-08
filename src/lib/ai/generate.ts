import { z } from "zod";
import {
  aiRuntime,
  type ChatRequest,
  type ChatResponse,
  type StructuredChatRequest,
  type TokenUsage,
} from "@/features/ai-runtime";
import {
  legacyProviderOrder,
  MissingAIKeyError,
  preferredTextProvider,
  withLegacyCompatibility,
  type LegacyProvider,
} from "./compat";

/**
 * Compatibility facade over `aiRuntime` (phase P2 of `docs/generate-migration.md`).
 *
 * The public API is unchanged on purpose: the 19 call sites still import `generateText` /
 * `generateStructured` and must not notice that provider ordering, key rotation, model
 * resolution, failover and usage collection now live in the runtime. Everything
 * provider-facing was deleted from this file - what is left is request shaping (legacy
 * arguments -> `ChatRequest`) and the compatibility shims in `compat.ts`.
 */

export { MissingAIKeyError };
export type { TokenUsage };

type Provider = LegacyProvider;

export type GenerateMeta = {
  /**
   * `providerId` of the model that actually answered - after key rotation and after model
   * failover (`qwen`, `gemini`, ...). Callers persist this as `usage_records.provider` (D2).
   */
  provider: string;
  model: string;
  /** Masked credential label (`****1234`). Never the key, and never persisted (D6). */
  keyLabel: string;
  usage?: TokenUsage;
};

/** @deprecated Legacy alias kept so existing imports keep compiling; retire in P4. */
export type ProviderResult = { text: string; usage?: TokenUsage };

type RuntimeMeta = Pick<ChatResponse, "providerId" | "model" | "credentialLabel" | "usage">;

function toMeta(response: RuntimeMeta): GenerateMeta {
  return {
    provider: response.providerId,
    model: response.model,
    keyLabel: response.credentialLabel,
    usage: response.usage,
  };
}

/** The legacy per-call `provider` argument never pinned anything - it asked for it first (G1). */
function preferredProvider(preferred?: Provider): Pick<ChatRequest, "preferProviderId"> {
  return preferred ? { preferProviderId: preferred } : {};
}

/** Every legacy text call shares the same compatibility envelope. */
function runOnRuntime<T>(preferred: Provider | undefined, run: () => Promise<T>) {
  return withLegacyCompatibility({
    providerIds: () => legacyProviderOrder(preferred),
    namedProvider: () => preferredTextProvider(preferred),
    run,
  });
}

export async function generateText(input: {
  prompt: string;
  systemPrompt?: string;
  provider?: Provider;
}) {
  const request: ChatRequest = {
    messages: [{ role: "user", content: input.prompt }],
    systemPrompt: input.systemPrompt,
    ...preferredProvider(input.provider),
  };
  const response = await runOnRuntime(input.provider, () => aiRuntime.chat(request));
  return { text: response.text, ...toMeta(response) };
}

export async function generateStructured<T extends z.ZodType>(input: {
  prompt: string;
  systemPrompt?: string;
  schema: T;
  provider?: Provider;
}): Promise<{ data: z.infer<T> } & GenerateMeta> {
  // The instruction → parse → corrective-retry loop is the runtime's job now (G5);
  // this facade only hands over the prompt and the schema.
  const request: StructuredChatRequest<T> = {
    messages: [{ role: "user", content: input.prompt }],
    systemPrompt: input.systemPrompt,
    schema: input.schema,
    ...preferredProvider(input.provider),
  };
  const response = await runOnRuntime(input.provider, () => aiRuntime.chatStructured(request));
  return { data: response.data, ...toMeta(response) };
}
