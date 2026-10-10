import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The image providers as registry rows (CI-AI-IMG-CONFIG-03, C1a/C1b).
 *
 * The card's subject is a *routing* fact: an image request must be signed against the endpoint and the
 * credential the user named for images, and against nothing else. `openai` serves text and images from
 * one host, so "the same vendor" used to mean "the same endpoint, key and model row" - which is what the
 * two `imageProviderIds` rows (`openai-image` / `gemini-image`) separate:
 *
 *  1. **The seed creates them** (`syncImageProviderSettings()`, called from `ensureModelRuntimeSeeded()`),
 *     and an endpoint row appears only where a URL resolves. For the OpenAI-compatible side that is the
 *     `openAIImageBaseUrl` field and nothing else - not `openAIBaseUrl`, not `OPENAI_BASE_URL`, not the
 *     `api.openai.com` default (Q4 as ruled for this card). Gemini has no URL field at all (Q2): it keeps
 *     the host its protocol defines, while its *key* is independent.
 *  2. **The legacy model import binds to the image row** (`importLegacyAiSettings()`, C1b): the model the
 *     form names under 图片 is a model of `openai-image` / `gemini-image`, so it can never be reached
 *     through the text provider's endpoint or key.
 *  3. **The sync is additive and idempotent**: it runs on every settings save *and* once per
 *     `seedVersion`, so it must not duplicate rows, must not resurrect what the user turned off, and must
 *     not touch a text provider, endpoint, credential or model.
 *
 * Only the database is real; the transport is a tripwire, because the registry resolves and routes
 * without ever making a request of its own.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-image-provider-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "image-provider.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { aiProviderOrder, aiProviderRegistry, imageProviderDisplayName, imageProviderIds, imageProviderModelEnv } =
  await import("@/features/ai-settings/provider-registry");
const { keylessAppEnvValue } = await import("@/test/app-env");

const { credentialEnvVarNames, credentialRefFor, readCredentialKeys, writeCredential } = await import(
  "@/lib/credentials"
);
const { deleteModelProvider, getModelEndpoint, listModelEndpoints, listModelProviders, listModels, upsertModelProvider } =
  await import("@/db/repositories/ai-runtime");
const { updateLocalAgentSettings } = await import("@/db/repositories/settings");
const registry = await import("./registry");

const imageBaseUrl = "https://images.example.test/v1";
const openAIImageId = imageProviderIds.openai;
const geminiImageId = imageProviderIds.gemini;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

/**
 * The registry never calls a provider while it seeds, imports or routes; if that changes, the count is
 * how a case says so instead of the suite reaching a real host. This file stubs no provider answers, so
 * an accidental request would otherwise leave the machine.
 */
function refuseNetwork() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ error: { message: "unexpected call" } }, 503);
    }),
  );
  return calls;
}

/**
 * "Not configured", stated the way a fresh install states it: no legacy model name, no operator base
 * URL and no key anywhere. The key variables are *neutralised* rather than deleted - deleting one hands
 * it back to the app env file, which on a developer machine holds real keys and would have the seed
 * discover a catalog (`src/test/app-env.ts` pins them for the whole run; repeating it per case keeps the
 * sentinel a case overwrote from leaking into the next).
 */
function clearInstallEnv() {
  for (const name of [
    ...aiProviderOrder.map((provider) => aiProviderRegistry[provider].modelEnv),
    ...Object.values(imageProviderModelEnv),
  ]) {
    if (name) {
      delete process.env[name];
    }
  }
  for (const name of aiProviderOrder.map((provider) => aiProviderRegistry[provider].baseUrlEnv)) {
    if (name) {
      delete process.env[name];
    }
  }
  for (const providerId of Object.values(imageProviderIds)) {
    for (const name of credentialEnvVarNames(providerId)) {
      process.env[name] = keylessAppEnvValue;
    }
  }
}

const providerIdsOf = async () => (await listModelProviders()).map((provider) => provider.providerId);

describe("image providers as registry rows", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    clearInstallEnv();
    // One seeded install for the whole file; each case then states the image settings it is about and
    // calls the function under test itself.
    await updateLocalAgentSettings({
      imageProvider: "openai",
      openAIImageBaseUrl: "",
      openAIImageModel: "",
      geminiImageModel: "",
    });
    await registry.ensureModelRuntimeSeeded();
    for (const providerId of [openAIImageId, geminiImageId]) {
      await deleteModelProvider(providerId);
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("seeds a row per image provider, with an endpoint only where a URL resolves (C1a, Q4)", async () => {
    const calls = refuseNetwork();
    // The two spellings a *text* install may hold in its environment. Neither is an image URL, and the
    // built-in default host is not one either: the OpenAI-compatible image endpoint comes from the form.
    process.env.OPENAI_BASE_URL = "https://text-endpoint.example/v1";
    process.env.OPENAI_IMAGE_BASE_URL = "https://an-image-url-that-is-not-the-field.example/v1";
    // What the text provider looked like before the image sync ran: the sync may not move it.
    const textBefore = (await getModelEndpoint("openai/default"))?.baseUrl;

    await registry.syncImageProviderSettings();

    expect(calls).toEqual([]);
    expect(await providerIdsOf()).toEqual(expect.arrayContaining([openAIImageId, geminiImageId]));
    const providers = await listModelProviders();
    // The label 系统 / 模型管理 shows: a row of its own next to the text provider of the same vendor.
    expect(providers.find((row) => row.providerId === openAIImageId)?.name).toBe(imageProviderDisplayName.openai);
    expect(providers.find((row) => row.providerId === geminiImageId)?.name).toBe(imageProviderDisplayName.gemini);

    // No URL was ever named for images, so there is no image endpoint to route to - and neither spelling
    // above became one.
    expect(await listModelEndpoints(openAIImageId)).toEqual([]);
    // The text endpoint is exactly where it was: additive in both directions.
    expect((await getModelEndpoint("openai/default"))?.baseUrl).toBe(textBefore);

    // Gemini serves images from the host its protocol defines, so no field is invented for it (Q2) - and
    // what it does own is its credential.
    expect(await listModelEndpoints(geminiImageId)).toEqual([
      expect.objectContaining({
        endpointId: `${geminiImageId}/default`,
        providerId: geminiImageId,
        protocol: "gemini",
        baseUrl: aiProviderRegistry.gemini.defaultBaseUrl,
        credentialRef: credentialRefFor(geminiImageId),
        enabled: true,
      }),
    ]);
  });

  it("binds the model the image form names to the image provider, never to the text one (C1b)", async () => {
    refuseNetwork();
    await updateLocalAgentSettings({
      openAIImageBaseUrl: imageBaseUrl,
      openAIImageModel: "gpt-image-1",
      geminiImageModel: "gemini-2.5-flash-image",
    });

    await registry.syncImageProviderSettings();
    await registry.importLegacyAiSettings();
    // The key the form would have saved beside them: routing only ever picks a model it can sign for
    // (`MODEL_CREDENTIAL_MISSING` is what the runtime answers without one), and this key belongs to the
    // image ref - the text one stays empty.
    await writeCredential(credentialRefFor(openAIImageId), "sk-image-openai");

    // Both rows the form names are models of their *image* provider, enabled because their endpoint is.
    const openaiModels = await listModels({ providerId: openAIImageId });
    const geminiModels = await listModels({ providerId: geminiImageId });
    expect(openaiModels.map((model) => model.modelId)).toEqual(["gpt-image-1"]);
    expect(openaiModels[0]).toMatchObject({ endpointId: `${openAIImageId}/default`, enabled: true });
    expect(openaiModels[0].capabilities.filter((entry) => entry.supported).map((entry) => entry.capability)).toContain(
      "image_generation",
    );
    expect(geminiModels.map((model) => model.modelId)).toEqual(["gemini-2.5-flash-image"]);
    expect(geminiModels[0]).toMatchObject({ endpointId: `${geminiImageId}/default`, enabled: true });

    // The text provider gained nothing: this is the line C1b draws, and before this card the image model
    // sat on `openai/default`, sharing its endpoint and its key.
    expect((await listModels({ providerId: "openai" })).map((model) => model.modelId)).not.toContain("gpt-image-1");

    // Routing agrees: the pinned image provider holds the one candidate, and the text provider holds none
    // at all - so an image request there can only fail, never call.
    const pinned = await registry.resolveRoute({ capability: "image_generation", providerId: openAIImageId });
    expect(pinned.candidate).toMatchObject({
      provider: { providerId: openAIImageId },
      endpoint: { endpointId: `${openAIImageId}/default`, baseUrl: imageBaseUrl },
      model: { modelId: "gpt-image-1" },
    });
    const throughText = await registry.resolveRoute({ capability: "image_generation", providerId: "openai" });
    expect(throughText.candidates).toEqual([]);
    expect(throughText.explanation?.reason).toBe("no-models-synced");
  });

  it("keeps a name, a provenance or an enable state the user changed (additive and idempotent)", async () => {
    refuseNetwork();
    await updateLocalAgentSettings({ openAIImageBaseUrl: imageBaseUrl, openAIImageModel: "gpt-image-1" });
    await registry.syncImageProviderSettings();

    // What 系统 / 模型管理 can change: the label, the provenance and the switch. The sync runs on every
    // settings save *and* once per `seedVersion`, so none of the three may be written back.
    await upsertModelProvider({
      providerId: openAIImageId,
      name: "My image host",
      source: "user",
      enabled: false,
    });

    await registry.syncImageProviderSettings();
    await registry.syncImageProviderSettings();

    const provider = (await listModelProviders()).find((row) => row.providerId === openAIImageId);
    expect(provider).toMatchObject({ name: "My image host", source: "user", enabled: false });
    // One row, not three: the endpoint id is a key, so re-running the sync re-points it instead of
    // adding a copy.
    expect(await listModelEndpoints(openAIImageId)).toEqual([
      expect.objectContaining({ endpointId: `${openAIImageId}/default`, baseUrl: imageBaseUrl }),
    ]);
    expect((await listModels({ providerId: openAIImageId })).map((model) => model.modelId)).toEqual(["gpt-image-1"]);
  });

  it("writes the image endpoint disabled when the URL is withdrawn and enables it again when it returns (Q4)", async () => {
    refuseNetwork();
    await writeCredential(credentialRefFor(openAIImageId), "sk-image-openai");
    await updateLocalAgentSettings({ openAIImageBaseUrl: imageBaseUrl, openAIImageModel: "gpt-image-1" });
    await registry.syncImageProviderSettings();

    const [configured] = await listModelEndpoints(openAIImageId);
    expect(configured).toMatchObject({ baseUrl: imageBaseUrl, enabled: true });
    const routable = await registry.resolveRoute({ capability: "image_generation", providerId: openAIImageId });
    expect(routable.candidate?.model.modelId).toBe("gpt-image-1");

    // The form saved an empty field. The row stays (the pasted key and the model-management entry are the
    // user's) but nothing can route through it, and the diagnosis says which of the two it is.
    await updateLocalAgentSettings({ openAIImageBaseUrl: "" });
    await registry.syncImageProviderSettings();

    expect(await listModelEndpoints(openAIImageId)).toEqual([
      expect.objectContaining({ baseUrl: "", enabled: false, credentialRef: credentialRefFor(openAIImageId) }),
    ]);
    const withdrawn = await registry.resolveRoute({ capability: "image_generation", providerId: openAIImageId });
    expect(withdrawn.candidates).toEqual([]);
    expect(withdrawn.explanation).toEqual({ reason: "endpoint-disabled", missing: [] });
    // The model row is the same row - the sync deletes no knowledge - it is simply unroutable now.
    expect((await listModels({ providerId: openAIImageId })).map((model) => model.modelId)).toEqual(["gpt-image-1"]);

    // Filling the field in again re-enables that endpoint, and the model becomes callable again.
    await updateLocalAgentSettings({ openAIImageBaseUrl: imageBaseUrl });
    await registry.syncImageProviderSettings();

    expect(await listModelEndpoints(openAIImageId)).toEqual([
      expect.objectContaining({ baseUrl: imageBaseUrl, enabled: true }),
    ]);
    const restored = await registry.resolveRoute({ capability: "image_generation", providerId: openAIImageId });
    expect(restored.candidate).toMatchObject({
      endpoint: { endpointId: `${openAIImageId}/default` },
      model: { modelId: "gpt-image-1" },
    });
  });

  it("keeps gemini's key independent while its host stays the protocol default (Q2)", async () => {
    refuseNetwork();
    // The same vendor, two keys: text and images are billed and rotated separately (Q1).
    await writeCredential(credentialRefFor("gemini"), "sk-text-gemini");
    await writeCredential(credentialRefFor(geminiImageId), "sk-image-gemini");
    // ...and a field naming an OpenAI-compatible host is not a Gemini host, whatever it says.
    await updateLocalAgentSettings({ openAIImageBaseUrl: imageBaseUrl });

    await registry.syncImageProviderSettings();

    expect(await readCredentialKeys(credentialRefFor(geminiImageId))).toEqual(["sk-image-gemini"]);
    expect(await readCredentialKeys(credentialRefFor("gemini"))).toEqual(["sk-text-gemini"]);
    // Gemini's endpoint signs with the image credential, not with the text one, while its base URL stays
    // the host its protocol defines - there is no field of its own that could inherit the OpenAI image URL.
    expect(await listModelEndpoints(geminiImageId)).toEqual([
      expect.objectContaining({
        baseUrl: aiProviderRegistry.gemini.defaultBaseUrl,
        credentialRef: credentialRefFor(geminiImageId),
      }),
    ]);
    expect(await getModelEndpoint("gemini/default")).toMatchObject({
      baseUrl: aiProviderRegistry.gemini.defaultBaseUrl,
      credentialRef: credentialRefFor("gemini"),
    });
  });
});

