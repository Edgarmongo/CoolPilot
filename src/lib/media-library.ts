import { VIDEO_CONTENT_TYPES, VIDEO_FILE_EXTENSIONS, isVideoFileName, videoFileExtension } from "@/lib/video-library";

/**
 * The workspace's imported-media section (CI-P3-02 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * A transcription run reads a *file*, not a url, so the audio and video it works on has to live in the
 * workspace the way a published video already does. This module is the vocabulary of that section -
 * `media/` of `src/lib/paths.ts` - and it is deliberately importable from a browser component: the
 * console needs the accepted extensions and the size cap, the routes need the same two facts plus the
 * address shape, and neither should derive them from the other.
 *
 * Three rules it keeps:
 *
 * 1. **One extension list.** `MEDIA_AUDIO_EXTENSIONS` plus the video extensions of
 *    `@/lib/video-library` are exactly what `isTranscriptionSourceName()` accepts, and
 *    `@/lib/media-artifact-ref` imports the same sets - so the section's vocabulary and the media
 *    reference's cannot drift apart.
 * 2. **An address is a route plus a base name.** `mediaFileUrl()` is the only place the media route's
 *    shape is written. It is a storage route of the workspace like `/api/videos`, and it is named in
 *    `docs/coolpilot-integration-contracts.md` §1 next to the other ones.
 * 3. **The cap is stated, not implied.** `MAX_MEDIA_BYTES` is what the upload route refuses before it
 *    writes a byte and what the console shows the user, so the two numbers are one number.
 */

/** Audio containers the transcription pipeline accepts, in the order the console offers them. */
export const MEDIA_AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"] as const;

const audioExtensionSet = new Set<string>(MEDIA_AUDIO_EXTENSIONS);

/** Content types used when streaming an imported audio file back to the browser. */
export const MEDIA_AUDIO_CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
};

/** Every extension an import accepts: the audio containers above plus the video library's own. */
export const MEDIA_SOURCE_EXTENSIONS = [...VIDEO_FILE_EXTENSIONS, ...MEDIA_AUDIO_EXTENSIONS] as const;

/**
 * Largest file a transcription import accepts (512 MB).
 *
 * Deliberately smaller than the 5 GB publishing cap: this file is not merely stored, it is handed to a
 * recognizer (locally: decoded through ffmpeg into 16 kHz mono PCM). 512 MB of compressed audio is
 * already several hours of speech, so the ceiling is a guard rather than a real limit for a talk,
 * an interview or a podcast episode - and a file that exceeds it is refused with a status the caller
 * can read instead of being accepted and failing later.
 */
export const MAX_MEDIA_BYTES = 512 * 1024 * 1024;

/**
 * The prefix every file this section writes carries.
 *
 * It is what `@/lib/media-artifact-ref`'s `sourceFor()` reads to answer `uploaded`, the same way
 * `upload-*` does for artifacts - the naming scheme is the only provenance record the workspace keeps.
 */
export const MEDIA_FILE_PREFIX = "media-";

/** Lower-cased extension (including the dot) of a file name, or "". */
export function mediaFileExtension(name: string) {
  return videoFileExtension(name);
}

/** True when `name` carries a supported audio extension. */
export function isAudioFileName(name: string) {
  return audioExtensionSet.has(mediaFileExtension(name));
}

/** True when `name` is a file a transcription run may read: a supported audio *or* video file. */
export function isTranscriptionSourceName(name: string) {
  return isVideoFileName(name) || isAudioFileName(name);
}

/** `"audio"` / `"video"` for a supported media file, `""` for anything else. */
export function transcriptionSourceKind(name: string): "audio" | "video" | "" {
  if (isAudioFileName(name)) return "audio";
  if (isVideoFileName(name)) return "video";
  return "";
}

/** MIME type for a stored media file, defaulting to a generic binary stream. */
export function mediaContentType(fileName: string) {
  const extension = mediaFileExtension(fileName);
  return (
    MEDIA_AUDIO_CONTENT_TYPES[extension] ??
    VIDEO_CONTENT_TYPES[extension] ??
    "application/octet-stream"
  );
}

/** Address used to stream a stored media file back to the browser (`GET /api/media?file=`). */
export function mediaFileUrl(fileName: string) {
  return `/api/media?file=${encodeURIComponent(fileName)}`;
}

/** Byte formatting is `@/lib/video-library`'s, re-exported so a media surface need not import a video module for a number. */
export { formatVideoSize as formatMediaSize } from "@/lib/video-library";

/** One media file already imported into the local library. */
export type StoredMediaSource = {
  fileName: string;
  url: string;
  size: number;
  createdAt: number;
  /** `"audio"` or `"video"`; never empty, because only supported names are listed. */
  kind: "audio" | "video";
};
