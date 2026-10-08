import { runSiteBrowserTool } from "@/lib/browser-preview";
import { parseFollowerCount, parseReadings } from "@/lib/metric-parse";
import { getMetricProfile } from "@/lib/metric-profiles";
import type { AccountRecord } from "@/lib/types";

export type CollectedReading = {
  recordId: string;
  title: string;
  matched: boolean;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  favorites?: number;
  completionRate?: number;
};

export type AccountCollectionResult = {
  accountId: string;
  platform: string;
  loginRequired: boolean;
  followers?: number;
  readings: CollectedReading[];
  error?: string;
};

/**
 * Opens the account's creator-centre stats page (reusing the account's signed-in
 * browser profile) and reads the per-content metrics. Local-first: the browser
 * talks directly to the platform, nothing is proxied through a server.
 */
export async function collectAccountMetrics(
  site: AccountRecord,
  records: { id: string; title: string }[],
): Promise<AccountCollectionResult> {
  const profile = getMetricProfile(site.platform);
  try {
    const output = (await runSiteBrowserTool(
      site,
      { name: "collect_metrics", args: { url: profile.statsPageUrl } },
      { headless: true, bringToFront: false },
    )) as { loginRequired?: boolean; bodyText?: string };

    if (output.loginRequired) {
      return { accountId: site.id, platform: site.platform, loginRequired: true, readings: [] };
    }

    const bodyText = output.bodyText ?? "";
    const parsed = parseReadings(bodyText, records.map((record) => record.title), profile);
    const byTitle = new Map(parsed.map((reading) => [reading.title.trim(), reading]));
    const readings: CollectedReading[] = records.map((record) => {
      const reading = byTitle.get(record.title.trim());
      if (!reading) {
        return { recordId: record.id, title: record.title, matched: false };
      }
      return { recordId: record.id, ...reading };
    });

    return {
      accountId: site.id,
      platform: site.platform,
      loginRequired: false,
      followers: parseFollowerCount(bodyText, profile),
      readings,
    };
  } catch (error) {
    return {
      accountId: site.id,
      platform: site.platform,
      loginRequired: false,
      readings: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
