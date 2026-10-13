import { describe, expect, it } from "vitest";
import type { TaskLogEntry } from "@/lib/tasks/task-view";
import {
  isRenderArtifactFileName,
  renderArtifactContentType,
  videoRenderArtifactFiles,
  videoRenderArtifacts,
  videoRenderArtifactsRoute,
  videoRenderEncoded,
  videoRenderSidecarUrl,
  videoRenderTemplateCatalog,
  videoRenderToolPath,
} from "./video-render-artifacts";

/**
 * CI-P1-04 (sub-item P1-04-07): the rules that decide what a render package is made of and where each
 * file can be reached.
 *
 * The logs below are the shape `runEventsToTaskLogs()` really produces for the renderer's own events:
 * `stage` is the stage the renderer logged, and `data` is that event's data - the deliverable logs
 * `fileName` + `encoded`, the subtitle stage logs `fileName` + `cues`, the package stage logs `fileName`
 * + `renderId`, and the materials stage logs `video`/`cover` instead of a file name. That last
 * difference is why a material can never be read back as an artifact of the package.
 */

function logEntry(stage: string, data: Record<string, unknown>, message = stage): TaskLogEntry {
  return { taskId: "task-1", at: 1, level: "info", stage, message, data };
}

const deliverable = "render-1-abcdefgh.mp4";
const subtitles = "render-1-abcdefgh.srt";
const metadata = "render-1-abcdefgh.json";

const completeLog: TaskLogEntry[] = [
  logEntry("materials", { video: "clip.mp4", bytes: 120, cover: "cover.png" }),
  logEntry("video", { fileName: deliverable, bytes: 120, encoded: false }),
  logEntry("subtitles", { fileName: subtitles, cues: 2 }),
  logEntry("package", { fileName: metadata, renderId: "render-1-abcdefgh" }),
];

describe("isRenderArtifactFileName", () => {
  it("accepts the files a package writes and refuses the extensions it never writes", () => {
    expect(isRenderArtifactFileName(deliverable)).toBe(true);
    expect(isRenderArtifactFileName(subtitles)).toBe(true);
    expect(isRenderArtifactFileName(metadata)).toBe(true);

    expect(isRenderArtifactFileName("notes.txt")).toBe(false);
    expect(isRenderArtifactFileName("archive.zip")).toBe(false);
  });

  it("refuses a path, a traversal, a padded name and a quote", () => {
    expect(isRenderArtifactFileName("videos/render-1.mp4")).toBe(false);
    expect(isRenderArtifactFileName("..\\render-1.mp4")).toBe(false);
    expect(isRenderArtifactFileName("..\\credential-vault.json")).toBe(false);
    expect(isRenderArtifactFileName("../render-1.srt")).toBe(false);
    expect(isRenderArtifactFileName("render-1.mp4 ")).toBe(false);
    expect(isRenderArtifactFileName("")).toBe(false);
    expect(isRenderArtifactFileName('render-1".srt')).toBe(false);
    expect(isRenderArtifactFileName("render\u00001.srt")).toBe(false);
  });
});

describe("renderArtifactContentType", () => {
  it("uses the video library's types and the sidecars' own", () => {
    expect(renderArtifactContentType(deliverable)).toBe("video/mp4");
    expect(renderArtifactContentType(subtitles)).toBe("application/x-subrip; charset=utf-8");
    expect(renderArtifactContentType(metadata)).toBe("application/json; charset=utf-8");
    expect(renderArtifactContentType("odd.bin")).toBe("application/octet-stream");
  });
});

describe("videoRenderArtifactFiles", () => {
  it("reads the three products out of the task's own log", () => {
    expect(videoRenderArtifactFiles(completeLog)).toEqual({
      video: deliverable,
      subtitles,
      metadata,
    });
  });

  it("answers null for a product the log does not report", () => {
    const noSubtitles = completeLog.filter((entry) => entry.stage !== "subtitles");
    expect(videoRenderArtifactFiles(noSubtitles)).toEqual({
      video: deliverable,
      subtitles: null,
      metadata,
    });
    expect(videoRenderArtifactFiles([])).toEqual({ video: null, subtitles: null, metadata: null });
  });

  it("ignores a file name that is not one a package could write", () => {
    const smuggled = [
      logEntry("materials", { video: "../credential-vault.json" }),
      logEntry("video", { fileName: "../credential-vault.json", encoded: false }),
      logEntry("package", { fileName: "notes.txt" }),
    ];
    expect(videoRenderArtifactFiles(smuggled)).toEqual({
      video: null,
      subtitles: null,
      metadata: null,
    });
  });

  it("keeps the first name a stage logs rather than the last", () => {
    const relogged = [...completeLog, logEntry("video", { fileName: "render-2-zzzzzzzz.mp4" })];
    expect(videoRenderArtifactFiles(relogged).video).toBe(deliverable);
  });

  it("never treats the materials stage as a product of the package", () => {
    // The materials stage logs the *material*, which lives in the same `videos/` folder as the deliverable.
    const onlyMaterials = [logEntry("materials", { video: deliverable, cover: null })];
    expect(videoRenderArtifactFiles(onlyMaterials).video).toBe(null);
  });
});

describe("videoRenderEncoded", () => {
  it("reports what the log says, and silence as null", () => {
    expect(videoRenderEncoded(completeLog)).toBe(false);
    expect(videoRenderEncoded([])).toBe(null);
    expect(videoRenderEncoded([logEntry("materials", { video: "clip.mp4" })])).toBe(null);
    expect(videoRenderEncoded([logEntry("video", { fileName: deliverable, encoded: true })])).toBe(true);
  });
});

describe("videoRenderArtifacts", () => {
  it("describes the package in the order it was written, with a real address each", () => {
    const artifacts = videoRenderArtifacts("task-1", completeLog);
    expect(artifacts.map((artifact) => artifact.slot)).toEqual(["video", "subtitles", "metadata"]);
    expect(artifacts[0]).toMatchObject({
      fileName: deliverable,
      kind: "video",
      // The deliverable keeps the video library's own address, so it keeps Range support.
      url: `/api/videos?file=${encodeURIComponent(deliverable)}`,
    });
    expect(artifacts[1]).toMatchObject({
      fileName: subtitles,
      kind: "subtitle",
      url: `/api/videos/renders/task-1?file=${encodeURIComponent(subtitles)}`,
    });
    expect(artifacts[2]).toMatchObject({
      fileName: metadata,
      kind: "document",
      url: `/api/videos/renders/task-1?file=${encodeURIComponent(metadata)}`,
    });
  });

  it("omits a slot the task did not write instead of reporting it empty", () => {
    const artifacts = videoRenderArtifacts("task-1", completeLog.filter((e) => e.stage === "video"));
    expect(artifacts.map((artifact) => artifact.slot)).toEqual(["video"]);
  });

  it("builds addresses that carry the id and the name as data, not as path", () => {
    expect(videoRenderArtifactsRoute("a/b")).toBe("/api/videos/renders/a%2Fb");
    expect(videoRenderSidecarUrl("a/b", "x y.srt")).toBe("/api/videos/renders/a%2Fb?file=x%20y.srt");
  });

  it("names the write entry a client component may import", () => {
    // Spelled here, not imported from `video-render-tool.ts`: that module executes the task and reaches
    // the database, which a browser bundle cannot carry. The renders route test pins this path against
    // the registry's own tool name, so the second spelling cannot drift unnoticed.
    expect(videoRenderToolPath).toBe("/api/tools/video_render");
  });
});

describe("videoRenderTemplateCatalog", () => {
  it("summarises the registry the tool itself publishes", () => {
    const catalog = videoRenderTemplateCatalog();
    expect(catalog.map((template) => template.id)).toEqual(["existing_video_package"]);
    const [template] = catalog;
    expect(template.version).toBeGreaterThan(0);
    expect(template.materials).toEqual(["video", "cover"]);
    expect(template.params).toEqual(["title", "captions", "subtitles"]);
  });
});

