import type { BrowserPreviewSession, NavigationCause, PlatformSignal } from "@/lib/browser-preview-shared";
import { getBrowserPreviewStore } from "@/lib/browser-preview-store";

/**
 * A browser session the publish routes can be driven against without a browser (C2 of
 * `docs/creator-workflow-audit.md`).
 *
 * The assisted publish contract reads exactly three things off a live session page - the current
 * URL, the body text, and (since C2-1c) whatever `evaluate` can answer about what the page said
 * while an earlier poll was not looking - and the draft receipt lives on the session object itself.
 * Faking those is enough to pin "verify writes the fact exactly once" in a unit test, instead of
 * needing Playwright, a real account and a real post. What the fake deliberately does not do is
 * navigate: a case opens the draft on one URL and then uses `show()` to put the session on a URL of
 * another path, which is both how "the author published" is expressed - C2 fix A compares the live
 * page against the page the draft was made on, not against a pattern - and how a first, failed check
 * turns into a later success.
 *
 * Since C2-1b the outcome depends on *how* a move is explained, so `show()` also records the
 * navigation in the session's journal the way the real page lifecycle does, and an optional excerpt
 * stands in for what the page showed at that moment. That is what lets a case say "the confirmation
 * was on screen for two seconds and the poll arrived after it" without a browser.
 *
 * The page is typed by hand rather than by `Page`, so nothing here can start pulling in the real
 * session module.
 */

/** What the fake page is showing. */
export type FakePage = {
  url: string;
  /** What `body.innerText()` answers - the success-phrase branch of the publish check. */
  bodyText?: string;
  closed?: boolean;
};

/** One navigation, as the page lifecycle would have recorded it. */
export type FakeNavigation = {
  /** Defaults to `platform`: a move no code in the test asked for. */
  cause?: NavigationCause;
  detail?: string;
  /** What the page said a moment after it moved - a confirmation the poll itself never saw. */
  excerpt?: string;
};

export type FakeSession = {
  session: BrowserPreviewSession;
  /** Moves the fake page, keeping the session - and any draft receipt on it - in place. */
  show: (next: FakePage, navigation?: FakeNavigation) => void;
};

/** Opens a session for `accountId` in the store the routes read from. */
export function openFakeSession(
  accountId: string,
  page: FakePage,
  accountName = "CoolPilot",
  /** What the platform-signal witness (`window.__coolpilotSignals`) would answer on this page. */
  signals: PlatformSignal[] = [],
): FakeSession {
  const current: FakePage = { ...page };
  const session = {
    accountId,
    accountName,
    profilePath: `preview/${accountId}`,
    status: "ready",
    pageUrl: current.url,
    journal: [],
    startedAt: 0,
    updatedAt: 0,
    contextBound: false,
    boundPages: new WeakSet(),
    page: {
      isClosed: () => current.closed ?? false,
      url: () => current.url,
      locator: () => ({ innerText: async () => current.bodyText ?? "" }),
      evaluate: async () => signals,
    },
  } as unknown as BrowserPreviewSession;

  getBrowserPreviewStore().sessions.set(accountId, session);

  return {
    session,
    show(next: FakePage, navigation?: FakeNavigation) {
      current.url = next.url;
      current.bodyText = next.bodyText;
      session.pageUrl = next.url;
      session.journal.push({
        at: Date.now(),
        url: next.url,
        cause: navigation?.cause ?? "platform",
        detail: navigation?.detail,
        bodyExcerpt: navigation?.excerpt,
      });
    },
  };
}

/** Empties the store, so one case cannot inherit the session of another. */
export function closeFakeSessions() {
  getBrowserPreviewStore().sessions.clear();
}
