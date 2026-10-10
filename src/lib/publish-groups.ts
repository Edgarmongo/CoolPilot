import type { PublishSiteResult } from "./publish";

/** One `POST /api/publish` request: the accounts that share exactly the same copy. */
export type PublishGroup = { title: string; text: string; accountIds: string[] };

/**
 * Runs one publish request per group, in order, without letting one failing group skip the rest.
 *
 * The video composer fans out over per-account copy overrides, so a single author action becomes
 * several requests. Awaiting them in a bare `for` loop meant the first rejected request threw out of
 * `handlePublish` and the remaining groups were never called at all - the author was told nothing
 * about accounts the platform never even heard of. Here a rejection is turned into evidence instead:
 * the group's accounts are reported as `failed` with `errorKind: "unexpected"` (the router never got
 * to answer for them), and the loop continues.
 *
 * If the rejection carries the server's own `results` (`ApiClientError.details`, `api-client.ts:10`
 * - the shape 5b of the card uses for a half-executed batch), those are used untouched: they are the
 * only account of what the platform actually did, and synthesising over them would lose it.
 *
 * Deliberately pure - no React, no `fetch`, no `node:*` - so the "the other groups still run"
 * promise is testable without a DOM or a server.
 */
export async function publishGroups(
  groups: PublishGroup[],
  publish: (group: PublishGroup) => Promise<PublishSiteResult[]>,
): Promise<PublishSiteResult[]> {
  const results: PublishSiteResult[] = [];

  for (const group of groups) {
    try {
      results.push(...(await publish(group)));
    } catch (error) {
      const reported = reportedPublishResults(error);
      if (reported) {
        results.push(...reported);
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      for (const accountId of group.accountIds) {
        // The account name and platform are unknown on this path on purpose: the request never came
        // back, so claiming to know what the platform said about them would be a guess.
        results.push({
          accountId,
          accountName: "",
          platform: "",
          status: "failed",
          error: message,
          errorKind: "unexpected",
        });
      }
    }
  }

  return results;
}

/**
 * The server's per-account results when a rejection carries them; `null` when it carries none.
 *
 * Exported because the same question is asked in two places: by `publishGroups` above, and by
 * `posts-composer` when a single request comes back as the structured 5b failure. In both cases the
 * server's own account of the run (card §1.3, `details.results`) is the only thing worth believing.
 */
export function reportedPublishResults(error: unknown): PublishSiteResult[] | null {
  if (typeof error !== "object" || error === null) return null;
  const details: unknown = (error as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return null;
  const results = (details as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) return null;
  return results as PublishSiteResult[];
}
