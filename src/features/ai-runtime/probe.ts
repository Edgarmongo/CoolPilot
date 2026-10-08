import { AppError } from "@/lib/app-errors";
import { saveProbeRecord, setModelCapability } from "@/db/repositories/ai-runtime";
import { runWithCredentialKey } from "./key-pool";
import { adapterFor } from "./adapters";
import type { ChatMessage, ModelCapability, ModelProbeRecord } from "./contracts";
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

export async function probeModelCapability(input: {
  modelRowId: string;
  capability: ModelCapability;
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
  const startedAt = Date.now();

  let status: "ok" | "failed" = "ok";
  let message = "request accepted";
  try {
    // A probe is a diagnostic: it rotates across the credential's keys (so a rate-limited
    // key does not make a working model look broken) and reports the outcome back.
    await runWithCredentialKey(
      { ref: endpoint.credentialRef, providerId: provider.providerId, allowKeyless: true },
      (secret) =>
        adapter.chat(
          { provider, endpoint, credential: secret },
          {
            model: model.modelId,
            messages: probeMessages(input.capability),
            temperature: 0,
            maxTokens: 32,
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
  } catch (error) {
    status = "failed";
    message = (error instanceof Error ? error.message : "probe failed").slice(0, 300);
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
