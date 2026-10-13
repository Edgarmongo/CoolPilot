import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api-client";
import { localeResources } from "@/lib/locale-resources";
import { locales } from "@/lib/i18n-config";
import type { TranslationKey } from "@/lib/locale-resources";
import type { RunStatus } from "@/lib/types";
import {
  runActionFailureNotice,
  runCancelPath,
  runCancelSuccessNotice,
  runPauseActionsVisible,
  runPauseExplanationKey,
  runResumeFailureNotice,
  runResumePath,
  runResumeSuccessNotice,
  runRowLines,
  submitRunPauseDecision,
  type RunPauseNotice,
  type RunPauseRow,
} from "./run-pause-actions";

/**
 * The Runs console's side of a budget pause (CI-P7-03-F), on its own: no database, no route, no DOM.
 *
 * The two routes are the authority on whether a run may continue; what this file pins is what the
 * console asks them and what it says back. Three things a second implementation of this would get
 * wrong, and which are therefore the cases below:
 *
 *  1. **a refusal is not a success.** `402 AI_BUDGET_EXCEEDED` must not render as "queued again", and
 *     the arithmetic the gate stated has to survive into the notice - the user's next action depends on
 *     it. The `409 not-paused` case is its mirror: the row was stale, not refused.
 *  2. **only a paused run grows a decision.** Every other status keeps the queue's existing rendering.
 *  3. **the localised copy is complete.** Each notice is a `TranslationKey` + values, so the three
 *     locale files have to carry every key these functions can name, and the two keys that take the
 *     server's sentence have to keep its `{message}` placeholder - a translation that dropped it would
 *     silently discard the gate's own arithmetic.
 */

const runId = "run_pause_1";

/** A refusal shaped exactly like the gate's own: `AI_BUDGET_EXCEEDED`/402 with the decision attached. */
function gateRefusal() {
  return new ApiClientError({
    code: "AI_BUDGET_EXCEEDED",
    message:
      "The AI budget refused this call before it was sent (over-limit). Limit 0 CNY for 2026-10, spent 1.25.",
    details: { reasons: ["over-limit"], limit: 0, spentAmount: 1.25, period: { key: "2026-10" } },
  });
}

/** A `409` as both routes' own `fail(...)` builds it: a message, a reason and the status it saw. */
function conflict(reason: string, status: RunStatus) {
  return new ApiClientError({
    code: "UNKNOWN_ERROR",
    message: `Refused with reason ${reason}`,
    details: { resumed: false, reason, status },
  });
}

const row = (status: RunStatus): RunPauseRow => ({
  status,
  resultMessage: "",
  createdAt: 1_700_000_000_000,
});

const formatTime = () => "formatted-time";

describe("the runs console's budget-pause decision", () => {
  it("offers the decision only while the run is standing still on the budget", () => {
    expect(runPauseActionsVisible("paused")).toBe(true);
    // Every other status keeps the queue's existing behaviour - no button is invented for it.
    for (const status of ["queued", "running", "success", "warning", "failed", "cancelled"] as RunStatus[]) {
      expect(runPauseActionsVisible(status)).toBe(false);
    }
  });

  it("adds the localised pause explanation to a paused row, and only to a paused row", () => {
    const paused = runRowLines({ ...row("paused"), resultMessage: "The AI budget refused the next step" }, formatTime);
    expect(paused.pauseKey).toBe("agentBudgetPaused");
    // The engine's own sentence is kept beside it: it is the evidence, not a duplicate of the headline.
    expect(paused.message).toBe("The AI budget refused the next step");

    const queued = runRowLines({ ...row("queued"), resultMessage: "Run queued" }, formatTime);
    expect(queued.pauseKey).toBeNull();
    expect(queued.message).toBe("Run queued");
  });

  it("keeps the queue's own message fallback for a row that carries none", () => {
    expect(runRowLines(row("failed"), formatTime).message).toBe("formatted-time");
  });

  it("reads a resume that was let go as the run going back to the queue", async () => {
    const posted: Array<{ url: string; body: unknown }> = [];
    const notice = await submitRunPauseDecision({
      runId,
      action: "resume",
      post: async (url, body) => {
        posted.push({ url, body });
      },
    });

    expect(posted).toEqual([{ url: `/api/runs/${runId}/resume`, body: {} }]);
    expect(notice).toEqual(runResumeSuccessNotice(runId));
    expect(notice).toMatchObject({ tone: "success", key: "runQueuedNotice", values: { id: runId }, refresh: true });
  });

  it("reads a refused resume as the budget still saying no, with the gate's own arithmetic", async () => {
    const notice = await submitRunPauseDecision({
      runId,
      action: "resume",
      post: async () => {
        throw gateRefusal();
      },
    });

    expect(notice.tone).toBe("error");
    expect(notice.key).toBe("runPauseResumeRefused");
    // Not the success line, and not a console-invented reason: the server's sentence, verbatim.
    expect(notice.key).not.toBe(runResumeSuccessNotice(runId).key);
    expect(String(notice.values?.message)).toContain("over-limit");
    expect(String(notice.values?.message)).toContain("Limit 0 CNY for 2026-10");
    expect(notice.refresh).toBe(true);
  });

  it("reads a resume on a run that is no longer paused as a stale row rather than a refusal", () => {
    const notice = runResumeFailureNotice(conflict("not-paused", "success"));
    expect(notice).toMatchObject({ tone: "warning", key: "runPauseResumeStale", refresh: true });
    // The stale case names no server sentence: there is nothing to act on, only a row to re-read.
    expect(notice.values).toBeUndefined();
  });

  it("keeps the resume route's other refusals on the generic path, with the server's sentence", () => {
    const notice = runResumeFailureNotice(conflict("no-checkpoint", "paused"));
    expect(notice.key).toBe("runPauseActionFailed");
    expect(String(notice.values?.message)).toContain("no-checkpoint");
  });

  it("reads a cancellation that was written as a success that keeps the finished steps", async () => {
    const notice = await submitRunPauseDecision({ runId, action: "cancel", post: async () => undefined });
    expect(notice).toEqual(runCancelSuccessNotice());
    expect(notice).toMatchObject({ tone: "success", key: "runPauseCancelled", refresh: true });
  });

  it("reports a cancellation the server refused instead of claiming it worked", async () => {
    const notice = await submitRunPauseDecision({
      runId,
      action: "cancel",
      post: async () => {
        throw conflict("not-safe-to-stop", "running");
      },
    });
    expect(notice.tone).toBe("error");
    expect(notice.key).toBe("runPauseActionFailed");
    expect(String(notice.values?.message)).toContain("not-safe-to-stop");
  });

  it("answers a request that never reached the server without throwing, so the button can be retried", async () => {
    const notice = await submitRunPauseDecision({
      runId,
      action: "resume",
      post: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    // A transport failure is not a budget refusal: it must not be shown as one.
    expect(notice.key).toBe("runPauseActionFailed");
    expect(String(notice.values?.message)).toBe("Failed to fetch");
    expect(runActionFailureNotice(new Error("boom")).tone).toBe("error");
  });

  it("builds both request paths from the run id", () => {
    expect(runResumePath(runId)).toBe(`/api/runs/${runId}/resume`);
    expect(runCancelPath(runId)).toBe(`/api/runs/${runId}/cancel`);
    // An id is opaque to the console, so it is escaped rather than spliced into the path.
    expect(runCancelPath("a/b c")).toBe("/api/runs/a%2Fb%20c/cancel");
  });

  it("names only keys the three locale files carry, placeholders included", () => {
    // Every notice these functions can produce, so a key no locale carries fails here rather than on a
    // screen that prints the key itself (`t()` falls back to the key when the dictionary has none).
    const notices: RunPauseNotice[] = [
      runResumeSuccessNotice(runId),
      runCancelSuccessNotice(),
      runResumeFailureNotice(gateRefusal()),
      runResumeFailureNotice(conflict("not-paused", "success")),
      runActionFailureNotice(new Error("boom")),
    ];
    const keys = [
      ...new Set<TranslationKey>([
        runPauseExplanationKey,
        "btnContinueRun",
        "btnCancelRun",
        ...notices.map((notice) => notice.key),
      ]),
    ];
    // The keys that carry the server's sentence have to keep the placeholder that puts it there.
    const carried = notices.filter((notice) => notice.values?.message !== undefined).map((notice) => notice.key);

    for (const locale of locales) {
      for (const key of keys) {
        const text = localeResources[locale][key];
        expect(text, `${locale}.${key}`).toBeTruthy();
        expect(text, `${locale}.${key}`).not.toContain("\uFFFD");
      }
      for (const key of carried) {
        expect(localeResources[locale][key], `${locale}.${key}`).toContain("{message}");
      }
    }
  });
});
