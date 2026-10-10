import fs from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/transcription` and `GET /api/transcription` (CI-P3-02-01/02).
 *
 * The route's own contract is decided here: what it refuses, with which status, and what it answers a
 * caller who has to poll. Two things it deliberately does **not** prove, because they belong elsewhere:
 *
 * - the *execution* is `src/lib/transcription/transcription-task.test.ts` (and, for real engines,
 *   `pnpm verify`), so `startTranscriptionTask()` is stubbed here. A route test that ran a real engine
 *   would spend minutes in Windows speech recognition and could only assert on a machine's installed
 *   recognizers, which is not what this file is for;
 * - the run it creates is still a **real** `runs` row, read back through the repository, because "the task
 *   exists and CI-P1-02 can report it" is exactly what the route promises.
 *
 * The workspace is thrown away, so a submission named `talk.mp3` is only answerable when this test put that
 * file in `media/` - which is how "refused before a task is created" is asserted rather than assumed.
 */

vi.mock("@/lib/transcription/transcription-task", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/transcription/transcription-task")>();
  return { ...actual, startTranscriptionTask: vi.fn(() => true) };
});

const tempDir = fs.mkdtempSync(path.join(tmpdir(), "coolpilot-transcription-route-"));
const workspace = path.join(tempDir, "CoolPilot", "web-data");
const mediaDir = path.join(workspace, "media");

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;
const previousDbUrl = process.env.SOCIAL_AUTO_POST_DB_URL;
process.env.SOCIAL_AUTO_POST_DATA_DIR = workspace;
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(workspace, "social-auto-post.db").replace(/\\/g, "/")}`;

const { GET, POST } = await import("./route");
const repository = await import("@/db/repository");
const { sqlite } = await import("@/db/client");
await repository.listRuns(1);

const submit = (body: unknown) =>
  POST(
    new Request("http://localhost/api/transcription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

afterEach(async () => {
  rmSync(mediaDir, { recursive: true, force: true });
  await sqlite.execute({ sql: "DELETE FROM run_events" });
  await sqlite.execute({ sql: "DELETE FROM runs" });
  await sqlite.execute({ sql: "DELETE FROM research_materials" });
});

afterAll(async () => {
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

describe("/api/transcription", () => {
  it("answers an empty list before anything was submitted, without creating the media section", async () => {
    const { data } = await (await GET()).json();
    expect(data.tasks).toEqual([]);
    // Listing transcription tasks is a read of `runs`: it needs no media section and leaves none behind.
    expect(fs.existsSync(mediaDir)).toBe(false);
  });


  it("refuses a request that names no media file, and creates no task for it", async () => {
    const response = await submit({ sourceRoot: "media" });

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.code).toBe("INVALID_PAYLOAD");
    expect(await repository.listRuns(10)).toHaveLength(0);
  });

  it("refuses a file that is not in the media library before a task exists", async () => {
    const response = await submit({ sourceRoot: "media", sourceFileName: "missing.mp3" });

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.details?.code).toBe("SOURCE_MISSING");
    // Nothing was queued: the refusal is the answer to *this* request, not a task that fails a second later.
    expect(await repository.listRuns(10)).toHaveLength(0);
  });

  it("creates a real task the console can poll for a file that is there", async () => {
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "talk.mp3"), "fake-mp3-bytes");

    const response = await submit({
      sourceRoot: "media",
      sourceFileName: "talk.mp3",
      providerId: "local-windows-speech",
      language: "zh-CN",
      title: "访谈转写",
    });

    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data.reused).toBe(false);
    expect(data.started).toBe(true);
    expect(data.lookup).toBe(`/api/tasks/${data.taskId}`);
    // The task view comes from CI-P1-02, not from this route: a queued row of the transcription playbook.
    expect(data.task).toMatchObject({ id: data.taskId, type: "media_transcription", status: "queued" });

    const run = await repository.getRun(data.taskId);
    expect(run?.playbookId).toBe("media_transcription");
    // The request is stored as it was accepted, which is what the executor re-reads.
    expect(run?.params).toMatchObject({
      sourceRoot: "media",
      sourceFileName: "talk.mp3",
      providerId: "local-windows-speech",
      language: "zh-CN",
      title: "访谈转写",
    });

    const { data: listed } = await (await GET()).json();
    expect(listed.tasks.map((task: { id: string }) => task.id)).toEqual([data.taskId]);
  });

  it("answers a second submission of the same file with the task already in flight", async () => {
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "talk.mp3"), "fake-mp3-bytes");
    const body = { sourceRoot: "media", sourceFileName: "talk.mp3" };

    const first = await (await submit(body)).json();
    const second = await submit(body);

    expect(second.status).toBe(200);
    const repeated = await second.json();
    expect(repeated.data.reused).toBe(true);
    expect(repeated.data.taskId).toBe(first.data.taskId);
    // One row, not two: a double click cannot queue the same minutes of audio twice.
    expect(await repository.listRuns(10)).toHaveLength(1);
  });
});
