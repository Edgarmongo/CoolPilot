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
