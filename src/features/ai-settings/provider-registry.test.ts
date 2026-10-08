import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiProviderRegistry, orderedProviders, resolveProviderBaseUrl, resolveProviderModel } from "./provider-registry";

describe("ai provider registry", () => {
  // `resolveProviderModel()` reads `<PROVIDER>_MODEL` from the environment when settings are absent,
  // so a developer who exported GEMINI_MODEL would otherwise fail the "no fallbacks" case below.
  beforeEach(() => {
    vi.stubEnv("GEMINI_MODEL", "");
    vi.stubEnv("GROQ_MODEL", "");
    vi.stubEnv("OPENAI_MODEL", "");
    vi.stubEnv("OPENROUTER_MODEL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps provider metadata centralized", () => {
    expect(aiProviderRegistry.openrouter.supportsCustomBaseUrl).toBe(true);
    expect(aiProviderRegistry.gemini.modelEnv).toBe("GEMINI_MODEL");
  });

  it("orders preferred provider before fallback providers", () => {
    expect(orderedProviders("openrouter").slice(0, 2)).toEqual(["openrouter", "gemini"]);
  });

  it("resolves custom OpenAI-compatible settings", () => {
    const settings = {
      openAIBaseUrl: "https://example.com/v1",
      openAIModel: "custom-model",
    };
    expect(resolveProviderBaseUrl("openai", settings as never)).toBe("https://example.com/v1");
    expect(resolveProviderModel("openai", settings as never)).toBe("custom-model");
  });

  it("does not hardcode provider model fallbacks", () => {
    expect(resolveProviderModel("gemini", null)).toBe("");
    expect(resolveProviderModel("groq", null)).toBe("");
  });
});
