import { describe, expect, it } from "vitest";
import {
  buildGatewayVendorGroups,
  classifyGatewayCapability,
  classifyGatewayVendor,
  countGatewayModelsByCapability,
  gatewayVendors,
} from "./model-gateway-catalog";
import {
  modelGatewayModels,
  modelGatewaySnapshotCapturedAt,
  modelGatewaySnapshotSource,
} from "./model-gateway-snapshot";

describe("model gateway snapshot", () => {
  it("holds unique, non-empty model ids with import metadata", () => {
    expect(modelGatewayModels.length).toBeGreaterThan(100);
    expect(new Set(modelGatewayModels).size).toBe(modelGatewayModels.length);
    expect(modelGatewayModels.every((model) => model.trim() === model && model.length > 0)).toBe(true);
    expect(modelGatewaySnapshotCapturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(modelGatewaySnapshotSource.trim().length).toBeGreaterThan(0);
  });
});

describe("model gateway catalog", () => {
  it("assigns every model to exactly one vendor and one capability", () => {
    const groups = buildGatewayVendorGroups();
    const assigned = groups.flatMap((group) => group.capabilityGroups.flatMap((entry) => entry.models));
    expect(assigned.length).toBe(modelGatewayModels.length);
    expect(new Set(assigned).size).toBe(modelGatewayModels.length);
    for (const group of groups) {
      const counted = group.capabilityGroups.reduce((total, entry) => total + entry.models.length, 0);
      expect(group.total, `${group.id} total mismatch`).toBe(counted);
    }
    const capabilityCounts = countGatewayModelsByCapability();
    expect(Object.values(capabilityCounts).reduce((total, count) => total + count, 0)).toBe(modelGatewayModels.length);
  });

  it("orders vendors by total and covers the known families", () => {
    const groups = buildGatewayVendorGroups();
    expect(groups.length).toBeGreaterThan(10);
    expect(groups.map((group) => group.total)).toEqual([...groups.map((group) => group.total)].sort((a, b) => b - a));
    const byId = new Map(groups.map((group) => [group.id, group]));
    for (const id of ["openai", "anthropic", "google", "qwen", "zhipu", "deepseek", "doubao", "xai", "llama", "midjourney", "xinghuo"]) {
      expect(byId.get(id)?.total ?? 0, `${id} has no models`).toBeGreaterThan(0);
    }
  });

  it("falls back to the catch-all vendor instead of dropping models", () => {
    const fallback = gatewayVendors[gatewayVendors.length - 1];
    expect(fallback.id).toBe("other");
    expect(classifyGatewayVendor("unknown-vendor-model-1.0").id).toBe("other");
  });

  it("classifies representative models", () => {
    expect(classifyGatewayVendor("claude-opus-4-5-20251101").id).toBe("anthropic");
    expect(classifyGatewayVendor("doubao-seed-1-6-251015").id).toBe("doubao");
    expect(classifyGatewayVendor("hy4-preview").id).toBe("hunyuan");
    expect(classifyGatewayVendor("aigc-video-hailuo").id).toBe("minimax");

    expect(classifyGatewayCapability("gpt-image-2")).toBe("image");
    expect(classifyGatewayCapability("text-embedding-3-large")).toBe("embedding");
    expect(classifyGatewayCapability("BAAI/bge-reranker-v2-m3")).toBe("embedding");
    expect(classifyGatewayCapability("mj_video")).toBe("video");
    expect(classifyGatewayCapability("kling-avatar-image2video")).toBe("video");
    expect(classifyGatewayCapability("qwen3-tts-flash")).toBe("audio");
    expect(classifyGatewayCapability("deepseek-r1")).toBe("reasoning");
    expect(classifyGatewayCapability("kimi-k2.7-code")).toBe("code");
    expect(classifyGatewayCapability("gemini-3-pro-preview")).toBe("chat");
  });
});
