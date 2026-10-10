import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { TranscriptionFailure } from "./transcription";

/**
 * The decoder the local engine runs on (CI-P3-02).
 *
 * ffmpeg is not a dependency of this repository and is not bundled: it is a tool an operator either has
 * or does not have, so this module's first job is to *find out* and say so. Nothing here pretends a
 * decoder exists - `resolveFfmpeg()` reports `available: false` with the reason, and the local provider
 * turns that into `FFMPEG_UNAVAILABLE` before it touches a file.
 *
 * Two environment variables override the search, which is what a packaged build or an unusual install
 * needs: `FFMPEG_PATH` and `FFPROBE_PATH`.
 *
 * Everything here is process-level and nothing here writes into the workspace: the only file it creates
 * lives in the OS temp directory and is removed by the caller that asked for it (`local-speech.ts`, in a
 * `finally`).
 */

const execFileAsync = promisify(execFile);

/** Longest a single ffmpeg/ffprobe call may take. Decoding is bounded by the file, not by a model. */
const toolTimeoutMs = 20 * 60_000;

/** ffprobe's answer is small; a runaway one is a bug, not a big file. */
const probeMaxBuffer = 2 * 1024 * 1024;

export type FfmpegAvailability = {
  available: boolean;
  /** The executable to spawn, as found; empty when nothing was found. */
  ffmpegPath: string;
  ffprobePath: string;
  /** `env` (an explicit override), `path` (found on the system) or `missing`. */
  source: "env" | "path" | "missing";
  /** One sentence naming what is wrong, for the task log and the console. */
  detail: string;
};

async function canRun(executable: string, args: string[]) {
  try {
    await execFileAsync(executable, args, { timeout: 20_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds ffmpeg and ffprobe.
 *
 * An explicit `FFMPEG_PATH`/`FFPROBE_PATH` is honoured first and *verified* by running `-version`: a
 * path that is set but wrong is reported as missing rather than used and failing later, in the middle of
 * a transcription. Otherwise the plain names are tried, which is what resolves a PATH install.
 */
export async function resolveFfmpeg(): Promise<FfmpegAvailability> {
  const configuredFfmpeg = process.env.FFMPEG_PATH?.trim() ?? "";
  const configuredFfprobe = process.env.FFPROBE_PATH?.trim() ?? "";
  const ffmpeg = configuredFfmpeg || "ffmpeg";
  const ffprobe = configuredFfprobe || "ffprobe";
  const configured = Boolean(configuredFfmpeg || configuredFfprobe);

  if ((await canRun(ffmpeg, ["-version"])) && (await canRun(ffprobe, ["-version"]))) {
    return {
      available: true,
      ffmpegPath: ffmpeg,
      ffprobePath: ffprobe,
      source: configured ? "env" : "path",
      detail: configured ? "FFMPEG_PATH/FFPROBE_PATH" : "found on PATH",
    };
  }

  return {
    available: false,
    ffmpegPath: "",
    ffprobePath: "",
    source: "missing",
    detail:
      `ffmpeg/ffprobe did not answer "-version" (${configured ? "FFMPEG_PATH/FFPROBE_PATH is set" : "not on PATH"}). ` +
      "The local speech engine decodes audio with ffmpeg: install ffmpeg (and put it on PATH), or set FFMPEG_PATH and FFPROBE_PATH.",
  };
}

export type MediaProbe = {
  /** Milliseconds, or null when the container does not state one. */
  durationMs: number | null;
  /** False when the file has no audio stream at all: nothing can be recognised from it. */
  hasAudio: boolean;
  /** The container/format name ffprobe reported. */
  format: string;
  audioCodec: string;
};

type FfprobeOutput = {
  format?: { duration?: unknown; format_name?: unknown };
  streams?: Array<{ codec_type?: unknown; codec_name?: unknown }>;
};

/**
 * Asks ffprobe what the file is: its duration, its container and whether it carries audio.
 *
 * A file with no audio stream is refused here rather than decoded into silence: "this video has no
 * sound" is a different answer from "the recognizer heard nothing", and only one of the two is about the
 * recognizer.
 */
export async function probeMedia(filePath: string, ffprobePath: string): Promise<MediaProbe> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      ffprobePath,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { timeout: toolTimeoutMs, maxBuffer: probeMaxBuffer, windowsHide: true },
    );
    stdout = result.stdout;
  } catch (error) {
    throw new TranscriptionFailure(
      "SOURCE_UNSUPPORTED",
      `ffprobe could not read this file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let payload: FfprobeOutput;
  try {
    payload = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    throw new TranscriptionFailure("SOURCE_UNSUPPORTED", "ffprobe did not answer with JSON");
  }

  const streams = payload.streams ?? [];
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const seconds = Number(payload.format?.duration);
  return {
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null,
    hasAudio: audio !== undefined,
    format: typeof payload.format?.format_name === "string" ? payload.format.format_name : "",
    audioCodec: typeof audio?.codec_name === "string" ? audio.codec_name : "",
  };
}

/**
 * Decodes any accepted audio/video file into the one shape the OS recognizer reads: 16 kHz, mono,
 * 16-bit PCM WAV.
 *
 * The target format is not a preference. `System.Speech`'s recognizers accept a narrow set of wave
 * formats, and re-sampling here is what makes an mp3, an m4a and the audio track of an mp4 arrive at the
 * recognizer as the same thing. The file is created in the OS temp directory and its path is returned;
 * removing it is the caller's `finally`.
 */
export async function extractRecognizerWave(input: { ffmpegPath: string; sourcePath: string }) {
  const target = path.join(
    os.tmpdir(),
    `coolpilot-transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
  );
  try {
    await execFileAsync(
      input.ffmpegPath,
      ["-y", "-v", "error", "-i", input.sourcePath, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", target],
      { timeout: toolTimeoutMs, windowsHide: true },
    );
  } catch (error) {
    throw new TranscriptionFailure(
      "SOURCE_UNSUPPORTED",
      `ffmpeg could not decode this file to 16 kHz mono PCM: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const stats = await fs.stat(target).catch(() => null);
  if (!stats?.isFile() || stats.size === 0) {
    await removeTempFile(target);
    throw new TranscriptionFailure("TRANSCRIPTION_EMPTY", "ffmpeg produced an empty wave file");
  }
  return { path: target, sizeBytes: stats.size };
}

/** Best-effort removal of a temp artifact. A failure here must never mask the run's own outcome. */
export async function removeTempFile(filePath: string) {
  await fs.rm(filePath, { force: true }).catch(() => undefined);
}
