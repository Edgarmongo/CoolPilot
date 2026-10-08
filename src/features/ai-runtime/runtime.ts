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
  type ModelCandidate,
  type ModelCapability,
  type ModelIntent,
  type ModelRequirement,
  type ModelRoute,
  type TokenUsage,
} from "./contracts";
import { isFatalModelError, runWithCredentialKey } from "./key-pool";
import { resolveRoute, type RouteResolution } from "./registry";

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
 */
async function callCandidate<T>(
  candidate: ModelCandidate,
  attempts: ModelAttempt[],
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
            providerId: candidate.provider.providerId,
            modelId: candidate.model.modelId,
            credentialLabel: keyLabel,
            error: errorMessage(error),
          });
        },
      },
      (secret) => run(toContext(candidate, secret)),
    );
  } catch (error) {
    // No key ever signed the call (none configured, or every key was skipped): record the
    // model-level reason so the trail is complete either way.
    if (attempts.length === before) {
      attempts.push({
        providerId: candidate.provider.providerId,
        modelId: candidate.model.modelId,
        credentialLabel: "",
        error: errorMessage(error),
      });
    }
    throw error;
  }
}

export async function chat(request: ChatRequest): Promise<ChatResponse> {
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
      // spending the whole candidate chain on the same 400.
      if (isFatalModelError(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? unavailableError(resolution);
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
      throw new AppError("MODEL_CAPABILITY_UNAVAILABLE", {
        status: 409,
        message: `The ${candidate.endpoint.protocol} adapter cannot generate images yet`,
        details: { providerId: candidate.provider.providerId, model: candidate.model.modelId },
      });
    }
    const generate = adapter.generateImage.bind(adapter);
    try {
      const { value, keyLabel } = await callCandidate(
        candidate,
        attempts,
        request.forceUnhealthyCredential,
        (context) => generate(context, { model: candidate.model.modelId, prompt: request.prompt, size: request.size }),
      );
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
        throw error;
      }
    }
  }

  throw lastError ?? unavailableError(resolution);
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
  usage?: TokenUsage;
  route: ModelRoute;
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
  const second = await chat({ ...request, messages: retryMessages, json: true });
  const secondParse = parseStructured(request.schema, second.text);
  if (!secondParse.ok) {
    throw new AppError("AI_STRUCTURED_OUTPUT_INVALID", {
      status: 502,
      message: `Structured output validation failed: ${secondParse.error}`,
      details: {
        providerId: second.providerId,
        model: second.model,
        firstError: firstParse.error,
        secondError: secondParse.error,
      },
    });
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
} as const;

