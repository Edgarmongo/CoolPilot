import { describe, expect, it, vi } from "vitest";
import { publishGroups, reportedPublishResults, type PublishGroup } from "./publish-groups";
import type { PublishSiteResult } from "./publish";

/**
 * "One failing group must not skip the others" (E2E-FIX-01 §4.3).
 *
 * The video composer publishes once per group of accounts that share the same copy. Before this
 * card the awaiting loop sat inside a single `try`, so a rejection on group 1 meant group 2 was
 * never requested at all - silently, since the error was the only thing the author saw. That
 * behaviour cannot be observed through the component (vitest runs `environment: "node"`), so the
 * loop was extracted into `publish-groups.ts` and these cases drive its promise directly.
 */

function group(accountIds: string[]): PublishGroup {
  return { title: "Title", text: "Text", accountIds };
}

function site(accountId: string, status: PublishSiteResult["status"]): PublishSiteResult {
  return { accountId, accountName: `Account ${accountId}`, platform: "weibo", status };
}

describe("publish group fan-out", () => {
  it("concatenates the groups' results in order (G1)", async () => {
    const publish = vi
      .fn<(group: PublishGroup) => Promise<PublishSiteResult[]>>()
      .mockResolvedValueOnce([site("a1", "published")])
      .mockResolvedValueOnce([site("a2", "drafted")]);

    const results = await publishGroups([group(["a1"]), group(["a2"])], publish);

    expect(publish).toHaveBeenCalledTimes(2);
    expect(results.map((result) => result.accountId)).toEqual(["a1", "a2"]);
  });

  it("still runs the remaining groups after one rejects (G2)", async () => {
    const publish = vi
      .fn<(group: PublishGroup) => Promise<PublishSiteResult[]>>()
      .mockRejectedValueOnce(new Error("Request failed with 500"))
      .mockResolvedValueOnce([site("a2", "published")]);

    const results = await publishGroups([group(["a1", "a3"]), group(["a2"])], publish);

    expect(publish).toHaveBeenCalledTimes(2);
    // The unreachable accounts are reported one for one, so the result panel still covers every
    // account the author selected - and the summary can tell them apart from a business failure.
    expect(results).toHaveLength(3);
    expect(results.filter((result) => result.status === "failed").map((result) => result.accountId)).toEqual([
      "a1",
      "a3",
    ]);
    expect(results[0]).toMatchObject({ status: "failed", errorKind: "unexpected", error: "Request failed with 500" });
    expect(results[2]).toMatchObject({ accountId: "a2", status: "published" });
  });

  it("prefers the server's own results over synthesised ones (G3)", async () => {
    const reported = [site("a1", "published"), site("a2", "failed")];
    const publish = vi
      .fn<(group: PublishGroup) => Promise<PublishSiteResult[]>>()
      .mockRejectedValueOnce(Object.assign(new Error("PUBLISH_RUN_FAILED"), { details: { results: reported } }));

    const results = await publishGroups([group(["a1", "a2"])], publish);

    // What the platform really did outranks what we could guess: nothing is overwritten with a
    // blanket "failed", and the delivered account stays visible.
    expect(results).toEqual(reported);
  });

  it("asks for nothing when there are no groups (G4)", async () => {
    const publish = vi.fn<(group: PublishGroup) => Promise<PublishSiteResult[]>>();

    const results = await publishGroups([], publish);

    expect(results).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("reported publish results", () => {
  it("reads the server's results out of a rejection's details (G5)", () => {
    const reported = [site("a1", "failed")];

    expect(
      reportedPublishResults(Object.assign(new Error("PUBLISH_RUN_FAILED"), { details: { results: reported } })),
    ).toEqual(reported);
  });

  it("answers null for a rejection that carries no results (G6)", () => {
    // Only the structured 5b body carries `details.results`; anything else has to fall through to the
    // caller's own handling rather than quietly looking like a batch that already reported itself.
    expect(reportedPublishResults(new Error("Request failed with 500"))).toBeNull();
    expect(reportedPublishResults(Object.assign(new Error("boom"), { details: { retrySafe: false } }))).toBeNull();
    expect(reportedPublishResults(Object.assign(new Error("boom"), { details: { results: [] } }))).toBeNull();
  });
});
