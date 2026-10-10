import { z } from "zod";
import { AppError } from "@/lib/app-errors";
import { adapterFor, type AdapterContext } from "./adapters";
import {
  requirementForIntent,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type ImageGenerationRequest,
  type ImageGenerationResponse,
  type ModelAttempt,
  type ModelAttemptKind,
  type ModelCandidate,
  type ModelCapability,
  type ModelIntent,
  type ModelRequirement,
  type ModelRoute,
  type TokenUsage,
  type TranscriptionRequest,
  type TranscriptionResponse,
} from "./contracts";
import { isFatalModelError, runWithCredentialKey } from "./key-pool";
import { resolveRoute, type RouteResolution } from "./registry";
import { attachModelAttempts, modelAttemptsFrom } from "./trail";

/**
 * `aiRuntime` - the only entry point the rest of the app uses for model calls.
 * Providers, protocols, endpoints and keys are resolved here; callers describe *what*
 * they need (a capability or an intent), never *which vendor* to use.
 *
 * Two layers of resilience, both visible in the response:
 *   1. key rotation inside one model (`credentialLabel` + `attempts`),
 *   2. model failover across the resolver's ranked candidates - only when the caller did
 *      not pin a model or provider, so an explicit choice is never silently downgraded.
 */

/** How many candidate models one call may burn before giving up. */
const maxCandidateAttempts = 3;

function chatRequirements(request: ChatRequest): ModelRequirement[] {
  const required = new Set<ModelCapability>([request.capability ?? "chat"]);
  if (request.json) required.add("structured_output");
  if (request.tools?.length) required.add("tool_calling");
  if (request.messages.some((message) => (message.images?.length ?? 0) > 0)) required.add("vision");
  const capabilities = Array.from(required);

  const strict: ModelRequirement = {
    capabilities,
    capability: request.capability ?? "chat",
    model: request.model,
    providerId: request.providerId,
    preferProviderId: request.preferProviderId,
  };

  // Fallback: keep only the entry capability. A model without JSON mode can still
  // answer, and `route.requirement` tells the caller what was actually enforced.
  const entry: ModelRequirement = {
    capabilities: [request.capability ?? "chat"],
    capability: request.capability ?? "chat",
    model: request.model,
    providerId: request.providerId,
    preferProviderId: request.preferProviderId,
  };
  if (capabilities.length <= 1) {
    return [strict];
  }
  return [strict, entry];
}

async function firstResolvable(requirements: ModelRequirement[]): Promise<RouteResolution> {
  let last: RouteResolution | null = null;
  for (const requirement of requirements) {
    const resolution = await resolveRoute(requirement);
    if (resolution.candidate) {
      return resolution;
    }
    last = resolution;
  }
  return last as RouteResolution;
}

function unavailableError(resolution: RouteResolution): AppError {
  const reason = resolution.explanation?.reason ?? "no-models-synced";
  const missing = resolution.explanation?.missing ?? [];
  const details = { reason, missing, requirement: resolution.requirement };
  if (reason === "credential-missing") {
    return new AppError("MODEL_CREDENTIAL_MISSING", {
      status: 400,
      message: "No configured model has a usable credential for this request",
      details,
    });
  }
  if (reason === "capability-missing" || reason === "context-window-too-small") {
    return new AppError("MODEL_CAPABILITY_UNAVAILABLE", {
      status: 409,
      message:
        missing.length > 0 ? `No usable model provides: ${missing.join(", ")}` : "No usable model matches the request",
      details,
    });
  }
  return new AppError("MODEL_NOT_CONFIGURED", {
    status: 503,
    message: "No model is configured for this request",
    details,
  });
}

function toContext(candidate: ModelCandidate, credential: string | null): AdapterContext {
  return { provider: candidate.provider, endpoint: candidate.endpoint, credential };
}

function toRoute(resolution: RouteResolution, candidate: ModelCandidate): ModelRoute {
  return {
    reason: resolution.reason,
    providerId: candidate.provider.providerId,
    endpointId: candidate.endpoint.endpointId,
    modelRowId: candidate.model.id,
    modelId: candidate.model.modelId,
    protocol: candidate.endpoint.protocol,
    alternatives: resolution.candidates.slice(1, 6).map((entry) => entry.model.modelId),
    requirement: resolution.requirement,
  };
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : "unknown error").slice(0, 300);
}

/**
 * The candidate models this call may use, in the resolver's order. A pinned model or
 * provider yields exactly one candidate, so an explicit choice is never downgraded.
 */
function candidateChain(pin: { model?: string; providerId?: string }, resolution: RouteResolution): ModelCandidate[] {
  if (pin.model || pin.providerId) {
    return resolution.candidates.slice(0, 1);
  }
  return resolution.candidates.slice(0, maxCandidateAttempts);
}

/**
 * One model call with key rotation. Every key-level failure is appended to `attempts`
 * before the pool moves on, so the caller can see which key was rejected and why.
 *
 * `kind` travels with the request so a re-ask (a self-correction) is distinguishable from the
 * original question even when it is the *keys* of that second request that fail.
 */
async function callCandidate<T>(
  candidate: ModelCandidate,
  attempts: ModelAttempt[],
  kind: ModelAttemptKind,
  force: boolean | undefined,
  run: (context: AdapterContext) => Promise<T>,
): Promise<{ value: T; keyLabel: string }> {
  const before = attempts.length;
  try {
    return await runWithCredentialKey(
      {
        ref: candidate.credentialRef,
        providerId: candidate.provider.providerId,
        force,
        onKeyFailure: ({ keyLabel, error }) => {
          attempts.push({
            kind,
            outcome: "failed",
            providerId: candidate.provider.providerId,
            modelId: candidate.model.modelId,
            endpointId: candidate.endpoint.endpointId,
            credentialLabel: keyLabel,
            error: errorMessage(error),
          });
        },
      },
      (secret) => run(toContext(candidate, secret)),
    );
  } catch (error) {
    // The pool reported no key-level failure (or no key was configured at all), so which key - if
    // any - signed this request is not knowable here: `throw error` above never names it. The
    // attempt is recorded anyway, because it happened; the empty label says "unattributed", and
    // the ledger keeps its cost NULL rather than reading that as "not billed".
    if (attempts.length === before) {
      attempts.push({
        kind,
        outcome: "failed",
        providerId: candidate.provider.providerId,
        modelId: candidate.model.modelId,
        endpointId: candidate.endpoint.endpointId,
        credentialLabel: "",
        error: errorMessage(error),
      });
    }
    throw error;
  }
}

/**
 * The request that produced the answer, appended to the same trail as the ones that did not.
 *
 * Leaving it out is what made `attempts` a list of failures: a caller could see which key was
 * rejected and not which request was billed, so the ledger could not write a row for the call the
 * user actually paid for.
 */
function winningAttempt(
  candidate: ModelCandidate,
  keyLabel: string,
  usage: TokenUsage | undefined,
  kind: ModelAttemptKind = "answer",
): ModelAttempt {
  return {
    kind,
    outcome: "success",
    providerId: candidate.provider.providerId,
    modelId: candidate.model.modelId,
    endpointId: candidate.endpoint.endpointId,
    credentialLabel: keyLabel,
    error: "",
    ...(usage ? { usage } : {}),
  };
}

/** A model call. The trail's requests are `answer`s: one question, however many times it is sent. */
export async function chat(request: ChatRequest): Promise<ChatResponse> {
  return chatWithKind(request, "answer");
}

/**
 * `chat` with the trail's `kind` under the caller's control, so `chatStructured` can mark the
 * requests of its second pass as the self-correction they are. Nothing else passes `answer`.
 */
async function chatWithKind(request: ChatRequest, kind: ModelAttemptKind): Promise<ChatResponse> {
  const resolution = await firstResolvable(chatRequirements(request));
  const chain = resolution.candidate ? candidateChain(request, resolution) : [];
  if (chain.length === 0) {
    throw unavailableError(resolution);
  }

  const attempts: ModelAttempt[] = [];
  let lastError: unknown = null;

  for (const candidate of chain) {
    const adapter = adapterFor(candidate.endpoint.protocol);
    try {
      const { value, keyLabel } = await callCandidate(
        candidate,
        attempts,
        kind,
        request.forceUnhealthyCredential,
        (context) =>
          adapter.chat(context, {
            model: candidate.model.modelId,
            messages: request.messages,
            temperature: request.temperature,
            maxTokens: request.maxTokens,
            json: request.json,
            tools: request.tools,
            systemPrompt: request.systemPrompt,
          }),
      );
      attempts.push(winningAttempt(candidate, keyLabel, value.usage, kind));
      return {
        text: value.text,
        toolCalls: value.toolCalls,
        model: candidate.model.modelId,
        providerId: candidate.provider.providerId,
        credentialLabel: keyLabel,
        attempts,
        usage: value.usage,
        route: toRoute(resolution, candidate),
      } satisfies ChatResponse;
    } catch (error) {
      lastError = error;
      // A rejected request shape repeats verbatim on the next model: stop instead of
      // spending the whole candidate chain on the same 400. The trail goes with the error: those
      // requests were sent, and one of them may have been billed before it was rejected.
      if (isFatalModelError(error)) {
        throw attachModelAttempts(error, attempts);
      }
    }
  }

  throw attachModelAttempts(lastError ?? unavailableError(resolution), attempts);
}

/** Same as `chat`, but the requirement comes from an intent (`intentRequirements`). */
export async function chatForIntent(
  intent: ModelIntent,
  request: Omit<ChatRequest, "capability">,
): Promise<ChatResponse> {
  const requirement = requirementForIntent(intent, { model: request.model, providerId: request.providerId });
  return chat({ ...request, capability: requirement.capability });
}

export async function generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  const resolution = await resolveRoute(
    requirementForIntent("image-generation", { model: request.model, providerId: request.providerId }),
  );
  const chain = resolution.candidate ? candidateChain(request, resolution) : [];
  if (chain.length === 0) {
    throw unavailableError(resolution);
  }

  const attempts: ModelAttempt[] = [];
  let lastError: unknown = null;

  for (const candidate of chain) {
    const adapter = adapterFor(candidate.endpoint.protocol);
    if (!adapter.generateImage) {
      throw attachModelAttempts(
        new AppError("MODEL_CAPABILITY_UNAVAILABLE", {
          status: 409,
          message: `The ${candidate.endpoint.protocol} adapter cannot generate images yet`,
          details: { providerId: candidate.provider.providerId, model: candidate.model.modelId },
        }),
        attempts,
      );
    }
    const generate = adapter.generateImage.bind(adapter);
    try {
      const { value, keyLabel } = await callCandidate(
        candidate,
        attempts,
        "answer",
        request.forceUnhealthyCredential,
        (context) => generate(context, { model: candidate.model.modelId, prompt: request.prompt, size: request.size }),
      );
      // An image model reports no token usage, so the winning request carries none: the ledger
      // records the call and its count, and its cost stays NULL rather than a made-up zero.
      attempts.push(winningAttempt(candidate, keyLabel, undefined));
      return {
        images: value.images,
        model: candidate.model.modelId,
        providerId: candidate.provider.providerId,
        credentialLabel: keyLabel,
        attempts,
        route: toRoute(resolution, candidate),
      } satisfies ImageGenerationResponse;
    } catch (error) {
      lastError = error;
      if (isFatalModelError(error)) {
        throw attachModelAttempts(error, attempts);
      }
    }
  }

  throw attachModelAttempts(lastError ?? unavailableError(resolution), attempts);
}

/**
 * Speech to text (CI-P3-02), resolved the same way every other call is: the caller says *what* it wants
 * recognised and the runtime decides which capability-resolved model and which key signs the request.
 *
 * `transcription` is already the intent a `speech_to_text` model satisfies (`intentRequirements`), so
 * nothing new is invented here: this is `generateImage`'s shape - resolve, walk the candidate chain,
 * rotate keys, report the trail. Two consequences worth naming, because they are the point of routing
 * through the runtime instead of calling a vendor:
 *
 * - **A pinned provider or model is never downgraded** (the chain shortens to one), and an unpinned call
 *   may fail over to another capable model, with every failed attempt in `attempts`.
 * - **"Nothing is configured" is a specific error, not a 500.** With no STT credential the runtime
 *   answers `MODEL_CREDENTIAL_MISSING` (or `MODEL_CAPABILITY_UNAVAILABLE` when no model claims the
 *   capability at all) and the caller can say exactly what to fix - which is what makes a transcript
 *   request fail honestly instead of producing an empty one.
 */
export async function transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
  const resolution = await resolveRoute(
    requirementForIntent("transcription", {
      model: request.model,
      providerId: request.providerId,
      preferProviderId: request.preferProviderId,
    }),
  );
  const chain = resolution.candidate ? candidateChain(request, resolution) : [];
  if (chain.length === 0) {
    throw unavailableError(resolution);
  }

  const attempts: ModelAttempt[] = [];
  let lastError: unknown = null;

  for (const candidate of chain) {
    const adapter = adapterFor(candidate.endpoint.protocol);
    if (!adapter.transcribe) {
      throw attachModelAttempts(
        new AppError("MODEL_CAPABILITY_UNAVAILABLE", {
          status: 409,
          message: `The ${candidate.endpoint.protocol} adapter cannot transcribe speech yet`,
          details: { providerId: candidate.provider.providerId, model: candidate.model.modelId },
        }),
        attempts,
      );
    }
    const recognize = adapter.transcribe.bind(adapter);
    try {
      const { value, keyLabel } = await callCandidate(
        candidate,
        attempts,
        "answer",
        request.forceUnhealthyCredential,
        (context) =>
          recognize(context, {
            model: candidate.model.modelId,
            audio: request.audio,
            language: request.language,
            prompt: request.prompt,
          }),
      );
      // Speech recognition reports no token usage either; see `generateImage`.
      attempts.push(winningAttempt(candidate, keyLabel, undefined));
      return {
        text: value.text,
        segments: value.segments,
        language: value.language,
        durationMs: value.durationMs,
        responseFormat: value.responseFormat,
        model: candidate.model.modelId,
        providerId: candidate.provider.providerId,
        credentialLabel: keyLabel,
        attempts,
        route: toRoute(resolution, candidate),
      } satisfies TranscriptionResponse;
    } catch (error) {
      lastError = error;
      if (isFatalModelError(error)) {
        throw attachModelAttempts(error, attempts);
      }
    }
  }

  throw attachModelAttempts(lastError ?? unavailableError(resolution), attempts);
}

/**
 * Structured output, the runtime way (G5): the same contract the legacy
 * `generateStructured` offered - JSON-schema instruction, validation, one corrective retry,
 * merged usage - but routed through the router/registry/key pool like every other call.
 *
 * The schema is not sent as a tool definition; it is embedded in the prompt exactly like
 * before, so a model that merely understands instructions still works.
 */
export type StructuredChatRequest<T extends z.ZodType> = Omit<ChatRequest, "json"> & {
  schema: T;
};

export type StructuredChatResponse<T extends z.ZodType> = {
  data: z.infer<T>;
  text: string;
  providerId: string;
  model: string;
  credentialLabel: string;
  /**
   * Both requests' figures added up, for a caller that only wants to show one total. The split
   * lives in `attempts`, one entry per request - which is exactly what this single number cannot
   * express, and why a re-ask used to look free.
   */
  usage?: TokenUsage;
  route: ModelRoute;
  /**
   * Every request this call sent, in order. A `retried` call carries two entries with
   * `outcome: "success"` - the first `answer` and then the `self-correction` - because both were
   * really sent and both were really billed (CI-P7-01-04).
   */
  attempts: ModelAttempt[];
  /** True when the first answer failed validation and the retry produced this one. */
  retried: boolean;
};

const structuredInstruction = [
  "Return ONLY a single valid JSON object that conforms to the JSON schema below.",
  "Do not include markdown code fences, comments, or any text outside the JSON object.",
].join("\n");

function mergeUsage(first?: TokenUsage, second?: TokenUsage): TokenUsage | undefined {
  if (!first) return second;
  if (!second) return first;
  return {
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    totalTokens: first.totalTokens + second.totalTokens,
  };
}

type StructuredParse<T extends z.ZodType> = { ok: true; data: z.infer<T> } | { ok: false; error: string };

/**
 * The self-correcting re-ask, which is the one place a *second* request exists for a reason of its
 * own (CI-P7-01-04). Its trail entries are marked `self-correction`, and the first answer's trail is
 * folded into any error this leg throws: that request was already sent and already billed, so losing
 * it here would delete real money from the ledger.
 */
async function askAgain<T extends z.ZodType>(
  request: StructuredChatRequest<T>,
  messages: ChatMessage[],
  firstAttempts: ModelAttempt[],
): Promise<ChatResponse> {
  try {
    return await chatWithKind({ ...request, messages, json: true }, "self-correction");
  } catch (error) {
    throw attachModelAttempts(error, [...firstAttempts, ...modelAttemptsFrom(error)]);
  }
}

function parseStructured<T extends z.ZodType>(schema: T, raw: string): StructuredParse<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${(error as Error).message}` };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; "),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Instruction goes into the last user turn, which is how the legacy prompt was shaped. */
function withInstruction(messages: ChatMessage[], instruction: string): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "user") {
    return [...messages.slice(0, -1), { ...last, content: `${last.content}\n\n${instruction}` }];
  }
  return [...messages, { role: "user", content: instruction }];
}

export async function chatStructured<T extends z.ZodType>(
  request: StructuredChatRequest<T>,
): Promise<StructuredChatResponse<T>> {
  const instruction = [structuredInstruction, `JSON schema: ${JSON.stringify(z.toJSONSchema(request.schema))}`].join("\n");
  const firstMessages = withInstruction(request.messages, instruction);
  const first = await chat({ ...request, messages: firstMessages, json: true });
  const firstParse = parseStructured(request.schema, first.text);
  if (firstParse.ok) {
    return {
      data: firstParse.data,
      text: first.text,
      providerId: first.providerId,
      model: first.model,
      credentialLabel: first.credentialLabel,
      usage: first.usage,
      route: first.route,
      attempts: first.attempts,
      retried: false,
    };
  }

  const retryMessages: ChatMessage[] = [
    ...firstMessages,
    { role: "assistant", content: first.text },
    {
      role: "user",
      content: [
        `Your previous reply could not be used (${firstParse.error}).`,
        "Reply again with ONLY the corrected JSON object and nothing else.",
      ].join("\n"),
    },
  ];
  const second = await askAgain(request, retryMessages, first.attempts);
  const secondParse = parseStructured(request.schema, second.text);
  if (!secondParse.ok) {
    // Two requests really went out and really cost money, and neither produced a usable answer.
    // The ledger gets both rows from this trail instead of the zero it used to get.
    throw attachModelAttempts(
      new AppError("AI_STRUCTURED_OUTPUT_INVALID", {
        status: 502,
        message: `Structured output validation failed: ${secondParse.error}`,
        details: {
          providerId: second.providerId,
          model: second.model,
          firstError: firstParse.error,
          secondError: secondParse.error,
        },
      }),
      [...first.attempts, ...second.attempts],
    );
  }

  return {
    data: secondParse.data,
    text: second.text,
    providerId: second.providerId,
    model: second.model,
    credentialLabel: second.credentialLabel,
    usage: mergeUsage(first.usage, second.usage),
    route: second.route,
    // A retry may legitimately answer from another model/key; both trails are reported.
    attempts: [...first.attempts, ...second.attempts],
    retried: true,
  };
}

/**
 * The runtime as a single object, for call sites that want it to read like "ask the runtime":
 * `aiRuntime.chat(...)`, `aiRuntime.chatStructured(...)`, `aiRuntime.generateImage(...)`.
 * Same functions as the individual exports - this is only the front door.
 */
export const aiRuntime = {
  chat,
  chatForIntent,
  chatStructured,
  generateImage,
  transcribe,
} as const;

