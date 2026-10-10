import type { PublishSiteResult } from "./publish";

/**
 * One publish batch's verdict (E2E-FIX-01, F2-1 plan A).
 *
 * `POST /api/publish` keeps answering HTTP 200 for a batch that actually ran: the only callers in
 * this repository - `posts-composer.tsx` and `videos-composer.tsx` - decide success from the
 * response *body* (`api-client.ts:38`), not from the status code, so moving the verdict into the
 * status code would only add a way to break them. The verdict therefore belongs in the body, next
 * to the per-account `results` those callers already read.
 *
 * This module is shared by the client and the route, so it must stay pure: the only import allowed
 * here is a *type* import of `./publish`. `tsc` cannot catch a value import of `@/lib/publish`,
 * playwright or the database in this position (it would only break in the browser bundle), which is
 * why `docs/e2e-fix-01-implementation-card.md` §1.1 states the constraint explicitly.
 */
export type PublishRunOutcome = "succeeded" | "partial" | "failed";

export type PublishRunSummary = {
  /** Accounts the caller named. Equal to `results.length` by construction (duplicate ids included). */
  requested: number;
  published: number;
  drafted: number;
  loginRequired: number;
  unsupported: number;
  /** Accounts the batch refused on business grounds, plus any the router threw on (see `unexpected`). */
  failed: number;
  /** Subset of `failed` the router itself threw on (5b of the card); always `<= failed`. */
  unexpected: number;
  /**
   * Counting guard: accounts whose `status` was not one of the five known values. Always 0 while
   * `PublishAccountStatus` is closed, but it keeps `requested` equal to the sum of the buckets even
   * if the union ever grows - an account can never be dropped or counted twice.
   */
  other: number;
  /** Accounts the platform really received something for: `published + drafted`. */
  delivered: number;
  /** `succeeded` = every account delivered, `failed` = none did, otherwise `partial`. */
  outcome: PublishRunOutcome;
};

/**
 * Counts a batch's results.
 *
 * Every account is placed in exactly one bucket by a single `switch`, so the invariants callers and
 * tests rely on hold by construction rather than by luck:
 *
 * - `published + drafted + loginRequired + unsupported + failed + other === requested`
 * - `delivered === published + drafted`
 * - `succeeded <=> requested > 0 && delivered === requested`, `failed <=> delivered === 0`
 *
 * `drafted` counts as delivered on purpose: a platform draft means the platform holds the author's
 * work, and calling that "not delivered" would hide the only copy that exists (plan A chose not to
 * guess at platform semantics - see invariant I5 of the card).
 */
export function summarizePublishResults(results: PublishSiteResult[]): PublishRunSummary {
  let published = 0;
  let drafted = 0;
  let loginRequired = 0;
  let unsupported = 0;
  let failed = 0;
  let unexpected = 0;
  let other = 0;

  for (const result of results) {
    switch (result.status) {
      case "published":
        published += 1;
        break;
      case "drafted":
        drafted += 1;
        break;
      case "login_required":
        loginRequired += 1;
        break;
      case "unsupported":
        unsupported += 1;
        break;
      case "failed":
        failed += 1;
        if (result.errorKind === "unexpected") unexpected += 1;
        break;
      default:
        other += 1;
        break;
    }
  }

  const requested = results.length;
  const delivered = published + drafted;
  const outcome: PublishRunOutcome =
    requested === 0 || delivered === 0
      ? "failed"
      : delivered === requested
        ? "succeeded"
        : "partial";

  return {
    requested,
    published,
    drafted,
    loginRequired,
    unsupported,
    failed,
    unexpected,
    other,
    delivered,
    outcome,
  };
}
