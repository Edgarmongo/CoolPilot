import { z } from "zod";
import type { TranslationKey } from "@/lib/locale-resources";

/**
 * The transcription contract (CI-P3-02 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * This file is the pure half: the vocabulary of an engine, the stable names of an honest refusal, the
 * shape of a stored request and the shape of what a finished run recorded. It opens no file, calls no
 * engine and writes no row, so it is importable from a browser component and testable without a
 * database - the same split `@/lib/research` and `@/lib/topics` use.
 *
 * Three rules it exists to keep:
 *
 * 1. **An engine is named, and which one ran is recorded.** `transcriptionProviderIds` is the whole
 *    list, a run stores the id it actually used, and nothing downstream guesses from a model name.
 * 2. **A refusal has a stable name.** Every way a run can fail is a code of
 *    `transcriptionFailureCodes`, so the console can say "ffmpeg is not installed" instead of "failed"
 *    and a test can assert the exact reason.
 * 3. **Empty is not success.** `TRANSCRIPTION_EMPTY` is its own outcome: an engine that ran and
 *    recognised nothing must not be stored as a material whose body is empty and whose status claims a
 *    transcript.
 */

/** The engines a transcription run can be executed by. */
export const transcriptionProviderIds = ["ai-runtime", "local-windows-speech"] as const;

export type TranscriptionProviderId = (typeof transcriptionProviderIds)[number];

export function isTranscriptionProviderId(value: unknown): value is TranscriptionProviderId {
  return (transcriptionProviderIds as readonly string[]).includes(value as string);
}

export const transcriptionProviderLabelKeys: Record<TranscriptionProviderId, TranslationKey> = {
  "ai-runtime": "trProviderAiRuntime",
  "local-windows-speech": "trProviderLocalSpeech",
};

/**
 * Every way a transcription run can refuse, as a stable name.
 *
 * The list is closed on purpose: the task maps each code to something the user can act on, and a code
 * that is not here cannot be produced.
 */
export const transcriptionFailureCodes = [
  /** The stored request is not a valid transcription request (a hand-written `runs` row, say). */
  "REQUEST_INVALID",
  /** The media file the request names is not in the workspace any more. */
  "SOURCE_MISSING",
  /** The file is not an audio/video format this pipeline reads. */
  "SOURCE_UNSUPPORTED",
  /** The file is larger than `MAX_MEDIA_BYTES`. */
  "SOURCE_TOO_LARGE",
  /** The decoder the local engine needs is not installed (ffmpeg/ffprobe). */
  "FFMPEG_UNAVAILABLE",
  /** The OS recognizer the local engine needs is not installed, or none matches the language. */
  "RECOGNIZER_UNAVAILABLE",
  /** No credential/model can serve `speech_to_text`, or the engine the caller asked for is off. */
  "PROVIDER_UNAVAILABLE",
  /**
   * The AI budget refused the run **before** the remote engine was asked (CI-P7-03-D1).
   *
   * It is deliberately not `TRANSCRIPTION_FAILED`: no provider was asked and no request was sent, so
   * nothing is billed and nothing failed. The decision itself belongs to the AI budget policy, whose
   * own `AI_BUDGET_EXCEEDED`/402 arithmetic travels in the message - the same split CI-P3-03's
   * distillation task makes between *its* codes and the gate's refusal.
   */
  "BUDGET_EXCEEDED",
  /** The engine ran and produced no text. Never stored as a transcript. */
  "TRANSCRIPTION_EMPTY",
  /** The run exceeded its own budget and was abandoned. */
  "TRANSCRIPTION_TIMEOUT",
  /** The engine failed for a reason of its own; `message` carries what it said. */
  "TRANSCRIPTION_FAILED",
] as const;

export type TranscriptionFailureCode = (typeof transcriptionFailureCodes)[number];

/** A refusal with a stable code. Thrown by providers and by the task, never swallowed. */
export class TranscriptionFailure extends Error {
  constructor(
    public readonly code: TranscriptionFailureCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "TranscriptionFailure";
  }
}

export function isTranscriptionFailure(error: unknown): error is TranscriptionFailure {
  return error instanceof TranscriptionFailure;
}

/** The workspace sections a transcription source can live in. */
export const transcriptionSourceRoots = ["media", "videos"] as const;

export type TranscriptionSourceRoot = (typeof transcriptionSourceRoots)[number];

/**
 * One stretch of recognised speech.
 *
 * The marks are nullable because engines differ in what they report: the OpenAI-compatible wire format
 * carries absolute times, the Windows recognizer carries the length of each utterance but not its
 * position in the file. `null` is "this engine did not say", which is a different statement from `0`.
 */
export const transcriptionSegmentSchema = z.object({
  index: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative().nullable(),
  endMs: z.number().int().nonnegative().nullable(),
  text: z.string(),
});

export type TranscriptionSegmentRecord = z.infer<typeof transcriptionSegmentSchema>;

/**
 * The request one `media_transcription` task stores in `runs.params_json`.
 *
 * It is the *request*, not the outcome: the file the user picked, the engine they asked for, the
 * language hint, and the material the transcript belongs to. Defaults are applied when the task runs,
 * so a queued row created by hand lands on a decision instead of on a crash.
 */
export const transcriptionRunRequestSchema = z.object({
  sourceRoot: z.enum(transcriptionSourceRoots),
  sourceFileName: z.string().trim().min(1).max(300),
  /** Which engine to run. Defaults to the cloud engine; the task records the one it used. */
  providerId: z.enum(transcriptionProviderIds).optional().default("ai-runtime"),
  /** A BCP-47-ish hint (`zh-CN`); empty means the engine decides and reports what it used. */
  language: z.string().trim().max(35).optional().default(""),
  /** The material the transcript is written to; empty creates a new one. */
  materialId: z.string().trim().max(60).optional().default(""),
  /** Title for a material this run creates; empty derives one from the file. */
  title: z.string().trim().max(200).optional().default(""),
  /** Where the media came from, when the user knows (kept as the material's source). */
  sourceUrl: z.string().trim().max(600).optional().default(""),
  /** A caller's own dedupe key: the same key never starts a second run while one is in flight. */
  idempotencyKey: z.string().trim().max(120).optional().default(""),
});

export type TranscriptionRunRequest = z.infer<typeof transcriptionRunRequestSchema>;

/** How an engine was asked to answer: the two wire formats, plus the local engine's own. */
export const transcriptionResponseFormats = ["verbose_json", "json", "local"] as const;

/**
 * What a finished transcription recorded about itself, stored on the material it produced.
 *
 * It exists so a transcript row stays self-describing after the task's log is gone: which file it came
 * from, which engine and model recognised it, how long the media was, and where the speech was. The
 * `segments` are the engine's; the material's `content` is what the user kept (edited or not).
 */
export const transcriptMetadataSchema = z.object({
  taskId: z.string(),
  providerId: z.string(),
  /** The model id for a cloud engine, the installed recognizer's id for the OS one. */
  model: z.string(),
  language: z.string(),
  durationMs: z.number().int().nonnegative().nullable(),
  sourceRoot: z.enum(transcriptionSourceRoots),
  sourceFileName: z.string(),
  sourceSizeBytes: z.number().int().nonnegative(),
  responseFormat: z.enum(transcriptionResponseFormats),
  segments: z.array(transcriptionSegmentSchema),
  createdAt: z.number().int(),
});

export type TranscriptMetadata = z.infer<typeof transcriptMetadataSchema>;

/** Reads a stored transcript back; a row written by another build is `null` rather than a crash. */
export function parseTranscriptMetadata(value: unknown): TranscriptMetadata | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = transcriptMetadataSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** `mm:ss` (or `h:mm:ss` past an hour), the only timestamp format this app shows. */
export function formatTranscriptTimestamp(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : `00:${mmss}`;
}

/**
 * The transcript as lines, each prefixed with the engine's mark when it gave one.
 *
 * This is the *view*, not the record: the material's `content` stays the words an engine recognised
 * (which is what a generation reads), and the timestamps are composed here from the stored segments. A
 * segment whose engine reported no position is shown without a mark, and a transcript with no segments
 * at all is one unmarked block - neither case invents a time.
 */
export function transcriptLines(
  text: string,
  segments: readonly TranscriptionSegmentRecord[],
): Array<{ at: string; text: string }> {
  if (segments.length === 0) {
    const body = text.trim();
    return body ? [{ at: "", text: body }] : [];
  }
  return segments
    .filter((segment) => segment.text.trim())
    .map((segment) => ({
      at: segment.startMs === null ? "" : formatTranscriptTimestamp(segment.startMs),
      text: segment.text.trim(),
    }));
}

/**
 * The plain body a transcript becomes: the engine's own text when it gave one, otherwise its segments
 * joined by newline. Empty when there is nothing to store - which the caller must treat as
 * `TRANSCRIPTION_EMPTY` rather than as an empty material.
 */
export function transcriptBody(text: string, segments: readonly TranscriptionSegmentRecord[]) {
  const trimmed = text.trim();
  if (trimmed) return trimmed;
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n");
}

