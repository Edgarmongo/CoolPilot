import type { TaskLogEntry } from "@/lib/tasks/task-view";
import { VIDEO_CONTENT_TYPES, VIDEO_FILE_EXTENSIONS, videoUrl } from "@/lib/video-library";
import { videoTemplates } from "./video-template";

/**
 * CI-P1-04, sub-item P1-04-07: what a render package is made of, and where a caller can get it.
 *
 * CI-P1-04 delivered the template contract, the render task and the pass-through renderer, plus a
 * `POST /api/tools/video_render` entry - and nothing that a screen could read. Two concrete holes are
 * what this module closes, and both are about **a file that exists but cannot be reached**:
 *
 * 1. The renderer writes three files per package - the deliverable `<renderId>.<ext>`, the subtitle
 *    sidecar `<renderId>.srt` and the metadata sidecar `<renderId>.json` - but only the video had a
 *    serving route (`/api/videos?file=`, which refuses every non-video extension by design). The two
 *    sidecars were reported as `url: ""`, the CI-P1-01 sentinel for "nothing serves this
 *    root/extension yet": true at the time, and a dead end for a caller.
 * 2. `runs.artifact_path` holds the video address only. The sidecar names exist in exactly two places:
 *    the workspace directory and the task's own log. This module reads them out of **the log** - the
 *    record the task itself wrote - instead of inventing a second index or re-rendering.
 *
 * Three rules it keeps:
 *
 * 1. **Nothing is derived by guessing.** A file name is only taken from a log entry whose stage the
 *    renderer logs that product under (`video` / `subtitles` / `package`) and whose `data.fileName` is a
 *    plain file name a package can produce. Anything else is ignored, and a slot the log never mentions
 *    stays `null`.
 * 2. **The address is the route that really serves it.** The deliverable keeps the video library's own
 *    address (so it keeps HTTP Range support and is usable wherever a stored video is); the sidecars are
 *    served by the render route that proves they belong to this task. No file gets an invented address.
 * 3. **This module is Node-free.** It reads log values and builds strings; `paths.ts`, `fs` and the
 *    database stay in the routes, so one rule serves both a server route and a client component.
 */

/** The sidecars `existing-video-package` writes beside the deliverable. */
export const renderSidecarExtensions = [".srt", ".json"] as const;

/**
 * Every extension a render artifact may carry: the deliverable's video extensions plus the two sidecars.
 * The pair is the whole allowlist a serving route checks against, so a package can never address a file
 * it could not have written.
 */
export const renderArtifactExtensions: readonly string[] = [
  ...VIDEO_FILE_EXTENSIONS,
  ...renderSidecarExtensions,
];

/** Content types for the sidecars; the deliverable's come from the video library. */
export const renderSidecarContentTypes: Record<string, string> = {
  ".srt": "application/x-subrip; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/** The three products a render package writes. The cover is a material, not a product. */
export type VideoRenderArtifactSlot = "video" | "subtitles" | "metadata";

/** One artifact of one render task, as a caller reads it. */
export type VideoRenderArtifact = {
  slot: VideoRenderArtifactSlot;
  fileName: string;
  kind: "video" | "subtitle" | "document";
  mimeType: string;
  /** The route that serves it. Never empty: every slot below is one this build can serve. */
  url: string;
};

/** Where a render task's artifacts are read from and, with `?file=`, streamed. */
export function videoRenderArtifactsRoute(taskId: string) {
  return `/api/videos/renders/${encodeURIComponent(taskId)}`;
}

/** The address of one sidecar of one render task. */
export function videoRenderSidecarUrl(taskId: string, fileName: string) {
  return `${videoRenderArtifactsRoute(taskId)}?file=${encodeURIComponent(fileName)}`;
}

/**
 * The write entry of this capability, and the only one: CI-P1-03's registry serves the `video_render`
 * tool at this path.
 *
 * The path is spelled here instead of being imported from `video-render-tool.ts` because that module
 * *executes* the render task, and the task reaches the database (`db/repository` → `db/client` →
 * `node:fs`). A client component that imported the tool name from it would pull `node:fs` into the
 * browser bundle and break every route of the dev server - this module is Node-free on purpose (rule 3
 * above), so a screen can name the entry without reaching the server layer.
 *
 * The pair therefore has two spellings of one fact, and a second spelling must not drift: the renders
 * route test asserts this path is exactly the registry's own tool name.
 */
export const videoRenderToolPath = "/api/tools/video_render";

function extensionOf(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot).toLowerCase() : "";
}

/**
 * True when `name` is a *file name* a render package can produce: a base name with no separators, no
 * traversal, no control character or quote, and one of `renderArtifactExtensions`.
 *
 * The check is deliberately the whole rule a serving route applies, so a name that answers `true` here
 * is exactly a name the route will agree to serve. Excluding quotes and control characters is also what
 * makes it safe to put the name into a `Content-Disposition` header verbatim.
 */
export function isRenderArtifactFileName(name: string) {
  if (!name || name !== name.trim()) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  // Control characters and quotes are refused because a file name must survive being echoed into a header.
  if (/[\u0000-\u001f\u007f"]/.test(name)) return false;
  return renderArtifactExtensions.includes(extensionOf(name));
}

/** The content type of a render artifact, by its extension. */
export function renderArtifactContentType(fileName: string) {
  const extension = extensionOf(fileName);
  return (
    VIDEO_CONTENT_TYPES[extension] ?? renderSidecarContentTypes[extension] ?? "application/octet-stream"
  );
}

/**
 * The stage each product is logged under, by the renderer that writes it (`video-renderer.ts`).
 *
 * `materials` is deliberately absent: the material is not a product of the package, so a file name
 * smuggled into that stage can never become an artifact of the task.
 */
const slotByStage: Record<string, VideoRenderArtifactSlot> = {
  video: "video",
  subtitles: "subtitles",
  package: "metadata",
};

/** The file names a render task wrote, one per slot, or `null` where the log records none. */
export type VideoRenderArtifactFiles = {
  video: string | null;
  subtitles: string | null;
  metadata: string | null;
};

/**
 * The files a render task wrote, read out of its own log.
 *
 * A task that never ran (or that failed at its first stage) answers `null` per slot rather than an empty
 * string, because "wrote no subtitle track" and "wrote a file named nothing" are different facts. The
 * first name a stage logs wins: a re-logged stage does not silently replace the product the task
 * already reported.
 */
export function videoRenderArtifactFiles(logs: readonly TaskLogEntry[]): VideoRenderArtifactFiles {
  const files: VideoRenderArtifactFiles = { video: null, subtitles: null, metadata: null };
  for (const entry of logs) {
    const slot = slotByStage[entry.stage];
    if (!slot || files[slot]) continue;
    const fileName = entry.data?.fileName;
    if (typeof fileName !== "string" || !isRenderArtifactFileName(fileName)) continue;
    files[slot] = fileName;
  }
  return files;
}

/**
 * Whether the log says frames were encoded. `null` when the log says nothing at all.
 *
 * The installed renderer reports `encoded: false` on its deliverable line, so this answers `false` for
 * every package this build can produce - and `null`, never `false`, for a task whose log is silent.
 */
export function videoRenderEncoded(logs: readonly TaskLogEntry[]): boolean | null {
  for (const entry of logs) {
    const encoded = entry.data?.encoded;
    if (typeof encoded === "boolean") return encoded;
  }
  return null;
}

/**
 * The artifacts of one render task, in the order a package writes them (deliverable, subtitles,
 * metadata). A slot the task did not write is absent from the list rather than present and empty.
 */
export function videoRenderArtifacts(
  taskId: string,
  logs: readonly TaskLogEntry[],
): VideoRenderArtifact[] {
  const files = videoRenderArtifactFiles(logs);
  const artifacts: VideoRenderArtifact[] = [];
  if (files.video) {
    artifacts.push({
      slot: "video",
      fileName: files.video,
      kind: "video",
      mimeType: renderArtifactContentType(files.video),
      // The deliverable is an ordinary stored video, so it keeps the library's own address.
      url: videoUrl(files.video),
    });
  }
  if (files.subtitles) {
    artifacts.push({
      slot: "subtitles",
      fileName: files.subtitles,
      kind: "subtitle",
      mimeType: renderArtifactContentType(files.subtitles),
      url: videoRenderSidecarUrl(taskId, files.subtitles),
    });
  }
  if (files.metadata) {
    artifacts.push({
      slot: "metadata",
      fileName: files.metadata,
      kind: "document",
      mimeType: renderArtifactContentType(files.metadata),
      url: videoRenderSidecarUrl(taskId, files.metadata),
    });
  }
  return artifacts;
}

/** One template as a screen reads it: the identity a caller pins, and what the build will accept. */
export type VideoRenderTemplateSummary = {
  id: string;
  version: number;
  description: string;
  /** The material names the template's own schema declares, in schema order. */
  materials: string[];
  /** The parameter names the template's own schema declares, in schema order. */
  params: string[];
};

/** The declared keys of a Zod object schema, or `[]` for a schema that declares no shape. */
function declaredKeys(schema: unknown): string[] {
  const shape = (schema as { shape?: unknown } | null)?.shape;
  if (!shape || typeof shape !== "object") return [];
  return Object.keys(shape as Record<string, unknown>);
}

/**
 * The render templates this build implements, as a screen reads them.
 *
 * It is a *summary of the registry*, computed here so a screen never carries a second copy of a template
 * id or of its parameter names: adding a template to `videoTemplates` is what makes it appear. The
 * schemas are introspected for the keys they declare, not for their rules - a screen needs to know which
 * fields exist, and the Zod schemas stay the only place that decides what a value may be.
 */
export function videoRenderTemplateCatalog(): VideoRenderTemplateSummary[] {
  return videoTemplates.map((template) => ({
    id: template.id,
    version: template.version,
    description: template.description,
    materials: declaredKeys(template.materialsSchema),
    params: declaredKeys(template.paramsSchema),
  }));
}
