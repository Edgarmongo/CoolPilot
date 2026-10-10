import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { toMediaAssetRef, type MediaAssetRef, type MediaAssetRoot } from "@/lib/media-artifact-ref";
import { artifactsRoot, brandLogosRoot, ensureVideosRoot, productImagesRoot, videosRoot } from "@/lib/paths";
import type { RunEventRecord } from "@/lib/types";
import { VIDEO_FILE_EXTENSIONS } from "@/lib/video-library";
import {
  VideoRenderFailure,
  resolveVideoCaptions,
  type ResolvedVideoRender,
  type VideoRenderParams,
} from "./video-render";
import type { VideoCaption } from "./video-template";

/**
 * CI-P1-04-05: the renderer the video render task runs on this build.
 *
 * It is an **adapter, and it says so**. `existing-video-package` does not encode frames: it packages
 * material the workspace already holds - a real byte-for-byte deliverable copy in `videos/`, an optional
 * subtitle track, an optional cover the workspace can serve, and a metadata sidecar - and reports
 * `encoded: false` in every outcome. That is what P1-04-05 asks for ("建立一个可调用的模拟渲染器或
 * 测试适配器，验证整个任务链路"), and it is why no template that *needs* an encoder is published:
 * whether CoolPilot adopts ffmpeg/Remotion is P1-04-06's decision, taken against this interface.
 *
 * What is real here, and therefore verifiable:
 *
 * - the material is resolved through the frozen CI-P1-01 resolver and must exist on disk;
 * - the deliverable is a real file with real bytes, addressable through `/api/videos?file=` and
 *   readable with HTTP range requests like every other stored video;
 * - the subtitle sidecar is a real SRT document, and the metadata sidecar records the task, template,
 *   renderer and materials it came from;
 * - a refusal is a `VideoRenderFailure` with a stable code - never a half-written package reported as a
 *   success.
 *
 * `VideoRenderer` is the seam a real encoder plugs into: `render()` takes the resolved request and a
 * context and answers with CI-P1-01 references. Nothing above it - the task contract, the tool entry,
 * the media references - changes when one is added.
 */

/** One line the renderer reports to the task log; the task executor maps it onto `run_events`. */
export type VideoRenderLogEntry = {
  stage: string;
  message: string;
  level?: RunEventRecord["level"];
  /** Explicit progress only: `{ current, total }` of the stages, never an estimate. */
  progress?: { current: number; total: number };
  data?: Record<string, unknown>;
};

export type VideoRenderContext = {
  /** The task that owns this render; written into the metadata sidecar so a file traces back to a task. */
  taskId: string;
  log: (entry: VideoRenderLogEntry) => Promise<void>;
};

export type VideoRenderArtifacts = {
  video: MediaAssetRef;
  /** The cover material, carried unchanged - `null` when the request named none. */
  cover: MediaAssetRef | null;
  /** The SRT sidecar - `null` when there are no captions or the request asked for no track. */
  subtitles: MediaAssetRef | null;
  metadata: MediaAssetRef;
};

export type VideoRenderResult = {
  artifacts: VideoRenderArtifacts;
  /** Bytes of the deliverable video file as written. */
  videoBytes: number;
  notes: string[];
};

export type VideoRenderer = {
  name: string;
  /** True only for a renderer that encodes new frames. Informational: callers report it verbatim. */
  encoded: boolean;
  render: (request: ResolvedVideoRender, context: VideoRenderContext) => Promise<VideoRenderResult>;
};

/** A workspace file the renderer resolved: the CI-P1-01 reference plus where it really is. */

/** The image roots a cover may come from, in the order they are searched for a bare file name. */
const coverRoots: readonly MediaAssetRoot[] = ["artifacts", "product-images", "brand-logos"];

const coverRootDirectories: Record<"artifacts" | "product-images" | "brand-logos", () => string> = {
  artifacts: artifactsRoot,
  "product-images": productImagesRoot,
  "brand-logos": brandLogosRoot,
};

/**
 * The video material, resolved through the frozen CI-P1-01 reference rules: a bare name, an absolute or
 * relative path and the app's own `/api/videos?file=` address all reduce to a name of the `videos/`
 * section, exactly like the publishing path resolves a stored video.
 */
export async function resolveVideoMaterial(value: string): Promise<ResolvedWorkspaceFile> {
  const ref = toMediaAssetRef(value, { root: "videos" });
  // A remote reference carries no local name at all, so it is named before the "no such file" case:
  // "the workspace does not hold it" and "it is somewhere else" are different answers.
  if (ref.external) {
    throw new VideoRenderFailure(
      "MATERIAL_NOT_LOCAL",
      `"${ref.remoteUrl}" is a remote address; the renderer packages files the workspace already holds`,
    );
  }
  if (!ref.fileName) {
    throw new VideoRenderFailure("MATERIAL_NOT_FOUND", `"${value}" names no file of the videos section`);
  }
  if (ref.kind !== "video") {
    throw new VideoRenderFailure(
      "MATERIAL_UNSUPPORTED",
      `"${ref.fileName}" is not a video this library stores (${VIDEO_FILE_EXTENSIONS.join(", ")})`,
    );
  }
  const filePath = path.join(videosRoot(), ref.fileName);
  const stats = await fs.stat(filePath).catch(() => null);
  if (!stats?.isFile()) {
    throw new VideoRenderFailure("MATERIAL_NOT_FOUND", `there is no file "${ref.fileName}" in the videos section`);
  }
  return { ref, path: filePath, bytes: stats.size };
}

/**
 * The cover material. A reference that names a root (an `/api/...` address) is only searched there; a
 * bare file name is searched in the three image roots in a fixed order, which is the same set
 * `listMediaAssets()` walks. A file that exists but has no serving route is refused rather than attached
 * as an address no browser could open.
 */
export async function resolveCoverMaterial(value: string): Promise<ResolvedWorkspaceFile> {
  const candidate = toMediaAssetRef(value);
  if (candidate.external) {
    throw new VideoRenderFailure(
      "COVER_UNSUPPORTED",
      `"${candidate.remoteUrl}" is a remote address; the renderer attaches covers the workspace already holds`,
    );
  }
  if (!candidate.fileName) {
    throw new VideoRenderFailure("COVER_NOT_FOUND", `"${value}" names no file of the workspace image roots`);
  }
  const roots = value.trim().startsWith("/api/") ? [candidate.root] : coverRoots;
  for (const root of roots) {
    if (root !== "artifacts" && root !== "product-images" && root !== "brand-logos") continue;
    const filePath = path.join(coverRootDirectories[root](), candidate.fileName);
    const stats = await fs.stat(filePath).catch(() => null);
    if (!stats?.isFile()) continue;
    const ref = toMediaAssetRef(candidate.fileName, { root });
    if (!ref.url) {
      throw new VideoRenderFailure(
        "COVER_UNSUPPORTED",
        `"${candidate.fileName}" in ${root}/ cannot be served as an image`,
      );
    }
    return { ref, path: filePath, bytes: stats.size };
  }
  throw new VideoRenderFailure(
    "COVER_NOT_FOUND",
    `there is no file "${candidate.fileName}" in ${coverRoots.map((root) => `${root}/`).join(", ")}`,
  );
}

export type ResolvedWorkspaceFile = { ref: MediaAssetRef; path: string; bytes: number };

/** How many stages a package render reports progress for, so `{ current, total }` means something. */
export const videoRenderStageCount = 4;

function pad(value: number, size = 2) {
  return String(value).padStart(size, "0");
}

/** `HH:MM:SS,mmm`, the SRT timestamp. Values are rounded and never negative. */
export function formatSrtTimestamp(ms: number) {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(clamped % 1_000, 3)}`;
}

/** An SRT document: one numbered cue per caption, blank-line separated, text trimmed. */
export function formatSrt(captions: readonly VideoCaption[]) {
  return captions
    .map(
      (caption, index) =>
        `${index + 1}\n${formatSrtTimestamp(caption.startMs)} --> ${formatSrtTimestamp(caption.endMs)}\n${caption.text.trim()}\n`,
    )
    .join("\n");
}

/** The render metadata sidecar: what produced this package, and what it was made of. */
export type VideoRenderMetadata = {
  taskId: string;
  renderId: string;
  createdAt: number;
  template: { id: string; version: number };
  renderer: { name: string; encoded: boolean };
  materials: { video: MediaAssetRef; cover: MediaAssetRef | null };
  artifacts: { video: string; subtitles: string | null };
  parameters: VideoRenderParams;
  notes: string[];
};

function writeFailure(fileName: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return new VideoRenderFailure("WORKSPACE_WRITE_FAILED", `could not write "${fileName}": ${detail}`);
}

/**
 * The installed renderer: package existing workspace material into a deliverable.
 *
 * The deliverable video is a copy of the material's bytes - the same file, a new address and a new name
 * that the render task owns. Nothing here pretends otherwise: `encoded` is `false`, the metadata sidecar
 * says so, and the outcome carries the notes that explain what was and was not produced.
 */
export const existingVideoPackageRenderer: VideoRenderer = {
  name: "existing-video-package",
  encoded: false,

  async render(request: ResolvedVideoRender, context: VideoRenderContext): Promise<VideoRenderResult> {
    const params: VideoRenderParams = request.params;
    const notes: string[] = [];
    const total = videoRenderStageCount;

    // 1. materials - both are resolved through the CI-P1-01 rules and must exist on disk.
    const material = await resolveVideoMaterial(request.materials.video);
    const cover = request.materials.cover ? await resolveCoverMaterial(request.materials.cover) : null;
    await context.log({
      stage: "materials",
      message: `Material "${material.ref.fileName}" resolved (${material.bytes} bytes${
        cover ? `, cover "${cover.ref.fileName}"` : ", no cover"
      })`,
      progress: { current: 1, total },
      data: { video: material.ref.fileName, bytes: material.bytes, cover: cover?.ref.fileName ?? null },
    });
    if (!cover) notes.push("no cover material was given, so the package carries no cover");
    else notes.push("the cover is attached unchanged; this renderer does not draw on it");

    // 2. the deliverable video - a real file with the material's real bytes.
    const renderId = `render-${Date.now()}-${nanoid(8)}`;
    const extension = path.extname(material.ref.fileName).toLowerCase();
    const videoFileName = `${renderId}${extension}`;
    const videosDir = ensureVideosRoot();
    try {
      await fs.copyFile(material.path, path.join(videosDir, videoFileName));
    } catch (error) {
      throw writeFailure(videoFileName, error);
    }
    const videoStats = await fs.stat(path.join(videosDir, videoFileName));
    await context.log({
      stage: "video",
      message: `Deliverable video "${videoFileName}" written (${videoStats.size} bytes, copied from "${material.ref.fileName}")`,
      progress: { current: 2, total },
      data: { fileName: videoFileName, bytes: videoStats.size, encoded: false },
    });


    // 3. the subtitle track - a real SRT document, or an explicit statement that there is none.
    const resolved = resolveVideoCaptions(params.captions ?? []);
    if (!resolved.sorted) {
      notes.push("the captions arrived out of order and were sorted by start time");
      await context.log({
        stage: "subtitles",
        message: `Captions were sorted by start time (${resolved.captions.length} cues)`,
        level: "warn",
        progress: { current: 3, total },
      });
    }
    let subtitleFileName: string | null = null;
    if (!params.subtitles) {
      notes.push("the request asked for no subtitle track, so the captions were not written");
      await context.log({
        stage: "subtitles",
        message: "No subtitle track was written: the request asked for none",
        progress: { current: 3, total },
      });
    } else if (resolved.captions.length === 0) {
      notes.push("no captions were given, so the package carries no subtitle track");
      await context.log({
        stage: "subtitles",
        message: "No subtitle track was written: there are no captions",
        progress: { current: 3, total },
      });
    } else {
      subtitleFileName = `${renderId}.srt`;
      try {
        await fs.writeFile(path.join(videosDir, subtitleFileName), formatSrt(resolved.captions), "utf8");
      } catch (error) {
        throw writeFailure(subtitleFileName, error);
      }
      await context.log({
        stage: "subtitles",
        message: `Subtitle track "${subtitleFileName}" written (${resolved.captions.length} cues)`,
        progress: { current: 3, total },
        data: { fileName: subtitleFileName, cues: resolved.captions.length },
      });
    }

    // 4. the metadata sidecar: the package's own account of what produced it.
    const metadata: VideoRenderMetadata = {
      taskId: context.taskId,
      renderId,
      createdAt: Date.now(),
      template: request.templateRef,
      renderer: { name: existingVideoPackageRenderer.name, encoded: existingVideoPackageRenderer.encoded },
      materials: { video: material.ref, cover: cover?.ref ?? null },
      artifacts: { video: videoFileName, subtitles: subtitleFileName },
      parameters: params,
      notes,
    };
    const metadataFileName = `${renderId}.json`;
    try {
      await fs.writeFile(path.join(videosDir, metadataFileName), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    } catch (error) {
      throw writeFailure(metadataFileName, error);
    }
    await context.log({
      stage: "package",
      message: `Render metadata "${metadataFileName}" written`,
      progress: { current: 4, total },
      data: { fileName: metadataFileName, renderId },
    });

    // 5. the outcome - CI-P1-01 references, so a caller reads these files like any other media file.
    return {
      artifacts: {
        video: toMediaAssetRef(videoFileName, { root: "videos" }),
        cover: cover?.ref ?? null,
        subtitles: subtitleFileName ? toMediaAssetRef(subtitleFileName, { root: "videos" }) : null,
        metadata: toMediaAssetRef(metadataFileName, { root: "videos" }),
      },
      videoBytes: videoStats.size,
      notes,
    };
  },
};

/** The renderer this build installs for the task executor; one name, so a caller can report it. */
export const installedVideoRenderer: VideoRenderer = existingVideoPackageRenderer;

