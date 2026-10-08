import type { BrowserPreviewSession } from "@/lib/browser-preview-shared";
import { getBrowserPreviewStore } from "@/lib/browser-preview-store";

/**
 * A browser session the publish routes can be driven against without a browser (C2 of
 * `docs/creator-workflow-audit.md`).
 *
 * The assisted publish contract reads exactly two things off a live session page - the current URL
 * and the body text - and the draft receipt lives on the session object itself. Faking those three
 * is enough to pin "verify writes the fact exactly once" in a unit test, instead of needing
 * Playwright, a real account and a real post. What the fake deliberately does not do is navigate:
 * a case that wants "the author published" asks for a URL the editor pattern does not match, and
 * `show()` is how a case lets a first, failed check turn into a later success.
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

export type FakeSession = {
  session: BrowserPreviewSession;
  /** Moves the fake page, keeping the session - and any draft receipt on it - in place. */
  show: (next: FakePage) => void;
};

/** Opens a session for `accountId` in the store the routes read from. */
export function openFakeSession(accountId: string, page: FakePage, accountName = "CoolPilot"): FakeSession {
  const current: FakePage = { ...page };
  const session = {
    accountId,
    accountName,
    profilePath: `preview/${accountId}`,
    status: "ready",
    pageUrl: current.url,
    startedAt: 0,
    updatedAt: 0,
    contextBound: false,
    boundPages: new WeakSet(),
    page: {
      isClosed: () => current.closed ?? false,
      url: () => current.url,
      locator: () => ({ innerText: async () => current.bodyText ?? "" }),
    },
  } as unknown as BrowserPreviewSession;

  getBrowserPreviewStore().sessions.set(accountId, session);

  return {
    session,
    show(next: FakePage) {
      current.url = next.url;
      current.bodyText = next.bodyText;
      session.pageUrl = next.url;
    },
  };
}

/** Empties the store, so one case cannot inherit the session of another. */
export function closeFakeSessions() {
  getBrowserPreviewStore().sessions.clear();
}
