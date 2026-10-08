import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The legacy facades on top of the runtime (phase P2 of `docs/generate-migration.md`).
 *
 * What these tests are really about: `generateText`, `generateStructured` and
 * `generateImageFile` no longer contain a single line of provider logic - every call must
 * reach `aiRuntime`, with routing, key rotation, model failover and usage coming from there.
 * The transport is always stubbed, so no test touches a real endpoint and no key from
 * `.env.local` can reach one either. Rotation / failover / pinning are asserted in
 * `src/features/ai-runtime/runtime.test.ts`; here the facade contract is what matters.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-legacy-facade-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "facade.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const facade = await import("./generate");
const imageFacade = await import("@/lib/agent/image-generation");
const registry = await import("@/features/ai-runtime/registry");
const runtimeSync = await import("@/features/ai-runtime/sync");
const repository = await import("@/db/repositories/ai-runtime");
const credentials = await import("@/lib/credentials");
const { aiProviderOrder, aiProviderRegistry } = await import("@/features/ai-settings/provider-registry");
const { postDraftSchema } = await import("./schemas");

/**
 * Every env var a legacy install may have exported. This suite asserts "nothing is configured",
 * so an ambient `GEMINI_API_KEYS` (or an `OPENAI_API_KEY`, the singular spelling `secrets.ts`
 * accepts as a fallback) in the developer's shell must not be able to change the outcome - the
 * `*_MODEL` variables count too, because `resolveProviderModel()` reads them when settings are
 * absent. Clearing them is what makes the "no key anywhere" cases below mean what they say.
 */
const legacyEnvVars: string[] = [
  ...new Set([
    ...aiProviderOrder.map((provider) => aiProviderRegistry[provider].modelEnv).filter((name) => Boolean(name)),
    "GEMINI_API_KEYS",
    "OPENAI_API_KEYS",
    "OPENROUTER_API_KEYS",
    "GROQ_API_KEYS",
    "GEMINI_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "GROQ_API_KEY",
    "GEMINI_IMAGE_MODEL",
    "OPENAI_IMAGE_MODEL",
  ]),
];

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

type StubRoute = { match: (url: string) => boolean; respond: () => Response };

function stubFetch(routes: StubRoute[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const route = routes.find((entry) => entry.match(url));
      return route ? route.respond() : jsonResponse({ error: { message: "unexpected call" } }, 404);
    }),
  );
  return calls;
}

type RequestBody = {
  model?: string;
  prompt?: string;
  size?: string;
  temperature?: number;
  response_format?: unknown;
  messages?: Array<{ role: string; content: string }>;
};

function bodyOf(call: { init?: RequestInit }) {
  return JSON.parse(String(call.init?.body)) as RequestBody;
}

function chatReply(text: string, usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }) {
  return jsonResponse({ choices: [{ message: { content: text } }], usage });
}

function geminiReply(text: string) {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
  });
}

const qwenCatalog = () => jsonResponse({ data: [{ id: "qwen3-max" }] });
const openAItextCatalog = () => jsonResponse({ data: [{ id: "gpt-4o-mini" }] });
const openAIImageCatalog = () => jsonResponse({ data: [{ id: "gpt-image-1" }] });
const geminiTextCatalog = () =>
  jsonResponse({
    models: [
      {
        name: "models/gemini-2.5-flash",
        baseModelId: "gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        supportedGenerationMethods: ["generateContent"],
        inputTokenLimit: 1048576,
      },
    ],
  });
const geminiImageCatalog = () =>
  jsonResponse({
    models: [
      {
        name: "models/gemini-2.5-flash-image",
        baseModelId: "gemini-2.5-flash-image",
        displayName: "Gemini 2.5 Flash Image",
        supportedGenerationMethods: ["generateContent"],
      },
    ],
  });

const offline = () => jsonResponse({ error: { message: "offline" } }, 500);

/** Blank slate: nothing callable, no legacy key in the process, no vault entry. */
async function resetRuntime() {
  await registry.ensureModelRuntimeSeeded();
  for (const providerId of ["gemini", "groq", "openai", "openrouter", "qwen", "deepseek"] as const) {
    await repository.setModelsEnabledByProvider(providerId, false);
    await credentials.clearCredential(credentials.credentialRefFor(providerId));
  }
  // A capability default from an earlier test would outrank the provider preference under test.
  await registry.setModelDefaultForCapability("chat", null);
  for (const name of legacyEnvVars) {
    delete process.env[name];
  }
}

/** Makes one provider/model pair really callable, with exactly that model left enabled. */
async function prepareModel(providerId: string, modelId: string, secret: string) {
  await credentials.writeCredential(credentials.credentialRefFor(providerId), secret);
  await runtimeSync.syncProviderCatalog(providerId);
  const rows = await repository.listModels({ providerId });
  const target = rows.find((model) => model.modelId === modelId);
  await repository.setModelsEnabled(
    rows.filter((model) => model.id !== target?.id).map((model) => model.id),
    false,
  );
  if (target) {
    await repository.setModelsEnabled([target.id], true);
  }
  return target;
}

describe("legacy AI facade on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers through the runtime and reports the provider that really ran (D2)", async () => {
    const calls = stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
      { match: (url) => url.includes("/chat/completions"), respond: () => chatReply("pong-from-runtime") },
    ]);
    const row = await prepareModel("qwen", "qwen3-max", "sk-stub-qwen");
    await registry.setModelDefaultForCapability("chat", row?.id ?? "");

    const result = await facade.generateText({ prompt: "ping" });

    expect(result.text).toBe("pong-from-runtime");
    // `qwen` is not part of the legacy provider union at all - only the runtime can answer this.
    expect(result.provider).toBe("qwen");
    expect(result.model).toBe("qwen3-max");
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    expect(result.keyLabel.endsWith("qwen")).toBe(true);
    expect(result.keyLabel).not.toContain("sk-stub-qwen");

    const [chatCall] = calls.filter((call) => call.url.includes("/chat/completions"));
    // The legacy call shape survives: one user turn, temperature 0.7.
    expect(bodyOf(chatCall)).toMatchObject({ model: "qwen3-max", temperature: 0.7 });
    expect(bodyOf(chatCall).messages?.at(-1)).toEqual({ role: "user", content: "ping" });
  });

  it("resolves a model on demand when the registry was never populated (legacy discovery)", async () => {
    process.env.GEMINI_API_KEYS = "sk-stub-gemini";
    const calls = stubFetch([
      // The chat URL also contains `/models/<id>`, so the catalog pattern must be precise.
      { match: (url) => url.includes(":generateContent"), respond: () => geminiReply("pong-from-gemini") },
      { match: (url) => url.includes("/v1beta/models?"), respond: geminiTextCatalog },
    ]);

    const result = await facade.generateText({ prompt: "ping" });

    expect(result.text).toBe("pong-from-gemini");
    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("gemini-2.5-flash");
    // Nothing was callable before the call: the facade discovered the catalog first.
    expect(calls[0]?.url).toContain("/v1beta/models?");
    expect(calls.filter((call) => call.url.includes(":generateContent"))).toHaveLength(1);
  });

  it("treats the legacy provider argument as a preference, not a pin (G1)", async () => {
    const calls = stubFetch([
      { match: (url) => url.includes("api.openai.com") && url.endsWith("/models"), respond: openAItextCatalog },
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
      { match: (url) => url.includes("api.openai.com") && url.includes("/chat/completions"), respond: offline },
      {
        match: (url) => url.includes("dashscope") && url.includes("/chat/completions"),
        respond: () => chatReply("pong-from-qwen"),
      },
    ]);
    await prepareModel("qwen", "qwen3-max", "sk-stub-qwen");
    await prepareModel("openai", "gpt-4o-mini", "sk-stub-openai");

    const result = await facade.generateText({ prompt: "ping", provider: "openai" });

    const chatCalls = calls.filter((call) => call.url.includes("/chat/completions"));
    // Preferred provider first...
    expect(chatCalls[0]?.url).toContain("api.openai.com");
    // ...but its failure still falls over, which a pin would not have done (D2).
    expect(result.provider).toBe("qwen");
    expect(result.text).toBe("pong-from-qwen");
  });

  it("delegates structured output to the runtime's JSON retry path (G5)", async () => {
    const replies = [
      chatReply("not json at all", { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 }),
      chatReply('{"title":"t","body":"b"}', { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }),
    ];
    const calls = stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
      { match: (url) => url.includes("/chat/completions"), respond: () => replies.shift() ?? chatReply("{}") },
    ]);
    await prepareModel("qwen", "qwen3-max", "sk-stub-qwen");

    const result = await facade.generateStructured({ prompt: "draft a post", schema: postDraftSchema });

    expect(result.data).toEqual({ title: "t", body: "b" });
    // Both calls are billed, so the facade reports the merged usage.
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4, totalTokens: 16 });

    const bodies = calls.filter((call) => call.url.includes("/chat/completions")).map(bodyOf);
    expect(bodies).toHaveLength(2);
    const firstPrompt = bodies[0]?.messages?.at(-1)?.content ?? "";
    expect(firstPrompt).toContain("Return ONLY a single valid JSON object");
    expect(firstPrompt).toContain("JSON schema:");
    expect(bodies[0]?.response_format).toEqual({ type: "json_object" });
    // The retry appends the rejected answer plus the correction; the schema stays in the prompt.
    const retry = bodies[1]?.messages ?? [];
    expect(retry.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(retry.at(-1)?.content).toContain("could not be used");
    expect(retry.at(-1)?.content).not.toContain("JSON schema:");
  });

  it("keeps the legacy missing-key contract when no provider holds a key (G4)", async () => {
    stubFetch([{ match: () => true, respond: offline }]);

    const error: unknown = await facade.generateText({ prompt: "ping" }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(facade.MissingAIKeyError);
    // The legacy message named the configured text provider, which is still the default.
    expect((error as Error).message).toBe("Missing gemini API key");
  });

  it("generates an image through the runtime and writes the artifact file (G3)", async () => {
    const calls = stubFetch([
      { match: (url) => url.endsWith("/models"), respond: openAIImageCatalog },
      {
        match: (url) => url.includes("/images/generations"),
        respond: () => jsonResponse({ data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }] }),
      },
    ]);
    await prepareModel("openai", "gpt-image-1", "sk-stub-openai");

    const result = await imageFacade.generateImageFile({ prompt: "a cat on a keyboard" });

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-image-1");
    expect(path.dirname(result.path)).toBe(path.join(dataDir, "artifacts"));
    expect(await fs.readFile(result.path, "utf-8")).toBe("fake-png-bytes");

    const [imageCall] = calls.filter((call) => call.url.includes("/images/generations"));
    expect(bodyOf(imageCall)).toMatchObject({
      model: "gpt-image-1",
      prompt: "a cat on a keyboard",
      size: "1024x1024",
    });
  });

  it("keeps the image provider pinned instead of silently using the other one (G3)", async () => {
    const calls = stubFetch([
      { match: (url) => url.includes("/v1beta/models?"), respond: geminiImageCatalog },
      { match: () => true, respond: offline },
    ]);
    // Gemini is configured and callable; the settings still name OpenAI as the image provider.
    await prepareModel("gemini", "gemini-2.5-flash-image", "sk-stub-gemini");

    const error: unknown = await imageFacade
      .generateImageFile({ prompt: "a cat on a keyboard" })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(facade.MissingAIKeyError);
    expect((error as Error).message).toBe("Missing openai API key");
    expect(calls.some((call) => call.url.includes(":generateContent"))).toBe(false);
  });
});
