import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { artifactsRoot } from "@/lib/paths";

/**
 * Downloads remote images into the artifacts directory.
 *
 * The public image APIs that are usually recommended for this job (Openverse,
 * Wikimedia Commons, Pexels, Unsplash) are unreachable from mainland China,
 * which is the primary target for this app, and search results often point at
 * hosts that are slow or blocked (Google's CDN, ad-heavy blogs). Because of
 * that the downloader is deliberately short-tempered and always falls back to
 * the Bing-hosted preview when the original host stalls.
 */

export const MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024;
export const REMOTE_IMAGE_ORIGINAL_TIMEOUT_MS = 3500;
export const REMOTE_IMAGE_FALLBACK_TIMEOUT_MS = 8000;

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const extensionByContentType: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const extensionByPath: Record<string, string> = {
  ".png": ".png",
  ".jpg": ".jpg",
  ".jpeg": ".jpg",
  ".webp": ".webp",
  ".gif": ".gif",
};

const GENERIC_CONTENT_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/download",
]);

/** Trusts the content type, falling back to a recognisable path extension. */
function resolveExtension(contentType: string, source: string): string | null {
  const direct = extensionByContentType[contentType];
  if (direct) return direct;
  if (GENERIC_CONTENT_TYPES.has(contentType)) {
    return extensionByPath[path.extname(new URL(source).pathname).toLowerCase()] ?? null;
  }
  return null;
}

async function downloadImage(source: string, timeoutMs: number) {
  const response = await fetch(source, {
    headers: { "User-Agent": DESKTOP_USER_AGENT, Accept: "image/*,*/*;q=0.8" },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Image download failed with status ${response.status}`);

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const extension = resolveExtension(contentType, source);
  if (!extension) throw new Error("The link does not point to a supported image");

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error("The downloaded image is empty");
  if (buffer.length > MAX_REMOTE_IMAGE_BYTES) throw new Error("The image is larger than 10MB");
  return { buffer, extension };
}

/** Keeps the downloader from being pointed at loopback/private hosts (SSRF). */
export function isFetchableImageUrl(value: string | undefined): value is string {
  if (!value) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1") return false;
  if (/^(127|10|169\.254)\./.test(host) || /^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}

/**
 * Downloads a remote image into the artifacts directory and returns the new
 * file name. The preview URL is tried as a second attempt so a dead original
 * host cannot stall the caller.
 */
export async function fetchRemoteImageToArtifacts(input: { url: string; fallbackUrl?: string }) {
  const candidates: Array<{ url: string; timeoutMs: number }> = [];
  const push = (value: string | undefined, timeoutMs: number) => {
    if (isFetchableImageUrl(value) && !candidates.some((entry) => entry.url === value)) {
      candidates.push({ url: value, timeoutMs });
    }
  };
  push(input.url, REMOTE_IMAGE_ORIGINAL_TIMEOUT_MS);
  push(input.fallbackUrl, REMOTE_IMAGE_FALLBACK_TIMEOUT_MS);
  if (candidates.length === 0) throw new Error("The link does not point to a supported image");

  let lastError = "Image download failed";
  for (const candidate of candidates) {
    try {
      const { buffer, extension } = await downloadImage(candidate.url, candidate.timeoutMs);
      const fileName = `online-${Date.now()}-${nanoid(8)}${extension}`;
      await fs.writeFile(path.join(artifactsRoot(), fileName), buffer);
      return fileName;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError);
}
