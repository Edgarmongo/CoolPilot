import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CI-P3-02-02/03/04: the transcription task against a real database, which is where the card's claims
 * are decided.
 *
 * The engines themselves are pinned elsewhere (`providers.test.ts`); what this file pins is what the
 * *task* does with whatever an engine answers:
 *
 * - a transcription is a `runs` row of type `media_transcription`, so CI-P1-02's own view reports its
 *   canonical status, its progress from its own log and the material the run wrote;
 * - the transcript is stored as a research material - the same kind of record a web page becomes - with
 *   the engine's own segments, including the timestamps the engine reported (P3-02-04);
 * - **empty is not success**: an engine that recognises nothing ends the task `failed` with
 *   `TRANSCRIPTION_EMPTY` and writes no material;
 * - an engine that refuses keeps its code, and a file that is gone is refused **before** an engine runs;
 * - a task that already reached a terminal status is not transcribed a second time, and a repeat submission
 *   of a file that is still running collapses into the same row instead of queueing a duplicate.
 *
 * `@/db/client` resolves its database once, when it is first imported, so the throwaway workspace is put in
 * the environment before any module of the app is loaded. `./providers` is mocked after that point and only
 * its engine *choice* is replaced: the real `resolveTranscriptionSource()` still runs against the real
 * workspace, which is what makes the missing-file case a real one.
 */

vi.mock("./providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./providers")>();
  return { ...actual, chooseTranscriptionProvider: vi.fn() };
});

const tempDir = mkdtempSync(path.join(tmpdir(), "coolpilot-transcription-task-"));
const workspace = path.join(tempDir, "CoolPilot", "web-data");

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;
const previousDbUrl = process.env.SOCIAL_AUTO_POST_DB_URL;
process.env.SOCIAL_AUTO_POST_DATA_DIR = workspace;
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(workspace, "social-auto-post.db").replace(/\\/g, "/")}`;

const mediaDir = path.join(workspace, "media");

let repository: typeof import("@/db/repository");
let sqlite: typeof import("@/db/client").sqlite;
let research: typeof import("@/db/repositories/research");
let tasks: typeof import("@/lib/tasks/task-library");
let transcription: typeof import("./transcription-task");
let contract: typeof import("./transcription");
let providers: typeof import("./providers");

beforeAll(async () => {
  repository = await import("@/db/repository");
  ({ sqlite } = await import("@/db/client"));
  research = await import("@/db/repositories/research");
  tasks = await import("@/lib/tasks/task-library");
  transcription = await import("./transcription-task");
  contract = await import("./transcription");
  providers = await import("./providers");
  // Migrations run on the first repository call, exactly like the app's first request.
  await repository.listRuns(1);
  mkdirSync(mediaDir, { recursive: true });
});

beforeEach(async () => {
  rmSync(mediaDir, { recursive: true, force: true });
  mkdirSync(mediaDir, { recursive: true });
  writeFileSync(path.join(mediaDir, "talk.mp3"), "fake-mp3-bytes");
  vi.mocked(providers.chooseTranscriptionProvider).mockReset();
  // Each test starts from a workspace the previous test's transcript cannot leak into: a test that counts
  // materials has to be counting only what it wrote.
  await sqlite.execute({ sql: "DELETE FROM research_materials" });
  await sqlite.execute({ sql: "DELETE FROM run_events" });
  await sqlite.execute({ sql: "DELETE FROM runs" });
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

/** The request a caller submits; the file created in `beforeEach` is what it names. */
const request = {
  sourceRoot: "media" as const,
  sourceFileName: "talk.mp3",
  providerId: "local-windows-speech" as const,
};

/** One stubbed engine, answering what a test tells it to answer. */
function engine(overrides: Partial<import("./providers").TranscriptionProviderResult> = {}) {
  return {
    id: "local-windows-speech" as const,
    async availability() {
      return { providerId: "local-windows-speech" as const, available: true, detail: "fake recognizer (test)" };
    },
    async transcribe() {
      return {
        providerId: "local-windows-speech" as const,
        model: "fake-recognizer",
        language: "zh-CN",
        durationMs: 12_000,
        text: "第一段。第二段。",
        segments: [
          { index: 0, startMs: 0, endMs: 4_000, text: "第一段。" },
          { index: 1, startMs: 4_000, endMs: 12_000, text: "第二段。" },
        ],
        responseFormat: "local" as const,
        notes: [],
        ...overrides,
      };
    },
  };
}

/** Makes the provider layer answer with one engine, as a successful choice with nothing tried before it. */
function chosen(provider = engine()) {
  const availability = { providerId: provider.id, available: true, detail: "fake recognizer (test)" };
  vi.mocked(providers.chooseTranscriptionProvider).mockResolvedValue({ provider, availability, tried: [availability] });
  return provider;
}

describe("transcription task", () => {
  it("stores the transcript as a research material the task system points at", async () => {
    chosen();

    const { run } = await transcription.createTranscriptionTask(request);
    const outcome = await transcription.executeTranscriptionTask(run.id);

    expect(outcome.kind).toBe("succeeded");
    if (outcome.kind !== "succeeded") return;

    const material = await research.getResearchMaterial(outcome.materialId);
    expect(material).not.toBeNull();
    // The material is a real research row: the text a generation reads, the file it came from, and the
    // engine's own segments - not a parallel store of its own.
    expect(material?.kind).toBe("audio");
    expect(material?.fileName).toBe("talk.mp3");
    expect(material?.content).toBe("第一段。第二段。");
    expect(material?.transcript?.taskId).toBe(run.id);
    expect(material?.transcript?.providerId).toBe("local-windows-speech");
    expect(material?.transcript?.model).toBe("fake-recognizer");
    expect(material?.transcript?.segments.map((segment) => segment.startMs)).toEqual([0, 4_000]);

    // The run is a task of CI-P1-02: canonical status, its own progress, and the material in its log.
    const view = await tasks.findTaskView(run.id);
    expect(view?.type).toBe("media_transcription");
    expect(view?.status).toBe("succeeded");
    expect(view?.progress).toBe(100);
    const logs = await tasks.listTaskLogs("playbook", run.id);
    expect(logs.at(-1)?.data.materialId).toBe(outcome.materialId);
  });

  it("writes into the material the request named instead of creating a second one", async () => {
    chosen();
    const created = await research.createResearchMaterial({
      title: "访谈（待转写）",
      kind: "audio",
      content: "占位文字",
      fileName: "talk.mp3",
    });
    expect(created).not.toBeNull();
    if (!created) return;
    const existing = created;

    const { run } = await transcription.createTranscriptionTask({ ...request, materialId: existing.id });
    const outcome = await transcription.executeTranscriptionTask(run.id);

    expect(outcome.kind).toBe("succeeded");
    if (outcome.kind !== "succeeded") return;
    expect(outcome.materialId).toBe(existing.id);

    // One material, not two: the transcript replaced the body the caller pointed at, and recorded where
    // the text came from.
    const materials = await research.listResearchMaterials();
    expect(materials).toHaveLength(1);
    const updated = await research.getResearchMaterial(existing.id);
    expect(updated?.content).toBe("第一段。第二段。");
    expect(updated?.status).toBe("ready");
    expect(updated?.fetchedAt).not.toBeNull();
    expect(updated?.transcript?.sourceFileName).toBe("talk.mp3");
  });

  it("treats an engine that recognised nothing as a failure, never as an empty transcript", async () => {
    chosen(engine({ text: "", segments: [] }));

    const { run } = await transcription.createTranscriptionTask(request);
    const outcome = await transcription.executeTranscriptionTask(run.id);

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.failure.code).toBe("TRANSCRIPTION_EMPTY");
    expect(await research.listResearchMaterials()).toHaveLength(0);
    expect((await tasks.findTaskView(run.id))?.status).toBe("failed");
  });

  it("keeps the engine's own refusal code on the task", async () => {
    vi.mocked(providers.chooseTranscriptionProvider).mockRejectedValue(
      new contract.TranscriptionFailure("PROVIDER_UNAVAILABLE", "ai-runtime: no speech_to_text model configured"),
    );

    const { run } = await transcription.createTranscriptionTask(request);
    const outcome = await transcription.executeTranscriptionTask(run.id);

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.failure.code).toBe("PROVIDER_UNAVAILABLE");
    expect(outcome.failure.message).toContain("no speech_to_text model configured");
    // CI-P1-02's view words a failed run as `RUN_FAILED` with the run's own message; the refusal's stable
    // code is the one the run_events entry carries, which is what the console shows as the reason.
    const view = await tasks.findTaskView(run.id);
    expect(view?.status).toBe("failed");
    expect(view?.error?.message).toContain("no speech_to_text model configured");
    const logs = await tasks.listTaskLogs("playbook", run.id);
    expect(logs.at(-1)?.data.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("refuses a file that is not in the workspace before an engine is asked", async () => {
    chosen();

    const { run } = await transcription.createTranscriptionTask({ ...request, sourceFileName: "gone.mp3" });
    const outcome = await transcription.executeTranscriptionTask(run.id);

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.failure.code).toBe("SOURCE_MISSING");
    expect(vi.mocked(providers.chooseTranscriptionProvider)).not.toHaveBeenCalled();
    expect(await research.listResearchMaterials()).toHaveLength(0);
  });

  it("does not transcribe a task that already reached a terminal status", async () => {
    chosen();
    const { run } = await transcription.createTranscriptionTask(request);
    await transcription.executeTranscriptionTask(run.id);

    const again = await transcription.executeTranscriptionTask(run.id);

    expect(again.kind).toBe("skipped");
    expect(await research.listResearchMaterials()).toHaveLength(1);
    // The engine ran exactly once for this row.
    expect(vi.mocked(providers.chooseTranscriptionProvider)).toHaveBeenCalledTimes(1);
  });

  it("collapses a repeat submission of a file that is still in flight, and honours an idempotency key", async () => {
    chosen();
    const first = await transcription.createTranscriptionTask(request);
    const second = await transcription.createTranscriptionTask(request);

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.run.id).toBe(first.run.id);

    // A key names an operation, so that run answers it even after it settled: the caller asked for
    // exactly-once and got it.
    await transcription.executeTranscriptionTask(first.run.id);
    const keyed = await transcription.createTranscriptionTask({ ...request, idempotencyKey: "podcast-42" });
    const keyedAgain = await transcription.createTranscriptionTask({ ...request, idempotencyKey: "podcast-42" });
    expect(keyedAgain.reused).toBe(true);
    expect(keyedAgain.run.id).toBe(keyed.run.id);

    // Without a key a terminal run is history and a new submission is a new run - "transcribe it once
    // more, with the other engine" has to stay possible (nothing of that file is in flight any more).
    await transcription.executeTranscriptionTask(keyed.run.id);
    const deliberate = await transcription.createTranscriptionTask(request);
    expect(deliberate.reused).toBe(false);
    expect(deliberate.run.id).not.toBe(keyed.run.id);
  });

  it("starts a task once per process and lists it for the console", async () => {
    chosen();
    const { run } = await transcription.createTranscriptionTask(request);

    expect(transcription.startTranscriptionTask(run.id)).toBe(true);
    // The same row cannot be started twice by this process; the second call is refused, not queued.
    expect(transcription.startTranscriptionTask(run.id)).toBe(false);

    await vi.waitFor(async () => {
      expect((await tasks.findTaskView(run.id))?.status).toBe("succeeded");
    });

    const listed = await transcription.listTranscriptionTasks();
    expect(listed.map((task) => task.id)).toContain(run.id);
    expect(listed.every((task) => task.type === "media_transcription")).toBe(true);
  });
});
