import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cold-start catalog discovery (D-P3-1 of `docs/generate-migration-p3.md`).
 *
 * The pre-runtime path resolved a model on demand, so an install that only had an API key answered
 * out of the box. The runtime needs a callable registry row instead, and `lib/ai/compat.ts` patches
 * that today by discovering inside a failed request. These tests pin the replacement: **the seed**
 * discovers, routing stays offline, a provider that is down cannot break start-up, and a provider
 * that is already set up is never re-synced by a request.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-cold-start-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "cold-start.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { aiProviderOrder, aiProviderRegistry } = await import("@/features/ai-settings/provider-registry");

const { keylessAppEnvValue } = await import("@/test/app-env");

/**
 * The keys the cases below write are set per test, on top of the keyless value `src/test/app-env.ts`
 * gives every provider key variable - so nothing here can fall back to a developer's own `.env.local`
 * and make the seed discover a provider this test never configured. Model names are cleared instead of
 * neutralised: the legacy import (G2) reads them, and empty is what "not configured" means there.
 */
const legacyModelEnvVars = new Set(
  aiProviderOrder.map((provider) => aiProviderRegistry[provider].modelEnv).filter((name) => Boolean(name)),
);
const keyedEnvVars = new Set(["GEMINI_API_KEYS", "DEEPSEEK_API_KEYS", "GROQ_API_KEYS"]);

function clearInstallEnv() {
  for (const name of legacyModelEnvVars) {
    delete process.env[name];
  }
  for (const name of keyedEnvVars) {
    process.env[name] = keylessAppEnvValue;
  }
}

clearInstallEnv();

const registry = await import("./registry");
const runtime = await import("./runtime");
const repository = await import("@/db/repositories/ai-runtime");
const credentials = await import("@/lib/credentials");

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

const geminiCatalog = () =>
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

type StubOptions = { failCatalogs?: string[] };

/** Records every URL a seed fetches; answers the calls the assertions need. */
function stubFetch(options: StubOptions = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (options.failCatalogs?.some((providerId) => url.includes(providerId)) && url.endsWith("/models")) {
        return jsonResponse({ error: { message: "catalog unreachable" } }, 503);
      }
      if (url.includes("/v1beta/models?")) return geminiCatalog();
      if (url.includes("deepseek") && url.endsWith("/models")) return jsonResponse({ data: [{ id: "deepseek-chat" }] });
      if (url.includes(":generateContent")) {
        return jsonResponse({ candidates: [{ content: { parts: [{ text: "pong-from-gemini" }] } }] });
      }
      return jsonResponse({ error: { message: "unexpected call" } }, 404);
    }),
  );
  return calls;
}

/** A model-list read, i.e. one catalog sync of that provider. */
const catalogsOf = (calls: string[], providerId: string) =>
  calls.filter((url) => url.includes(providerId) && (url.endsWith("/models") || url.includes("/models?")));

/** Back to "nothing callable, no key in the vault" - the state a fresh install starts from. */
async function clearInstallState() {
  for (const provider of await repository.listModelProviders()) {
    await repository.setModelsEnabledByProvider(provider.providerId, false);
    await credentials.clearCredential(credentials.credentialRefFor(provider.providerId));
  }
}

describe("cold-start catalog discovery", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    clearInstallEnv();
    await registry.ensureModelRuntimeSeeded();
    await clearInstallState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves a keyless install alone: no network call, nothing enabled", async () => {
    const calls = stubFetch();

    await registry.ensureModelRuntimeSeeded();

    // Every seeded provider was considered and skipped without a request: no key anywhere.
    expect(calls).toEqual([]);
    const enabled = (await repository.listModels({ providerId: "gemini" })).filter((model) => model.enabled);
    expect(enabled).toEqual([]);
  });

  it("makes a lone API key callable during seeding, so the request path discovers nothing (G3)", async () => {
    const calls = stubFetch();
    process.env.GEMINI_API_KEYS = "sk-stub-gemini";

    await registry.ensureModelRuntimeSeeded();

    expect(catalogsOf(calls, "gemini")).toHaveLength(1);
    const discovered = (await repository.listModels({ providerId: "gemini" })).find(
      (model) => model.modelId === "gemini-2.5-flash",
    );
    expect(discovered?.enabled).toBe(true);

    const resolution = await registry.resolveRoute({ capabilities: ["chat"], providerId: "gemini" });
    expect(resolution.candidates[0]?.provider.providerId).toBe("gemini");

    const response = await runtime.chat({ messages: [{ role: "user", content: "ping" }], providerId: "gemini" });
    expect(response.text).toBe("pong-from-gemini");
    expect(response.model).toBe("gemini-2.5-flash");
    // Routing and the call itself added no catalog read: discovery is not on the request path.
    expect(catalogsOf(calls, "gemini")).toHaveLength(1);
  });

  it("does not re-sync a provider whose catalog is already discovered", async () => {
    const calls = stubFetch();
    process.env.DEEPSEEK_API_KEYS = "sk-stub-deepseek";

    await registry.ensureModelRuntimeSeeded();
    expect(catalogsOf(calls, "deepseek")).toHaveLength(1);
    // Gemini settled in the test above (its models are callable): nothing left to discover.
    expect(catalogsOf(calls, "gemini")).toEqual([]);

    await registry.ensureModelRuntimeSeeded();
    await registry.resolveRoute({ capabilities: ["chat"] });
    expect(catalogsOf(calls, "deepseek")).toHaveLength(1);
  });

  it("stays silent when the catalog cannot be reached, and retries it later (start-up must not fail)", async () => {
    const calls = stubFetch({ failCatalogs: ["groq"] });
    process.env.GROQ_API_KEYS = "sk-stub-groq";

    await expect(registry.ensureModelRuntimeSeeded()).resolves.toBeUndefined();

    expect(catalogsOf(calls, "groq")).toHaveLength(1);
    expect((await repository.listModels({ providerId: "groq" })).filter((model) => model.enabled)).toEqual([]);
    // The failure lands on the endpoint, which is what the settings UI reads - never on the caller.
    expect((await repository.getModelEndpoint("groq/default"))?.status).toBe("error");

    // A provider that failed is retried, so a key fixed outside the app needs no restart either.
    await registry.ensureModelRuntimeSeeded();
    expect(catalogsOf(calls, "groq")).toHaveLength(2);
  });
});
