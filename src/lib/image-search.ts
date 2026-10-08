/**
 * Keyless online image search backed by Bing Images.
 *
 * The public image APIs that are usually recommended for this job
 * (Openverse, Wikimedia Commons, Pexels, Unsplash) are unreachable from
 * mainland China, which is the primary target for this app. Bing Images is
 * reachable and exposes the result set as `m="{...}"` JSON blobs on its
 * `images/async` endpoint, which is what we parse here.
 */

export type OnlineImage = {
  /** Stable identifier for React keys. */
  id: string;
  /** Original, full-size image URL — this is what gets inserted. */
  url: string;
  /** Smaller Bing-hosted preview used in the results grid. */
  thumbUrl: string;
  /** Human readable description / alt text. */
  title: string;
  /** Page the image was discovered on. */
  sourceUrl: string;
};

export const ONLINE_IMAGE_LIMIT = 24;

const BING_IMAGES_ENDPOINT = "https://www.bing.com/images/async";
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type BingImageMeta = {
  murl?: string;
  turl?: string;
  t?: string;
  purl?: string;
  mid?: string;
};

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Decoded last so `&amp;quot;` is not turned into a quote.
    .replace(/&amp;/g, "&");
}

/**
 * Extracts image results from Bing's image-search markup. Kept pure and
 * exported so it can be unit tested without touching the network.
 */
export function parseBingImageHtml(html: string, limit: number = ONLINE_IMAGE_LIMIT): OnlineImage[] {
  const images: OnlineImage[] = [];
  const seen = new Set<string>();
  const pattern = /class="iusc"[^>]*?\sm="([^"]+)"/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null && images.length < limit) {
    let meta: BingImageMeta;
    try {
      meta = JSON.parse(decodeHtmlEntities(match[1])) as BingImageMeta;
    } catch {
      continue;
    }
    const url = meta.murl?.trim();
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    images.push({
      id: meta.mid?.trim() || url,
      url,
      thumbUrl: meta.turl?.trim() || url,
      title: meta.t?.trim() || "",
      sourceUrl: meta.purl?.trim() || "",
    });
  }

  return images;
}

/** Searches Bing Images and returns normalised results. */
export async function searchOnlineImages(
  query: string,
  limit: number = ONLINE_IMAGE_LIMIT,
): Promise<OnlineImage[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const count = Math.min(Math.max(limit, 8), 48);
  const url = `${BING_IMAGES_ENDPOINT}?q=${encodeURIComponent(trimmed)}&first=0&count=${count}&adlt=off&mmasync=1`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": DESKTOP_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Image search failed with status ${response.status}`);
  }

  return parseBingImageHtml(await response.text(), count);
}
