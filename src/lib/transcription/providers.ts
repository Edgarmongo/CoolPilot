import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/app-errors";
import { tryAiBudgetCall, type AiBudgetCallRequest, type AiBudgetIdentity } from "@/lib/ai-budget-guard";
import { recordAiUsageCall, recordAiUsageFailure, type AiUsageCallContext } from "@/lib/ai-usage-ledger-recorder";
import { resolveModelPrice } from "@/db/repositories/ai-usage-ledger";
import {
  requirementForIntent,
  resolveRoute,
  transcribe as runtimeTranscribe,
  type TranscriptionResponse,
} from "@/features/ai-runtime";
import {
  MAX_MEDIA_BYTES,
  isTranscriptionSourceName,
  mediaContentType,
  transcriptionSourceKind,
} from "@/lib/media-library";
import { mediaRoot, videosRoot } from "@/lib/paths";
import { extractRecognizerWave, probeMedia, removeTempFile, resolveFfmpeg } from "./ffmpeg";
import { localSpeechAvailability, recognizeWithSystemSpeech } from "./local-speech";
import {
  TranscriptionFailure,
  isTranscriptionFailure,
  type TranscriptionProviderId,
  type TranscriptionSegmentRecord,
  type TranscriptionSourceRoot,
} from "./transcription";

/**
 * The `TranscriptionProvider` seam (CI-P3-02).
 *
 * The card's own advice is followed literally: one interface, and the engine behind it is a decision
 * made *after* the interface, not baked into it. Two engines implement it today -
 *
 *   - `ai-runtime`            the model gateway's `speech_to_text` capability: an OpenAI-compatible
 *                             `/audio/transcriptions` call, so Whisper, Groq's `whisper-large-v3`, a
 *                             compatible gateway or a self-hosted faster-whisper server all work without
 *                             new code (the model is chosen by capability, never by vendor);
 *   - `local-windows-speech`  ffmpeg + the recognizer Windows ships: offline, no key, no upload.
 *
 * A third (a bundled whisper.cpp, a Python sidecar) is a new file beside these two: nothing outside this
 * module knows which engines exist, and the task layer only ever asks for "a provider" and records which
 * one answered.
 *
 * Three rules the seam keeps:
 *
 * 1. **The file is the caller's decision, the bytes are the engine's business.** `resolveTranscriptionSource()`
 *    turns a `{ root, fileName }` pair into a validated workspace path or a refusal, so no engine has to
 *    know the workspace layout and no request can name a file outside it.
 * 2. **Availability is asked, not assumed.** `availability()` says whether an engine can run *now*
 *    (a credential, a model, ffmpeg, an installed recognizer) with the reason it cannot - which is what
 *    lets the console offer the engines that actually work.
 * 3. **A refusal keeps its name.** `TranscriptionFailure` codes travel from the engine to the task log
 *    unchanged; an engine that cannot run is never "an empty transcript".
 */

export type TranscriptionSource = {
  root: TranscriptionSourceRoot;
  fileName: string;
  /** Absolute path inside the workspace section; never leaves the workspace, never leaves this module. */
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  kind: "audio" | "video";
};

/**
 * The workspace file a run reads.
 *
 * Every check happens before an engine sees the path: a name that is not a plain file name, an
 * unsupported extension, a file that is gone, empty or over `MAX_MEDIA_BYTES`. The section is resolved
 * from `root`, so `../credential-vault.json` cannot be reached by naming it.
 */
export async function resolveTranscriptionSource(input: {
  root: TranscriptionSourceRoot;
  fileName: string;
}): Promise<TranscriptionSource> {
  const fileName = input.fileName.trim();
  if (path.basename(fileName) !== fileName || !isTranscriptionSourceName(fileName)) {
    throw new TranscriptionFailure(
      "SOURCE_UNSUPPORTED",
      `"${input.fileName}" is not an audio or video file this build can read`,
    );
  }

  const directory = input.root === "media" ? mediaRoot() : videosRoot();
  const filePath = path.join(directory, fileName);
  const stats = await fs.stat(filePath).catch(() => null);
  if (!stats?.isFile()) {
    throw new TranscriptionFailure("SOURCE_MISSING", `"${fileName}" is not in this workspace's ${input.root} section.`);
  }
  if (stats.size <= 0) {
    throw new TranscriptionFailure("SOURCE_UNSUPPORTED", `"${fileName}" is empty.`);
  }
  if (stats.size > MAX_MEDIA_BYTES) {
    throw new TranscriptionFailure(
      "SOURCE_TOO_LARGE",
      `"${fileName}" is ${stats.size} bytes; the transcription limit is ${MAX_MEDIA_BYTES}.`,
    );
  }

  return {
    root: input.root,
    fileName,
    filePath,
    mimeType: mediaContentType(fileName),
    sizeBytes: stats.size,
    kind: transcriptionSourceKind(fileName) === "audio" ? "audio" : "video",
  };
}

/** One line of engine progress, in the shape the task writes to `run_events`. */
export type TranscriptionLogEntry = {
  message: string;
  stage: string;
  level?: "info" | "warn" | "error";
  progress?: { current: number; total: number };
  data?: Record<string, unknown>;
};

export type TranscriptionProviderRequest = {
  source: TranscriptionSource;
  /** Empty means "you decide, and tell me what you used". */
  language: string;
  log: (entry: TranscriptionLogEntry) => Promise<void> | void;
  /**
   * The business row this run belongs to (CI-P7-03-D1): the run and task a cloud call's ledger rows and
   * budget hold are recorded under.
   *
   * Optional, and absent means absent - a call site that declares nothing holds nothing. The local
   * engine ignores it entirely: it uploads nothing, spends nothing and has nothing to attribute.
   */
  identity?: AiBudgetIdentity;
};

export type TranscriptionProviderResult = {
  providerId: TranscriptionProviderId;
  /** The model that ran, or the recognizer's own id for the OS engine. */
  model: string;
  language: string;
  durationMs: number | null;
  text: string;
  /** The engine's own utterance breaks; marks are `null` when the engine reports no position. */
  segments: TranscriptionSegmentRecord[];
  responseFormat: "verbose_json" | "json" | "local";
  /** Facts the caller should read: why an engine answered in a lower format, what it could not do. */
  notes: string[];
};

export type TranscriptionProviderAvailability = {
  providerId: TranscriptionProviderId;
  available: boolean;
  /** What the engine would run on, or exactly what is missing. */
  detail: string;
};

export type TranscriptionProvider = {
  id: TranscriptionProviderId;
  availability(): Promise<TranscriptionProviderAvailability>;
  transcribe(request: TranscriptionProviderRequest): Promise<TranscriptionProviderResult>;
};

/** The one sentence an unavailable gateway gets: the runtime's own bottleneck, not a generic failure. */
function explainRoute(reason: string, missing: readonly string[]) {
  const gap = missing.length > 0 ? ` (no model provides: ${missing.join(", ")})` : "";
  return `the model gateway cannot serve speech_to_text right now: ${reason}${gap}`;
}

/**
 * The media's own length, in seconds (CI-P7-03-D1): the one fact about a cloud transcription that can be
 * measured *before* it is sent, and therefore the only honest basis for pricing it beforehand.
 *
 * `null` when the decoder is not installed or the container states no duration - never a length guessed
 * from the file's size. This is an estimate input, not a validation: an unreadable file is still refused
 * by the engine below with its own code, and the measurement deciding "no quantity" is not the same
 * statement as "this file cannot be transcribed".
 */
async function sourceSecondsForEstimate(filePath: string): Promise<number | null> {
  try {
    const ffmpeg = await resolveFfmpeg();
    if (!ffmpeg.available) return null;
    const probe = await probeMedia(filePath, ffmpeg.ffprobePath);
    return probe.durationMs === null ? null : probe.durationMs / 1000;
  } catch {
    return null;
  }
}

/**
 * How much speech this call may tell the gate it will use, in the unit its own price is quoted in.
 *
 * A speech price is written either per second of audio or per character, and only the first can be
 * measured before the words exist. So the catalog is asked first - the same read, by the same route and
 * dimension, that the gate itself will price with a moment later - and a number is stated only when it is
 * a number *of that unit*. Seconds multiplied by a per-character rate would be a figure nobody could
 * back, and an estimate that invents one is worse than no estimate: the number would decide a spend
 * decision while being wrong by orders of magnitude.
 *
 * With no measurable quantity the call states none, the estimate is `unknown`, and the user's own
 * `unknownCostPolicy` decides - which is the honest answer for a price this build cannot apply.
 */
async function pricedSpeechSeconds(seconds: number | null): Promise<number | null> {
  if (seconds === null || seconds <= 0) return null;
  try {
    const candidate = (await resolveRoute(requirementForIntent("transcription"))).candidate;
    if (!candidate) return null;
    const price = await resolveModelPrice(
      candidate.provider.providerId,
      candidate.model.modelId,
      Date.now(),
      "speech",
    );
    return price?.unitLabel === "second" ? seconds : null;
  } catch {
    // A catalog that cannot be read *here* must not become a refusal invented by this file: the gate
    // below reads the same catalog and throws what it actually means.
    return null;
  }
}

/**
 * The seconds this call used, in the ledger's own key for them (`second`, the unit a speech price is
 * quoted in) - `undefined` when neither the engine nor the container stated a length, because "not
 * measured" is an absent quantity and never a 0.
 *
 * The engine's own figure wins when it reported one: that is what the transcript records, and it is
 * what a provider rounding to the second actually billed. No character count is ever claimed - this
 * build measures the audio, not the vendor's characters - so a per-character price row keeps its cost
 * unstated instead of stating one on a unit nobody measured.
 */
function meteredSpeechSeconds(input: { reportedMs: number | null; measuredSeconds: number | null }) {
  const seconds = input.reportedMs !== null ? input.reportedMs / 1000 : input.measuredSeconds;
  return seconds === null || seconds <= 0 ? undefined : { second: seconds };
}

/** The runtime's own words, in this module's vocabulary - the mapping CI-P3-02 pinned, unchanged. */
function gatewayFailure(error: unknown): TranscriptionFailure {
  const code = error instanceof AppError ? error.code : "";
  const message = error instanceof Error ? error.message : String(error);
  // "Nothing can serve this" is a configuration answer, not a transcription failure: keeping the two
  // apart is what lets the console point at the model settings instead of saying "failed".
  if (
    code === "MODEL_CREDENTIAL_MISSING" ||
    code === "MODEL_CAPABILITY_UNAVAILABLE" ||
    code === "MODEL_NOT_CONFIGURED"
  ) {
    return new TranscriptionFailure("PROVIDER_UNAVAILABLE", `the model gateway refused the request: ${message}`);
  }
  const killed = (error as { name?: string }).name === "TimeoutError";
  return new TranscriptionFailure(
    killed ? "TRANSCRIPTION_TIMEOUT" : "TRANSCRIPTION_FAILED",
    killed ? "the speech-to-text request exceeded its own timeout" : message,
  );
}

/** The one request this engine sends: the file's own bytes, and the gateway's trail back. */
async function sendToGateway(input: {
  source: TranscriptionSource;
  language: string;
  log: (entry: TranscriptionLogEntry) => Promise<void> | void;
}): Promise<TranscriptionResponse> {
  const bytes = await fs.readFile(input.source.filePath);
  await input.log({
    stage: "engine",
    message: `Sending "${input.source.fileName}" (${bytes.length} bytes) to the configured speech-to-text model`,
    data: { sourceRoot: input.source.root, sourceFileName: input.source.fileName, sourceBytes: bytes.length },
  });
  return runtimeTranscribe({
    audio: { name: input.source.fileName, mimeType: input.source.mimeType, bytes },
    language: input.language || undefined,
  });
}

/**
 * The cloud engine: whatever the model gateway resolves for the `transcription` intent.
 *
 * Nothing in this file names a vendor, a model id or an endpoint - the runtime does that, which is why
 * adding Groq, a self-hosted Whisper server or another OpenAI-compatible provider is a configuration
 * change and not a code change.
 */
const aiRuntimeProvider: TranscriptionProvider = {
  id: "ai-runtime",

  async availability() {
    const resolution = await resolveRoute(requirementForIntent("transcription"));
    const candidate = resolution.candidate;
    if (!candidate) {
      return {
        providerId: "ai-runtime",
        available: false,
        detail: explainRoute(resolution.explanation?.reason ?? "no-models-synced", resolution.explanation?.missing ?? []),
      };
    }
    return {
      providerId: "ai-runtime",
      available: true,
      detail: `${candidate.provider.providerId} / ${candidate.model.modelId}`,
    };
  },

  async transcribe({ source, language, log, identity }) {
    // CI-P7-03-D1. A cloud transcription is a *paid* call, so it goes through the same budget gate every
    // other paid call uses: admission is asked for **before** a byte is read, a refusal means no request
    // is ever sent, and the call is metered in the dimension it is really billed in - `speech`, measured
    // in seconds of audio. The local engine above spends nothing, so it has neither a hold nor a row.
    const usageCall: AiUsageCallContext = {
      purpose: "transcription",
      meteredKind: "speech",
      startedAt: Date.now(),
      ...identity,
    };
    const measuredSeconds = await sourceSecondsForEstimate(source.filePath);
    const request = {
      identity,
      purpose: usageCall.purpose,
      capability: "speech_to_text",
      capabilities: ["speech_to_text"],
      meteredKind: "speech",
      quantity: await pricedSpeechSeconds(measuredSeconds),
    } satisfies AiBudgetCallRequest;

    let result: TranscriptionResponse;
    try {
      const attempt = await tryAiBudgetCall(request, async (handle) => {
        // CI-P7-03-A: the hold's id travels onto this call's ledger rows, so what was held and what was
        // spent are compared by an id instead of correlated by purpose and time.
        usageCall.budgetReservationId = handle.reservationId ?? undefined;
        return sendToGateway({ source, language, log });
      });
      if (!attempt.ok) {
        // The refusal is this run's answer, not the engine's: nothing was sent, so nothing was billed
        // and no ledger row can exist for it. The gate's own arithmetic travels in the message.
        throw new TranscriptionFailure("BUDGET_EXCEEDED", attempt.error.message);
      }
      result = attempt.value;
    } catch (error) {
      if (isTranscriptionFailure(error)) throw error;
      // A request that *was* sent and failed is recorded before the mapping turns the failure into this
      // module's vocabulary: the provider may still have billed for it, and "the ledger missed it" must
      // not look like "nothing happened". The engine answered nothing about its own length, so the
      // length measured before the upload is what the row states - the audio really did leave this
      // machine, and that number is a fact about what may have been billed.
      await recordAiUsageFailure(
        { ...usageCall, quantity: meteredSpeechSeconds({ reportedMs: null, measuredSeconds }) },
        error,
      );
      throw gatewayFailure(error);
    }

    await recordAiUsageCall({
      ...usageCall,
      attempts: result.attempts,
      quantity: meteredSpeechSeconds({ reportedMs: result.durationMs, measuredSeconds }),
    });

    const notes: string[] = [];
    if (result.responseFormat === "json") {
      notes.push(
        `${result.providerId}/${result.model} answered without segments (response_format=json), so this transcript carries no timestamps.`,
      );
    }
    if (result.attempts.some((attempt) => attempt.outcome === "failed")) {
      const failed = result.attempts.filter((attempt) => attempt.outcome === "failed").length;
      notes.push(`${failed} earlier attempt(s) failed before ${result.providerId}/${result.model} answered.`);
    }
    if (!result.language) {
      notes.push("The engine did not report a detected language.");
    }

    return {
      providerId: "ai-runtime",
      model: result.model,
      language: result.language || language,
      durationMs: result.durationMs,
      text: result.text,
      segments: result.segments,
      responseFormat: result.responseFormat,
      notes,
    };
  },
};

/**
 * How long the OS recognizer may take for a file of this length.
 *
 * The Windows engine runs at roughly the speed of the audio, so the budget is derived from the media's
 * own duration rather than being fixed: four times the audio plus a two minute floor, capped at
 * forty-five minutes. A run that exceeds it is a `TRANSCRIPTION_TIMEOUT`, not a run that hangs for ever.
 */
export function localRecognitionBudgetMs(durationMs: number | null) {
  const fromDuration = (durationMs ?? 0) * 4;
  return Math.min(45 * 60_000, Math.max(2 * 60_000, fromDuration));
}

/**
 * The offline engine: ffmpeg decodes, the Windows recognizer listens.
 *
 * Both dependencies are checked *before* anything is decoded, and the decoded wave is removed in a
 * `finally` whatever happens - a failed run must not leave a gigabyte of PCM in the temp directory.
 */
const localSpeechProvider: TranscriptionProvider = {
  id: "local-windows-speech",

  async availability() {
    const ffmpeg = await resolveFfmpeg();
    if (!ffmpeg.available) {
      return { providerId: "local-windows-speech", available: false, detail: ffmpeg.detail };
    }
    const speech = await localSpeechAvailability();
    if (!speech.available) {
      return { providerId: "local-windows-speech", available: false, detail: speech.detail };
    }
    return {
      providerId: "local-windows-speech",
      available: true,
      detail: `${speech.detail} · ffmpeg: ${ffmpeg.detail}`,
    };
  },

  async transcribe({ source, language, log }) {
    const ffmpeg = await resolveFfmpeg();
    if (!ffmpeg.available) throw new TranscriptionFailure("FFMPEG_UNAVAILABLE", ffmpeg.detail);

    const probe = await probeMedia(source.filePath, ffmpeg.ffprobePath);
    if (!probe.hasAudio) {
      throw new TranscriptionFailure(
        "SOURCE_UNSUPPORTED",
        `"${source.fileName}" has no audio stream, so there is no speech to recognise.`,
      );
    }
    await log({
      stage: "decode",
      message: `Decoding "${source.fileName}" (${probe.format || "unknown format"}, ${probe.durationMs ?? "unknown"} ms) to 16 kHz mono PCM`,
      data: { container: probe.format, audioCodec: probe.audioCodec, durationMs: probe.durationMs },
    });

    const wave = await extractRecognizerWave({ ffmpegPath: ffmpeg.ffmpegPath, sourcePath: source.filePath });
    try {
      await log({ stage: "recognize", message: "Recognising speech with the installed Windows recognizer" });
      const recognized = await recognizeWithSystemSpeech({
        wavePath: wave.path,
        language,
        timeoutMs: localRecognitionBudgetMs(probe.durationMs),
      });
      if (!recognized.text && recognized.segments.length === 0) {
        throw new TranscriptionFailure(
          "TRANSCRIPTION_EMPTY",
          "the Windows recognizer heard no speech in this file (it may be music, silence, or a language no installed recognizer covers)",
        );
      }
      return {
        providerId: "local-windows-speech",
        model: recognized.recognizerId,
        language: recognized.culture,
        durationMs: probe.durationMs,
        text: recognized.text,
        segments: recognized.segments,
        responseFormat: "local",
        notes: [
          "The Windows recognizer reports utterances without their position in the file, so these segments carry no timestamps.",
          `Recognised with the installed recognizer "${recognized.recognizerId}" (${recognized.culture}).`,
        ],
      };
    } finally {
      await removeTempFile(wave.path);
    }
  },
};

/** Every engine this build has, by id. */
export const transcriptionProviders: Record<TranscriptionProviderId, TranscriptionProvider> = {
  "ai-runtime": aiRuntimeProvider,
  "local-windows-speech": localSpeechProvider,
};

/**
 * The engines a run may fall back to, in order, per requested engine.
 *
 * A fallback is **never towards the cloud**: asking for the offline engine and having the file uploaded
 * instead would be the one mistake a local-first app cannot make. The reverse is the useful direction -
 * with no speech-to-text credential configured, a run falls back to the machine's own recognizer and
 * says in its log that it did.
 */
export const transcriptionFallbackOrder: Record<TranscriptionProviderId, TranscriptionProviderId[]> = {
  "ai-runtime": ["ai-runtime", "local-windows-speech"],
  "local-windows-speech": ["local-windows-speech"],
};

export type ChosenTranscriptionProvider = {
  provider: TranscriptionProvider;
  availability: TranscriptionProviderAvailability;
  /** Everything that was asked before this one, so the log can say why it moved on. */
  tried: TranscriptionProviderAvailability[];
};

/**
 * Picks the engine a run will use, or refuses with every reason it could not.
 *
 * The refusal is a single `PROVIDER_UNAVAILABLE` whose message lists each attempt and its own detail:
 * "no speech-to-text credential" and "ffmpeg is not installed" are different problems, and a user cannot
 * fix a problem they are not told about.
 */
export async function chooseTranscriptionProvider(
  preferredId: TranscriptionProviderId,
): Promise<ChosenTranscriptionProvider> {
  const tried: TranscriptionProviderAvailability[] = [];
  for (const id of transcriptionFallbackOrder[preferredId]) {
    const availability = await transcriptionProviders[id].availability();
    tried.push(availability);
    if (availability.available) {
      return { provider: transcriptionProviders[id], availability, tried };
    }
  }
  throw new TranscriptionFailure(
    "PROVIDER_UNAVAILABLE",
    tried.map((entry) => `${entry.providerId}: ${entry.detail}`).join(" · "),
  );
}

