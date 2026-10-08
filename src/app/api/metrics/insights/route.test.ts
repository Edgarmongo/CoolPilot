import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/app-errors";

/**
 * `api/metrics/insights` on `aiRuntime` (batch P3-A3 of `docs/generate-migration-p3.md`).
 *
 * This is `src/app`'s first test file, and the batch's error-semantics sample: the route used to be the
 * one place outside `lib/scraper.ts` that branched on `instanceof MissingAIKeyError`, so what these
 * cases pin is D-P3-3 end to end - the runtime decides the code *and* the HTTP status, and the route
 * passes both through without a local error taxonomy of its own.
 *
 * The legacy facade is not an option on this path any more. If the route - or anything it imports -
 * still asked for `generateStructured` / `generateText` / `MissingAIKeyError`, the factories below
 * throw and this whole file fails, rather than one case quietly keeping the old behaviour alive.
 */
vi.mock("@/lib/ai", () => {
  throw new Error("api/metrics/insights must not import the legacy facade (@/lib/ai)");
});
vi.mock("@/lib/ai/generate", () => {
  throw new Error("api/metrics/insights must not import the legacy facade (@/lib/ai/generate)");
});
vi.mock("@/lib/ai/compat", () => {
  throw new Error("api/metrics/insights must not import the compat shim (@/lib/ai/compat)");
});

/**
 * The harness pins the temp database and the keyless env before any of this loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
const {
  jsonRequest,
  stubFetch,
  chatCalls,
  bodyOf,
  jsonReply,
  qwenCatalog,
  unavailable,
  resetRuntime,
  prepareChatModel,
  runtime,
  runtimeRepository,
  credentials,
} = await import("@/test/route-harness");
const { POST } = await import("./route");
const { createPublishRecord } = await import("@/db/repository");
const { updatePublishRecordMetrics } = await import("@/db/repositories/metrics");

const insightUrl = "http://localhost/api/metrics/insights";

/** A fixed publication date, so the prompt's ISO timestamp is computed the way the route computes it. */
const publishedAt = Date.UTC(2024, 4, 2, 3, 0, 0);

/** What a model that understood `metricInsightSchema` answers. */
const insight = {
  verdict: "hit" as const,
  summary: "Views beat both baselines.",
  factors: ["punchy title", "posted in the evening"],
  suggestions: ["keep the format", "post at the same hour"],
};

async function mustCreatePublishRecord(input: Parameters<typeof createPublishRecord>[0]) {
  const record = await createPublishRecord(input);
  if (!record) throw new Error("publish record was not created");
  return record;
}

/**
 * One published piece with real numbers, plus an older sibling in the same account and platform, so the
 * baseline the route computes is not 0/0: 1200 views against an (1200 + 400) / 2 = 800 average.
 */
async function seedMetrics() {
  const target = await mustCreatePublishRecord({
    accountId: "account-1",
    accountName: "CoolPilot",
    platform: "threads",
    title: "How we ship",
    contentType: "post",
    status: "published",
    url: "https://example.com/posts/how-we-ship",
    publishedAt,
  });
  await updatePublishRecordMetrics(target.id, {
    views: 1200,
    likes: 10,
    comments: 1,
    shares: 1,
    favorites: 1,
    metricStatus: "collected",
    metricsSyncedAt: publishedAt,
  });

  const sibling = await mustCreatePublishRecord({
    accountId: "account-1",
    accountName: "CoolPilot",
    platform: "threads",
    title: "Older post",
    contentType: "post",
    status: "published",
    publishedAt: publishedAt - 86_400_000,
  });
  await updatePublishRecordMetrics(sibling.id, {
    views: 400,
    likes: 2,
    metricStatus: "collected",
    metricsSyncedAt: publishedAt,
  });

  return target;
}

describe("POST /api/metrics/insights on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers with the insight the runtime produced and the model that really ran", async () => {
    const calls = stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
      { match: (url) => url.includes("/chat/completions"), respond: () => jsonReply(insight) },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const record = await seedMetrics();

    const response = await POST(jsonRequest(insightUrl, { publishRecordId: record.id }));
    const body = await response.json();

    // The insight itself, plus the provider/model pair the runtime really used (not a hard-coded one).
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        publishRecordId: record.id,
        verdict: "hit",
        summary: "Views beat both baselines.",
        factors: ["punchy title", "posted in the evening"],
        suggestions: ["keep the format", "post at the same hour"],
        provider: "qwen",
        model: "qwen3-max",
      },
    });
    expect(typeof body.data.createdAt).toBe("number");

    // One structured call, on the runtime's JSON channel, and the prompt really carries this record's
    // numbers plus the baseline the route computed from the other row.
    const [chat] = chatCalls(calls);
    expect(chatCalls(calls)).toHaveLength(1);
    const wire = bodyOf(chat);
    expect(wire.model).toBe("qwen3-max");
    expect(wire.response_format).toEqual({ type: "json_object" });
    // No system turn: the route hands the runtime a single user message, and the schema instruction rides it.
    expect(wire.messages?.map((message) => message.role)).toEqual(["user"]);
    const prompt = wire.messages?.[0]?.content ?? "";
    expect(prompt).toContain("Platform: threads");
    expect(prompt).toContain("Account: CoolPilot");
    expect(prompt).toContain("Title: How we ship");
    expect(prompt).toContain("Content type: post");
    expect(prompt).toContain(`Published at: ${new Date(publishedAt).toISOString()}`);
    expect(prompt).toContain("Views/reads: 1200");
    expect(prompt).toContain("Interactions: 13 (likes 10, comments 1, shares 1, favorites 1)");
    expect(prompt).toContain("This account's average views: 800 (2 posts)");
    expect(prompt).toContain("This platform's average views: 800 (2 posts)");
    expect(prompt).toContain("JSON schema:");
    expect(prompt).toContain("verdict");
  });

  it("answers 400 with the runtime's code when the model has no credential left (D-P3-3)", async () => {
    const calls = stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const record = await seedMetrics();
    // The user removed the key after the model had been discovered: routing is now unroutable.
    await credentials.clearCredential(credentials.credentialRefFor("qwen"));

    const response = await POST(jsonRequest(insightUrl, { publishRecordId: record.id }));
    const body = await response.json();

    expect(response.status).toBe(400);
    // The code is the runtime's - the route recognises no error class of its own any more.
    expect(body.code).toBe("MODEL_CREDENTIAL_MISSING");
    // The old contract was `MissingAIKeyError` -> 400 "Missing qwen API key". The status survives; the
    // message is now the routing explanation, which is more useful and comes from one place.
    expect(body.message).not.toContain("Missing qwen API key");
    expect(body.message).toContain("credential");
    // Nothing was attempted: there was no key to sign a call with.
    expect(chatCalls(calls)).toEqual([]);
  });

  it("answers 429 when every key is out of rotation, and never calls the provider", async () => {
    const calls = stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-key-one\nsk-key-two");
    const record = await seedMetrics();

    // Key one is cooling down after a rate limit and key two was rejected, so the pool has nothing left
    // to sign the call with: `MODEL_CREDENTIAL_UNAVAILABLE`, decided by the pool and by nobody above it.
    const ref = credentials.credentialRefFor("qwen");
    await runtime.planCredentialKeys({ ref, providerId: "qwen" });
    const [first, second] = await runtimeRepository.listCredentialKeys(ref);
    await runtime.reportCredentialKeyFailure({ keyId: first.id }, new AppError("MODEL_RATE_LIMITED", { status: 429 }));
    await runtime.reportCredentialKeyFailure(
      { keyId: second.id },
      new AppError("MODEL_CREDENTIAL_INVALID", { status: 401 }),
    );

    const response = await POST(jsonRequest(insightUrl, { publishRecordId: record.id }));
    const body = await response.json();

    // A cooling down pool is a 429 for the client - the runtime's status, not one this route invented.
    expect(response.status).toBe(429);
    expect(body.code).toBe("MODEL_CREDENTIAL_UNAVAILABLE");
    // The pool's diagnosis reaches HTTP intact: both reasons, so the UI can explain itself.
    expect(body.details.reasons).toEqual(expect.arrayContaining(["cooling-down", "invalid"]));
    expect(chatCalls(calls)).toEqual([]);
  });

  it("answers 502 with the upstream status in details when the provider itself fails", async () => {
    const calls = stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
      { match: (url) => url.includes("/chat/completions"), respond: unavailable },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const record = await seedMetrics();

    const response = await POST(jsonRequest(insightUrl, { publishRecordId: record.id }));
    const body = await response.json();

    // A 5xx from the provider is a 502 here - again the runtime's status, where the old route answered
    // a flat 500 and left the client to guess what happened.
    expect(response.status).toBe(502);
    expect(body.code).toBe("MODEL_UPSTREAM_FAILED");
    expect(body.details.status).toBe(503);
    // One enabled model and one key: the failure is reported after that single attempt.
    expect(chatCalls(calls)).toHaveLength(1);
  });

  it("keeps answering 404 for an unknown record, without asking any model", async () => {
    const calls = stubFetch([
      { match: (url) => url.includes("dashscope") && url.endsWith("/models"), respond: qwenCatalog },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const response = await POST(jsonRequest(insightUrl, { publishRecordId: "no-such-record" }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.message).toBe("Publish record not found");
    // The record lookup comes first, so no model is asked (and the stub would answer 404 loudly if one were).
    expect(chatCalls(calls)).toEqual([]);
  });

  it("keeps answering 400 for a payload without a usable record id", async () => {
    const calls = stubFetch([]);

    const response = await POST(jsonRequest(insightUrl, { publishRecordId: "   " }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("INVALID_PAYLOAD");
    expect(calls).toEqual([]);
  });
});
