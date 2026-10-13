import { AppError } from "@/lib/app-errors";
import { saveProbeRecord, setModelCapability } from "@/db/repositories/ai-runtime";
import { runWithCredentialKey } from "./key-pool";
import { adapterFor } from "./adapters";
import type { ChatMessage, ModelAttempt, ModelCapability, ModelProbeRecord } from "./contracts";
import { loadCallableModel } from "./registry";

/**
 * Layer 3 of capability detection: a real request that either works or does not.
 *
 * A probe only answers "did the endpoint accept this request shape and return usable
 * content?" - it never claims to measure quality. Results are written as `PROBE_TEST`
 * rows, which outrank both the vendor metadata and the name heuristics.
 */

/** Capabilities that one cheap request can actually test. */
export const probeableCapabilities: ModelCapability[] = ["chat", "vision", "tool_calling", "structured_output"];

/**
 * The reply ceiling every probe states (the `maxTokens` that goes on the wire). It is named so the
 * budget gate can hold this request's *own* ceiling: an estimate built from an unstated ceiling would
 * be the estimate of a different request (CI-P7-03).
 */
export const modelProbeMaxOutputTokens = 32;

/**
 * How one probe's provider request is metered (CI-P7-01-04 / CI-P7-03).
 *
 * A probe sends a real, billable request, and it used to be the one provider call path in this product
 * the ledger never saw and the budget gate never met. The wiring for that does not belong *here*: the
 * runtime executes and traces, it takes no budget hold and writes no ledger row (`runtime.ts` hands its
 * `attempts` to its caller for exactly that reason, and the gate and the recorder live in `src/lib`). So
 * the call layer that owns the user's money injects the three things this module cannot do for itself:
 *
 *  - `begin` is awaited **before anything is sent**, carrying the target this probe resolved and the text
 *    it will send (measured, then forgotten), and may refuse by throwing. A refusal therefore leaves no
 *    request, no `PROBE_TEST` mark, no probe record and no ledger row behind, and it is the caller's own
 *    402 rather than a probe result claiming the model failed;
 *  - the returned session's `record` receives the trail of the requests this probe really sent, in the
 *    runtime's own `ModelAttempt` shape - which is what the ledger needs to write one row per request;
 *  - `release` gives back whatever `begin` took, and runs in a `finally`.
 *
 * The hooks carry no new semantics: the call layer reuses the gate and the recorder, and neither hook
 * throws (a hold settles idempotently and the recorder swallows its own write failures). A caller that
 * passes no `metering` gets exactly the probe this module had before - which is what the probe's own
 * unmetered tests still do.
 */
export interface ModelProbeMetering {
  begin(target: ModelProbeTarget): Promise<ModelProbeMeteringSession>;
}

/** What one probe is about to send, as the metering layer has to see it *before* it goes out. */
export interface ModelProbeTarget {
  providerId: string;
  modelId: string;
  endpointId: string;
  /** The capability being probed - what this request needs the model to have. */
  capability: ModelCapability;
  /** The text the request will carry, so the estimate measures this request and not a nearby one. */
  inputText: string;
  /** The reply ceiling the request states; see {@link modelProbeMaxOutputTokens}. */
  maxOutputTokens: number;
}

/** One probe's metering: opened by `begin`, closed by `release` whatever happened. */
export interface ModelProbeMeteringSession {
  /** Every request this probe sent, oldest first. Sent once, when the request is over. */
  record(attempts: ModelAttempt[]): Promise<void>;
  /** Gives back what `begin` took. Called in a `finally`; never throws. */
  release(): Promise<void>;
}

/** 1x1 transparent PNG - enough to prove a model accepts image input. */
const onePixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function probeMessages(capability: ModelCapability): ChatMessage[] {
  if (capability === "vision") {
    return [{ role: "user", content: "Reply with the single word: ok", images: [onePixelPng] }];
  }
  if (capability === "structured_output") {
    return [{ role: "user", content: 'Reply with exactly {"ok":true}' }];
  }
  if (capability === "tool_calling") {
    return [{ role: "user", content: "Call the coolpilot_probe tool." }];
  }
  return [{ role: "user", content: "Reply with the single word: ok" }];
}

/**
 * The text of a probe request, as the budget estimate measures it: the instruction the request carries.
 * A vision probe's 1x1 PNG is bytes on the wire rather than text, so it is deliberately not counted as
 * tokens - what is measured here is what can be measured.
 */
function requestTextOf(messages: ChatMessage[]) {
  return messages.map((message) => message.content).join("\n");
}

/** The failure text a trail entry and the probe's own message both carry, cut to the column's length. */
function failureText(error: unknown) {
  return (error instanceof Error ? error.message : "probe failed").slice(0, 300);
}

export async function probeModelCapability(input: {
  modelRowId: string;
  capability: ModelCapability;
  /**
   * The call layer's budget gate and ledger, injected (see {@link ModelProbeMetering}). Absent = the
   * unmetered probe this module had before: nothing is held and nothing is recorded.
   */
  metering?: ModelProbeMetering;
}): Promise<ModelProbeRecord> {
  const resolved = await loadCallableModel(input.modelRowId);
  if (!resolved) {
    throw new AppError("MODEL_NOT_CONFIGURED", {
      status: 404,
      message: "Model or endpoint not found",
      details: { modelRowId: input.modelRowId },
    });
  }
  const { model, endpoint, provider } = resolved;
  const probedAt = Date.now();

  if (!probeableCapabilities.includes(input.capability)) {
    const record: ModelProbeRecord = {
      modelRowId: model.id,
      capability: input.capability,
      status: "unsupported",
      latencyMs: 0,
      message: `${input.capability} cannot be probed with a single text request`,
      probedAt,
    };
    await saveProbeRecord(record);
    return record;
  }

  const adapter = adapterFor(endpoint.protocol);
  const messages = probeMessages(input.capability);

  // CI-P7-03. The gate stands between the prompt and the request: it is asked *before* anything is
  // sent, with this probe's own target and this request's own ceiling, so a refusal is thrown from
  // here - out of this function, before a provider was asked - and it is the caller's 402 rather than a
  // probe result saying the model failed. CI-P7-01-04. The session it hands back is also where the
  // trail of the requests that *were* sent goes, one entry per request, because a request the provider
  // rejected may still have been billed for.
  const session = input.metering
    ? await input.metering.begin({
        providerId: provider.providerId,
        modelId: model.modelId,
        endpointId: endpoint.endpointId,
        capability: input.capability,
        inputText: requestTextOf(messages),
        maxOutputTokens: modelProbeMaxOutputTokens,
      })
    : null;

  const attempts: ModelAttempt[] = [];
  const startedAt = Date.now();

  let status: "ok" | "failed" = "ok";
  let message = "request accepted";
  try {
    // A probe is a diagnostic: it rotates across the credential's keys (so a rate-limited
    // key does not make a working model look broken) and reports the outcome back. Every request it
    // sent lands in the trail, the rejected keys first - the runtime's own accounting shape.
    const { value, keyLabel } = await runWithCredentialKey(
      {
        ref: endpoint.credentialRef,
        providerId: provider.providerId,
        allowKeyless: true,
        onKeyFailure: ({ keyLabel: rejectedKey, error }) => {
          attempts.push({
            kind: "answer",
            outcome: "failed",
            providerId: provider.providerId,
            modelId: model.modelId,
            endpointId: endpoint.endpointId,
            credentialLabel: rejectedKey,
            error: failureText(error),
          });
        },
      },
      (secret) =>
        adapter.chat(
          { provider, endpoint, credential: secret },
          {
            model: model.modelId,
            messages,
            temperature: 0,
            maxTokens: modelProbeMaxOutputTokens,
            json: input.capability === "structured_output",
            tools:
              input.capability === "tool_calling"
                ? [
                    {
                      name: "coolpilot_probe",
                      description: "Returns ok when called",
                      parameters: { type: "object", properties: {} },
                    },
                  ]
                : undefined,
          },
        ),
    );
    // The request that produced the answer, appended to the same trail as the ones that did not: what
    // *this* request reported is what the ledger prices, and a provider that reported nothing leaves
    // `usage` absent rather than zero.
    attempts.push({
      kind: "answer",
      outcome: "success",
      providerId: provider.providerId,
      modelId: model.modelId,
      endpointId: endpoint.endpointId,
      credentialLabel: keyLabel,
      error: "",
      ...(value.usage ? { usage: value.usage } : {}),
    });
  } catch (error) {
    status = "failed";
    message = failureText(error);
    // A request was sent, and the pool reported no key-level failure (or no key was configured at all),
    // so which key - if any - signed it is not knowable here. The entry is recorded anyway, because the
    // request happened; the empty label says "unattributed", and the ledger keeps its cost NULL rather
    // than reading that as "not billed".
    if (attempts.length === 0) {
      attempts.push({
        kind: "answer",
        outcome: "failed",
        providerId: provider.providerId,
        modelId: model.modelId,
        endpointId: endpoint.endpointId,
        credentialLabel: "",
        error: message,
      });
    }
  } finally {
    // The money first, then the hold: with the request over, the ledger row is the accounting and the
    // hold has nothing left to stand for (CI-P7-03-A). Neither call throws, so bookkeeping cannot take
    // the probe's own answer down with it.
    if (session) {
      await session.record(attempts);
      await session.release();
    }
  }

  const record: ModelProbeRecord = {
    modelRowId: model.id,
    capability: input.capability,
    status,
    latencyMs: Date.now() - startedAt,
    message,
    probedAt,
  };
  await setModelCapability({
    modelRowId: model.id,
    capability: input.capability,
    supported: status === "ok",
    source: "PROBE_TEST",
  });
  await saveProbeRecord(record);
  return record;
}
