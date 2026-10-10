import { describe, expect, it } from "vitest";
import { summarizePublishResults } from "./publish-results";
import type { PublishAccountStatus, PublishSiteResult } from "./publish";

/**
 * The counting behind 全部成功 / 部分成功 / 全部失败 (E2E-FIX-01 §4.1).
 *
 * Until this card, both composers treated "the request came back" as "the publish worked", so a
 * batch where every account failed still announced 已提交. The fix is a verdict computed from the
 * same `results` array the callers already render; these cases pin that verdict, and - just as
 * importantly - pin that the buckets cannot disagree with each other, because a summary that
 * contradicts itself would be a worse lie than the one being fixed.
 */

let sequence = 0;

/** An account result, so a case reads like a batch instead of like a hand-built object. */
function site(status: PublishAccountStatus, extra: Partial<PublishSiteResult> = {}): PublishSiteResult {
  sequence += 1;
  return {
    accountId: `acct-${sequence}`,
    accountName: `Account ${sequence}`,
    platform: "weibo",
    status,
    ...extra,
  };
}

describe("publish batch summary", () => {
  it("treats an empty batch as failed rather than successful (P1)", () => {
    // The route's `min(1)` on `accountIds` makes this unreachable through HTTP, but the helper has
    // to be a total function: the tempting `delivered === requested` alone would call `[]` a success.
    expect(summarizePublishResults([])).toMatchObject({
      requested: 0,
      delivered: 0,
      outcome: "failed",
    });
  });

  it("calls a fully published batch succeeded (P2)", () => {
    const summary = summarizePublishResults([site("published"), site("published")]);

    expect(summary.outcome).toBe("succeeded");
    expect(summary.delivered).toBe(summary.requested);
    expect(summary.published).toBe(2);
    expect(summary.failed).toBe(0);
  });

  it("calls a half-delivered batch partial (P3)", () => {
    const summary = summarizePublishResults([site("published"), site("failed", { error: "Site not found" })]);

    expect(summary.outcome).toBe("partial");
    expect(summary).toMatchObject({ requested: 2, published: 1, failed: 1, delivered: 1 });
  });

  it("calls a fully failed batch failed (P4)", () => {
    const summary = summarizePublishResults([
      site("failed", { error: "Site not found" }),
      site("failed", { error: "Login required" }),
    ]);

    expect(summary.outcome).toBe("failed");
    expect(summary.delivered).toBe(0);
    expect(summary.failed).toBe(2);
  });

  it("counts drafted as delivered, because the platform holds the work (P5)", () => {
    const summary = summarizePublishResults([site("drafted"), site("drafted")]);

    expect(summary.drafted).toBe(2);
    expect(summary.delivered).toBe(summary.requested);
    expect(summary.outcome).toBe("succeeded");
  });

  it("counts login_required and unsupported separately from failed (P6)", () => {
    const summary = summarizePublishResults([
      site("login_required", { error: "Login required" }),
      site("unsupported"),
    ]);

    expect(summary).toMatchObject({ loginRequired: 1, unsupported: 1, failed: 0, delivered: 0 });
    expect(summary.outcome).toBe("failed");
  });

  it("counts only the failures the router itself raised as unexpected (P7)", () => {
    const summary = summarizePublishResults([
      site("failed", { error: "Site not found" }),
      site("failed", { error: "database is locked", errorKind: "unexpected" }),
    ]);

    expect(summary.failed).toBe(2);
    expect(summary.unexpected).toBe(1);
    expect(summary.unexpected).toBeLessThanOrEqual(summary.failed);
  });

  it("never touches the results it was handed (P8)", () => {
    // The route passes the array it is about to serialise, and the composers pass the array they
    // render: in-place counting would show up there as dirty data.
    const results = [site("published"), site("failed", { errorKind: "unexpected" })];
    results.forEach((result) => Object.freeze(result));
    Object.freeze(results);
    const before = JSON.stringify(results);

    summarizePublishResults(results);

    expect(JSON.stringify(results)).toBe(before);
  });

  it("keeps the buckets mutually exclusive and covering every account (P9)", () => {
    const results = [
      site("published"),
      site("published"),
      site("drafted"),
      site("login_required"),
      site("unsupported"),
      site("failed"),
      site("failed", { errorKind: "unexpected" }),
      // A status this build does not know about stands in for a future server: it must be visible
      // in `other` instead of silently vanishing from the counts.
      { ...site("failed"), status: "queued" as PublishAccountStatus },
    ];

    const summary = summarizePublishResults(results);
    const buckets =
      summary.published +
      summary.drafted +
      summary.loginRequired +
      summary.unsupported +
      summary.failed +
      summary.other;

    expect(summary.requested).toBe(results.length);
    expect(buckets).toBe(summary.requested);
    expect(summary.delivered).toBe(summary.published + summary.drafted);
    expect(summary.other).toBe(1);
    // The unknown status is not delivered, so the batch is honestly reported as partial.
    expect(summary.outcome).toBe("partial");
  });
});
