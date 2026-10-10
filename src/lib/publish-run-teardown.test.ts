import { describe, expect, it } from "vitest";
import { liveRuns, runTeardownNeedsConfirm, type RunLifecycleStatus } from "./publish-run-teardown";

/**
 * Closing the assisted-publish UI (C2-1d of `docs/assisted-publishing-engine.md`).
 *
 * Closing the run panel used to stop every session it had opened and delete the platform draft, with
 * no way to say "I am coming back to this". Measured, that costs the author the only copy of their
 * work: the session is the draft, and the published fact - if there is one - is already in the
 * database, so nothing is protected by stopping a run that has not finished. These cases pin the
 * question in front of that teardown: which run states are worth asking about, and which are already
 * over.
 *
 * The guard is a pure predicate in `src/lib/publish-run-teardown.ts` rather than inline in the
 * dialog's JSX precisely so it can be tested here: the project's vitest config runs `environment:
 * "node"` and collects only `src/**\/*.test.ts`, so there is no DOM to render a dialog into.
 */

/** The panel's vocabulary, so a case reads like a panel state instead of a string array. */
const statuses = (...list: RunLifecycleStatus[]): RunLifecycleStatus[] => list;

describe("assisted-publish teardown guard", () => {
  it("asks before closing while a run could still be the author's work in progress", () => {
    // Preparing: the prefill is mid-flight and the session may only just be opening.
    expect(runTeardownNeedsConfirm(statuses("preparing"))).toBe(true);
    // Editing: the page is in front of the author, holding the draft they have been working on.
    expect(runTeardownNeedsConfirm(statuses("editing"))).toBe(true);
    // Unknown: the page moved without a confirmation, and the session is the only place the account
    // of what happened still exists - C2-1c's navigation journal goes when the session does.
    expect(runTeardownNeedsConfirm(statuses("unknown"))).toBe(true);
    // One live run in a multi-platform batch is enough to make the close a decision.
    expect(runTeardownNeedsConfirm(statuses("published", "editing", "queued"))).toBe(true);
  });

  it("closes without a question when every run is already over", () => {
    expect(runTeardownNeedsConfirm(statuses())).toBe(false);
    expect(runTeardownNeedsConfirm(statuses("published", "discarded", "failed"))).toBe(false);
    // A failed prefill is not live either: the session exists, but the run is over - and the receipt
    // still holds what it needs if the author publishes the page by hand.
    expect(runTeardownNeedsConfirm(statuses("failed"))).toBe(false);
    // A queued tab has started nothing, so closing it stops nothing.
    expect(runTeardownNeedsConfirm(statuses("queued"))).toBe(false);
  });

  it("counts the runs a close would walk away from", () => {
    expect(liveRuns(statuses("editing", "preparing", "unknown", "published"))).toBe(3);
    expect(liveRuns(statuses())).toBe(0);
  });
});
