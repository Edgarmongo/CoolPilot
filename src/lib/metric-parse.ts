import type { MetricLabelSet, PlatformMetricProfile } from "@/lib/metric-profiles";

/**
 * Parses a platform's compact number — "1,234", "1.2万", "3.4k", "2.1M" → integer.
 * Returns `undefined` when the token is not a recognizable number.
 */
export function parseCompactNumber(input: string): number | undefined {
  const cleaned = input.replace(/[,，\s]/g, "").trim().toLowerCase();
  if (!cleaned) return undefined;
  const match = cleaned.match(/^(\d+(?:\.\d+)?)(万|亿|k|m|w|kw)?$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const multiplier = match[2] === "万" || match[2] === "w" || match[2] === "kw"
    ? 10_000
    : match[2] === "亿"
      ? 100_000_000
      : match[2] === "k"
        ? 1_000
        : match[2] === "m"
          ? 1_000_000
          : 1;
  return Math.round(value * multiplier);
}

/** First `label<number>` (or `number<label>`) occurrence for any of the labels. */
export function parseLabeledNumber(text: string, labels: string[]): number | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const after = new RegExp(`${escaped}\\s*[：:]?\\s*([\\d.,，]+\\s*[万亿kKmMwW]{0,2})`);
    const before = new RegExp(`([\\d.,，]+\\s*[万亿kKmMwW]{0,2})\\s*${escaped}`);
    const match = after.exec(text) ?? before.exec(text);
    if (match) {
      const parsed = parseCompactNumber(match[1]);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

export type ParsedReading = {
  title: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  favorites?: number;
  completionRate?: number;
  /** Whether the title was located in the page text at all. */
  matched: boolean;
};

function parseSection(section: string, labels: MetricLabelSet): Omit<ParsedReading, "title" | "matched"> {
  return {
    views: parseLabeledNumber(section, labels.views),
    likes: parseLabeledNumber(section, labels.likes),
    comments: parseLabeledNumber(section, labels.comments),
    shares: parseLabeledNumber(section, labels.shares),
    favorites: parseLabeledNumber(section, labels.favorites),
    completionRate: parseLabeledNumber(section, labels.completion),
  };
}

/**
 * Reads the metrics for each known content title out of the creator-centre page
 * text. Titles that are absent are reported with `matched: false` so the caller
 * can decide whether the content is dead or simply on another page.
 */
export function parseReadings(
  fullText: string,
  titles: string[],
  profile: PlatformMetricProfile,
): ParsedReading[] {
  const normalized = fullText.replace(/\r/g, "");
  const unique = Array.from(new Set(titles.map((title) => title.trim()).filter(Boolean)));
  const located = unique
    .map((title) => ({ title, index: normalized.indexOf(title) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index);

  const readings: ParsedReading[] = [];
  for (const title of unique) {
    const position = located.findIndex((entry) => entry.title === title);
    if (position < 0) {
      readings.push({ title, matched: false });
      continue;
    }
    const start = located[position].index + title.length;
    const end = position + 1 < located.length ? located[position + 1].index : normalized.length;
    const section = normalized.slice(start, end);
    readings.push({
      title,
      matched: true,
      ...parseSection(section, profile.labels),
    });
  }
  return readings;
}

/** Best-effort account follower count from the same page text. */
export function parseFollowerCount(fullText: string, profile: PlatformMetricProfile): number | undefined {
  return parseLabeledNumber(fullText, profile.followerLabels);
}
