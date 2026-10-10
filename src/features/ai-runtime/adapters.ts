import { AppError } from "@/lib/app-errors";
import type {
  ChatRequest,
  ChatToolCall,
  ModelCapability,
  ModelEndpointRecord,
  ModelProtocol,
  ModelProviderRecord,
  NormalizedModel,
  TokenUsage,
  TranscriptionSegment,
} from "./contracts";
import {
  normalizeGeminiCatalog,
  normalizeOpenAICompatibleCatalog,
  normalizeOpenRouterCatalog,
} from "./normalizers";

/**
 * Protocol adapters - the only place in the app that speaks a vendor wire format.
 *
 * One adapter serves a whole *protocol* (e.g. every OpenAI-compatible vendor), so the
 * provider list can grow without new client code. Adapters receive a resolved
 * credential and never read the database or the environment themselves.
 */

export type AdapterContext = {
  provider: ModelProviderRecord;
  endpoint: ModelEndpointRecord;
  /** Plaintext secret, already resolved by the runtime. Never logged. */
  credential: string | null;
};

export type AdapterChatOptions = Pick<ChatRequest, "messages" | "temperature" | "maxTokens" | "json" | "tools" | "systemPrompt"> & {
  model: string;
};

export type AdapterChatResult = {
  text: string;
  toolCalls: ChatToolCall[];
  usage?: TokenUsage;
};

export type AdapterImageOptions = {
  model: string;
  prompt: string;
  size?: string;
};

export type AdapterImageResult = {
  images: Array<{ base64: string; mimeType: string }>;
};

export type AdapterProbeResult = {
  supported: boolean;
  message: string;
};

/**
 * Speech-to-text options an adapter receives. The runtime has already decided *which* model and key;
 * an adapter decides only how to say it on the wire.
 */
export type AdapterTranscriptionOptions = {
  model: string;
  audio: { name: string; mimeType: string; bytes: Uint8Array };
  language?: string;
  prompt?: string;
};

export type AdapterTranscriptionResult = {
  text: string;
  segments: TranscriptionSegment[];
  language: string;
  durationMs: number | null;
  responseFormat: "verbose_json" | "json";
};

export type ProtocolAdapter = {
  protocol: ModelProtocol;
  listModels(context: AdapterContext): Promise<NormalizedModel[]>;
  chat(context: AdapterContext, options: AdapterChatOptions): Promise<AdapterChatResult>;
  generateImage?(context: AdapterContext, options: AdapterImageOptions): Promise<AdapterImageResult>;
  /**
   * Recognise speech, when the protocol has a call for it. A protocol without one is reported by the
   * runtime as `MODEL_CAPABILITY_UNAVAILABLE`, never silently skipped.
   */
  transcribe?(context: AdapterContext, options: AdapterTranscriptionOptions): Promise<AdapterTranscriptionResult>;
  probe?(
    context: AdapterContext,
    options: { model: string; capability: ModelCapability },
  ): Promise<AdapterProbeResult>;
};

const chatTimeoutMs = 120_000;
const catalogTimeoutMs = 30_000;
/**
 * A transcription is a whole file, not a sentence, so it is given far longer than a chat call: ten
 * minutes is the ceiling for one HTTP request, and the task layer above applies its own, longer,
 * end-to-end budget (a file that has to be decoded first takes longer than the request that sends it).
 */
const transcriptionTimeoutMs = 10 * 60_000;

function trimBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function requireCredential(context: AdapterContext) {
  if (!context.credential) {
    throw new AppError("MODEL_CREDENTIAL_MISSING", {
      status: 400,
      message: `${context.provider.name} has no credential for this endpoint`,
      details: { providerId: context.provider.providerId, credentialRef: context.endpoint.credentialRef },
    });
  }
  return context.credential;
}

function requireBaseUrl(context: AdapterContext) {
  const baseUrl = context.endpoint.baseUrl.trim();
  if (!baseUrl) {
    throw new AppError("MODEL_ENDPOINT_INVALID", {
      status: 400,
      message: `${context.provider.name} endpoint has no base URL`,
      details: { endpointId: context.endpoint.endpointId },
    });
  }
  return trimBaseUrl(baseUrl);
}

function normalizeUsage(input: { input?: unknown; output?: unknown; total?: unknown }): TokenUsage | undefined {
  const inputTokens = Math.max(0, Math.round(Number(input.input) || 0));
  const outputTokens = Math.max(0, Math.round(Number(input.output) || 0));
  const totalTokens = Math.max(0, Math.round(Number(input.total) || inputTokens + outputTokens));
  if (!inputTokens && !outputTokens && !totalTokens) return undefined;
  return { inputTokens, outputTokens, totalTokens };
}

/** `Retry-After` (seconds or HTTP date) capped at 30 minutes; 0 when the header is absent. */
function retryAfterMs(response: Response) {
  const header = response.headers.get("retry-after");
  if (!header) return 0;
  const cap = 30 * 60_000;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(Math.round(seconds * 1000), cap);
  }
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, Math.min(at - Date.now(), cap)) : 0;
}

/**
 * Auth and rate-limit answers get their own error code: the credential layer rotates keys
 * on a 401/403/429, and it can only do that if it is not handed a generic "upstream failed".
 */
function upstreamError(context: AdapterContext, label: string, status: number, payload: unknown, retryAfter = 0) {
  const message = `${label} HTTP ${status}: ${JSON.stringify(payload).slice(0, 240)}`;
  const details = { providerId: context.provider.providerId, endpointId: context.endpoint.endpointId, status };
  if (status === 401) {
    return new AppError("MODEL_CREDENTIAL_INVALID", { status: 502, message, details });
  }
  if (status === 403) {
    return new AppError("MODEL_CREDENTIAL_FORBIDDEN", { status: 502, message, details });
  }
  if (status === 429) {
    return new AppError("MODEL_RATE_LIMITED", { status: 429, message, details: { ...details, retryAfterMs: retryAfter } });
  }
  return new AppError("MODEL_UPSTREAM_FAILED", { status: 502, message, details });
}

async function fetchJson(
  context: AdapterContext,
  label: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    // Timeouts and DNS/TLS failures surface as fetch rejections; keeping the cause makes
    // "why did nothing happen" answerable without a debugger.
    throw new AppError("MODEL_UPSTREAM_FAILED", {
      status: 502,
      message: `${label} could not be reached: ${error instanceof Error ? error.message : "network error"}`,
      details: { providerId: context.provider.providerId, endpointId: context.endpoint.endpointId, status: 0 },
    });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw upstreamError(context, label, response.status, payload, retryAfterMs(response));
  }
  return payload;
}

/** `…base64` payloads and `https://…` URLs both reach the provider as a usable URL. */
function toDataUrl(image: string) {
  if (/^https?:\/\//i.test(image) || /^data:/i.test(image)) {
    return image;
  }
  return `data:image/png;base64,${image}`;
}

type OpenAICompatibleMessage = { role: string; content: unknown; name?: string; tool_call_id?: string };

function toOpenAIMessage(message: ChatRequest["messages"][number]): OpenAICompatibleMessage {
  const images = message.images ?? [];
  if (images.length === 0) {
    return {
      role: message.role,
      content: message.content,
      ...(message.name ? { name: message.name } : {}),
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    };
  }
  return {
    role: message.role,
    content: [
      ...(message.content ? [{ type: "text", text: message.content }] : []),
      ...images.map((image) => ({ type: "image_url", image_url: { url: toDataUrl(image) } })),
    ],
  };
}

function openAIToolUsage(payload: unknown) {
  const usage = (payload as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } })
    ?.usage;
  if (!usage) return undefined;
  return normalizeUsage({ input: usage.prompt_tokens, output: usage.completion_tokens, total: usage.total_tokens });
}

/**
 * The primary subtag of a language hint (`en-US` -> `en`), which is what the OpenAI-compatible wire
 * field `language` accepts. An absent hint sends nothing rather than a guess.
 */
function primaryLanguageSubtag(language: string | undefined) {
  return ((language ?? "").trim().split(/[-_]/)[0] ?? "").toLowerCase();
}

/** True when a refusal is specifically about `response_format`: the only field this adapter falls back on. */
function isResponseFormatRefusal(error: unknown) {
  return error instanceof AppError && error.message.includes("response_format");
}

/** The engine's own segments, in its own order. A payload without them yields none, never one made up. */
function transcriptionSegments(payload: unknown): TranscriptionSegment[] {
  const raw = (payload as { segments?: unknown }).segments;
  if (!Array.isArray(raw)) return [];
  const segments: TranscriptionSegment[] = [];
  for (const entry of raw) {
    const text = typeof (entry as { text?: unknown })?.text === "string" ? (entry as { text: string }).text.trim() : "";
    if (!text) continue;
    const start = Number((entry as { start?: unknown }).start);
    const end = Number((entry as { end?: unknown }).end);
    segments.push({
      index: segments.length,
      startMs: Number.isFinite(start) ? Math.max(0, Math.round(start * 1000)) : 0,
      endMs: Number.isFinite(end) ? Math.max(0, Math.round(end * 1000)) : 0,
      text,
    });
  }
  return segments;
}

/** One transcription answer read into the contract's shape; anything absent stays absent. */
function parseTranscriptionPayload(
  payload: unknown,
  responseFormat: "verbose_json" | "json",
): AdapterTranscriptionResult {
  const text = typeof (payload as { text?: unknown }).text === "string" ? (payload as { text: string }).text.trim() : "";
  const language =
    typeof (payload as { language?: unknown }).language === "string" ? (payload as { language: string }).language : "";
  const duration = Number((payload as { duration?: unknown }).duration);
  return {
    text,
    segments: responseFormat === "verbose_json" ? transcriptionSegments(payload) : [],
    language,
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null,
    responseFormat,
  };
}

export const openAICompatibleAdapter: ProtocolAdapter = {
  protocol: "openai-compatible",

  async listModels(context) {
    const baseUrl = requireBaseUrl(context);
    const payload = await fetchJson(
      context,
      "Model list",
      `${baseUrl}/models`,
      {
        headers: {
          accept: "application/json",
          ...(context.credential ? { Authorization: `Bearer ${context.credential}` } : {}),
        },
      },
      catalogTimeoutMs,
    );
    if (context.provider.providerId === "openrouter") {
      // OpenRouter states modalities and supported parameters, which beats guessing
      // from the model id - worth the extra branch.
      return normalizeOpenRouterCatalog(payload);
    }
    return normalizeOpenAICompatibleCatalog(payload);
  },

  async chat(context, options) {
    const baseUrl = requireBaseUrl(context);
    const credential = requireCredential(context);
    const payload = await fetchJson(
      context,
      "Chat completion",
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
        body: JSON.stringify({
          model: options.model,
          messages: [
            ...(options.systemPrompt ? [{ role: "system", content: options.systemPrompt }] : []),
            ...options.messages.map(toOpenAIMessage),
          ],
          temperature: options.temperature ?? 0.7,
          ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
          ...(options.json ? { response_format: { type: "json_object" } } : {}),
          ...(options.tools?.length
            ? {
                tools: options.tools.map((tool) => ({
                  type: "function",
                  function: {
                    name: tool.name,
                    ...(tool.description ? { description: tool.description } : {}),
                    parameters: tool.parameters ?? { type: "object", properties: {} },
                  },
                })),
              }
            : {}),
        }),
      },
      chatTimeoutMs,
    );

    const message = (payload as { choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown[] } }> })
      ?.choices?.[0]?.message;
    const text = typeof message?.content === "string" ? message.content.trim() : "";
    const toolCalls: ChatToolCall[] = (message?.tool_calls ?? []).flatMap((entry) => {
      const call = entry as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
      const name = typeof call.function?.name === "string" ? call.function.name : "";
      if (!name) return [];
      return [
        {
          id: typeof call.id === "string" ? call.id : name,
          name,
          arguments: typeof call.function?.arguments === "string" ? call.function.arguments : "{}",
        },
      ];
    });

    if (!text && toolCalls.length === 0) {
      throw new AppError("MODEL_UPSTREAM_NO_CONTENT", {
        status: 502,
        message: `${context.provider.name} returned no text`,
        details: { providerId: context.provider.providerId, model: options.model },
      });
    }
    return { text, toolCalls, usage: openAIToolUsage(payload) };
  },

  async generateImage(context, options) {
    const baseUrl = requireBaseUrl(context);
    const credential = requireCredential(context);
    const payload = await fetchJson(
      context,
      "Image generation",
      `${baseUrl}/images/generations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
        body: JSON.stringify({
          model: options.model,
          prompt: options.prompt,
          ...(options.size ? { size: options.size } : {}),
        }),
      },
      chatTimeoutMs,
    );

    const entries = (payload as { data?: Array<{ b64_json?: unknown; url?: unknown }> }).data ?? [];
    const images: AdapterImageResult["images"] = [];
    for (const entry of entries) {
      if (typeof entry.b64_json === "string" && entry.b64_json) {
        images.push({ base64: entry.b64_json, mimeType: "image/png" });
        continue;
      }
      if (typeof entry.url === "string" && entry.url) {
        const download = await fetch(entry.url, { cache: "no-store", signal: AbortSignal.timeout(catalogTimeoutMs) });
        if (download.ok) {
          const buffer = Buffer.from(await download.arrayBuffer());
          images.push({ base64: buffer.toString("base64"), mimeType: download.headers.get("content-type") ?? "image/png" });
        }
      }
    }
    if (images.length === 0) {
      throw new AppError("MODEL_UPSTREAM_NO_CONTENT", {
        status: 502,
        message: `${context.provider.name} returned no image data`,
        details: { providerId: context.provider.providerId, model: options.model },
      });
    }
    return { images };
  },

  /**
   * Speech-to-text over `/audio/transcriptions` - the wire shape Whisper, Groq's `whisper-large-v3`,
   * a self-hosted faster-whisper server and every compatible gateway speak.
   *
   * Two decisions are deliberate:
   *
   * - **It asks for `verbose_json` and falls back to `json` once.** `whisper-1` and Groq's models answer
   *   with segments, language and duration; the `gpt-4o-transcribe` family answers text only and refuses
   *   the richer format with a 400 that names `response_format`. That refusal is a fact about the engine,
   *   not a failure of the run, so it is retried once and reported as `responseFormat: "json"` - which is
   *   how "this engine gave no timestamps" is said without inventing a segment.
   * - **Only a refusal that names the field is followed.** Any other 400 (an unavailable model, a bad
   *   request) is rethrown exactly as it arrived, rather than being retried into a second, less
   *   informative error.
   *
   * An answer with no text at all is an upstream fault: an empty transcript is not a transcription, and
   * this layer must not hand one back as if it were.
   */
  async transcribe(context, options) {
    const baseUrl = requireBaseUrl(context);
    const credential = requireCredential(context);
    const url = `${baseUrl}/audio/transcriptions`;

    const send = async (responseFormat: "verbose_json" | "json") => {
      const form = new FormData();
      // `FormData` wants a view over a plain `ArrayBuffer`, and the request's bytes are a `Uint8Array`
      // over whatever the caller had. One explicit copy makes the two agree without the caller's buffer
      // ever being detached.
      const fileBytes = new Uint8Array(options.audio.bytes.byteLength);
      fileBytes.set(options.audio.bytes);
      form.append("file", new Blob([fileBytes], { type: options.audio.mimeType }), options.audio.name);
      form.append("model", options.model);
      form.append("response_format", responseFormat);
      const language = primaryLanguageSubtag(options.language);
      if (language) form.append("language", language);
      if (options.prompt) form.append("prompt", options.prompt);
      return fetchJson(
        context,
        `Transcription (${responseFormat})`,
        url,
        { method: "POST", headers: { Authorization: `Bearer ${credential}` }, body: form },
        transcriptionTimeoutMs,
      );
    };

    let payload: unknown;
    let responseFormat: "verbose_json" | "json" = "verbose_json";
    try {
      payload = await send("verbose_json");
    } catch (error) {
      if (!isResponseFormatRefusal(error)) throw error;
      responseFormat = "json";
      payload = await send("json");
    }

    const result = parseTranscriptionPayload(payload, responseFormat);
    if (!result.text) {
      throw new AppError("MODEL_UPSTREAM_NO_CONTENT", {
        status: 502,
        message: `${context.provider.name} returned no transcript`,
        details: { providerId: context.provider.providerId, model: options.model },
      });
    }
    return result;
  },
};

/** Base URL of the Gemini REST API, tolerating both `/v1beta` and bare hosts. */
function geminiApiRoot(baseUrl: string) {
  const root = trimBaseUrl(baseUrl);
  return root.endsWith("/v1beta") || root.endsWith("/v1") ? root : `${root}/v1beta`;
}

function geminiPart(message: ChatRequest["messages"][number]) {
  return [
    ...(message.content ? [{ text: message.content }] : []),
    ...(message.images ?? []).map((image) => {
      const match = /^data:([^;]+);base64,(.*)$/i.exec(image);
      if (match) {
        return { inlineData: { mimeType: match[1], data: match[2] } };
      }
      if (/^https?:\/\//i.test(image)) {
        return { fileData: { fileUri: image } };
      }
      return { inlineData: { mimeType: "image/png", data: image } };
    }),
  ];
}

function geminiUsage(payload: unknown) {
  const usage = (
    payload as { usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; totalTokenCount?: unknown } }
  )?.usageMetadata;
  if (!usage) return undefined;
  return normalizeUsage({
    input: usage.promptTokenCount,
    output: usage.candidatesTokenCount,
    total: usage.totalTokenCount,
  });
}

export const geminiAdapter: ProtocolAdapter = {
  protocol: "gemini",

  async listModels(context) {
    const credential = requireCredential(context);
    const url = new URL(`${geminiApiRoot(requireBaseUrl(context))}/models`);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("key", credential);
    const payload = await fetchJson(context, "Gemini model list", url.toString(), {}, catalogTimeoutMs);
    return normalizeGeminiCatalog(payload);
  },

  async chat(context, options) {
    const credential = requireCredential(context);
    const systemMessages = [
      ...(options.systemPrompt ? [options.systemPrompt] : []),
      ...options.messages.filter((message) => message.role === "system").map((message) => message.content),
    ];
    const payload = await fetchJson(
      context,
      "Gemini generateContent",
      `${geminiApiRoot(requireBaseUrl(context))}/models/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(credential)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: options.messages
            .filter((message) => message.role !== "system")
            .map((message) => ({
              role: message.role === "assistant" ? "model" : "user",
              parts: geminiPart(message),
            })),
          ...(systemMessages.length > 0 ? { systemInstruction: { parts: [{ text: systemMessages.join("\n\n") }] } } : {}),
          ...(options.json ? { generationConfig: { responseMimeType: "application/json" } } : {}),
          ...(options.tools?.length
            ? {
                tools: [
                  {
                    functionDeclarations: options.tools.map((tool) => ({
                      name: tool.name,
                      ...(tool.description ? { description: tool.description } : {}),
                      parameters: tool.parameters ?? { type: "object", properties: {} },
                    })),
                  },
                ],
              }
            : {}),
        }),
      },
      chatTimeoutMs,
    );

    const parts =
      (
        payload as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string; thought?: boolean; functionCall?: { name?: string; args?: unknown } }> };
          }>;
        }
      )?.candidates?.[0]?.content?.parts ?? [];

    const text = parts
      .filter((part) => !part.thought && typeof part.text === "string" && part.text.trim())
      .map((part) => part.text?.trim() ?? "")
      .join("\n")
      .trim();
    const toolCalls: ChatToolCall[] = parts.flatMap((part, index) => {
      const name = part.functionCall?.name;
      if (!name) return [];
      return [{ id: `${name}-${index}`, name, arguments: JSON.stringify(part.functionCall?.args ?? {}) }];
    });

    if (!text && toolCalls.length === 0) {
      throw new AppError("MODEL_UPSTREAM_NO_CONTENT", {
        status: 502,
        message: "Gemini returned no text",
        details: { providerId: context.provider.providerId, model: options.model },
      });
    }
    return { text, toolCalls, usage: geminiUsage(payload) };
  },

  async generateImage(context, options) {
    const credential = requireCredential(context);
    const payload = await fetchJson(
      context,
      "Gemini image generation",
      `${geminiApiRoot(requireBaseUrl(context))}/models/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(credential)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: options.prompt }] }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
        }),
      },
      chatTimeoutMs,
    );

    const parts =
      (
        payload as {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                inlineData?: { data?: unknown; mimeType?: unknown };
                inline_data?: { data?: unknown; mime_type?: unknown };
              }>;
            };
          }>;
        }
      )?.candidates?.[0]?.content?.parts ?? [];

    const images: AdapterImageResult["images"] = [];
    for (const part of parts) {
      const inline = part.inlineData ?? part.inline_data;
      if (typeof inline?.data !== "string" || !inline.data) continue;
      const mimeType = String(
        (inline as { mimeType?: unknown }).mimeType ?? (inline as { mime_type?: unknown }).mime_type ?? "image/png",
      );
      images.push({ base64: inline.data, mimeType });
    }
    if (images.length === 0) {
      throw new AppError("MODEL_UPSTREAM_NO_CONTENT", {
        status: 502,
        message: "Gemini returned no image data",
        details: { providerId: context.provider.providerId, model: options.model },
      });
    }
    return { images };
  },
};

/**
 * Protocol → adapter. Adding a vendor that speaks an existing protocol needs no code
 * here; adding a *protocol* (Anthropic) means adding one entry and its normalizer.
 */
const protocolAdapters: Partial<Record<ModelProtocol, ProtocolAdapter>> = {
  "openai-compatible": openAICompatibleAdapter,
  gemini: geminiAdapter,
};

export const implementedProtocols = Object.keys(protocolAdapters) as ModelProtocol[];

export function isProtocolImplemented(protocol: ModelProtocol) {
  return Boolean(protocolAdapters[protocol]);
}

export function adapterFor(protocol: ModelProtocol): ProtocolAdapter {
  const adapter = protocolAdapters[protocol];
  if (!adapter) {
    throw new AppError("MODEL_PROTOCOL_UNSUPPORTED", {
      status: 400,
      message: `No adapter implements the ${protocol} protocol yet`,
      details: { protocol, implemented: implementedProtocols },
    });
  }
  return adapter;
}
