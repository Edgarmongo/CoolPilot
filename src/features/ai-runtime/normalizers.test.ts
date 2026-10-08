import { describe, expect, it } from "vitest";
import {
  normalizeGatewayModelIds,
  normalizeGeminiCatalog,
  normalizeOpenAICompatibleCatalog,
  normalizeOpenRouterCatalog,
} from "./normalizers";

/**
 * The normalizer is the boundary between vendor JSON and the registry: a shape it gets
 * wrong shows up as a wrong capability everywhere down the line.
 */
describe("model catalog normalizers", () => {
  it("reads OpenAI-compatible model lists and derives capabilities from the id", () => {
    const models = normalizeOpenAICompatibleCatalog({
      data: [
        { id: "gpt-4o-mini" },
        { id: "text-embedding-3-small" },
        { id: "gpt-4o-mini" },
        { object: "model" },
      ],
    });

    expect(models.map((model) => model.modelId)).toEqual(["gpt-4o-mini", "text-embedding-3-small"]);
    const chat = models[0];
    expect(chat.modelType).toBe("chat");
    expect(chat.capabilities.map((entry) => entry.capability)).toEqual(
      expect.arrayContaining(["chat", "vision", "tool_calling", "structured_output"]),
    );
    expect(chat.capabilities.every((entry) => entry.source === "MODEL_CATALOG")).toBe(true);

    const embedding = models[1];
    expect(embedding.modelType).toBe("embedding");
    expect(embedding.capabilities[0]?.capability).toBe("embedding");
  });

  it("trusts OpenRouter modality and parameter metadata over name guessing", () => {
    const models = normalizeOpenRouterCatalog({
      data: [
        {
          id: "some-vendor/model-x",
          name: "Model X",
          context_length: 128_000,
          architecture: { modality: "text+image->text" },
          supported_parameters: ["tools", "response_format", "reasoning"],
        },
        {
          id: "some-vendor/painter",
          name: "Painter",
          architecture: { modality: "text->image" },
        },
      ],
    });

    const [chat, painter] = models;
    expect(chat.contextWindow).toBe(128_000);
    const capabilities = Object.fromEntries(chat.capabilities.map((entry) => [entry.capability, entry.source]));
    expect(capabilities.vision).toBe("PROVIDER_METADATA");
    expect(capabilities.tool_calling).toBe("PROVIDER_METADATA");
    expect(capabilities.structured_output).toBe("PROVIDER_METADATA");
    expect(capabilities.reasoning).toBe("PROVIDER_METADATA");

    expect(painter.modelType).toBe("image");
    expect(painter.capabilities.some((entry) => entry.capability === "image_generation")).toBe(true);
    expect(painter.capabilities.some((entry) => entry.capability === "vision")).toBe(false);
  });

  it("maps Gemini generation methods to capabilities and reads the context window", () => {
    const models = normalizeGeminiCatalog({
      models: [
        {
          name: "models/gemini-2.5-pro",
          displayName: "Gemini 2.5 Pro",
          inputTokenLimit: 1_048_576,
          supportedGenerationMethods: ["generateContent", "countTokens"],
        },
        {
          name: "models/text-embedding-004",
          supportedGenerationMethods: ["embedContent"],
        },
        {
          name: "models/count-only",
          supportedGenerationMethods: ["countTokens"],
        },
      ],
    });

    expect(models.map((model) => model.modelId)).toEqual(["gemini-2.5-pro", "text-embedding-004"]);
    expect(models[0].displayName).toBe("Gemini 2.5 Pro");
    expect(models[0].contextWindow).toBe(1_048_576);
    expect(models[0].capabilities.some((entry) => entry.capability === "chat")).toBe(true);
    expect(models[1].capabilities[0]?.capability).toBe("embedding");
    expect(models[1].capabilities[0]?.source).toBe("PROVIDER_METADATA");
  });

  it("treats an imported gateway list as catalog knowledge only", () => {
    const models = normalizeGatewayModelIds(["kling-v2", "kling-v2", " mj_video ", ""]);
    expect(models.map((model) => model.modelId)).toEqual(["kling-v2", "mj_video"]);
    expect(models[0].capabilities.some((entry) => entry.capability === "video_generation")).toBe(true);
    // Nothing in a bare id list may claim to be callable.
    expect(models[0].capabilities.every((entry) => entry.source === "MODEL_CATALOG")).toBe(true);
  });
});
