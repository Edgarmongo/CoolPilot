import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `api/ai/models/probe` on the real chain (CI-P7-01-04 / CI-P7-03).
 *
 * Layer 3 capability detection sends one real request - `adapter.chat` on `runWithCredentialKey`, which
 * rotates the credential's keys on purpose - and until this card it was the one provider call path in the
 * product that neither the budget gate nor the ledger ever saw. These cases pin the two halves that were
 * missing, where each of them can be observed: the gate refuses *before* the wire, and the requests that
 * did go out become ledger rows - including the ones no figure can be stated for, which is the single
 * thing a ledger may never answer with a 0.
 *
 * The chain under test is the real one (route, probe, registry, key pool, provider adapter); only the
 * transport is stubbed.
 */

/** The harness pins the temp database and the keyless env before anything that reads them loads. */
const {
  bodyOf,
  chatCalls,
  jsonRequest,
  jsonResponse,
  prepareModel,
  refuseEveryAiBudgetCall,
  resetRuntime,
  runtimeRepository,
  stubFetch,
} = await import("@/test/route-harness");
const { POST } = await import("./route");
const { createAiModelPrice, listAiUsageLedgerEntries } = await import("@/db/repositories/ai-usage-ledger");
const { updateAiBudgetSettings } = await import("@/db/repositories/settings");
const { inFlightAiBudgetReservations } = await import("@/lib/ai-budget-guard");

const probeUrl = "http://localhost/api/ai/models/probe";

/**
 * One CNY per token, in and out: `perMillion` is a rate per *million* tokens, so 1_000_000 prices a token
 * at 1 and every amount below reads as the token count that produced it.
 */
const pricePerToken = 1_000_000;
const priceEffectiveFrom = 1_700_000_000_000;

/**
 * A catalog that advertises the one model a case probes. Each case uses a model row of its own: a price
 * row, a stored probe record and a `PROBE_TEST` mark all attach to a model row, and this file shares one
 * temp database, so a case that reused a row would read the state its predecessor left behind.
 */
const qwenModels = (...modelIds: string[]) => ({
  match: (target: string) => target.endsWith("/models"),
  respond: () => jsonResponse({ data: modelIds.map((id) => ({ id })) }),
});
const chatCompletions = (respond: () => Response) => ({
  match: (target: string) => target.includes("/chat/completions"),
  respond,
});

/** What a provider answers a probe: one word back, plus the usage it reports - nothing, when it reports none. */
const probeReply = (usage?: Record<string, number>) =>
  jsonResponse({ choices: [{ message: { content: "ok" } }], ...(usage ? { usage } : {}) });

async function priceTheModel(providerId: string, modelId: string) {
  await createAiModelPrice({
    providerId,
    modelId,
    currency: "CNY",
    inputPerMillion: pricePerToken,
    outputPerMillion: pricePerToken,
    priceVersion: "2026-10",
    effectiveFrom: priceEffectiveFrom,
  });
}

const budget = (policy: "off" | "warn" | "block", monthlyLimit: number | null, unknownCostPolicy: "allow" | "block") =>
  updateAiBudgetSettings({ policy, monthlyLimit, currency: "CNY", unknownCostPolicy });

const runProbe = (body: unknown) => POST(jsonRequest(probeUrl, body));

/**
 * The probe rows this case wrote. Every case reads the ledger through a timestamp it takes for itself:
 * one file shares one temp database, so the rows the earlier cases wrote are still in it.
 */
async function probeRows(since: number) {
  return listAiUsageLedgerEntries({ from: since, limit: 10 });
}

/** The `PROBE_TEST` marks a model carries: the probe's own answer, which a refusal must not write. */
async function probeMarks(modelRowId: string) {
  const row = await runtimeRepository.getModelRow(modelRowId);
  return (row?.capabilities ?? []).filter((entry) => entry.source === "PROBE_TEST");
}

describe("POST /api/ai/models/probe, metered", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records the request the probe sent, prices it, and gives the hold back", async () => {
    const modelId = "probe-paid";
    const calls = stubFetch([
      qwenModels(modelId),
      chatCompletions(() => probeReply({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 })),
    ]);
    const model = await prepareModel("qwen", modelId, "sk-stub-qwen");
    await priceTheModel("qwen", modelId);
    await budget("warn", 1000, "allow");

    const since = Date.now();
    const response = await runProbe({ modelRowId: model?.id, capability: "chat" });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({ status: "ok", capability: "chat" });
    // One request, on the text channel, on the model the user picked - and carrying the probe's own
    // ceiling, which is the number the gate held.
    expect(chatCalls(calls)).toHaveLength(1);
    expect(bodyOf(chatCalls(calls)[0])).toMatchObject({ model: modelId, max_tokens: 32 });

    const rows = await probeRows(since);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      purpose: "model-probe",
      meteredKind: "text",
      outcome: "success",
      providerId: "qwen",
      modelId,
      endpointId: "qwen/default",
      completeness: "reported",
      costSource: "computed",
      costCurrency: "CNY",
    });
    expect(row.tokens).toMatchObject({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    // Three tokens in and two out at one CNY per token: stated to the ledger's own resolution, and a
    // figure rather than a blank only because both the usage and the price really were there.
    expect(row.costAmount).toBe(5);
    // The hold it was admitted under is on the row (CI-P7-03-A), and it has been given back.
    expect(row.budgetReservationId).not.toBe("");
    expect(await inFlightAiBudgetReservations()).toEqual([]);
  });

  it("answers the gate's 402 before the provider is asked, and writes nothing at all", async () => {
    const modelId = "probe-refused";
    stubFetch([qwenModels(modelId)]);
    const model = await prepareModel("qwen", modelId, "sk-stub-qwen");
    await priceTheModel("qwen", modelId);
    await refuseEveryAiBudgetCall();
    // Configured through a catalog read first, then the transport is emptied: from here on, any request
    // this probe makes is one the case would see.
    const calls = stubFetch([]);
    const since = Date.now();

    const response = await runProbe({ modelRowId: model?.id, capability: "chat" });
    const payload = await response.json();

    expect(response.status).toBe(402);
    expect(payload.code).toBe("AI_BUDGET_EXCEEDED");
    // Nothing was sent, so nothing can be charged for and there is nothing to account for.
    expect(calls).toEqual([]);
    expect(await probeRows(since)).toEqual([]);
    // And the model is not marked: a refusal is not a probe result, so it must not read as "this model
    // cannot do it" - neither as a `PROBE_TEST` capability nor as a stored probe record.
    expect(await probeMarks(model?.id ?? "")).toEqual([]);
    expect(await runtimeRepository.listProbeRecords(model?.id ?? "")).toEqual([]);
  });

  it("records a rejected request as its own row, with no figure invented for it", async () => {
    const modelId = "probe-failed";
    const calls = stubFetch([qwenModels(modelId), chatCompletions(() => jsonResponse({ error: { message: "boom" } }, 500))]);
    const model = await prepareModel("qwen", modelId, "sk-stub-qwen");
    await priceTheModel("qwen", modelId);
    await budget("warn", 1000, "allow");
    const since = Date.now();

    const response = await runProbe({ modelRowId: model?.id, capability: "chat" });
    const payload = await response.json();

    // A probe that reached a provider answers with a *result*, not an HTTP failure: the model said no,
    // and that is what the capability check was asking.
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({ status: "failed" });
    expect(payload.data.message).toContain("HTTP 500");
    expect(chatCalls(calls)).toHaveLength(1);

    const rows = await probeRows(since);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      purpose: "model-probe",
      meteredKind: "text",
      outcome: "failed",
      completeness: "unknown",
      costSource: "unknown",
    });
    // The provider may well have billed for a request that failed, so the cost stays blank - the row
    // states "this request happened", never "it was free".
    expect(row.costAmount).toBeNull();
    expect(row.errorSummary).toContain("HTTP 500");
  });

  it("leaves a provider that reports no usage unmeasured instead of writing a zero", async () => {
    const modelId = "probe-unreported";
    stubFetch([qwenModels(modelId), chatCompletions(() => probeReply())]);
    const model = await prepareModel("qwen", modelId, "sk-stub-qwen");
    await priceTheModel("qwen", modelId);
    await budget("warn", 1000, "allow");
    const since = Date.now();

    const response = await runProbe({ modelRowId: model?.id, capability: "chat" });

    expect(response.status).toBe(200);
    // The request worked and the price is on file, so the only thing missing is the amount - and a
    // missing amount is exactly what `completeness: "unknown"` plus a NULL cost means. Pricing a zero
    // here would have made a real charge look like a free call.
    const rows = await probeRows(since);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({ outcome: "success", completeness: "unknown", costSource: "unknown" });
    expect(row.costAmount).toBeNull();
  });

  it("records a probe on a model with no price, and holds nothing for it", async () => {
    const modelId = "probe-unpriced";
    stubFetch([
      qwenModels(modelId),
      chatCompletions(() => probeReply({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 })),
    ]);
    const model = await prepareModel("qwen", modelId, "sk-stub-qwen");
    // No price row at all: the model is callable, and its cost simply cannot be stated.
    await budget("warn", 1000, "allow");
    const since = Date.now();

    const response = await runProbe({ modelRowId: model?.id, capability: "chat" });

    expect(response.status).toBe(200);
    const rows = await probeRows(since);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // The usage *was* measured; it is the price that is missing, and the row says which of the two it is
    // (`reported` + `unpriced`) rather than collapsing both into "unknown".
    expect(row).toMatchObject({ outcome: "success", completeness: "reported", costSource: "unpriced" });
    expect(row.costAmount).toBeNull();
    expect(row.pricing).toBeNull();
    // Nothing was held, because there is no honest amount to hold - and the row says so by carrying no
    // reservation id, rather than a made-up one.
    expect(row.budgetReservationId).toBe("");
  });

  it("refuses an unpriceable probe when the user asked unknown costs to be refused", async () => {
    const modelId = "probe-unpriceable";
    stubFetch([qwenModels(modelId)]);
    const model = await prepareModel("qwen", modelId, "sk-stub-qwen");
    // No price row, and `unknownCostPolicy: "block"`: the refusal is the user's own setting speaking, not
    // a missing catalog row.
    await budget("warn", 1000, "block");
    const calls = stubFetch([]);
    const since = Date.now();

    const response = await runProbe({ modelRowId: model?.id, capability: "chat" });
    const payload = await response.json();

    expect(response.status).toBe(402);
    expect(payload.code).toBe("AI_BUDGET_EXCEEDED");
    expect(calls).toEqual([]);
    expect(await probeRows(since)).toEqual([]);
  });

  it("does not gate or record a capability a single request cannot test", async () => {
    const modelId = "probe-unsupported";
    stubFetch([qwenModels(modelId)]);
    const model = await prepareModel("qwen", modelId, "sk-stub-qwen");
    // A budget that refuses everything: the answer below must come from the probe's own rule, not from
    // the gate, and nothing may be held for a request that is never sent.
    await budget("block", 0, "block");
    const calls = stubFetch([]);
    const since = Date.now();

    const response = await runProbe({ modelRowId: model?.id, capability: "image_generation" });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({ status: "unsupported", capability: "image_generation" });
    expect(calls).toEqual([]);
    expect(await probeRows(since)).toEqual([]);
    // The result is still stored: "this capability cannot be probed with one text request" is the probe's
    // own answer, and it has nothing to do with the budget.
    expect(await runtimeRepository.listProbeRecords(model?.id ?? "")).toHaveLength(1);
  });
});
