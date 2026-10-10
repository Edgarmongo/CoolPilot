import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end look at the runtime against a throwaway SQLite file: seeding, catalog
 * sync, credential gating, capability routing and the unified chat call. The provider
 * is stubbed at `fetch`, so no real key or network access is involved.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-runtime-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "runtime.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { aiProviderOrder, aiProviderRegistry } = await import("@/features/ai-settings/provider-registry");

/**
 * The model names a legacy install may have exported, cleared before anything seeds.
 *
 * `ensureModelRuntimeSeeded()` runs the legacy import (G2), which turns `<PROVIDER>_MODEL` into a
 * real, enabled model row - so an ambient `GEMINI_MODEL` would hand these tests a second callable
 * provider and make the routing assertions describe the developer's shell instead of the runtime.
 * The key variables are not handled here: `src/test/app-env.ts` pins every one of them for the whole
 * run, which is also what keeps the seed's catalog discovery (D-P3-1) off the network.
 */
const legacyModelEnvVars: string[] = [
  ...aiProviderOrder.map((provider) => aiProviderRegistry[provider].modelEnv).filter((name) => Boolean(name)),
  "GEMINI_IMAGE_MODEL",
  "OPENAI_IMAGE_MODEL",
];
for (const name of legacyModelEnvVars) {
  delete process.env[name];
}

const registry = await import("./registry");
const sync = await import("./sync");
const runtime = await import("./runtime");
const trail = await import("./trail");
const probe = await import("./probe");
const repository = await import("@/db/repositories/ai-runtime");
const settings = await import("@/db/repositories/settings");
const credentials = await import("@/lib/credentials");
const snapshot = await import("@/features/ai-settings/model-gateway-snapshot");

const qwenRef = credentials.credentialRefFor("qwen");
const catalogPayload = { data: [{ id: "qwen3-max" }, { id: "qwen-vl-max" }, { id: "wan2.5-t2v" }] };

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function stubProvider(options: { chatStatus?: number } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/models")) {
        return jsonResponse(catalogPayload);
      }
      if (url.includes("/chat/completions")) {
        if (options.chatStatus && options.chatStatus >= 400) {
          return jsonResponse({ error: { message: "boom" } }, options.chatStatus);
        }
        return jsonResponse({
          choices: [{ message: { content: "pong" } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        });
      }
      return jsonResponse({}, 404);
    }),
  );
  return calls;
}

/**
 * Makes one provider/model really callable, independently of what earlier tests did:
 * store a key, sync the catalog (creates + enables the rows), keep exactly the one model
 * the assertions reason about.
 */
async function prepareChatModel(providerId: string, modelId: string, credential: string) {
  await registry.ensureModelRuntimeSeeded();
  await credentials.writeCredential(credentials.credentialRefFor(providerId), credential);
  await sync.syncProviderCatalog(providerId);
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

describe("ai runtime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("seeds providers, endpoints and the gateway catalog as knowledge only", async () => {
    await registry.ensureModelRuntimeSeeded();

    const providers = await repository.listModelProviders();
    expect(providers.map((provider) => provider.providerId)).toEqual(
      expect.arrayContaining(["openai", "gemini", "qwen", "deepseek", "zhipu", "gateway"]),
    );

    const [endpoint] = (await repository.listModelEndpoints("qwen")).filter(
      (entry) => entry.endpointId === "qwen/default",
    );
    expect(endpoint?.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(endpoint?.protocol).toBe("openai-compatible");
    expect(endpoint?.credentialRef).toBe("credential://qwen/default");

    // Anthropic has no OpenAI-compatible endpoint, so it stays visible but unroutable.
    expect(await repository.listModelEndpoints("anthropic")).toEqual([]);

    const gatewayModels = await repository.listModels({ providerId: "gateway", limit: 4000 });
    expect(gatewayModels).toHaveLength(snapshot.modelGatewayModels.length);
    expect(gatewayModels.every((model) => !model.enabled && model.endpointId === "")).toBe(true);

    // Seeding is idempotent.
    await registry.ensureModelRuntimeSeeded();
    expect(await repository.listModelProviders()).toHaveLength(providers.length);
  });

  it("syncs a catalog, keeps it callable and routes by capability", async () => {
    stubProvider();
    await credentials.writeCredential(qwenRef, "sk-qwen-test");

    const result = await sync.syncProviderCatalog("qwen");
    expect(result).toMatchObject({ status: "ok", modelCount: 3, created: 3 });

    const synced = await repository.listModels({ providerId: "qwen" });
    const chatModel = synced.find((model) => model.modelId === "qwen3-max");
    expect(chatModel?.enabled).toBe(true);
    expect(chatModel?.endpointId).toBe("qwen/default");
    expect(chatModel?.capabilities.map((entry) => entry.capability)).toEqual(
      expect.arrayContaining(["chat", "tool_calling", "structured_output"]),
    );
    expect(synced.find((model) => model.modelId === "wan2.5-t2v")?.modelType).toBe("video");

    // The user's default wins over the alphabetical tie-break.
    await registry.setModelDefaultForCapability("chat", chatModel?.id ?? "");
    const response = await runtime.chat({ messages: [{ role: "user", content: "ping" }] });
    expect(response.text).toBe("pong");
    expect(response.model).toBe("qwen3-max");
    expect(response.route).toMatchObject({
      providerId: "qwen",
      reason: "capability-default",
      protocol: "openai-compatible",
    });
    expect(response.usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });

    const chatCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("/chat/completions"));
    expect(String(chatCall?.[0])).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    const headers = (chatCall?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-qwen-test");
    expect(JSON.parse(String(chatCall?.[1]?.body))).toMatchObject({ model: "qwen3-max", temperature: 0.7 });
  });

  it("relaxes optional capabilities instead of failing the request", async () => {
    stubProvider();
    await credentials.writeCredential(qwenRef, "sk-qwen-test");

    const strict = await runtime.chat({ messages: [{ role: "user", content: "hi" }], json: true });
    expect(strict.route.requirement.capabilities).toEqual(expect.arrayContaining(["chat", "structured_output"]));

    // A model without JSON mode must not block the call: the relaxed requirement asks
    // for chat only, and the route records exactly that.
    const [chatModel] = (await repository.listModels({ providerId: "qwen" })).filter(
      (model) => model.modelId === "qwen3-max",
    );
    await repository.setModelCapability({
      modelRowId: chatModel.id,
      capability: "structured_output",
      supported: false,
      source: "USER_OVERRIDE",
    });

    const relaxed = await runtime.chat({ messages: [{ role: "user", content: "hi" }], json: true });
    expect(relaxed.route.requirement.capabilities).toEqual(["chat"]);
  });

  it("stops with a credential error instead of calling a provider without a key", async () => {
    const calls = stubProvider();
    await credentials.writeCredential(qwenRef, "");

    const resolution = await registry.resolveRoute({ capabilities: ["chat"] });
    expect(resolution.candidate).toBeNull();
    expect(resolution.explanation?.reason).toBe("credential-missing");
    expect(calls).toHaveLength(0);
    await expect(runtime.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      code: "MODEL_CREDENTIAL_MISSING",
    });

    await credentials.writeCredential(qwenRef, "sk-qwen-test");
  });

  it("records a probe as PROBE_TEST, which outranks the name rules", async () => {
    stubProvider();
    const [chatModel] = (await repository.listModels({ providerId: "qwen" })).filter(
      (model) => model.modelId === "qwen3-max",
    );

    const record = await probe.probeModelCapability({ modelRowId: chatModel.id, capability: "tool_calling" });
    expect(record).toMatchObject({ status: "ok", capability: "tool_calling" });

    expect(await repository.listProbeRecords(chatModel.id)).toHaveLength(1);
    const refreshed = await repository.getModelRow(chatModel.id);
    expect(refreshed?.capabilities.find((entry) => entry.capability === "tool_calling")?.source).toBe("PROBE_TEST");
  });

  it("surfaces upstream failures with the provider's status", async () => {
    stubProvider({ chatStatus: 500 });
    await expect(runtime.chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      code: "MODEL_UPSTREAM_FAILED",
    });
  });

  it("rotates to the next key when the provider rejects the first one", async () => {
    const authorizations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        authorizations.push(((init?.headers ?? {}) as Record<string, string>).Authorization ?? "");
        if (authorizations.length === 1) {
          return jsonResponse({ error: { message: "invalid key" } }, 401);
        }
        return jsonResponse({ choices: [{ message: { content: "pong" } }] });
      }),
    );
    await credentials.writeCredential(qwenRef, "sk-qwen-bad\nsk-qwen-good");

    const response = await runtime.chat({ messages: [{ role: "user", content: "ping" }] });

    expect(authorizations).toEqual(["Bearer sk-qwen-bad", "Bearer sk-qwen-good"]);
    expect(response.text).toBe("pong");
    expect(response.credentialLabel.endsWith("good")).toBe(true);
    // CI-P7-01-04: the trail is every request the call sent - the rejected key and then the one that
    // answered - so it says what ran, not only what did not.
    expect(response.attempts).toHaveLength(2);
    expect(response.attempts[0]).toMatchObject({
      providerId: "qwen",
      modelId: "qwen3-max",
      kind: "answer",
      outcome: "failed",
    });
    expect(response.attempts[0].error).toContain("HTTP 401");
    expect(response.attempts[1]).toMatchObject({ outcome: "success", credentialLabel: response.credentialLabel });
  });

  it("stops at a rejected request instead of burning the whole candidate chain", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return jsonResponse({ error: { message: "bad request" } }, 400);
      }),
    );
    await credentials.writeCredential(qwenRef, "sk-qwen-one\nsk-qwen-two");

    const failure: unknown = await runtime
      .chat({ messages: [{ role: "user", content: "ping" }] })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "MODEL_UPSTREAM_FAILED" });
    // One call: a 400 is not the key's fault, and another key would say exactly the same.
    expect(calls).toHaveLength(1);
    // CI-P7-01-04: the request that failed travels with the error, so a caller can record a call the
    // provider may still have billed for - which is the whole point of a ledger. The empty key label
    // is the pool saying "this failure was not the key's", not a claim that nothing was sent.
    expect(trail.modelAttemptsFrom(failure)).toEqual([
      expect.objectContaining({ kind: "answer", outcome: "failed", providerId: "qwen", credentialLabel: "" }),
    ]);
  });

  it("falls over to the next candidate model when one keeps failing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/models")) {
          return jsonResponse(url.includes("deepseek") ? { data: [{ id: "deepseek-chat" }] } : catalogPayload);
        }
        if (url.includes("deepseek")) {
          return jsonResponse({ choices: [{ message: { content: "pong-from-deepseek" } }] });
        }
        return jsonResponse({ error: { message: "boom" } }, 503);
      }),
    );

    const deepseekRef = credentials.credentialRefFor("deepseek");
    await credentials.writeCredential(qwenRef, "sk-qwen-test");
    await credentials.writeCredential(deepseekRef, "sk-deepseek-test");
    await sync.syncProviderCatalog("qwen");
    await sync.syncProviderCatalog("deepseek");

    // Keep exactly two candidates, so the failover chain is a deliberate one.
    const qwenModels = await repository.listModels({ providerId: "qwen" });
    await repository.setModelsEnabled(
      qwenModels.filter((model) => model.modelId !== "qwen3-max").map((model) => model.id),
      false,
    );
    const qwenChat = qwenModels.find((model) => model.modelId === "qwen3-max");
    await registry.setModelDefaultForCapability("chat", qwenChat?.id ?? "");

    const response = await runtime.chat({ messages: [{ role: "user", content: "ping" }] });

    expect(response.text).toBe("pong-from-deepseek");
    expect(response.providerId).toBe("deepseek");
    expect(response.model).toBe("deepseek-chat");
    expect(response.attempts[0]).toMatchObject({ providerId: "qwen", modelId: "qwen3-max" });
    // The route names the model that actually ran; the failed attempt stays visible.
    expect(response.route.providerId).toBe("deepseek");
    expect(response.credentialLabel.endsWith("test")).toBe(true);
  });

  it("never falls over when the caller pinned a provider (D2: no silent downgrade)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/models")) {
          return jsonResponse(url.includes("deepseek") ? { data: [{ id: "deepseek-chat" }] } : catalogPayload);
        }
        if (url.includes("deepseek")) {
          return jsonResponse({ choices: [{ message: { content: "pong-from-deepseek" } }] });
        }
        return jsonResponse({ error: { message: "boom" } }, 503);
      }),
    );

    await prepareChatModel("qwen", "qwen3-max", "sk-qwen-test");
    await prepareChatModel("deepseek", "deepseek-chat", "sk-deepseek-test");

    // A healthy deepseek model exists, but the caller asked for qwen by name.
    await expect(
      runtime.chat({ messages: [{ role: "user", content: "ping" }], providerId: "qwen" }),
    ).rejects.toMatchObject({ code: "MODEL_UPSTREAM_FAILED" });
    expect(calls.filter((url) => url.includes("deepseek") && !url.endsWith("/models"))).toEqual([]);
  });

  it("keeps the key state in the database, never the key", async () => {
    // Stubbed transport on purpose: a real 401 here would (correctly) retire the key and
    // poison every later test - health is state, and the test must control it.
    stubProvider();
    const qwenChat = await prepareChatModel("qwen", "qwen3-max", "sk-qwen-test");
    await registry.setModelDefaultForCapability("chat", qwenChat?.id ?? "");
    const response = await runtime.chat({ messages: [{ role: "user", content: "ping" }] });
    expect(response.text).toBe("pong");

    const records = await repository.listCredentialKeys(qwenRef);
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => /^[0-9a-f]{64}$/.test(record.fingerprint))).toBe(true);
    expect(records.some((record) => record.fingerprint === "sk-qwen-test")).toBe(false);
    // The call that just succeeded is recorded as such, and the masked tail is all we keep.
    expect(records.some((record) => record.status === "ok" && record.useCount > 0)).toBe(true);
  });

  it("prefers a provider without pinning it (G1: preference still falls over)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/models")) {
          return jsonResponse(url.includes("deepseek") ? { data: [{ id: "deepseek-chat" }] } : catalogPayload);
        }
        // The preferred provider is down; the runtime must still get an answer elsewhere.
        if (url.includes("dashscope")) {
          return jsonResponse({ error: { message: "boom" } }, 503);
        }
        return jsonResponse({ choices: [{ message: { content: "pong" } }] });
      }),
    );
    const qwenChat = await prepareChatModel("qwen", "qwen3-max", "sk-qwen-test");
    await prepareChatModel("deepseek", "deepseek-chat", "sk-deepseek-test");
    await registry.setModelDefaultForCapability("chat", qwenChat?.id ?? "");

    const resolution = await registry.resolveRoute({ capabilities: ["chat"], preferProviderId: "qwen" });
    expect(resolution.candidates[0]?.provider.providerId).toBe("qwen");
    expect(resolution.candidates.length).toBeGreaterThan(1);

    // A pin is a different thing: it really does shrink the chain to one provider.
    const pinned = await registry.resolveRoute({ capabilities: ["chat"], providerId: "qwen" });
    expect(pinned.candidates.every((candidate) => candidate.provider.providerId === "qwen")).toBe(true);

    const response = await runtime.chat({ messages: [{ role: "user", content: "ping" }], preferProviderId: "qwen" });
    expect(response.providerId).not.toBe("qwen");
    expect(response.attempts[0]).toMatchObject({ providerId: "qwen", modelId: "qwen3-max" });
  });

  it("imports the legacy settings once and then stays idempotent (G2)", async () => {
    // A user who configured a model in the legacy form / env: that choice must survive the
    // migration, so the import turns it into a registry row plus a capability default.
    await settings.updateLocalAgentSettings({ textProvider: "groq", groqModel: "llama-3.3-70b-versatile" });
    await credentials.writeCredential(credentials.credentialRefFor("groq"), "sk-groq-test");

    const first = await registry.importLegacyAiSettings();
    expect(first.preferredProviderId).toBe("groq");
    expect(first.entries).toContainEqual(
      expect.objectContaining({ providerId: "groq", modelId: "llama-3.3-70b-versatile", action: "created" }),
    );

    const imported = (await repository.listModels({ providerId: "groq" })).find(
      (model) => model.modelId === "llama-3.3-70b-versatile",
    );
    expect(imported?.enabled).toBe(true);
    expect(imported?.endpointId).toBe("groq/default");
    expect(imported?.capabilities.map((entry) => entry.capability)).toContain("chat");

    // The chat default belongs to another model, so this run must not touch it.
    expect(first.defaults).toContainEqual(expect.objectContaining({ capability: "chat", action: "kept" }));

    // Second run changes nothing - the bridge is safe to call on every boot.
    const second = await registry.importLegacyAiSettings();
    expect(second.entries.every((entry) => entry.action === "kept")).toBe(true);
    expect(second.defaults.every((entry) => entry.action === "kept")).toBe(true);

    // The preference is read live, so dropping the capability default puts groq first.
    const qwenDefault = (await repository.listModels({ providerId: "qwen" })).find(
      (model) => model.modelId === "qwen3-max",
    );
    await registry.setModelDefaultForCapability("chat", null);
    expect(await registry.loadPreferredProviderId()).toBe("groq");
    const resolution = await registry.resolveRoute({ capabilities: ["chat"] });
    expect(resolution.candidates[0]?.provider.providerId).toBe("groq");
    await registry.setModelDefaultForCapability("chat", qwenDefault?.id ?? "");

    await settings.updateLocalAgentSettings({ textProvider: "gemini", groqModel: "" });
  });

  it("retries once when a model answers with invalid JSON (G5)", async () => {
    const answers = ["not json at all", JSON.stringify({ title: "ok" })];
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/models")) return jsonResponse(catalogPayload);
        // Only chat calls advance the script: the catalog sync above must not consume one.
        chatCalls += 1;
        return jsonResponse({
          choices: [{ message: { content: answers[Math.min(chatCalls - 1, answers.length - 1)] } }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        });
      }),
    );
    const qwenChat = await prepareChatModel("qwen", "qwen3-max", "sk-qwen-test");
    await repository.setModelCapability({
      modelRowId: qwenChat?.id ?? "",
      capability: "structured_output",
      supported: true,
      source: "USER_OVERRIDE",
    });
    await registry.setModelDefaultForCapability("chat", qwenChat?.id ?? "");
    // The default is what routes the call to qwen; make that dependency explicit.
    expect((await registry.loadModelDefaults()).chat?.modelId).toBe("qwen3-max");

    const result = await runtime.chatStructured({
      messages: [{ role: "user", content: "give me a title" }],
      schema: z.object({ title: z.string() }),
    });

    expect(result.data).toEqual({ title: "ok" });
    expect(result.retried).toBe(true);
    expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 6, totalTokens: 10 });
    expect(result.model).toBe("qwen3-max");
    // `json: true` asks for structured output, and the route reports that it was enforced.
    expect(result.route.requirement.capabilities).toEqual(
      expect.arrayContaining(["chat", "structured_output"]),
    );
    expect(chatCalls).toBe(2);
    // CI-P7-01-04: two requests really went out, so the trail reports two - the first answer and the
    // re-ask marked as the correction it is. `usage` above is their sum, a display figure; these are
    // what each request reported, which is what lets a ledger charge for both.
    expect(result.attempts.map((entry) => entry.kind)).toEqual(["answer", "self-correction"]);
    expect(result.attempts.map((entry) => entry.outcome)).toEqual(["success", "success"]);
    expect(result.attempts.map((entry) => entry.usage)).toEqual([
      { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    ]);

    const retryBody = JSON.parse(
      String(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/chat/completions")).at(-1)?.[1]?.body),
    ) as {
      messages: Array<{ role: string; content: string }>;
      response_format?: { type?: string };
    };
    expect(retryBody.response_format).toEqual({ type: "json_object" });
    expect(retryBody.messages.at(-1)?.content).toContain("could not be used");
    expect(retryBody.messages.at(-2)?.role).toBe("assistant");
  });

  it("reports structured output that never validates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/models")
          ? jsonResponse(catalogPayload)
          : jsonResponse({ choices: [{ message: { content: "still not json" } }] }),
      ),
    );
    const qwenChat = await prepareChatModel("qwen", "qwen3-max", "sk-qwen-test");
    await registry.setModelDefaultForCapability("chat", qwenChat?.id ?? "");

    const failure: unknown = await runtime
      .chatStructured({ messages: [{ role: "user", content: "title" }], schema: z.object({ title: z.string() }) })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "AI_STRUCTURED_OUTPUT_INVALID" });
    // CI-P7-01-04: neither answer was usable and both requests were really sent, so both are in the
    // trail the error carries - which is what gives the ledger two rows for a call that produced
    // nothing, instead of the none it used to record.
    expect(trail.modelAttemptsFrom(failure).map((entry) => entry.kind)).toEqual(["answer", "self-correction"]);
    expect(trail.modelAttemptsFrom(failure).map((entry) => entry.outcome)).toEqual(["success", "success"]);
  });
});
