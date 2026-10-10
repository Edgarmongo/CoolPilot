import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/app-errors";

/**
 * `lib/scraper.ts` on the runtime (batch P3-A1 of `docs/generate-migration-p3.md`).
 *
 * The two generators keep their signatures and their prompt builders, so what these cases pin is
 * exactly what the runtime decides for them now: that the request really is the structured-output
 * shape, that provider/model/usage are the ones that really answered (L1/L2), that key rotation and
 * model failover still rescue a call (L3/L4/L5), and that the error vocabulary consumers branch on
 * survives the migration (D-P3-3: `MODEL_CREDENTIAL_*` passes through unwrapped, everything else is
 * still `AI rewrite failed: ...`).
 *
 * Nothing below goes through `lib/ai/generate.ts` or its compat shim - the point of the batch is that
 * this path stands on its own - so the design table of the batch is what the assertions follow.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-scraper-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "scraper.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { rewriteArticle, generateTopicPost } = await import("./scraper");
const registry = await import("@/features/ai-runtime/registry");
const runtimeSync = await import("@/features/ai-runtime/sync");
const repository = await import("@/db/repositories/ai-runtime");
const credentials = await import("@/lib/credentials");
const { aiProviderOrder, aiProviderRegistry } = await import("@/features/ai-settings/provider-registry");
const { keylessAppEnvValue } = await import("@/test/app-env");

const qwenRef = credentials.credentialRefFor("qwen");

/**
 * The env a configured legacy install may have exported. Model names are deleted (the seed's legacy
 * import reads them, and empty is what "not configured" means there) and key variables are neutralised
 * - handing them back to `.env.local` would let the seed discover a catalog for a provider this test
 * never configured (D-P3-1). This mirrors `src/lib/ai/generate.test.ts`; `src/test/app-env.ts` already
 * pins the keys for the whole run, and repeating it per test stops one case from leaking into the next.
 */
const legacyModelEnvVars: string[] = [
  ...new Set([
    ...aiProviderOrder.map((provider) => aiProviderRegistry[provider].modelEnv).filter((name) => Boolean(name)),
    "GEMINI_IMAGE_MODEL",
    "OPENAI_IMAGE_MODEL",
  ]),
];
const legacyKeyEnvVars = ["QWEN_API_KEYS", "QWEN_API_KEY", "DEEPSEEK_API_KEYS", "DEEPSEEK_API_KEY"];

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

type RecordedCall = { url: string; init?: RequestInit };

type StubRoute = { match: (url: string) => boolean; respond: () => Response };

function stubFetch(routes: StubRoute[]) {
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

type RequestBody = {
  model?: string;
  temperature?: number;
  response_format?: unknown;
  messages?: Array<{ role: string; content: string }>;
};

/** The chat turns only: a catalog read also carries an `Authorization` header but is not a call. */
const chatCalls = (calls: RecordedCall[]) => calls.filter((call) => call.url.includes("/chat/completions"));

const bodyOf = (call: RecordedCall | undefined) => JSON.parse(String(call?.init?.body)) as RequestBody;

const authorizationOf = (init?: RequestInit) => ((init?.headers ?? {}) as Record<string, string>).Authorization;

const authorizationsOf = (calls: RecordedCall[]) => chatCalls(calls).map((call) => authorizationOf(call.init));

const qwenCatalog = () => jsonResponse({ data: [{ id: "qwen3-max" }] });
const deepseekCatalog = () => jsonResponse({ data: [{ id: "deepseek-chat" }] });

/** What a model answers when it understood the schema: the draft as JSON, plus usage to report. */
function draftReply(draft: { title: string; body: string }, usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }) {
  return jsonResponse({ choices: [{ message: { content: JSON.stringify(draft) } }], usage });
}

const unauthorized = () => jsonResponse({ error: { message: "invalid key" } }, 401);
const unavailable = () => jsonResponse({ error: { message: "boom" } }, 503);
const rejected = () => jsonResponse({ error: { message: "bad request" } }, 400);

/**
 * Blank slate: nothing callable, no key in the process, no vault entry, no capability default left
 * over from an earlier case (a default would outrank the provider order these cases reason about).
 */
async function resetRuntime() {
  for (const name of legacyKeyEnvVars) {
    process.env[name] = keylessAppEnvValue;
  }
  for (const name of legacyModelEnvVars) {
    delete process.env[name];
  }
  await registry.ensureModelRuntimeSeeded();
  for (const provider of await repository.listModelProviders()) {
    await repository.setModelsEnabledByProvider(provider.providerId, false);
    await credentials.clearCredential(credentials.credentialRefFor(provider.providerId));
  }
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

/**
 * The two budget states a call site's refusal case needs (CI-P7-03), stated here the way this file
 * states its other fixtures: `src/test/route-harness.ts` keeps the shared copy, and this file - like
 * `src/lib/ai/generate.test.ts` - owns its own database, transport and credential pool instead.
 *
 * `refuseEveryAiBudgetCall()` is a refusal no catalog can accidentally satisfy: the limit is 0 and
 * `unknownCostPolicy: "block"` also refuses a call whose cost cannot be stated, so the refusal is the
 * user's settings speaking rather than a missing price row.
 */
async function refuseEveryAiBudgetCall() {
  const { updateAiBudgetSettings } = await import("@/db/repositories/settings");
  await updateAiBudgetSettings({ policy: "block", monthlyLimit: 0, currency: "CNY", unknownCostPolicy: "block" });
}

/** The shipped default, for the cases that keep calling models after a refusal case has run. */
async function allowEveryAiBudgetCall() {
  const { updateAiBudgetSettings } = await import("@/db/repositories/settings");
  await updateAiBudgetSettings({ policy: "off", monthlyLimit: null, currency: "CNY", unknownCostPolicy: "allow" });
}

describe("scraper generators on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    // The shipped budget row is `off`; a case that wants a refusal states the refusal itself, and this
    // puts the row back so the other cases here keep calling the model.
    await allowEveryAiBudgetCall();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for structured output through the runtime and reports the model that really ran", async () => {
    const calls = stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
      { match: (url) => url.includes("/chat/completions"), respond: () => draftReply({ title: "Runtime draft", body: "Post copy" }) },
    ]);
    const row = await prepareModel("qwen", "qwen3-max", "sk-stub-qwen");
    await registry.setModelDefaultForCapability("chat", row?.id ?? "");

    const result = await generateTopicPost({
      topic: "Cold start",
      language: "Traditional Chinese",
      systemPrompt: "You write for a Taiwanese audience.",
    });

    // The draft is normalised by `toPostDraft()` exactly as before, and the metadata is the runtime's.
    expect(result.title).toBe("Runtime draft");
    expect(result.body).toBe("Post copy");
    expect(result.postReadyText).toBe("Runtime draft\n\nPost copy");
    expect(result.provider).toBe("qwen");
    expect(result.model).toBe("qwen3-max");
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7, totalTokens: 18 });

    const [chat] = chatCalls(calls);
    const body = bodyOf(chat);
    expect(body.model).toBe("qwen3-max");
    expect(body.temperature).toBe(0.7);
    // JSON mode is on the wire: the adapter only sends `response_format` when the runtime asked for it.
    expect(body.response_format).toEqual({ type: "json_object" });
    // `systemPrompt` is a real system turn, and the runtime's schema instruction rides the last user turn.
    expect(body.messages?.[0]).toEqual({ role: "system", content: "You write for a Taiwanese audience." });
    expect(body.messages?.at(-1)?.role).toBe("user");
    expect(body.messages?.at(-1)?.content).toContain("Write a ready-to-post Threads social media draft in Traditional Chinese.");
    expect(body.messages?.at(-1)?.content).toContain("Topic: Cold start");
    expect(body.messages?.at(-1)?.content).toContain("JSON schema:");
    // One attempt: a valid answer is never retried.
    expect(chatCalls(calls)).toHaveLength(1);
  });

  it("rotates to another key of the same provider when one is rejected", async () => {
    let chatAttempts = 0;
    const calls = stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
      {
        match: (url) => url.includes("/chat/completions"),
        respond: () => (++chatAttempts === 1 ? unauthorized() : draftReply({ title: "Rotated", body: "Second key answered" })),
      },
    ]);
    const row = await prepareModel("qwen", "qwen3-max", "sk-qwen-bad\nsk-qwen-good");
    await registry.setModelDefaultForCapability("chat", row?.id ?? "");

    const result = await rewriteArticle({ title: "Article title", text: "Article body" });

    // The rejected attempt was retried with the other key of the same provider, and that key answered.
    // Which of the two goes first is the pool's business (it counts uses), so this case asserts the
    // rotation itself - two different keys, the second one winning - and not an order.
    const attempts = authorizationsOf(calls);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).not.toBe(attempts[1]);
    expect(new Set(attempts)).toEqual(new Set(["Bearer sk-qwen-bad", "Bearer sk-qwen-good"]));
    expect(result.title).toBe("Rotated");
    // Same runtime, same contract: the provider that answered and its usage come back to the caller.
    expect(result.provider).toBe("qwen");
    expect(result.model).toBe("qwen3-max");
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7, totalTokens: 18 });
    // The article really is in the prompt the model saw.
    const prompt = bodyOf(chatCalls(calls).at(-1)).messages?.at(-1)?.content ?? "";
    expect(prompt).toContain("Article title: Article title");
    expect(prompt).toContain("Article text: Article body");
  });

  it("falls over to another provider's model when the first one keeps failing", async () => {
    const calls = stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
      { match: (url) => url.includes("deepseek") && url.endsWith("/models"), respond: deepseekCatalog },
      { match: (url) => url.includes("dashscope"), respond: unavailable },
      { match: (url) => url.includes("deepseek"), respond: () => draftReply({ title: "Deepseek draft", body: "Failover body" }) },
    ]);
    const qwenRow = await prepareModel("qwen", "qwen3-max", "sk-stub-qwen");
    await prepareModel("deepseek", "deepseek-chat", "sk-stub-deepseek");
    // The default decides the order: the model that will fail goes first, on purpose.
    await registry.setModelDefaultForCapability("chat", qwenRow?.id ?? "");

    const result = await generateTopicPost({ topic: "Failover" });

    expect(result.title).toBe("Deepseek draft");
    expect(result.body).toBe("Failover body");
    // The caller records who really answered, not who was asked first.
    expect(result.provider).toBe("deepseek");
    expect(result.model).toBe("deepseek-chat");
    expect(chatCalls(calls).map((call) => call.url)).toEqual([
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      "https://api.deepseek.com/v1/chat/completions",
    ]);
  });

  it("stops at a rejected request instead of burning keys and models (a 400 is nobody's key)", async () => {
    const calls = stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
      { match: (url) => url.includes("/chat/completions"), respond: rejected },
    ]);
    const row = await prepareModel("qwen", "qwen3-max", "sk-qwen-one\nsk-qwen-two");
    await registry.setModelDefaultForCapability("chat", row?.id ?? "");

    const error: unknown = await rewriteArticle({ title: "Article title", text: "Article body" }).catch(
      (thrown: unknown) => thrown,
    );

    // The wrapping is deliberate: a non-credential failure keeps its legacy message and type.
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppError);
    expect((error as Error).message).toMatch(/^AI rewrite failed: Chat completion HTTP 400/);
    // One call: neither the second key nor a second model would get a different answer.
    expect(chatCalls(calls)).toHaveLength(1);
  });

  it("passes a credential failure through unwrapped, so consumers can branch on its code (D-P3-3)", async () => {
    const calls = stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
    ]);
    await prepareModel("qwen", "qwen3-max", "sk-stub-qwen");
    // The user removed the key after the model had been discovered: routing is now unroutable.
    await credentials.clearCredential(qwenRef);

    const error: unknown = await rewriteArticle({ title: "Article title", text: "Article body" }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "MODEL_CREDENTIAL_MISSING" });
    // Not flattened into `AI rewrite failed: ...`: the code is what `api/content/import-url` and
    // `worker/runner.ts` are meant to read.
    expect((error as Error).message).not.toContain("AI rewrite failed");
    expect(chatCalls(calls)).toEqual([]);
  });

  it("refuses the rewrite before it is sent, with the gate's own error rather than the legacy wording", async () => {
    await refuseEveryAiBudgetCall();
    const calls = stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
      { match: (url) => url.includes("/chat/completions"), respond: () => draftReply({ title: "Never", body: "Never sent" }) },
    ]);
    const row = await prepareModel("qwen", "qwen3-max", "sk-stub-qwen");
    await registry.setModelDefaultForCapability("chat", row?.id ?? "");

    // The gate stands outside the `try`, so the refusal is neither flattened into the legacy
    // `AI rewrite failed: …` wrapper (that wording means "the provider failed") nor written to the
    // ledger - nothing left this process.
    const error: unknown = await rewriteArticle({ title: "Article title", text: "Article body" }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "AI_BUDGET_EXCEEDED", status: 402 });
    expect((error as Error).message).not.toContain("AI rewrite failed");
    expect(chatCalls(calls)).toEqual([]);
  });

  it("refuses the topic draft before it is sent, on the very same budget", async () => {
    await refuseEveryAiBudgetCall();
    const calls = stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
      { match: (url) => url.includes("/chat/completions"), respond: () => draftReply({ title: "Never", body: "Never sent" }) },
    ]);
    const row = await prepareModel("qwen", "qwen3-max", "sk-stub-qwen");
    await registry.setModelDefaultForCapability("chat", row?.id ?? "");

    // This entry has no error contract of its own - it rethrows - so what the caller branches on is the
    // gate's own code and status, and the wire stays empty.
    await expect(
      generateTopicPost({ topic: "Cold start", language: "Traditional Chinese", systemPrompt: "Write for Threads." }),
    ).rejects.toMatchObject({ code: "AI_BUDGET_EXCEEDED", status: 402 });
    expect(chatCalls(calls)).toEqual([]);
  });
});
