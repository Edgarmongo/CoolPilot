import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelAttempt, TranscriptionResponse } from "@/features/ai-runtime";

/**
 * CI-P7-03-D1: the cloud engine under the AI budget.
 *
 * The *task* layer is pinned in `./transcription-task.test.ts`. What this file pins is what the paid
 * engine does around its one request, which is what the card is about:
 *
 *  - **a refusal means nothing was sent.** The gate runs before a byte is read, so a refused run never
 *    journals "Sending ...", never reaches the gateway and writes no ledger row - the three ways a run
 *    that spent nothing could look like one that spent something;
 *  - **a metered call says what it used.** One ledger row per request the gateway reports, under the
 *    `speech` dimension, in the unit this build can measure: the engine's own duration when it reported
 *    one, the container's length otherwise, and no quantity at all - never a `0` - when neither exists;
 *  - **the catalog decides the unit, not this file.** A speech price quoted per second is what the
 *    estimate multiplies; a per-character row cannot be measured before the words exist, so no number is
 *    stated, the estimate is `unknown`, and the user's own `unknownCostPolicy` decides;
 *  - **the free engine claims nothing.** The local engine uploads nothing, so it writes no row.
 *
 * The gateway is stubbed (`@/features/ai-runtime`) and so are the decoder probes (`./ffmpeg`): neither
 * the network nor an installed ffmpeg is part of what these claims are about. The database is real,
 * because a hold, a decision row and a ledger row are exactly the claims - and it is put in a throwaway
 * workspace before any module that reads it is loaded, the way `./transcription-task.test.ts` does it.
 */
vi.mock("@/features/ai-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/ai-runtime")>();
  return { ...actual, resolveRoute: vi.fn(), transcribe: vi.fn() };
});

vi.mock("./ffmpeg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ffmpeg")>();
  return {
    ...actual,
    resolveFfmpeg: vi.fn(),
    probeMedia: vi.fn(),
    extractRecognizerWave: vi.fn(),
    removeTempFile: vi.fn(),
  };
});

vi.mock("./local-speech", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./local-speech")>();
  return { ...actual, recognizeWithSystemSpeech: vi.fn() };
});

const tempDir = mkdtempSync(path.join(tmpdir(), "coolpilot-transcription-budget-"));
const workspace = path.join(tempDir, "CoolPilot", "web-data");

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;
const previousDbUrl = process.env.SOCIAL_AUTO_POST_DB_URL;
process.env.SOCIAL_AUTO_POST_DATA_DIR = workspace;
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(workspace, "social-auto-post.db").replace(/\\/g, "/")}`;

const mediaDir = path.join(workspace, "media");
const audioFile = path.join(mediaDir, "talk.mp3");
const audioBytes = "fake-mp3-bytes";

/** The provider and model these tests price; the gateway resolves nothing else. */
const gatewayProviderId = "audio-gw";
const gatewayModelId = "whisper-large-v3";
/** What the decoder reports for the file above, and what a per-second price therefore multiplies. */
const probedSeconds = 12.5;

let runtime: typeof import("@/features/ai-runtime");
let ffmpeg: typeof import("./ffmpeg");
let localSpeech: typeof import("./local-speech");
let providers: typeof import("./providers");
let guard: typeof import("@/lib/ai-budget-guard");
let budgetRepository: typeof import("@/db/repositories/ai-budget");
let ledger: typeof import("@/db/repositories/ai-usage-ledger");
let settings: typeof import("@/db/repositories/settings");
let sqlite: typeof import("@/db/client").sqlite;

beforeAll(async () => {
  runtime = await import("@/features/ai-runtime");
  ffmpeg = await import("./ffmpeg");
  localSpeech = await import("./local-speech");
  providers = await import("./providers");
  guard = await import("@/lib/ai-budget-guard");
  budgetRepository = await import("@/db/repositories/ai-budget");
  ledger = await import("@/db/repositories/ai-usage-ledger");
  settings = await import("@/db/repositories/settings");
  ({ sqlite } = await import("@/db/client"));
  // Migrations run on the first repository call, exactly like the app's first request.
  await settings.getAiBudgetSettings();
  mkdirSync(mediaDir, { recursive: true });
});

beforeEach(async () => {
  rmSync(mediaDir, { recursive: true, force: true });
  mkdirSync(mediaDir, { recursive: true });
  writeFileSync(audioFile, audioBytes);

  vi.mocked(runtime.resolveRoute).mockReset();
  vi.mocked(runtime.transcribe).mockReset();
  vi.mocked(ffmpeg.resolveFfmpeg).mockReset();
  vi.mocked(ffmpeg.probeMedia).mockReset();
  vi.mocked(ffmpeg.extractRecognizerWave).mockReset();
  vi.mocked(ffmpeg.removeTempFile).mockReset();
  vi.mocked(localSpeech.recognizeWithSystemSpeech).mockReset();

  // The world every test starts in: a route that can serve speech, a decoder that can measure the file,
  // a gateway that answers, and a budget that does not interfere.
  vi.mocked(runtime.resolveRoute).mockResolvedValue(speechRoute());
  vi.mocked(ffmpeg.resolveFfmpeg).mockResolvedValue({
    available: true,
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    source: "path",
    detail: "test decoder",
  });
  vi.mocked(ffmpeg.probeMedia).mockResolvedValue({
    durationMs: probedSeconds * 1000,
    hasAudio: true,
    format: "mp3",
    audioCodec: "mp3",
  });
  vi.mocked(ffmpeg.extractRecognizerWave).mockResolvedValue({ path: "recognizer.wav", sizeBytes: 4_096 });
  vi.mocked(ffmpeg.removeTempFile).mockResolvedValue(undefined);

  await settings.updateAiBudgetSettings({
    policy: "off",
    monthlyLimit: null,
    currency: "CNY",
    unknownCostPolicy: "allow",
    strategy: "balanced",
  });
  await sqlite.execute({ sql: "DELETE FROM ai_usage_ledger" });
  await sqlite.execute({ sql: "DELETE FROM ai_budget_decisions" });
  await sqlite.execute({ sql: "DELETE FROM ai_budget_reservations" });
  await sqlite.execute({ sql: "DELETE FROM ai_model_prices" });
});

afterAll(async () => {
  // The app never closes its own connection; Windows refuses to remove a file a live handle holds.
  await sqlite.close();
  if (previousDataDir === undefined) delete process.env.SOCIAL_AUTO_POST_DATA_DIR;
  else process.env.SOCIAL_AUTO_POST_DATA_DIR = previousDataDir;
  if (previousDbUrl === undefined) delete process.env.SOCIAL_AUTO_POST_DB_URL;
  else process.env.SOCIAL_AUTO_POST_DB_URL = previousDbUrl;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // A throwaway folder the OS reclaims on its own.
  }
});

/**
 * The route the gateway resolves for `speech_to_text`.
 *
 * Only three of its fields are read on this path: the provider id and the model id (the price is looked
 * up by them) and the explanation a caller reads when nothing routes at all. Building a whole
 * `ModelCandidate` would pin the registry's own row shapes in a file about the budget, so the value is
 * built minimally and cast as the resolution it stands for.
 */
function speechRoute(): Awaited<ReturnType<typeof runtime.resolveRoute>> {
  const candidate = {
    provider: { providerId: gatewayProviderId },
    model: { modelId: gatewayModelId },
  };
  return {
    candidate,
    candidates: [candidate],
    reason: "capability-match",
    requirement: { capabilities: ["speech_to_text"] },
  } as unknown as Awaited<ReturnType<typeof runtime.resolveRoute>>;
}

/** What one request the gateway sent looks like on its own, in the runtime's own vocabulary. */
function attempt(overrides: Partial<ModelAttempt> = {}): ModelAttempt {
  return {
    kind: "answer",
    outcome: "success",
    providerId: gatewayProviderId,
    modelId: gatewayModelId,
    endpointId: `${gatewayProviderId}/default`,
    credentialLabel: "****1234",
    error: "",
    ...overrides,
  };
}

/** What the gateway answers: the transcript, the engine's own segment marks, and the request trail. */
function gatewayAnswer(overrides: Partial<TranscriptionResponse> = {}): TranscriptionResponse {
  return {
    text: "第一段。第二段。",
    segments: [
      { index: 0, startMs: 0, endMs: 4_000, text: "第一段。" },
      { index: 1, startMs: 4_000, endMs: 12_500, text: "第二段。" },
    ],
    language: "zh-CN",
    durationMs: 12_500,
    responseFormat: "verbose_json",
    model: gatewayModelId,
    providerId: gatewayProviderId,
    credentialLabel: "****1234",
    attempts: [attempt()],
    route: {
      reason: "capability-match",
      providerId: gatewayProviderId,
      endpointId: `${gatewayProviderId}/default`,
      modelRowId: "model-row-1",
      modelId: gatewayModelId,
      protocol: "openai-compatible",
      alternatives: [],
      requirement: { capabilities: ["speech_to_text"] },
    },
    ...overrides,
  };
}

/** The media file one run reads, as the task would have resolved it. */
function source(): import("./providers").TranscriptionSource {
  return {
    root: "media",
    fileName: "talk.mp3",
    filePath: audioFile,
    mimeType: "audio/mpeg",
    sizeBytes: audioBytes.length,
    kind: "audio",
  };
}

/** The run's own journal, so a test can assert what a refused call never said. */
function journal() {
  const entries: import("./providers").TranscriptionLogEntry[] = [];
  return {
    entries,
    log: (entry: import("./providers").TranscriptionLogEntry) => {
      entries.push(entry);
    },
  };
}

/** The budget as a test states it: all four settings at once, so none is left half-written. */
async function budget(input: {
  policy: "off" | "warn" | "block";
  monthlyLimit: number | null;
  unknownCostPolicy?: "allow" | "block";
}) {
  await settings.updateAiBudgetSettings({
    policy: input.policy,
    monthlyLimit: input.monthlyLimit,
    currency: "CNY",
    unknownCostPolicy: input.unknownCostPolicy ?? "allow",
    strategy: "balanced",
  });
}

/** One speech price row: what the catalog says a second (or a character) of this model costs. */
async function speechPrice(input: { unitLabel: "second" | "character"; unitPrice: number }) {
  await ledger.createAiModelPrice({
    providerId: gatewayProviderId,
    modelId: gatewayModelId,
    meteredKind: "speech",
    currency: "CNY",
    unitPrice: input.unitPrice,
    unitLabel: input.unitLabel,
    priceVersion: "2026-10",
  });
}

/** The rows this workspace has, oldest request first. */
async function ledgerRows() {
  return (await ledger.listAiUsageLedgerEntries({ from: 0 })).reverse();
}

/** The decisions the gate stored, newest first. */
async function decisionRows(identity: { runId?: string; taskId?: string } = {}) {
  return budgetRepository.listAiBudgetDecisions({ ...identity, limit: 20 });
}

/** The quantity a ledger row carries, as an object - the column stores the JSON it was written as. */
const quantityOf = (row: { quantityJson: string }) => JSON.parse(row.quantityJson) as Record<string, unknown>;

/** What the engine answers, through the provider seam the task uses. */
function transcribe(input: { identity?: { runId?: string; taskId?: string } } = {}) {
  const run = journal();
  return {
    run,
    result: providers.transcriptionProviders["ai-runtime"].transcribe({
      source: source(),
      language: "zh-CN",
      log: run.log,
      identity: input.identity,
    }),
  };
}

/**
 * One call through the seam, with its refusal turned into a value rather than a thrown failure.
 *
 * Both vocabularies answer here on purpose: a budget refusal arrives as this module's own
 * `TranscriptionFailure` code, and anything from the gateway keeps `AppError.code`. Only `code` and
 * `message` are read, so the helper names exactly what a caller of this seam can see.
 */
async function failureFrom(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => error as { code?: string; message: string },
  );
}

describe("the cloud transcription engine under the AI budget", () => {
  it("refuses before it reads or sends anything, and writes nothing", async () => {
    await speechPrice({ unitLabel: "second", unitPrice: 1 });
    // No headroom at all this month, and the policy that refuses on the figure.
    await budget({ policy: "block", monthlyLimit: 0 });

    const { run, result } = transcribe({ identity: { runId: "run-refused", taskId: "task-refused" } });
    const failure = await failureFrom(result);

    expect(failure?.code).toBe("BUDGET_EXCEEDED");
    expect(failure?.message).toMatch(/over-limit/);
    // Nothing was read, sent or even journalled: the refusal happened before the file was opened.
    expect(runtime.transcribe).not.toHaveBeenCalled();
    expect(run.entries.some((entry) => entry.message.startsWith("Sending"))).toBe(false);
    expect(await ledgerRows()).toHaveLength(0);
    expect(await guard.inFlightAiBudgetReservations()).toHaveLength(0);

    // The verdict outlives the refusal, with the figure it was refused on: 12.5 seconds at 1 CNY.
    const [stored] = await decisionRows({ runId: "run-refused" });
    expect(stored).toMatchObject({
      status: "blocked",
      estimateKind: "estimate",
      estimateAmountMin: probedSeconds,
      estimateAmountMax: probedSeconds,
      limitAmount: 0,
      purpose: "transcription",
    });
    expect(stored?.reasons[0]).toBe("over-limit");
    expect(stored?.reservationId).toBe("");
  });

  it("refuses a call whose cost it cannot state when the user asked for that, still without sending", async () => {
    // No speech price anywhere: nothing can price this call, and the user asked for that to be a stop.
    await budget({ policy: "block", monthlyLimit: 100, unknownCostPolicy: "block" });

    const { run, result } = transcribe({ identity: { runId: "run-unpriced" } });
    const failure = await failureFrom(result);

    expect(failure?.code).toBe("BUDGET_EXCEEDED");
    expect(failure?.message).toMatch(/unknown-cost-refused/);
    expect(runtime.transcribe).not.toHaveBeenCalled();
    expect(run.entries.some((entry) => entry.message.startsWith("Sending"))).toBe(false);
    expect(await ledgerRows()).toHaveLength(0);
    expect(await guard.inFlightAiBudgetReservations()).toHaveLength(0);

    const [stored] = await decisionRows({ runId: "run-unpriced" });
    expect(stored?.status).toBe("blocked");
    expect(stored?.estimateKind).toBe("unpriced");
    expect(stored?.estimateNotes).toContain("price-not-on-file");
    expect(stored?.reservationId).toBe("");
  });

  it("holds the call's ceiling, sends it, and metes the seconds the engine reported", async () => {
    await speechPrice({ unitLabel: "second", unitPrice: 1 });
    await budget({ policy: "block", monthlyLimit: 100 });
    vi.mocked(runtime.transcribe).mockResolvedValue(gatewayAnswer());

    const { run, result } = transcribe({ identity: { runId: "run-metered", taskId: "task-metered" } });
    const answered = await result;

    expect(answered.providerId).toBe("ai-runtime");
    expect(answered.model).toBe(gatewayModelId);
    expect(answered.durationMs).toBe(12_500);
    expect(runtime.transcribe).toHaveBeenCalledTimes(1);
    expect(run.entries.some((entry) => entry.message.startsWith("Sending"))).toBe(true);

    const [row] = await ledgerRows();
    expect(row).toMatchObject({
      purpose: "transcription",
      meteredKind: "speech",
      providerId: gatewayProviderId,
      modelId: gatewayModelId,
      runId: "run-metered",
      taskId: "task-metered",
      attemptIndex: 0,
      outcome: "success",
      // CI-P7-05-01: no engine reports token usage through this runtime, and none needs to - the
      // dimension this call is billed on is the audio, and it *was* measured (12.5 seconds). With the
      // per-second price above in force the row states the money instead of the blank it used to.
      completeness: "reported",
      costAmount: 12.5,
      costCurrency: "CNY",
      costSource: "computed",
    });
    // The unit is the ledger's own key for it, and the engine's own duration is what is recorded.
    expect(quantityOf(row)).toEqual({ second: 12.5 });
    // A hold was taken for this call - its id travels onto the row - and given back when it ended.
    expect(row.budgetReservationId).not.toBe("");
    expect(await guard.inFlightAiBudgetReservations()).toHaveLength(0);

    const [stored] = await decisionRows({ runId: "run-metered" });
    expect(stored).toMatchObject({
      status: "allowed",
      purpose: "transcription",
      estimateKind: "estimate",
      estimateAmountMin: probedSeconds,
      estimateAmountMax: probedSeconds,
      limitAmount: 100,
      taskId: "task-metered",
    });
    expect(stored?.reasons).toContain("within-limit");
    expect(stored?.reservationId).toBe(row.budgetReservationId);
  });

  it("writes one row per request the gateway sent, in the order it sent them", async () => {
    await budget({ policy: "off", monthlyLimit: null });
    vi.mocked(runtime.transcribe).mockResolvedValue(
      gatewayAnswer({ attempts: [attempt({ outcome: "failed", error: "invalid key" }), attempt()] }),
    );

    const { result } = transcribe({ identity: { runId: "run-retry" } });
    await result;

    const rows = await ledgerRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.attemptIndex)).toEqual([0, 1]);
    expect(rows.map((row) => row.outcome)).toEqual(["failed", "success"]);
    // The retry names its predecessor, which is what makes "these two rows are one call" readable
    // afterwards instead of a guess inferred from the index.
    expect(rows[1].parentUsageId).toBe(rows[0].id);
    expect(rows[0].errorSummary).toBe("invalid key");
    expect(rows.map((row) => row.costAmount)).toEqual([null, null]);
    expect(rows.map((row) => quantityOf(row))).toEqual([{ second: 12.5 }, { second: 12.5 }]);
  });

  it("never multiplies seconds by a price quoted per character", async () => {
    // The catalog prices this model per character - a unit this build cannot measure before the words
    // exist. Seconds are never offered as a substitute for it, however tight the limit is.
    await speechPrice({ unitLabel: "character", unitPrice: 0.001 });
    await budget({ policy: "block", monthlyLimit: 1 });
    vi.mocked(runtime.transcribe).mockResolvedValue(gatewayAnswer());

    const { result } = transcribe({ identity: { runId: "run-per-character" } });
    await result;

    const [stored] = await decisionRows({ runId: "run-per-character" });
    expect(stored?.status).toBe("allowed");
    expect(stored?.estimateKind).toBe("unknown");
    expect(stored?.estimateNotes).toContain("usage-basis-unknown");
    expect(stored?.estimateAmountMin).toBeNull();
    // No quantity was stated, so nothing was held: 12.5 seconds is not 12.5 characters, and a figure
    // nobody could back is exactly what an estimate must not become.
    expect(stored?.reservationId).toBe("");
    expect(stored?.reservedAmount).toBe(0);

    // The seconds that *were* used are still recorded as usage - the ledger's business is what happened -
    // and the cost stays unstated, because the rate applies to a unit nobody measured.
    const [row] = await ledgerRows();
    expect(quantityOf(row)).toEqual({ second: 12.5 });
    expect(row.costAmount).toBeNull();
  });

  it("records the container's length when the engine reported no duration", async () => {
    await budget({ policy: "off", monthlyLimit: null });
    vi.mocked(runtime.transcribe).mockResolvedValue(
      gatewayAnswer({ durationMs: null, responseFormat: "json", segments: [] }),
    );

    const { result } = transcribe();
    await result;

    // The engine said nothing about length, so the decoder's own measurement is what is metered.
    const [row] = await ledgerRows();
    expect(quantityOf(row)).toEqual({ second: probedSeconds });
  });

  it("leaves the quantity absent, never 0, when there is nothing measurable at all", async () => {
    await speechPrice({ unitLabel: "second", unitPrice: 1 });
    await budget({ policy: "block", monthlyLimit: 100 });
    // No decoder on this machine: the length cannot be measured, so there is nothing to price with and
    // nothing to state - while the call itself still goes, because `unknownCostPolicy` allows it.
    vi.mocked(ffmpeg.resolveFfmpeg).mockResolvedValue({
      available: false,
      ffmpegPath: "",
      ffprobePath: "",
      source: "missing",
      detail: 'ffmpeg/ffprobe did not answer "-version"',
    });
    vi.mocked(runtime.transcribe).mockResolvedValue(gatewayAnswer({ durationMs: null }));

    const { result } = transcribe({ identity: { runId: "run-unmeasurable" } });
    await result;

    const [stored] = await decisionRows({ runId: "run-unmeasurable" });
    expect(stored?.estimateKind).toBe("unknown");
    expect(stored?.estimateNotes).toContain("usage-basis-unknown");

    const [row] = await ledgerRows();
    expect(quantityOf(row)).toEqual({});
    expect(row.costAmount).toBeNull();
  });

  it("metes a request that failed, and gives its hold back", async () => {
    await speechPrice({ unitLabel: "second", unitPrice: 1 });
    await budget({ policy: "block", monthlyLimit: 100 });
    // A gateway that was asked and failed: the trail travels on the error, which is what makes the
    // failed request visible in the ledger instead of invisible.
    const trail = await import("@/features/ai-runtime/trail");
    vi.mocked(runtime.transcribe).mockRejectedValue(
      trail.attachModelAttempts(new Error("the upstream closed the connection"), [
        attempt({ outcome: "failed", error: "the upstream closed the connection" }),
      ]),
    );

    const { result } = transcribe({ identity: { runId: "run-failed" } });
    const failure = await failureFrom(result);

    expect(failure?.code).toBe("TRANSCRIPTION_FAILED");
    const [row] = await ledgerRows();
    expect(row).toMatchObject({
      outcome: "failed",
      errorSummary: "the upstream closed the connection",
      costAmount: null,
      runId: "run-failed",
      // The seconds were measured, but the request failed: what it was billed for is not knowable, so
      // the row still claims nothing (CI-P7-05-01 changes the dimension it is measured on, not this).
      completeness: "unknown",
      costSource: "unknown",
    });
    // The audio really was uploaded, so its length is a fact about what may have been billed.
    expect(quantityOf(row)).toEqual({ second: 12.5 });
    // The hold does not outlive the call, whatever the call did.
    expect(await guard.inFlightAiBudgetReservations()).toHaveLength(0);
  });

  it("writes nothing when the gateway could not be asked at all", async () => {
    await budget({ policy: "block", monthlyLimit: 100 });
    const { AppError } = await import("@/lib/app-errors");
    vi.mocked(runtime.transcribe).mockRejectedValue(
      new AppError("MODEL_CREDENTIAL_MISSING", { status: 409, message: "no credential for speech_to_text" }),
    );

    const { result } = transcribe({ identity: { runId: "run-unconfigured" } });
    const failure = await failureFrom(result);

    // A configuration answer rather than an engine failure - and nothing was sent, so no row exists.
    expect(failure?.code).toBe("PROVIDER_UNAVAILABLE");
    expect(failure?.message).toContain("no credential for speech_to_text");
    expect(await ledgerRows()).toHaveLength(0);
    expect(await guard.inFlightAiBudgetReservations()).toHaveLength(0);
  });

  it("records nothing for the local engine, which uploads nothing", async () => {
    // A budget with nothing left, to show the free engine is not gated by it either.
    await budget({ policy: "block", monthlyLimit: 0 });
    vi.mocked(localSpeech.recognizeWithSystemSpeech).mockResolvedValue({
      recognizerId: "MS-2052-80-DESK",
      culture: "zh-CN",
      text: "第一段。",
      segments: [{ index: 0, startMs: null, endMs: null, text: "第一段。" }],
    });
    const run = journal();

    const answered = await providers.transcriptionProviders["local-windows-speech"].transcribe({
      source: source(),
      language: "zh-CN",
      log: run.log,
      identity: { runId: "run-local" },
    });

    expect(answered.providerId).toBe("local-windows-speech");
    expect(answered.text).toBe("第一段。");
    // A free engine is not a `0` in the ledger: it is no row, and no decision either.
    expect(runtime.transcribe).not.toHaveBeenCalled();
    expect(await ledgerRows()).toHaveLength(0);
    expect(await decisionRows({ runId: "run-local" })).toHaveLength(0);
  });
});

