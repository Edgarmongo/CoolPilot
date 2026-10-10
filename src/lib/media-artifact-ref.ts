/**
 * The unified media-artifact reference (CI-P1-01; contract §1 of
 * `docs/coolpilot-integration-contracts.md`).
 *
 * There is no `assets` table and this module deliberately does not add one: `fileName` is already the
 * stable addressing key of every media file the workspace holds, and the roots are fixed by
 * `src/lib/paths.ts`. What the workspace was missing is a single answer to "what is this reference,
 * where does it live and which address serves it?" - five call sites each re-derived part of that, and
 * nothing could express a *remote* reference at all, which is how the publish path came to drop a
 * remote cover silently (`docs/e2e-core-loop-verification.md` §8.1).
 *
 * Three rules this module keeps:
 *
 *  1. **It never invents an address.** The URLs it produces are the serving routes of the workspace:
 *     the two that historical data already stores - `/api/agent/artifacts?file=<basename>` and
 *     `/api/videos?file=<basename>` - plus `/api/media?file=<basename>`, which CI-P3-02 added together
 *     with the `media/` section (a file with no route reports `url: ""` instead of a made-up one).
 *     `resolveArtifactImageSrc()` stays untouched and frozen.
 *  2. **It resolves; it neither initializes nor reads the disk.** No Node imports here, so the same
 *     function serves routes, client components and tasks (same layering as `artifact-image-url.ts`).
 *     Whether a file exists is the serving route's question, and an empty `url` is this module's answer
 *     for "no route can serve this root/extension yet".
 *  3. **An unusable reference is reported as unusable, never silently dropped.** `url === ""` is the
 *     sentinel; nothing here returns `undefined` or throws for bad input.
 */
import { IMAGE_FILE_EXTENSIONS, artifactImageUrl } from "@/lib/artifact-image-url";
import {
  MEDIA_AUDIO_CONTENT_TYPES,
  MEDIA_AUDIO_EXTENSIONS,
  MEDIA_SOURCE_EXTENSIONS,
  mediaFileUrl,
} from "@/lib/media-library";
import { VIDEO_CONTENT_TYPES, VIDEO_FILE_EXTENSIONS, videoUrl } from "@/lib/video-library";

/**
 * The five directories a media file can live in (`src/lib/paths.ts`).
 *
 * `media/` is CI-P3-02's section - the audio and video a user imported as transcription input - and it
 * is listed here because this file is the one place the root vocabulary is written: a reference to a
 * transcription source and a reference to a publishable video are read by the same code.
 */
export const MEDIA_ASSET_ROOTS = ["artifacts", "videos", "media", "product-images", "brand-logos"] as const;

export type MediaAssetRoot = (typeof MEDIA_ASSET_ROOTS)[number];

export type MediaAssetKind = "image" | "video" | "audio" | "subtitle" | "document" | "unknown";

/**
 * Where the file came from. Derived from the file-name prefix the writers already use plus the root,
 * so no migration and no new column is needed:
 * `agent-image-*` generated · `writing-*` copied · `online-*` localized remote · `upload-*` uploaded.
 */
export type MediaAssetSource = "generated" | "uploaded" | "copied" | "remote" | "unknown";

export type MediaAssetRef = {
  /** Base name; the addressing key. Empty for a remote reference (CoolPilot holds no local copy). */
  fileName: string;
  kind: MediaAssetKind;
  mimeType: string;
  /** For a remote reference: the root a local copy would land in (`artifacts/`). */
  root: MediaAssetRoot;
  source: MediaAssetSource;
  /** Address for the browser, or "" when nothing can serve this root/extension yet. */
  url: string;
  /** The original remote address; present only when `external` is true. */
  remoteUrl?: string;
  /** True when the file is not in the workspace and must be localized before it can be published. */
  external: boolean;
};

const videoExtensionSet = new Set<string>(VIDEO_FILE_EXTENSIONS);
// The audio vocabulary belongs to `@/lib/media-library`; a second copy here is a second truth.
const audioExtensionSet = new Set<string>(MEDIA_AUDIO_EXTENSIONS);
// What `media/` holds and serves: its own audio plus the video imported for transcription (which is not
// the publishing library's video).
const mediaSourceExtensionSet = new Set<string>(MEDIA_SOURCE_EXTENSIONS);
const subtitleExtensions = new Set([".srt", ".vtt", ".ass"]);
const documentExtensions = new Set([".txt", ".md", ".pdf"]);

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ...VIDEO_CONTENT_TYPES,
  ...MEDIA_AUDIO_CONTENT_TYPES,
  ".srt": "application/x-subrip",
  ".vtt": "text/vtt",
  ".ass": "text/x-ssa",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
};

const ARTIFACT_ROUTE = "/api/agent/artifacts";
const VIDEO_ROUTE = "/api/videos";
const MEDIA_ROUTE = "/api/media";

export function isMediaAssetRoot(value: string): value is MediaAssetRoot {
  return (MEDIA_ASSET_ROOTS as readonly string[]).includes(value);
}

/** True when the reference can actually be shown or downloaded right now. */
export function isMediaAssetRefUsable(ref: MediaAssetRef) {
  return ref.url !== "";
}

/** Lower-cased extension (with the dot) of a value, ignoring `?query` and `#hash`. */
function extensionOf(value: string) {
  const clean = value.split(/[?#]/)[0] ?? "";
  const dot = clean.lastIndexOf(".");
  const separator = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return dot > separator ? clean.slice(dot).toLowerCase() : "";
}

function baseNameOf(value: string) {
  return value.split(/[\\/]/).pop() ?? "";
}

function kindFor(extension: string): MediaAssetKind {
  if (IMAGE_FILE_EXTENSIONS.has(extension)) return "image";
  if (videoExtensionSet.has(extension)) return "video";
  if (audioExtensionSet.has(extension)) return "audio";
  if (subtitleExtensions.has(extension)) return "subtitle";
  if (documentExtensions.has(extension)) return "document";
  return "unknown";
}

function mimeFor(extension: string) {
  return MIME_TYPES[extension] ?? "application/octet-stream";
}

/** A name a serving route may resolve: no separators, no traversal, not empty. */
function isSafeFileName(name: string) {
  return Boolean(name) && name !== "." && name !== ".." && baseNameOf(name) === name;
}

function sourceFor(fileName: string, root: MediaAssetRoot): MediaAssetSource {
  if (root === "videos" || root === "media" || root === "product-images" || root === "brand-logos") {
    return "uploaded";
  }
  if (fileName.startsWith("agent-image-")) return "generated";
  if (fileName.startsWith("writing-")) return "copied";
  if (fileName.startsWith("online-")) return "remote";
  if (fileName.startsWith("upload-")) return "uploaded";
  return "unknown";
}

function defaultRootFor(extension: string): MediaAssetRoot {
  // An audio file a bare name names is a transcription source, which is the `media/` section's job.
  if (audioExtensionSet.has(extension)) return "media";
  return videoExtensionSet.has(extension) ? "videos" : "artifacts";
}

/**
 * The address for a local file, or "" when no route serves that root/extension today. The `uploads/`
 * sections are only ever read through their own business UI today, and the artifacts route serves
 * images only (`src/app/api/agent/artifacts/route.ts`).
 *
 * `media/` serves its audio and its video alike: a talk imported for transcription is played back from
 * the same route the recognizer reads, and both are what that section holds.
 */
function servingUrl(root: MediaAssetRoot, fileName: string, extension: string) {
  if (!isSafeFileName(fileName)) return "";
  if (root === "artifacts") return IMAGE_FILE_EXTENSIONS.has(extension) ? artifactImageUrl(fileName) : "";
  if (root === "videos") return videoExtensionSet.has(extension) ? videoUrl(fileName) : "";
  if (root === "media") return mediaSourceExtensionSet.has(extension) ? mediaFileUrl(fileName) : "";
  return "";
}

function unusableRef(): MediaAssetRef {
  return {
    fileName: "",
    kind: "unknown",
    mimeType: "application/octet-stream",
    root: "artifacts",
    source: "unknown",
    url: "",
    external: false,
  };
}

/**
 * Recognises the app's own serving URLs, relative or absolute (`http://127.0.0.1:3000/api/videos?file=x`).
 * A remote host that happens to use the same path is not treated as local: only the path decides here,
 * and the callers that care about the host (the publish path) localize through `remote-image.ts`.
 */
function parseAppReference(value: string) {
  if (!/^https?:\/\//i.test(value) && !value.startsWith("/")) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, "http://coolpilot.local");
  } catch {
    return null;
  }
  const route = parsed.pathname.replace(/\/+$/, "");
  if (route !== ARTIFACT_ROUTE && route !== VIDEO_ROUTE && route !== MEDIA_ROUTE) return null;
  const root: MediaAssetRoot =
    route === ARTIFACT_ROUTE ? "artifacts" : route === VIDEO_ROUTE ? "videos" : "media";
  return {
    root,
    fileName: parsed.searchParams.get("file") ?? "",
  };
}

/**
 * Parses any reference the workspace can hold into a unified reference: a bare file name, an absolute
 * or relative local path, the app's own artifacts/videos/media URL (relative or absolute) or a remote
 * `http(s)` URL.
 *
 * The path reduction is deliberately forgiving, exactly like `resolveArtifactImageSrc()`: a reference
 * is reduced to its base name and the result is checked against the serving rules, so a traversal
 * attempt either collapses into a name that cannot leave the root or becomes `url: ""` when an app URL
 * carried a separator inside `file=`.
 *
 * Values are not trimmed, matching the frozen sibling: a padded name stays whatever was stored.
 */
export function toMediaAssetRef(value: string, hint?: { root?: MediaAssetRoot }): MediaAssetRef {
  const raw = typeof value === "string" ? value : "";
  if (!raw) return unusableRef();

  const app = parseAppReference(raw);
  if (app) {
    if (!isSafeFileName(app.fileName)) return unusableRef();
    const extension = extensionOf(app.fileName);
    const url = servingUrl(app.root, app.fileName, extension);
    if (!url) return unusableRef();
    return {
      fileName: app.fileName,
      kind: kindFor(extension),
      mimeType: mimeFor(extension),
      root: app.root,
      source: sourceFor(app.fileName, app.root),
      url,
      external: false,
    };
  }

  if (/^https?:\/\//i.test(raw)) {
    const extension = extensionOf(raw);
    return {
      fileName: "",
      kind: kindFor(extension),
      mimeType: mimeFor(extension),
      root: "artifacts",
      source: "remote",
      url: raw,
      remoteUrl: raw,
      external: true,
    };
  }

  const fileName = baseNameOf(raw);
  if (!isSafeFileName(fileName)) return unusableRef();
  const extension = extensionOf(fileName);
  // A bare name carries no root information, so the caller has to say when it is not an artifact;
  // otherwise a video extension implies `videos/` and everything else `artifacts/`.
  const root = hint?.root ?? defaultRootFor(extension);
  return {
    fileName,
    kind: kindFor(extension),
    mimeType: mimeFor(extension),
    root,
    source: sourceFor(fileName, root),
    url: servingUrl(root, fileName, extension),
    external: false,
  };
}
