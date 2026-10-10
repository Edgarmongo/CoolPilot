import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { vi } from "vitest";

/**
 * The shared test plumbing of the layers that sit above the runtime (batch P3-A3-0 of
 * `docs/generate-migration-p3.md`), and of the two "freeze, do not migrate" batches after it:
 * `src/app/api/images/route.test.ts` (P3-B-1) and `src/lib/article-images.test.ts` (P3-B-2) are the two
 * callers of `prepareImageModel()`, and the second one is not a route at all - the module pins the image
 * strategy, which is the layer both routes sit on.
 *
 * CI-AI-IMG-CONFIG-03 is the one change those two batches saw: an image request routes to the provider
 * that *owns* images (`openai-image` / `gemini-image`) instead of the text provider of the same vendor.
 * The image side of this harness therefore gained two things - `prepareImageModel()` reconciles the
 * image rows from the settings before it reads a catalog (an OpenAI-compatible image endpoint only
 * exists once `openAIImageBaseUrl` names a URL, per the Q4 rule of that card), and that same reconcile
 * is exported for a case that moves those settings itself.
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

/** For a test that writes files (artifacts, exports); cleaning up is that test's business. */
export const routeTestDataDir = dataDir;

/** The runtime's public surface: seeding, routing, catalog sync and the credential pool. */
export const runtime = await import("@/features/ai-runtime");
/** The runtime's own tables (providers, endpoints, models, keys). The route's business tables are the test's. */
export const runtimeRepository = await import("@/db/repositories/ai-runtime");
export const credentials = await import("@/lib/credentials");

const { aiProviderOrder, aiProviderRegistry, imageProviderIds } = await import(
  "@/features/ai-settings/provider-registry"
);
const { keylessAppEnvValue } = await import("@/test/app-env");

/**
 * The reconcile the settings route runs after every save (`syncImageProviderSettings()` in the runtime
 * registry), for a case that changes the *image* settings instead of letting `prepareImageModel()`
 * fixture them - most importantly the Q4 state where the image base URL is empty, which must leave no
 * routable image endpoint behind.
 */
export const { syncImageProviderSettings } = await import("@/features/ai-runtime/registry");

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
const keyEnvVars = [
  ...new Set([
    ...aiProviderOrder.flatMap((provider) => credentials.credentialEnvVarNames(provider)),
    // CI-AI-IMG-CONFIG-03: the image providers are registry rows of their own now, so their key
    // variables (`OPENAI_IMAGE_API_KEYS`, `GEMINI_IMAGE_API_KEYS`) are neutralised by name here too -
    // a developer shell that exports one must not decide what an image case routes to.
    ...Object.values(imageProviderIds).flatMap((providerId) => credentials.credentialEnvVarNames(providerId)),
  ]),
];

/**
 * Blank slate: no key in the process, no vault entry, no callable model, no capability default left
 * over from an earlier case (a default outranks the provider order a case may reason about).
 *
 * `image_generation` is cleared for the same reason as the two text capabilities: the B files are the
 * only cases that ask for it (`src/app/api/images/route.test.ts`, `src/lib/article-images.test.ts`), and
 * a leftover image default would outrank the provider order a case reasons about, exactly like a
 * leftover `chat` default.
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
  await runtime.setModelDefaultForCapability("image_generation", null);
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

/**
 * The image counterpart of `prepareChatModel` (batch P3-B-1): one credential, one enabled
 * `image_generation` model and the capability default - which is the layer `importLegacyAiSettings()`
 * would have set from the legacy form, so a case can choose between "the configured image provider"
 * and "the other one is callable too" without touching the registry by hand.
 *
 * CI-AI-IMG-CONFIG-03: `providerId` is the *image* provider (`openai-image` / `gemini-image`), and an
 * OpenAI-compatible image endpoint only exists in the registry once the image settings name a URL
 * (Q4 as ruled) - which is what the case's own `updateLocalAgentSettings({ openAIImageBaseUrl })`
 * puts there. The reconcile below is the same call the settings route makes after a save, and it has
 * to happen before `prepareModel()` reads the catalog: without the endpoint row there is nothing to
 * sync against and the model would not be callable.
 */
export async function prepareImageModel(providerId: string, modelId: string, secret: string) {
  const { syncImageProviderSettings } = await import("@/features/ai-runtime/registry");
  await syncImageProviderSettings();
  const row = await prepareModel(providerId, modelId, secret);
  await runtime.setModelDefaultForCapability("image_generation", row?.id ?? "");
  return row;
}

/**
 * The two budget states a call site's refusal case needs (CI-P7-03), stated in the one place every
 * route test already reaches.
 *
 * `refuseEveryAiBudgetCall()` is a refusal no catalog can accidentally satisfy: the limit is 0 and
 * `unknownCostPolicy: "block"` refuses a call whose cost cannot be stated either, so the answer is the
 * user's settings speaking and not a missing price row. `allowEveryAiBudgetCall()` puts the row back to
 * the shipped default, for a file that wants its other cases to keep calling models after a refusal case
 * has run. Both stand for the *call* gate; a step (node) gate reads the same row.
 */
export async function refuseEveryAiBudgetCall() {
  const { updateAiBudgetSettings } = await import("@/db/repositories/settings");
  await updateAiBudgetSettings({ policy: "block", monthlyLimit: 0, currency: "CNY", unknownCostPolicy: "block" });
}

export async function allowEveryAiBudgetCall() {
  const { updateAiBudgetSettings } = await import("@/db/repositories/settings");
  await updateAiBudgetSettings({ policy: "off", monthlyLimit: null, currency: "CNY", unknownCostPolicy: "allow" });
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
