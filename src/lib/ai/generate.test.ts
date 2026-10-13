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
 *
 * CI-AI-IMG-CONFIG-03 gave the facade an image provider of its own: the pin resolves to
 * `openai-image` / `gemini-image`, whose endpoint is the URL the settings name (`openAIImageBaseUrl`)
 * and whose key is the image credential - so nothing here can pass by borrowing the text provider.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-legacy-facade-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "facade.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const imageFacade = await import("@/lib/agent/image-generation");
const ledgerRepository = await import("@/db/repositories/ai-usage-ledger");
const registry = await import("@/features/ai-runtime/registry");
const runtimeSync = await import("@/features/ai-runtime/sync");
const repository = await import("@/db/repositories/ai-runtime");
const credentials = await import("@/lib/credentials");
const { AppError } = await import("@/lib/app-errors");
const { aiProviderOrder, aiProviderRegistry, imageProviderIds } = await import(
  "@/features/ai-settings/provider-registry"
);
const { updateLocalAgentSettings } = await import("@/db/repositories/settings");
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
  // CI-AI-IMG-CONFIG-03: the image providers hold keys of their own (`OPENAI_IMAGE_API_KEYS` /
  // `GEMINI_IMAGE_API_KEYS`), so an exported one is neutralised here as well - no case of this suite
  // may route because of a key that was never written by the case itself.
  ...Object.values(imageProviderIds).flatMap((providerId) => credentials.credentialEnvVarNames(providerId)),
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

/** The endpoint the image settings name; without one an image request has nowhere to go (Q4). */
const imageBaseUrl = "https://images.example.test/v1";

/**
 * What saving the image form does (CI-AI-IMG-CONFIG-03): the settings carry the URL and the runtime's
 * registry is reconciled from it, which is what creates the endpoint a case can then call through.
 */
async function configureImageEndpoint() {
  await updateLocalAgentSettings({ openAIImageBaseUrl: imageBaseUrl });
  await registry.syncImageProviderSettings();
}

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
  for (const providerId of [
    ...aiProviderOrder,
    // CI-AI-IMG-CONFIG-03: the image providers are rows of their own, with their own credentials, so
    // they are cleared like the text ones - a key one case wrote must not be callable in the next.
    ...Object.values(imageProviderIds),
    "qwen",
    "deepseek",
  ]) {
    await repository.setModelsEnabledByProvider(providerId, false);
    await credentials.clearCredential(credentials.credentialRefFor(providerId));
  }
  // A capability default from an earlier test would outrank the provider preference under test.
  await registry.setModelDefaultForCapability("chat", null);
  await registry.setModelDefaultForCapability("image_generation", null);
  // The image settings decide whether an image endpoint exists at all (Q4), so they go back to "not
  // configured" and the registry is reconciled with that: a case that needs one sets it itself
  // (`configureImageEndpoint()`), and a case that does not would otherwise inherit the last one's URL.
  await updateLocalAgentSettings({
    imageProvider: "openai",
    openAIImageBaseUrl: "",
    openAIImageSize: "1024x1024",
  });
  await registry.syncImageProviderSettings();
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
    await configureImageEndpoint();
    await prepareModel("openai-image", "gpt-image-1", "sk-stub-openai-image");

    const result = await imageFacade.generateImageFile({ prompt: "a cat on a keyboard" });

    // The provider that answered is the image row, which is what the ledger row will be keyed on.
    expect(result.provider).toBe("openai-image");
    expect(result.model).toBe("gpt-image-1");
    expect(path.dirname(result.path)).toBe(path.join(dataDir, "artifacts"));
    expect(await fs.readFile(result.path, "utf-8")).toBe("fake-png-bytes");

    const [imageCall] = calls.filter((call) => call.url.includes("/images/generations"));
    // The endpoint the image settings name, not the text provider's host.
    expect(imageCall.url).toBe(`${imageBaseUrl}/images/generations`);
    expect(bodyOf(imageCall)).toMatchObject({
      model: "gpt-image-1",
      prompt: "a cat on a keyboard",
      size: "1024x1024",
    });
  });

  it("carries a content context onto the ledger row only when the caller really has one (C4)", async () => {
    stubFetch([
      { match: (url) => url.endsWith("/models"), respond: openAIImageCatalog },
      {
        match: (url) => url.includes("/images/generations"),
        respond: () => jsonResponse({ data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }] }),
      },
    ]);
    await configureImageEndpoint();
    await prepareModel("openai-image", "gpt-image-1", "sk-stub-openai-image");

    // The agent's `generate_image_file` names the item it is working for, so the row can be read back per
    // content item - which is what lets an image's cost be summed without guessing whose it was.
    const attributed = await imageFacade.generateImageFile({
      prompt: "a cat on a keyboard",
      contentItemId: "content-1",
    });
    const rowsForItem = await ledgerRepository.listAiUsageLedgerEntries({ contentItemId: "content-1" });

    expect(rowsForItem).toHaveLength(1);
    expect(rowsForItem[0]).toMatchObject({ purpose: "image", meteredKind: "image", contentItemId: "content-1" });
    // The other half of the relation: the row points at the file, whose name is the identity the item
    // stores in `metadata.imageAssets`, so "which call produced this image" is answered by identity.
    expect(rowsForItem[0].outputAssetId).toBe(attributed.path);

    // A caller with no content context - the standalone 配图 page - attributes nothing at all.
    const standalone = await imageFacade.generateImageFile({ prompt: "a cat on a keyboard" });
    const [standaloneRow] = await ledgerRepository.listAiUsageLedgerEntries({ limit: 20 });
    expect(standaloneRow.outputAssetId).toBe(standalone.path);
    expect(standaloneRow.contentItemId).toBe("");
  });

  it("keeps the image provider pinned instead of silently using the other one (G3)", async () => {
    const calls = stubFetch([
      { match: (url) => url.includes("/v1beta/models?"), respond: geminiImageCatalog },
      { match: () => true, respond: offline },
    ]);
    // Gemini is configured and callable; the settings still name OpenAI as the image provider.
    await prepareModel("gemini-image", "gemini-2.5-flash-image", "sk-stub-gemini");
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

  it("leaves the image cost blank - never 0 - while the catalog names no image price (CI-P7-05-01)", async () => {
    stubFetch([
      { match: (url) => url.endsWith("/models"), respond: openAIImageCatalog },
      {
        match: (url) => url.includes("/images/generations"),
        respond: () => jsonResponse({ data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }] }),
      },
    ]);
    await configureImageEndpoint();
    await prepareModel("openai-image", "gpt-image-1", "sk-stub-openai-image");

    await imageFacade.generateImageFile({ prompt: "a cat on a keyboard", contentItemId: "content-unpriced" });

    // The amount this row is billed on *was* measured - one image - and no rate exists for it yet, so
    // the money is `unpriced` and blank. A 0 here would read as "this call was free".
    const [row] = await ledgerRepository.listAiUsageLedgerEntries({ contentItemId: "content-unpriced" });
    expect(row).toMatchObject({ meteredKind: "image", completeness: "reported", costSource: "unpriced" });
    expect(row.costAmount).toBeNull();
    expect(JSON.parse(row.quantityJson)).toEqual({ image: 1 });
  });

  it("states what the image cost once the catalog names an image price (CI-P7-05-01)", async () => {
    stubFetch([
      { match: (url) => url.endsWith("/models"), respond: openAIImageCatalog },
      {
        match: (url) => url.includes("/images/generations"),
        respond: () => jsonResponse({ data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }] }),
      },
    ]);
    await configureImageEndpoint();
    await prepareModel("openai-image", "gpt-image-1", "sk-stub-openai-image");
    // The rate a person typed for this image model, in the currency they are billed in. This is the
    // only price row this file writes, and it is the last case that runs, so nothing inherits it.
    await ledgerRepository.createAiModelPrice({
      providerId: "openai-image",
      modelId: "gpt-image-1",
      meteredKind: "image",
      currency: "USD",
      unitPrice: 0.04,
      unitLabel: "image",
      priceVersion: "2026-10",
    });

    await imageFacade.generateImageFile({ prompt: "a cat on a keyboard", contentItemId: "content-priced" });

    // The row this card is about: one generated image, costed by the catalog, with the unit and the
    // rate frozen onto it so a later edit to the catalog cannot restate what it cost.
    const [row] = await ledgerRepository.listAiUsageLedgerEntries({ contentItemId: "content-priced" });
    expect(row).toMatchObject({
      meteredKind: "image",
      completeness: "reported",
      costSource: "computed",
      costCurrency: "USD",
    });
    expect(row.costAmount).toBeCloseTo(0.04, 6);
    expect(JSON.parse(row.quantityJson)).toEqual({ image: 1 });
    expect(row.pricing).toMatchObject({ meteredKind: "image", unitPrice: 0.04, unitLabel: "image" });
  });
});
