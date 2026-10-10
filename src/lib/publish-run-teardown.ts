/**
 * When closing the assisted-publish UI is allowed to be quiet (C2-1d of
 * `docs/assisted-publishing-engine.md`).
 *
 * Closing the run panel used to stop every session it had opened, unconditionally. Measured, that
 * costs the author work they cannot get back: the session is the draft - title, text, media and the
 * page the platform was left on - and the panel was the only thing that could name it. Closing the
 * dialog after an hour of editing therefore threw the draft away exactly as if the author had asked
 * for it, and the one thing that did not exist was a way to say "I am still working on this".
 *
 * So teardown asks first when a run is *live*: a session is open, the platform page is the author's,
 * and no fact has been written about it yet. A settled run (`published`, `discarded`, `failed`) needs
 * no question - there is nothing to lose, and the publish fact (if any) is already in the database,
 * not in the browser. `queued` needs none either: the tab never started, so no session exists.
 *
 * The predicate is pure on purpose: `vitest.config.ts` runs `environment: "node"` and includes only
 * `src/**\/*.test.ts`, so a guard living inside the panel's JSX could not be pinned at all.
 */
export type RunLifecycleStatus =
  | "queued"
  | "preparing"
  | "editing"
  | "unknown"
  | "published"
  | "discarded"
  | "failed";

/**
 * Statuses that mean a session is open and unfinished: the prefill is still running, or the author's
 * page is on screen (`editing`), or it moved and the platform has not confirmed a post (`unknown`).
 */
const LIVE_RUN_STATUSES: RunLifecycleStatus[] = ["preparing", "editing", "unknown"];

/** How many tabs closing the UI right now would walk away from. */
export function liveRuns(statuses: readonly RunLifecycleStatus[]) {
  return statuses.filter((status) => LIVE_RUN_STATUSES.includes(status)).length;
}

/**
 * Whether closing the panel/dialog has to ask first. `draft_failed` is deliberately *not* live: the
 * session exists but the run is already over, so there is no authored state to protect.
 */
export function runTeardownNeedsConfirm(statuses: readonly RunLifecycleStatus[]) {
  return liveRuns(statuses) > 0;
}
