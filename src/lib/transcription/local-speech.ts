import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { removeTempFile } from "./ffmpeg";
import { TranscriptionFailure, type TranscriptionSegmentRecord } from "./transcription";

/**
 * The offline speech engine: the recognizer Windows already ships (CI-P3-02).
 *
 * Why this engine exists at all, next to a cloud one: a transcript request must not be *impossible* on a
 * machine with no API key, and a local-first app should be able to turn a talk into text without sending
 * it anywhere. `System.Speech` is a real recognizer - it is the same dictation engine Windows has used
 * since Vista - and it is invoked here as a child process because it is a .NET Framework API, not a
 * service: one `powershell.exe -File` per run, over a wave file ffmpeg produced.
 *
 * What it costs, stated plainly because the UI has to say it too:
 *
 * - **Windows only.** Everywhere else `availability()` answers `available: false`; the code does not
 *   pretend a Linux recognizer is around the corner.
 * - **A recognizer has to be installed.** Windows ships en-US; other languages appear only when the
 *   corresponding speech pack is installed. The chosen recognizer's id and culture are *reported*, so a
 *   transcript made with the English recognizer does not look like it was made with the Chinese one.
 * - **Recognition quality is the OS engine's**, which is below Whisper's - the cloud engine is the
 *   better answer for a real transcription, and this one is the answer for "offline, no key, now".
 * - **Utterances, not positions.** The recognizer reports how long each utterance lasted but not where
 *   it sat in the file, so segments are recorded with `startMs: null` rather than with a position this
 *   code would have to estimate. The transcript keeps the engine's own utterance breaks; timestamps are
 *   a cloud-engine feature.
 *
 * Nothing here keeps state between runs: the script is written to the OS temp directory, runs, and is
 * removed in a `finally`, exactly like the decoded wave beside it.
 */

const execFileAsync = promisify(execFile);

/** The host PowerShell. 5.1 is the one that carries `System.Speech`; an operator may override it. */
function powershellExecutable() {
  return process.env.COOLPILOT_POWERSHELL?.trim() || "powershell.exe";
}

/** Bounded: a listing is a listing. */
const listingTimeoutMs = 45_000;

/**
 * The recognizer script, as an array of lines so no shell quoting is involved: every argument travels as
 * an argument, and the answer travels back as JSON in a file rather than over stdout, where PowerShell's
 * own noise lives.
 *
 * The loop is what makes a long file work: `Recognize()` returns one utterance per call and *throws*
 * once the wave stream is exhausted, so an end-of-stream error is the loop's normal exit - which is why
 * this is a `try/catch` around the call rather than a `null` check.
 *
 * Two details are load-bearing, and both were found by running this against a real recognizer:
 *
 * 1. **No parameter is named `Input`.** `$Input` is one of PowerShell's automatic variables (the pipeline
 *    enumerator), and a `-Input` parameter does *not* bind: the script receives `''` and
 *    `SetInputToWaveFile('')` throws "'path' cannot be an empty string" instead of transcribing anything.
 *    `-WavePath` binds, and the value is verified below rather than assumed.
 * 2. **No parameter is `Mandatory`.** A mandatory parameter that did not bind makes PowerShell *ask* for
 *    it, and the caller's stdin is an open pipe: the child then waits for an answer nobody will type until
 *    the run's whole budget expires. A refusal has to be an answer, not a prompt.
 *
 * The array is exported so a test can pin those two rules: both failures are silent (a wrong parameter name
 * throws inside the child, a prompt hangs), and either one costs a whole run's time budget to observe.
 */
export const recognizeScript = [
  "param([string]$WavePath, [string]$Language, [string]$Out)",
  "$ErrorActionPreference = 'Stop'",
  "if ($WavePath -eq '' -or $Out -eq '') { [Console]::Error.WriteLine('usage: -WavePath <wav> [-Language <bcp47>] -Out <json>'); exit 2 }",
  "Add-Type -AssemblyName System.Speech",
  "function Write-Answer($payload) { $payload | ConvertTo-Json -Depth 6 -Compress | Set-Content -LiteralPath $Out -Encoding UTF8 }",
  "$recognizers = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())",
  "if ($recognizers.Count -eq 0) { Write-Answer @{ ok = $false; reason = 'no-recognizer'; detail = 'No System.Speech recognizer is installed on this machine.' }; exit 0 }",
  "$chosen = $null",
  "if ($Language -ne '') { foreach ($candidate in $recognizers) { if ($candidate.Culture.Name -like \"$Language*\") { $chosen = $candidate; break } } }",
  "if ($null -eq $chosen) { $chosen = $recognizers[0] }",
  "$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine $chosen",
  "$engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))",
  "$engine.SetInputToWaveFile($WavePath)",
  "$segments = New-Object System.Collections.ArrayList",
  "$texts = New-Object System.Collections.ArrayList",
  "$index = 0",
  "while ($index -lt 20000) {",
  "  $result = $null",
  "  try { $result = $engine.Recognize() } catch { break }",
  "  if ($null -eq $result) { break }",
  "  $spoken = ([string]$result.Text).Trim()",
  "  if ($spoken -ne '') {",
  "    [void]$segments.Add(@{ index = $index; startMs = $null; endMs = $null; text = $spoken })",
  "    [void]$texts.Add($spoken)",
  "    $index = $index + 1",
  "  }",
  "}",
  "$engine.Dispose()",
  "Write-Answer @{ ok = $true; recognizerId = $chosen.Id; culture = $chosen.Culture.Name; text = ($texts -join [Environment]::NewLine); segments = $segments }",
].join("\r\n");

/** Lists what this machine can recognise, without transcribing anything. */
const listScript = [
  "Add-Type -AssemblyName System.Speech",
  "$entries = @()",
  "foreach ($item in @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())) { $entries += @{ id = $item.Id; culture = $item.Culture.Name; description = $item.Description } }",
  "@{ ok = $true; recognizers = $entries } | ConvertTo-Json -Depth 4 -Compress",
].join("\r\n");

export type LocalRecognizer = { id: string; culture: string; description: string };

export type LocalSpeechAvailability =
  | { available: true; recognizers: LocalRecognizer[]; detail: string }
  | { available: false; recognizers: LocalRecognizer[]; detail: string };

/** Runs one script from a temp `.ps1` and removes it afterwards, whatever happened. */
async function runScript(input: { script: string; args: string[]; timeoutMs: number }) {
  const scriptPath = path.join(
    os.tmpdir(),
    `coolpilot-speech-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`,
  );
  // A BOM, because Windows PowerShell reads a script file as ANSI without one.
  await fs.writeFile(scriptPath, `\uFEFF${input.script}`, "utf8");
  try {
    return await execFileAsync(
      powershellExecutable(),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...input.args],
      { timeout: input.timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
  } finally {
    await removeTempFile(scriptPath);
  }
}

function platformRefusal(): LocalSpeechAvailability & { available: false } {
  return {
    available: false,
    recognizers: [],
    detail: `The Windows speech recognizer is only available on Windows (this build runs on ${process.platform}).`,
  };
}

/**
 * What this machine can recognise right now.
 *
 * The console asks this before it offers the local engine, so "not available" is a state the user reads
 * *before* submitting a file rather than a failure they wait for.
 */
export async function localSpeechAvailability(): Promise<LocalSpeechAvailability> {
  if (process.platform !== "win32") return platformRefusal();
  let stdout: string;
  try {
    const result = await runScript({ script: listScript, args: [], timeoutMs: listingTimeoutMs });
    stdout = result.stdout.trim();
  } catch (error) {
    return {
      available: false,
      recognizers: [],
      detail: `The Windows recognizer could not be queried: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  try {
    const payload = JSON.parse(stdout) as { recognizers?: LocalRecognizer[] };
    const recognizers = Array.isArray(payload.recognizers) ? payload.recognizers : [];
    if (recognizers.length === 0) {
      return {
        available: false,
        recognizers: [],
        detail:
          "No speech recognizer is installed for this language. Windows ships one for the system language; other languages need their speech pack.",
      };
    }
    return {
      available: true,
      recognizers,
      detail: `Installed: ${recognizers.map((entry) => entry.culture).join(", ")}`,
    };
  } catch {
    return {
      available: false,
      recognizers: [],
      detail: "The Windows recognizer answered with something that is not JSON.",
    };
  }
}

/**
 * PowerShell 5.1's `Set-Content -Encoding UTF8` writes a **BOM**, and `JSON.parse` rejects a leading
 * `\uFEFF` ("Unexpected token"). The answer files this module reads are written by that shell, so the three
 * bytes are stripped here rather than being allowed to turn a finished recognition into a parse error.
 */
export function stripBom(text: string) {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

export type LocalSpeechResult = {
  recognizerId: string;
  culture: string;
  text: string;
  segments: TranscriptionSegmentRecord[];
};

/**
 * Recognises the speech in one wave file with the installed Windows recognizer.
 *
 * `language` is a hint, not a promise: the recognizer whose culture matches it is preferred, and when
 * none does, the first installed one is used and its id and culture come back in the result - so a
 * transcript made with the English recognizer says so instead of silently pretending it understood
 * another language.
 */
export async function recognizeWithSystemSpeech(input: {
  wavePath: string;
  language: string;
  timeoutMs: number;
}): Promise<LocalSpeechResult> {
  if (process.platform !== "win32") {
    throw new TranscriptionFailure("RECOGNIZER_UNAVAILABLE", "The Windows speech recognizer is only available on Windows.");
  }

  const answerPath = path.join(
    os.tmpdir(),
    `coolpilot-speech-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  try {
    await runScript({
      script: recognizeScript,
      args: ["-WavePath", input.wavePath, "-Language", input.language, "-Out", answerPath],
      timeoutMs: input.timeoutMs,
    });

    const raw = stripBom(await fs.readFile(answerPath, "utf8").catch(() => ""));
    if (!raw.trim()) {
      throw new TranscriptionFailure(
        "RECOGNIZER_UNAVAILABLE",
        "The Windows recognizer produced no answer; it was probably unable to read the decoded audio.",
      );
    }

    const payload = JSON.parse(raw) as {
      ok?: boolean;
      reason?: string;
      detail?: string;
      recognizerId?: string;
      culture?: string;
      text?: string;
      segments?: TranscriptionSegmentRecord[];
    };
    if (payload.ok !== true) {
      throw new TranscriptionFailure(
        payload.reason === "no-recognizer" ? "RECOGNIZER_UNAVAILABLE" : "TRANSCRIPTION_FAILED",
        payload.detail ?? "The Windows recognizer refused the file",
      );
    }

    return {
      recognizerId: payload.recognizerId ?? "",
      culture: payload.culture ?? "",
      text: (payload.text ?? "").trim(),
      segments: Array.isArray(payload.segments) ? payload.segments : [],
    };
  } catch (error) {
    if (error instanceof TranscriptionFailure) throw error;
    const killed = (error as { killed?: boolean }).killed === true;
    throw new TranscriptionFailure(
      killed ? "TRANSCRIPTION_TIMEOUT" : "TRANSCRIPTION_FAILED",
      killed
        ? "The Windows recognizer exceeded this run's time budget."
        : `The Windows recognizer failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await removeTempFile(answerPath);
  }
}

