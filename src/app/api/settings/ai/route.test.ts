import { beforeEach, describe, expect, it } from "vitest";

/**
 * `api/settings/ai` on the text/image credential split (CI-AI-IMG-CONFIG-02) and on the image rows the
 * save hands to the runtime (CI-AI-IMG-CONFIG-03).
 *
 * What this file pins, in the vocabulary of the confirmed decisions:
 *
 *  1. **Q1/Q2 - image credentials are their own.** The image key is written to
 *     `credential://openai-image/default` (and `…/gemini-image/default`), never to the text
 *     provider's ref, so a key that signs chat calls can never sign image calls. The two image refs
 *     are cleared explicitly here, because the harness only clears the credentials of *seeded*
 *     providers and the settings row outlives a case.
 *  2. **Q4 - no inheritance.** Saving an image base URL leaves `openAIBaseUrl` alone, and the image
 *     base URL defaults to the empty string ("not configured") rather than to the text endpoint.
 *  3. **No secret round-trip.** GET echoes the image key masked; a masked placeholder or an empty
 *     field posted back is a no-op, so opening and saving the form never clears a key.
 *  4. **A saved URL is effective immediately** (CI-AI-IMG-CONFIG-03): POST reconciles the image
 *     endpoint/model rows in the runtime registry, and an emptied URL leaves that row disabled with an
 *     empty base URL instead of routing anywhere - the state the image request then fails on.
 *
 * The temp database and data directory (which is where the credential vault lives) come from the
 * harness, which must be imported before anything that reads them - hence the `await import`s.
 */
const { credentials, jsonRequest, runtimeRepository } = await import("@/test/route-harness");
const { GET, POST } = await import("./route");
const { getLocalAgentSettings, updateLocalAgentSettings } = await import("@/db/repositories/settings");

type SettingsPayload = {
  openAIBaseUrl: string;
  openAIImageBaseUrl: string;
  openAIImageModel: string;
  openAIImageKey: string;
  geminiImageKey: string;
};

const openAIImageRef = credentials.credentialRefFor("openai-image");
const geminiImageRef = credentials.credentialRefFor("gemini-image");
const openAITextRef = credentials.credentialRefFor("openai");

async function readSettings() {
  const response = await GET();
  const body = (await response.json()) as { ok: boolean; data: SettingsPayload };
  return { response, data: body.data };
}

function save(body: Record<string, unknown>) {
  return POST(jsonRequest("http://localhost/api/settings/ai", body));
}

describe("api/settings/ai image credential split", () => {
  beforeEach(async () => {
    // The settings and credentials of the image providers are reset here, because the harness shares one
    // `app_settings` row and one vault per file: the image refs are cleared explicitly, and the endpoint
    // rows a case's save left behind are cleared by the case that needs a known state.
    await credentials.clearCredential(openAIImageRef);
    await credentials.clearCredential(geminiImageRef);
    await credentials.clearCredential(openAITextRef);
    await updateLocalAgentSettings({ openAIImageBaseUrl: "", openAIImageModel: "" });
  });

  it("reports both image credentials as empty and the image base URL as unset", async () => {
    const { response, data } = await readSettings();

    expect(response.status).toBe(200);
    expect(data.openAIImageKey).toBe("");
    expect(data.geminiImageKey).toBe("");
    expect(data.openAIImageBaseUrl).toBe("");
  });

  it("stores the image key under its own ref and never copies the text base URL", async () => {
    const response = await save({
      openAIImageBaseUrl: "https://images.example.com/v1",
      openAIImageKey: "sk-image-secret",
    });
    expect(response.status).toBe(200);

    const settings = await getLocalAgentSettings();
    expect(settings.openAIImageBaseUrl).toBe("https://images.example.com/v1");
    // The text endpoint is untouched: no inheritance in either direction.
    expect(settings.openAIBaseUrl).toBe("https://api.openai.com/v1");

    expect(await credentials.readCredentialKeys(openAIImageRef)).toEqual(["sk-image-secret"]);
    expect(await credentials.readCredentialKeys(openAITextRef)).toEqual([]);
  });

  it("reconciles the image endpoint on save, so a saved URL is the one the runtime routes to", async () => {
    // The rows an earlier case's save left behind would decide what this case measures, so it starts
    // from the state a fresh install is in: the image settings name nothing and the registry has no
    // image rows.
    await runtimeRepository.deleteModelProvider("openai-image");
    const imageUrl = "https://images.example.com/v1";

    expect((await save({ openAIImageBaseUrl: imageUrl, openAIImageModel: "gpt-image-1" })).status).toBe(200);

    // The endpoint an image request is routed to: the URL the form saved, its own credential ref, and
    // the OpenAI-compatible protocol - none of it shared with the text provider.
    const endpoint = await runtimeRepository.getModelEndpoint("openai-image/default");
    expect(endpoint).toMatchObject({
      providerId: "openai-image",
      baseUrl: imageUrl,
      protocol: "openai-compatible",
      credentialRef: openAIImageRef,
      enabled: true,
    });
    // The model the form named is bound to that endpoint, which is what makes it routable rather than
    // merely listed: a disabled or unbound row would never be a candidate.
    const imageModels = await runtimeRepository.listModels({ providerId: "openai-image" });
    expect(imageModels.map((model) => model.modelId)).toEqual(["gpt-image-1"]);
    expect(imageModels[0]).toMatchObject({ endpointId: "openai-image/default", enabled: true });

    // The text provider receives neither the URL nor the model: no inheritance in either direction (Q4).
    expect((await runtimeRepository.listModelEndpoints("openai")).map((entry) => entry.baseUrl)).not.toContain(imageUrl);
    expect((await runtimeRepository.listModels({ providerId: "openai" })).map((model) => model.modelId)).not.toContain(
      "gpt-image-1",
    );

    // Withdrawing the URL keeps the row - the pasted key and the model-management entry are the user's -
    // but writes it disabled with an empty URL, so routing cannot pick it and the request fails loudly
    // instead of falling back onto `openAIBaseUrl`.
    expect((await save({ openAIImageBaseUrl: "" })).status).toBe(200);
    expect(await runtimeRepository.getModelEndpoint("openai-image/default")).toMatchObject({
      baseUrl: "",
      enabled: false,
      credentialRef: openAIImageRef,
    });
  });

  it("echoes the image key masked and never the plaintext", async () => {
    await save({ openAIImageKey: "sk-image-secret" });

    const { data } = await readSettings();
    expect(data.openAIImageKey).toMatch(/^\*+cret$/);
    expect(JSON.stringify(data)).not.toContain("sk-image-secret");
  });

  it("keeps a stored image key when the form posts the masked placeholder back", async () => {
    await save({ openAIImageKey: "sk-image-secret" });
    const { data } = await readSettings();

    await save({ openAIImageKey: data.openAIImageKey });

    expect(await credentials.readCredentialKeys(openAIImageRef)).toEqual(["sk-image-secret"]);
  });

  it("does not clear the stored image key when the field is emptied", async () => {
    await save({ openAIImageKey: "sk-image-secret" });

    await save({ openAIImageKey: "" });

    expect(await credentials.readCredentialKeys(openAIImageRef)).toEqual(["sk-image-secret"]);
  });

  it("rejects a malformed image base URL without touching the stored setting", async () => {
    const response = await save({ openAIImageBaseUrl: "not-a-url" });

    expect(response.status).toBe(400);
    expect((await getLocalAgentSettings()).openAIImageBaseUrl).toBe("");
  });

  it("persists the image model as the default routing config for later image requests", async () => {
    // Q3: the image model is a persisted default, not a migration - so it must survive the
    // round-trip and be overwritable without touching the text model.
    await save({ openAIImageModel: "gpt-image-1" });
    const persisted = await getLocalAgentSettings();
    expect(persisted.openAIImageModel).toBe("gpt-image-1");
    expect(persisted.openAIModel).toBe("");

    await save({ openAIImageModel: "gpt-image-1-mini" });
    expect((await readSettings()).data.openAIImageModel).toBe("gpt-image-1-mini");
  });
});
