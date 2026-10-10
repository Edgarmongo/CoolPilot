export function normalizePostText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * The Threads post budget the publish path already applies (`postNextThreadsContent` calls
 * `truncateThreadsPost` with its default). Exported so the platform-version adapter (CI-P2-05) prices
 * its own limit from the same number instead of repeating it.
 */
export const threadsPostMaxLength = 450;

/** Trailing space `truncateThreadsPost` appends for the composer; the adapter reserves it too. */
export const threadsPostTrailingSpace = " ";

export function truncateThreadsPost(text: string, appendText = "", maxLength = threadsPostMaxLength) {
  const trailingSpace = threadsPostTrailingSpace;
  let body = normalizePostText(text);
  const suffix = appendText.trim() ? `\n\n${appendText.trim()}` : "";
  const effectiveMax = maxLength - trailingSpace.length;

  if (body.length + suffix.length > effectiveMax) {
    const allowed = effectiveMax - suffix.length - 3;
    body = allowed > 0 ? `${body.slice(0, allowed)}...` : `${body.slice(0, effectiveMax - 3)}...`;
  }

  return `${body}${suffix}${trailingSpace}`;
}
