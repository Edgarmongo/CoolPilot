import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The image facade on top of the runtime (`src/lib/agent/image-generation.ts`).
 *
 * What these tests are really about: `generateImageFile` no longer contains a single line of
 * provider logic - every call must reach `aiRuntime`, with routing, key rotation, model failover
 * and usage coming from there. The transport is always stubbed, so no test touches a real
 * endpoint and no key from `.env.local` can reach one either. Rotation / failover / pinning are
 * asserted in `src/features/ai-runtime/runtime.test.ts`; here the facade contract is what matters.
 *
 * P4 deleted the text half of this suite together with the legacy text facade
 * (`src/lib/ai/generate.ts` and the `src/lib/ai/compat.ts` shim behind it), so only the image
 * cases are left. The file name is historical: it still sits where the facade used to live, and
 * its subject is now `@/lib/agent/image-generation`.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-legacy-facade-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "facade.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const imageFacade = await import("@/lib/agent/image-generation");
const registry = await import("@/features/ai-runtime/registry");
const runtimeSync = await import("@/features/ai-runtime/sync");
const repository = await import("@/db/repositories/ai-runtime");
const credentials = await import("@/lib/credentials");
const { AppError } = await import("@/lib/app-errors");
const { aiProviderOrder, aiProviderRegistry } = await import("@/features/ai-settings/provider-registry");
const { keylessAppEnvValue } = await import("@/test/app-env");

/**
 * Every env var a legacy install may have exported. This suite asserts "nothing is configured",
 * so an ambient `GEMINI_API_KEYS` (or an `OPENAI_API_KEY`, the singular spelling `secrets.ts`
 * accepts as a fallback) in the developer's shell must not be able to change the outcome - the
 * `*_MODEL` variables count too, because `resolveProviderModel()` reads them when settings are
 * absent. Clearing them is what makes the "no key anywhere" cases below mean what they say.
 *
 * The key variables are neutralised instead of deleted: deleting hands them back to the app env file,
 * which on a developer machine holds real keys, and the seed discovers a catalog for every keyed
 * provider (D-P3-1) - so a deleted variable would have the seed fetch. `src/test/app-env.ts` pins them
 * for the whole run; repeating it per test keeps a case that sets a key from leaking into the next.
 */
const legacyModelEnvVars: string[] = [
  ...new Set([
    ...aiProviderOrder.map((provider) => aiProviderRegistry[provider].modelEnv).filter((name) => Boolean(name)),
    "GEMINI_IMAGE_MODEL",
    "OPENAI_IMAGE_MODEL",
  ]),
];
const legacyKeyEnvVars = [
  "GEMINI_API_KEYS",
  "OPENAI_API_KEYS",
  "OPENROUTER_API_KEYS",
  "GROQ_API_KEYS",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
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
};

function bodyOf(call: { init?: RequestInit }) {
  return JSON.parse(String(call.init?.body)) as RequestBody;
}

const openAIImageCatalog = () => jsonResponse({ data: [{ id: "gpt-image-1" }] });
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
  // Neutralised before the seed: it discovers a catalog for every provider that holds a key (D-P3-1).
  for (const name of legacyKeyEnvVars) {
    process.env[name] = keylessAppEnvValue;
  }
  for (const name of legacyModelEnvVars) {
    delete process.env[name];
  }
  await registry.ensureModelRuntimeSeeded();
  for (const providerId of ["gemini", "groq", "openai", "openrouter", "qwen", "deepseek"] as const) {
    await repository.setModelsEnabledByProvider(providerId, false);
    await credentials.clearCredential(credentials.credentialRefFor(providerId));
  }
  // A capability default from an earlier test would outrank the provider preference under test.
  await registry.setModelDefaultForCapability("chat", null);
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

describe("image facade on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    // `prepareModel` syncs gemini's catalog; the facade call below is what this case measures.
    const prepared = calls.length;

    const error: unknown = await imageFacade
      .generateImageFile({ prompt: "a cat on a keyboard" })
      .catch((thrown: unknown) => thrown);

    // P3-B-3 cut `image-generation.ts -> compat.ts`, so the facade surfaces the runtime's own routing
    // error - and with the shim went the on-demand discovery pass, which is why the pinned provider's
    // catalog was never read here.
    expect(error).toBeInstanceOf(AppError);
    const failure = error as InstanceType<typeof AppError>;
    expect(failure.code).toBe("MODEL_NOT_CONFIGURED");
    expect(failure.message).toBe("No model is configured for this request");
    expect(calls.some((call) => call.url.includes(":generateContent"))).toBe(false);
    expect(calls).toHaveLength(prepared);
  });
});
