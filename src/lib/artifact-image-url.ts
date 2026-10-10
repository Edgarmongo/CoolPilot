/**
 * Helpers for the URLs that point at images stored in the artifacts directory.
 *
 * Kept free of Node imports so both server routes and client components can use
 * it.
 */

/** Extensions the image library is willing to serve. */
export const IMAGE_FILE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

const ARTIFACT_PATH = "/api/agent/artifacts";

/** URL used to stream a stored artifact back to the browser. */
export function artifactImageUrl(fileName: string) {
  return `${ARTIFACT_PATH}?file=${encodeURIComponent(fileName)}`;
}

/**
 * Resolves a stored image reference into the URL a browser should request.
 *
 * A remote `http(s)` URL is already reachable and is returned untouched. Everything else is
 * reduced to its base name and served from the artifacts route, so a bare file name and an
 * absolute local path resolve to the same URL.
 *
 * The base-name rule is deliberately forgiving: this answers "which address should the browser
 * request?", not "is this reference valid, or does the file exist?" - the artifacts route answers
 * the second question with a 404. For the same reason nothing is trimmed or lower-cased and the
 * extension is never inspected.
 *
 * Do not change the URL shape: `article-editor` writes this exact string into `content_items.body`
 * when an image is inserted, so stored articles already carry it.
 */
export function resolveArtifactImageSrc(value?: string) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const fileName = value.split(/[\\/]/).pop() ?? "";
  return fileName ? artifactImageUrl(fileName) : "";
}
