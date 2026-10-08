import { describe, expect, it } from "vitest";
import { locales } from "@/lib/i18n-config";
import { localeResources } from "@/lib/locale-resources";
import {
  findMainstreamVendor,
  mainstreamCapabilityLabelKeys,
  mainstreamModelCapabilities,
  mainstreamProviderStatusLabelKeys,
  mainstreamVendorRegistry,
  normalizeEndpoint,
} from "./mainstream-model-catalog";
import { gatewayVendors } from "./model-gateway-catalog";

describe("mainstream vendor registry", () => {
  it("keeps vendor ids unique", () => {
    const ids = mainstreamVendorRegistry.map((vendor) => vendor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only documents OpenAPI-compatible endpoints for OpenAI-compatible providers", () => {
    for (const vendor of mainstreamVendorRegistry) {
      if (vendor.localProvider === "gemini" || vendor.localProvider === "groq") {
        expect(vendor.compatibleBaseUrl, `${vendor.id} is not OpenAI-compatible`).toBeUndefined();
      }
      if (vendor.compatibleBaseUrl) {
        expect(vendor.localProvider, `${vendor.id} needs a local provider`).toBeTruthy();
        expect(vendor.compatibleBaseUrl).toMatch(/^https:\/\//);
      }
    }
    expect(findMainstreamVendor("qwen")?.compatibleBaseUrl).toContain("dashscope.aliyuncs.com");
    expect(findMainstreamVendor("midjourney")?.localProvider).toBeUndefined();
  });

  it("resolves every registry entry through the gateway classifiers", () => {
    const gatewayVendorIds = new Set(gatewayVendors.map((vendor) => vendor.id));
    for (const vendor of mainstreamVendorRegistry) {
      expect(gatewayVendorIds.has(vendor.id), `${vendor.id} is not a gateway vendor id`).toBe(true);
      expect(findMainstreamVendor(vendor.id)?.name).toBe(vendor.name);
    }
  });

  it("resolves every label key in every locale", () => {
    const keys = [
      ...Object.values(mainstreamCapabilityLabelKeys),
      ...Object.values(mainstreamProviderStatusLabelKeys),
    ];
    for (const locale of locales) {
      for (const key of keys) {
        expect(localeResources[locale][key], `${locale} is missing ${key}`).toBeTruthy();
      }
    }
  });

  it("keeps the capability list stable", () => {
    expect(mainstreamModelCapabilities).toEqual(["chat", "reasoning", "code", "image", "video", "audio", "embedding"]);
  });

  it("normalizes endpoints for comparisons", () => {
    expect(normalizeEndpoint("https://API.OpenAI.com/v1/")).toBe("https://api.openai.com/v1");
    expect(normalizeEndpoint(undefined)).toBe("");
  });
});
