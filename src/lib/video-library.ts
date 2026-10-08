/**
 * Helpers for videos stored in the app data directory.
 *
 * Kept free of Node imports so both server routes and client components can use
 * it (the composer needs the accept list and the size cap).
 */

/** Extensions the video library is willing to store and serve. */
export const VIDEO_FILE_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v"] as const;

const videoExtensionSet = new Set<string>(VIDEO_FILE_EXTENSIONS);

/** Content types used when streaming a stored video back to the browser. */
export const VIDEO_CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

/** Largest video the upload endpoint accepts (5 GB). */
export const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;

/** Lower-cased extension (including the dot) of a file name, or "". */
export function videoFileExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** True when `name` carries a supported video extension. */
export function isVideoFileName(name: string) {
  return videoExtensionSet.has(videoFileExtension(name));
}

/** MIME type for a stored video, defaulting to a generic binary stream. */
export function videoContentType(fileName: string) {
  return VIDEO_CONTENT_TYPES[videoFileExtension(fileName)] ?? "application/octet-stream";
}

/** URL used to stream a stored video back to the browser. */
export function videoUrl(fileName: string) {
  return `/api/videos?file=${encodeURIComponent(fileName)}`;
}

/** A video already uploaded into the local library. */
export type StoredVideo = {
  fileName: string;
  url: string;
  size: number;
  createdAt: number;
};

/** Longest title we forward to a platform (longer titles get truncated there). */
export const VIDEO_TITLE_MAX_LENGTH = 60;

/** Longest description we forward to a platform. */
export const VIDEO_DESCRIPTION_MAX_LENGTH = 2000;

/** Human readable byte size, e.g. "12.4 MB". */
export function formatVideoSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** Video stored on a content item's metadata, used when republishing it. */
export function videoPathFromMetadata(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.videoPath;
  return typeof value === "string" ? value.trim() : "";
}
