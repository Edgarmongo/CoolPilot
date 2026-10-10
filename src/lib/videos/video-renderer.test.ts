import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resolveVideoRenderInput, VideoRenderFailure } from "./video-render";
import {
  existingVideoPackageRenderer,
  formatSrt,
  formatSrtTimestamp,
  resolveCoverMaterial,
  resolveVideoMaterial,
  type VideoRenderLogEntry,
} from "./video-renderer";

/**
 * CI-P1-04-05: the installed renderer, pinned against a real (throwaway) workspace.
 *
 * This is the adapter P1-04-05 asks for, so the tests pin exactly what it claims and what it refuses:
 *
 * - it writes a **real** deliverable - the material's bytes, a real SRT document and a real metadata
 *   sidecar - and reports CI-P1-01 references for all three;
 * - it says what it did: `encoded: false`, the notes, and one progress event per stage;
 * - it refuses by name (`VideoRenderFailure` with a stable code) and refuses **before** writing anything
 *   when the material is missing, remote or not a video this library stores.
 *
 * The workspace is a throwaway directory pinned before the renderer (and therefore `@/lib/paths`) is
 * imported, exactly like `src/app/api/videos/route.test.ts`.
 */

const previousDataDir = process.env.SOCIAL_AUTO_POST_DATA_DIR;

const workspace = mkdtempSync(path.join(tmpdir(), "coolpilot-video-render-"));
process.env.SOCIAL_AUTO_POST_DATA_DIR = workspace;

const videosDir = path.join(workspace, "videos");
const artifactsDir = path.join(workspace, "artifacts");

const materialBytes = "real-video-bytes";

beforeEach(() => {
  rmSync(videosDir, { recursive: true, force: true });
  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(videosDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(path.join(videosDir, "clip.mp4"), materialBytes);
  writeFileSync(path.join(artifactsDir, "cover.png"), "cover-bytes");
});

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.SOCIAL_AUTO_POST_DATA_DIR;
  else process.env.SOCIAL_AUTO_POST_DATA_DIR = previousDataDir;
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    // A throwaway folder the OS reclaims on its own.
  }
});

async function render(input: Record<string, unknown>, taskId = "run-render-1") {
  const entries: VideoRenderLogEntry[] = [];
  const result = await existingVideoPackageRenderer.render(resolveVideoRenderInput(input), {
    taskId,
    log: async (entry) => {
      entries.push(entry);
    },
  });
  return { result, entries };
}

async function failureOf(run: () => Promise<unknown>) {
  try {
    await run();
    return null;
  } catch (error) {
    return error as VideoRenderFailure;
  }
}

const baseRequest = { template: { id: "existing_video_package" }, materials: { video: "clip.mp4" } };

describe("existing_video_package", () => {
  it("writes a real deliverable, a real subtitle track and real metadata", async () => {
    const { result, entries } = await render({
      ...baseRequest,
      materials: { video: "clip.mp4", cover: "cover.png" },
      params: {
        title: "Launch clip",
        captions: [
          { startMs: 0, endMs: 1_500, text: "hello" },
          { startMs: 1_500, endMs: 3_000, text: "world" },
        ],
      },
    });

    expect(result.artifacts.video.fileName).toMatch(/^render-\d+-[A-Za-z0-9_-]{8}\.mp4$/);
    expect(result.artifacts.video.url).toBe(`/api/videos?file=${result.artifacts.video.fileName}`);
    expect(result.videoBytes).toBe(materialBytes.length);
    // The bytes are the material's bytes: an adapter that packages does not touch them.
    expect(readFileSync(path.join(videosDir, result.artifacts.video.fileName), "utf8")).toBe(materialBytes);

    // The cover is the workspace's own file, carried unchanged and addressable through the artifacts route.
    expect(result.artifacts.cover).toMatchObject({
      fileName: "cover.png",
      url: "/api/agent/artifacts?file=cover.png",
    });

    // A subtitle file in `videos/` has no serving route yet, and the contract says so with `url: ""`.
    const subtitleFileName = result.artifacts.subtitles?.fileName ?? "";
    expect(subtitleFileName).toMatch(/^render-\d+-[A-Za-z0-9_-]{8}\.srt$/);
    expect(result.artifacts.subtitles?.url).toBe("");
    expect(readFileSync(path.join(videosDir, subtitleFileName), "utf8")).toBe(
      "1\n00:00:00,000 --> 00:00:01,500\nhello\n\n2\n00:00:01,500 --> 00:00:03,000\nworld\n",
    );

    const metadata = JSON.parse(readFileSync(path.join(videosDir, result.artifacts.metadata.fileName), "utf8"));
    expect(metadata).toMatchObject({
      taskId: "run-render-1",
      template: { id: "existing_video_package", version: 1 },
      renderer: { name: "existing-video-package", encoded: false },
      materials: { video: { fileName: "clip.mp4" }, cover: { fileName: "cover.png" } },
      artifacts: { video: result.artifacts.video.fileName, subtitles: subtitleFileName },
    });
    expect(metadata.createdAt).toBeGreaterThan(0);

    // One progress event per stage, and the last one says the work is finished.
    expect(entries.map((entry) => entry.stage)).toEqual(["materials", "video", "subtitles", "package"]);
    expect(entries.map((entry) => entry.progress?.current)).toEqual([1, 2, 3, 4]);
    expect(entries.every((entry) => entry.progress?.total === 4)).toBe(true);
  });

  it("names the material it could not use, and writes nothing", async () => {
    const missing = await failureOf(() => render({ ...baseRequest, materials: { video: "gone.mp4" } }));
    const remote = await failureOf(() =>
      render({ ...baseRequest, materials: { video: "https://cdn.example.com/clip.mp4" } }),
    );
    const notVideo = await failureOf(() => render({ ...baseRequest, materials: { video: "notes.txt" } }));

    expect(missing?.code).toBe("MATERIAL_NOT_FOUND");
    expect(missing?.message).toContain("gone.mp4");
    expect(remote?.code).toBe("MATERIAL_NOT_LOCAL");
    expect(remote?.message).toContain("https://cdn.example.com/clip.mp4");
    expect(notVideo?.code).toBe("MATERIAL_UNSUPPORTED");

    // Nothing was written: a refusal is not a partial render.
    expect(readdirSync(videosDir)).toEqual(["clip.mp4"]);
  });
});


describe("existing_video_package refusals", () => {
  it("refuses a cover it cannot serve, and never attaches an address that would 404", async () => {
    const missing = await failureOf(() =>
      render({ ...baseRequest, materials: { video: "clip.mp4", cover: "nope.png" } }),
    );
    writeFileSync(path.join(artifactsDir, "notes.txt"), "not an image");
    const unservable = await failureOf(() =>
      render({ ...baseRequest, materials: { video: "clip.mp4", cover: "notes.txt" } }),
    );

    expect(missing?.code).toBe("COVER_NOT_FOUND");
    expect(unservable?.code).toBe("COVER_UNSUPPORTED");
  });

  it("honours the output requirements instead of writing a track nobody asked for", async () => {
    const noTrack = await render({
      ...baseRequest,
      params: { subtitles: false, captions: [{ startMs: 0, endMs: 10, text: "unused" }] },
    });
    const noCaptions = await render(baseRequest);

    expect(noTrack.result.artifacts.subtitles).toBeNull();
    expect(noTrack.result.notes)
      .toContain("the request asked for no subtitle track, so the captions were not written");
    expect(noCaptions.result.artifacts.subtitles).toBeNull();
    expect(noCaptions.result.notes)
      .toContain("no captions were given, so the package carries no subtitle track");
  });

  it("sorts captions that arrived out of order and records that it did", async () => {
    const { result, entries } = await render({
      ...baseRequest,
      params: {
        captions: [
          { startMs: 2_000, endMs: 3_000, text: "second" },
          { startMs: 0, endMs: 1_000, text: "first" },
        ],
      },
    });

    expect(result.notes).toContain("the captions arrived out of order and were sorted by start time");
    expect(entries.find((entry) => entry.level === "warn")?.message).toContain("sorted by start time");
    expect(readFileSync(path.join(videosDir, result.artifacts.subtitles?.fileName ?? ""), "utf8")).toContain(
      "1\n00:00:00,000 --> 00:00:01,000\nfirst",
    );
  });
});

describe("material resolution", () => {
  it("resolves every historical reference form to the same workspace file", async () => {
    const bare = await resolveVideoMaterial("clip.mp4");
    const absolute = await resolveVideoMaterial(path.join(videosDir, "clip.mp4"));
    const appUrl = await resolveVideoMaterial("/api/videos?file=clip.mp4");

    expect([bare.ref.fileName, absolute.ref.fileName, appUrl.ref.fileName]).toEqual([
      "clip.mp4",
      "clip.mp4",
      "clip.mp4",
    ]);
    expect(bare.path).toBe(path.join(videosDir, "clip.mp4"));

    expect((await resolveCoverMaterial("cover.png")).ref.url).toBe("/api/agent/artifacts?file=cover.png");
    expect((await resolveCoverMaterial("/api/agent/artifacts?file=cover.png")).ref.fileName).toBe("cover.png");
  });

  it("formats SRT cues with the timestamps a player reads", () => {
    expect(formatSrtTimestamp(0)).toBe("00:00:00,000");
    expect(formatSrtTimestamp(3_661_007)).toBe("01:01:01,007");
    expect(formatSrt([{ startMs: 0, endMs: 500, text: "  trimmed  " }])).toBe(
      "1\n00:00:00,000 --> 00:00:00,500\ntrimmed\n",
    );
  });
});

