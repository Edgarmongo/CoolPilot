import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { vi } from "vitest";

/**
 * The route layer's shared test plumbing (batch P3-A3-0 of `docs/generate-migration-p3.md`).
 *
 * `src/app` had no test file before A3, and `lib/scraper.test.ts` shows why: a test that watches a
 * route talk to a provider first has to own four things - a database that is not the user's, a
 * transport that is not the network, a credential pool that is not the machine's key file, and the
 * `Request` itself. That is all this module is. It asserts nothing on purpose, so every route test
 * keeps its own `await POST(request)` and `expect(response.status)` and its HTTP contract stays
 * readable in the file that owns it:
 *
 *   const calls = stubFetch([...]);                          // transport
 *   const record = await createPublishRecord({ ... });        // fixture: the route test's business
 *   await prepareChatModel("qwen", "qwen3-max", "sk-stub");   // one credential + one callable model
 *   const response = await POST(jsonRequest(url, { ... }));
 *   expect(response.status).toBe(200);
 *
 * The temp database is pinned *before* anything that reads it is imported - a static import of `@/db`
 * here would read the install's own URL first, because a module body runs after its imports - which is
 * why the imports below are `await`s. `lib/scraper.test.ts` opens with the same three lines.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-route-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "routes.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

/** For a route that writes files (artifacts, exports); cleaning up is the route test's business. */
export const routeTestDataDir = dataDir;

/** The runtime's public surface: seeding, routing, catalog sync and the credential pool. */
export const runtime = await import("@/features/ai-runtime");
/** The runtime's own tables (providers, endpoints, models, keys). The route's business tables are the test's. */
export const runtimeRepository = await import("@/db/repositories/ai-runtime");
export const credentials = await import("@/lib/credentials");

const { aiProviderOrder, aiProviderRegistry } = await import("@/features/ai-settings/provider-registry");
const { keylessAppEnvValue } = await import("@/test/app-env");

/**
 * The legacy spellings a configured install may have exported: `<PROVIDER>_MODEL` and the key
 * variables. Model names are *deleted* (empty is what "not configured" means to the seed's legacy
 * import) while key variables are *neutralised* - deleting one hands it straight back to `.env.local`,
 * which the runtime reads directly (D-P3-7). This mirrors `src/lib/ai/generate.test.ts`.
 */
const modelEnvVars = [
  ...new Set([
    ...aiProviderOrder.map((provider) => aiProviderRegistry[provider].modelEnv).filter((name) => Boolean(name)),
    "GEMINI_IMAGE_MODEL",
    "OPENAI_IMAGE_MODEL",
  ]),
];
const keyEnvVars = [...new Set(aiProviderOrder.flatMap((provider) => credentials.credentialEnvVarNames(provider)))];

/**
 * Blank slate: no key in the process, no vault entry, no callable model, no capability default left
 * over from an earlier case (a default outranks the provider order a case may reason about).
 */
export async function resetRuntime() {
  for (const name of keyEnvVars) {
    process.env[name] = keylessAppEnvValue;
  }
  for (const name of modelEnvVars) {
    delete process.env[name];
  }
  await runtime.ensureModelRuntimeSeeded();
  for (const provider of await runtimeRepository.listModelProviders()) {
    await runtimeRepository.setModelsEnabledByProvider(provider.providerId, false);
    await credentials.clearCredential(credentials.credentialRefFor(provider.providerId));
  }
  await runtime.setModelDefaultForCapability("chat", null);
  await runtime.setModelDefaultForCapability("structured_output", null);
}

/** Makes one provider/model pair really callable: one credential, one enabled model. */
export async function prepareModel(providerId: string, modelId: string, secret: string) {
  await credentials.writeCredential(credentials.credentialRefFor(providerId), secret);
  await runtime.syncProviderCatalog(providerId);
  const rows = await runtimeRepository.listModels({ providerId });
  const target = rows.find((model) => model.modelId === modelId);
  await runtimeRepository.setModelsEnabled(
    rows.filter((model) => model.id !== target?.id).map((model) => model.id),
    false,
  );
  if (target) {
    await runtimeRepository.setModelsEnabled([target.id], true);
  }
  return target;
}

/** The usual fixture for an AI route: that single model is the default for text and structured output. */
export async function prepareChatModel(providerId: string, modelId: string, secret: string) {
  const row = await prepareModel(providerId, modelId, secret);
  await runtime.setModelDefaultForCapability("chat", row?.id ?? "");
  await runtime.setModelDefaultForCapability("structured_output", row?.id ?? "");
  return row;
}

/** A `Request` shaped like the one the app sends: POST with a JSON body. */
export function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

export type RecordedCall = { url: string; init?: RequestInit };

export type StubRoute = { match: (url: string) => boolean; respond: () => Response };

/** Replaces the global transport and records every call, so a case can assert on the wire. */
export function stubFetch(routes: StubRoute[]) {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const route = routes.find((entry) => entry.match(url));
      // An unexpected call must fail loudly rather than quietly steer a routing assertion.
      return route ? route.respond() : jsonResponse({ error: { message: "unexpected call" } }, 404);
    }),
  );
  return calls;
}

export type RequestBody = {
  model?: string;
  temperature?: number;
  response_format?: unknown;
  messages?: Array<{ role: string; content: string }>;
};

/** The chat turns only: a catalog read also carries an `Authorization` header but is not a model call. */
export const chatCalls = (calls: RecordedCall[]) => calls.filter((call) => call.url.includes("/chat/completions"));

export const bodyOf = (call: RecordedCall | undefined) => JSON.parse(String(call?.init?.body)) as RequestBody;

const authorizationOf = (init?: RequestInit) => ((init?.headers ?? {}) as Record<string, string>).Authorization;

export const authorizationsOf = (calls: RecordedCall[]) => chatCalls(calls).map((call) => authorizationOf(call.init));

export const qwenCatalog = () => jsonResponse({ data: [{ id: "qwen3-max" }] });
export const deepseekCatalog = () => jsonResponse({ data: [{ id: "deepseek-chat" }] });

/** What a model answers when it understood the schema: the payload as JSON, plus usage to report. */
export function jsonReply(payload: unknown, usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }) {
  return jsonResponse({ choices: [{ message: { content: JSON.stringify(payload) } }], usage });
}

export const unauthorized = () => jsonResponse({ error: { message: "invalid key" } }, 401);
export const rateLimited = () => jsonResponse({ error: { message: "slow down" } }, 429);
export const unavailable = () => jsonResponse({ error: { message: "boom" } }, 503);
export const rejected = () => jsonResponse({ error: { message: "bad request" } }, 400);
