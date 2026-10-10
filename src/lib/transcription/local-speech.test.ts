import { describe, expect, it } from "vitest";
import { recognizeScript, stripBom } from "./local-speech";

/**
 * The two traps in the recognizer script (CI-P3-02), both found by running it against the real recognizer
 * rather than by reading it:
 *
 * 1. A parameter named `Input` does not bind - `$Input` is PowerShell's automatic pipeline variable - so
 *    the script received `''` and `SetInputToWaveFile('')` threw instead of transcribing anything.
 * 2. `[Parameter(Mandatory=$true)]` on a parameter that did not bind makes the child *prompt*, and the
 *    caller's stdin is an open pipe: the run then sat there until its whole budget was spent and the child
 *    was killed. That is a two-minute wait for a one-line refusal.
 *
 * Neither failure is visible from the caller: one throws inside a child process, the other simply takes the
 * whole budget. The script is pinned here so a future edit cannot reintroduce either one quietly.
 */
describe("windows recognizer script", () => {
  const script = recognizeScript;

  it("never declares a parameter named Input, which would not bind", () => {
    expect(script).not.toMatch(/\[string\]\$Input\b/);
    expect(script).not.toMatch(/-Input\b/);
    expect(script).toContain("param([string]$WavePath, [string]$Language, [string]$Out)");
  });

  it("feeds the wave file from the parameter it declared", () => {
    expect(script).toContain("$engine.SetInputToWaveFile($WavePath)");
  });

  it("declares no mandatory parameter, so a missing argument is a refusal and not a prompt", () => {
    expect(script).not.toContain("Mandatory");
    // The guard that replaces the prompt: usage on stderr, exit code 2, nothing written.
    expect(script).toContain("exit 2");
  });

  it("reports the recognizer it really used, with positions it really has", () => {
    expect(script).toContain("recognizerId = $chosen.Id");
    expect(script).toContain("culture = $chosen.Culture.Name");
    // The OS recognizer reports utterance breaks but no position in the file; `null` is what it is.
    expect(script).toContain("startMs = $null; endMs = $null");
  });
});

/** PowerShell 5.1's `Set-Content -Encoding UTF8` writes a BOM; `JSON.parse` refuses one. */
describe("recognizer answer reader", () => {
  it("strips the BOM Windows PowerShell writes and nothing else", () => {
    expect(stripBom('\uFEFF{"ok":true}')).toBe('{"ok":true}');
    expect(stripBom('{"ok":true}')).toBe('{"ok":true}');
    // A BOM is only special at the very start: a body that contains one keeps it.
    expect(stripBom('{"text":"\uFEFF"}')).toBe('{"text":"\uFEFF"}');
  });
});
