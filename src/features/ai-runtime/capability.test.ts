import { describe, expect, it } from "vitest";
import {
  detectCapabilities,
  explainRequirement,
  mergeCapabilityRecords,
  modelTypeForCapabilities,
  missingCapabilities,
} from "./capability";
import type { CapabilityRecord, ModelRecord } from "./contracts";

function model(partial: Partial<ModelRecord> & { capabilities: CapabilityRecord[] }): ModelRecord {
  return {
    id: partial.id ?? "provider/endpoint:model",
    providerId: partial.providerId ?? "provider",
    endpointId: partial.endpointId ?? "provider/default",
    modelId: partial.modelId ?? "model",
    displayName: partial.displayName ?? partial.modelId ?? "model",
    modelType: partial.modelType ?? modelTypeForCapabilities(partial.capabilities),
    contextWindow: partial.contextWindow ?? null,
    enabled: partial.enabled ?? true,
    source: partial.source ?? "sync",
    syncedAt: partial.syncedAt ?? null,
    capabilities: partial.capabilities,
    createdAt: 0,
    updatedAt: 0,
  };
}

const capability = (entry: CapabilityRecord["capability"], source: CapabilityRecord["source"] = "MODEL_CATALOG", confidence = 0.5): CapabilityRecord => ({
  capability: entry,
  supported: true,
  source,
  confidence,
});

describe("capability detection", () => {
  it("classifies by family and keeps the confidence below certainty", () => {
    expect(detectCapabilities("qwen-vl-max")[0]).toEqual({
      capability: "chat",
      supported: true,
      source: "MODEL_CATALOG",
      confidence: 0.6,
    });
    expect(detectCapabilities("kling-v2").map((entry) => entry.capability)).toEqual(["video_generation"]);
    expect(detectCapabilities("bge-reranker-v2").map((entry) => entry.capability)).toEqual(["rerank"]);
    expect(detectCapabilities("totally-unknown-model")).toEqual([]);
  });

  it("lets the highest priority source win per capability", () => {
    const merged = mergeCapabilityRecords(
      [capability("chat", "MODEL_CATALOG", 0.9)],
      [capability("chat", "PROVIDER_METADATA", 0.5)],
      [capability("chat", "PROBE_TEST", 1)],
      [capability("chat", "USER_OVERRIDE", 1)],
    );
    expect(merged).toEqual([capability("chat", "USER_OVERRIDE", 1)]);
  });

  it("derives the coarse model type from the strongest capability family", () => {
    expect(modelTypeForCapabilities([capability("chat"), capability("image_generation")])).toBe("image");
    expect(modelTypeForCapabilities([capability("chat"), capability("reasoning")])).toBe("reasoning");
    expect(modelTypeForCapabilities([capability("embedding")])).toBe("embedding");
    expect(modelTypeForCapabilities([])).toBe("unknown");
  });

  it("reports the missing capability for a model that almost matches", () => {
    const candidate = model({ capabilities: [capability("chat")] });
    expect(missingCapabilities(candidate, { capabilities: ["chat", "vision"] })).toEqual(["vision"]);
  });
});

describe("requirement explanation", () => {
  it("says nothing is synced when the registry is empty", () => {
    expect(explainRequirement({ capabilities: ["chat"] }, [])).toEqual({ reason: "no-models-synced", missing: ["chat"] });
  });

  it("names the capability that no model provides", () => {
    const explanation = explainRequirement({ capabilities: ["chat", "video_generation"] }, [
      model({ capabilities: [capability("chat")] }),
    ]);
    expect(explanation.reason).toBe("capability-missing");
    expect(explanation.missing).toEqual(["video_generation"]);
  });

  it("blames the credential when the capability exists but nothing can be called", () => {
    expect(explainRequirement({ capabilities: ["chat"] }, [model({ capabilities: [capability("chat")] })])).toEqual({
      reason: "credential-missing",
      missing: [],
    });
  });
});
