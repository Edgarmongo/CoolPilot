import type { BrowserContext, Page } from "playwright-core";

// Frame captures are downscaled to this size. Keep it equal to the browser
// viewport (see DEFAULT_VIEWPORT in ./browser) so there is no rescale: a size
// mismatch blurs the JPEG and makes it shimmer/flicker while scrolling.
export const PREVIEW_SIZE = { width: 1280, height: 900 };
export const DEFAULT_SITE_URL = "https://www.threads.net/";
const BLANK_URL_PREFIXES = ["about:blank", "chrome://newtab", "chrome://", "devtools://"];

export type PreviewStatus = "starting" | "ready" | "error" | "closed";

export type StartBrowserPreviewOptions = {
  bringToFront?: boolean;
  headless?: boolean;
};

/**
 * How the platform page answered one piece of the draft (C2-1a of
 * `docs/assisted-publishing-engine.md`).
 *
 * `filled` is the page taking what it was handed; `empty` is the page being on screen with no field
 * that could take it. Those two are the states the assisted flow used to call the same thing:
 * `runConfiguredCreatePost` returned `drafted: true` for any run that did not throw, so "the editor
 * is open" and "the draft is filled" reached the author, the agent and the verify as one answer.
 *
 * `not_offered` is the third state because "the page did not take the title" and "there was no title
 * to give" are different claims about the author's draft, and only one of them is bad news: a
 * text-only post has no video to upload, and reporting its `media` as `empty` would blame the
 * platform for a field nobody offered it.
 */
export type DraftFieldOutcome = "filled" | "empty" | "not_offered";

/** The three pieces the prefill can hand over, each with what the page did with it (C2-1a). */
export type PublishDraftEvidence = {
  title: DraftFieldOutcome;
  text: DraftFieldOutcome;
  media: DraftFieldOutcome;
};

/** The evidence of a run that had nothing to hand over at all. */
export const NO_DRAFT_HANDED_OVER: PublishDraftEvidence = {
  title: "not_offered",
  text: "not_offered",
  media: "not_offered",
};

/** The pieces of a draft, in the order the prefill hands them over. */
export const DRAFT_FIELD_ORDER = ["title", "text", "media"] as const;

/**
 * Whether the platform page holds a draft of this content (C2-1a).
 *
 * Two ways to be true, and the second is what makes this a function rather than `some(filled)`: the
 * page took something, or there was nothing to hand over in the first place. A run that offered
 * content and had all of it refused is `false`, and that case is exactly what the smoke measured -
 * the prefill walked through 小红书's creator home, matched no field, and the panel still said
 * 待编辑发布, so the author was told to finish a page holding nothing.
 */
export function draftPrepared(evidence: PublishDraftEvidence) {
  const outcomes = DRAFT_FIELD_ORDER.map((field) => evidence[field]);
  return outcomes.includes("filled") || outcomes.every((outcome) => outcome === "not_offered");
}

/**
 * The pieces that were actually offered, with what the page did with each - what a panel can show
 * its work with. `not_offered` pieces are left out rather than reported as a failure.
 */
export function offeredDraftFields(
  evidence: PublishDraftEvidence,
): { field: (typeof DRAFT_FIELD_ORDER)[number]; outcome: DraftFieldOutcome }[] {
  return DRAFT_FIELD_ORDER.filter((field) => evidence[field] !== "not_offered").map((field) => ({
    field,
    outcome: evidence[field],
  }));
}

/**
 * What `/api/publish/draft` handed to the platform, remembered on the session that performed
 * the draft (C2 of `docs/creator-workflow-audit.md`). The verify step is the only reader, and
 * reading *takes* it - so one draft can authorize at most one publish fact.
 */
export type PublishDraftReceipt = {
  contentItemId: string;
  title: string;
  contentType: string;
  method: string;
  terminal: string;
  /**
   * The page the draft was created on - what the platform editor was showing when the prefill
   * finished. The verify's URL branch compares the live page against this instead of asking whether
   * the URL *looks like* an editor (C2 fix A): 小红书 drafts at
   * `.../publish/publish?from=menu&target=video`, which no editor pattern matches, so the pattern
   * alone read the draft's own page as "left the editor" and wrote a publish fact for a post nobody
   * had sent.
   *
   * An empty string is a receipt with no page to compare against - the C2 smoke's baseline row,
   * whose recorded URL *is* the editor. The verify then claims nothing, which is the honest reading
   * of a draft that finished before the editor had an address (see `leftDraftPage`).
   */
  editorUrl: string;
  /**
   * Whether the platform page took anything at all (C2-1a) - `draftPrepared`'s answer, carried on the
   * receipt so the record of what was prepared does not depend on the panel having read the response.
   */
  drafted: boolean;
  /** What the page did with the title, the text and the media it was offered (C2-1a). */
  evidence: PublishDraftEvidence;
  draftedAt: number;
};

/**
 * Who moved the session's page (C2-1c of `docs/assisted-publishing-engine.md`).
 *
 * `platform` is the default and it is where the interesting case lives: a navigation no code asked
 * for. The C2 smoke's second false row was written for a page the app never navigated away from
 * (小红书 handed the session back to `/new/home`), and no artifact said who did it - the session was
 * gone before anyone could ask. Recording the cause at the moment of the navigation is what makes
 * that question answerable, and it is evidence the publish record can carry.
 */
export type NavigationCause = "boot" | "activate" | "draft" | "tool" | "user" | "platform";

/** One navigation of a session page, with what caused it and what the page looked like after. */
export type NavigationEntry = {
  at: number;
  url: string;
  cause: NavigationCause;
  /** The tool call or input the cause belongs to (`tool` + `collect_metrics`, `user` + `key`). */
  detail?: string;
  /**
   * What the page showed a moment after it settled, truncated. Filled in asynchronously, so it is
   * absent on the entry the navigation itself records.
   */
  bodyExcerpt?: string;
};

/** A navigation that has been asked for but has not happened yet. Consumed by the next one. */
export type PendingNavigation = { cause: NavigationCause; detail?: string };

/** The platform's own statement that something happened, as the page witnessed it. */
export type PlatformSignal = { at: number; url: string; text: string };

/** How many navigations a session remembers; the oldest are dropped. */
export const NAVIGATION_JOURNAL_LIMIT = 20;

export type BrowserPreviewSession = {
  accountId: string;
  accountName: string;
  profilePath: string;
  status: PreviewStatus;
  error?: string;
  pageUrl?: string;
  /** The draft this session is holding, until a verify consumes it. */
  publishDraft?: PublishDraftReceipt;
  /** Every navigation this session's pages made, oldest first (C2-1c). */
  journal: NavigationEntry[];
  /** The cause the next navigation should be attributed to, set by whoever is about to navigate. */
  pendingCause?: PendingNavigation;
  startedAt: number;
  updatedAt: number;
  lastFrameAt?: number;
  frame?: Buffer;
  context?: BrowserContext;
  page?: Page;
  streamingPage?: Page;
  contextBound: boolean;
  boundPages: WeakSet<Page>;
};

export type BrowserPreviewSnapshot = {
  accountId: string;
  accountName: string;
  profilePath: string;
  status: PreviewStatus | "idle";
  error?: string;
  pageUrl?: string;
  /** The navigation trace behind `pageUrl` - why a page change is attributed to whom (C2-1c). */
  journal: NavigationEntry[];
  startedAt?: number;
  updatedAt?: number;
  lastFrameAt?: number;
  hasFrame: boolean;
};

/**
 * Says who is about to move the page. The next navigation consumes it, so a cause written and then
 * not used must be cleared (see `activatePage`, which only navigates blank pages).
 */
export function noteNavigationCause(session: BrowserPreviewSession, cause: NavigationCause, detail?: string) {
  session.pendingCause = { cause, detail };
}

/**
 * Takes - and thereby consumes - the pending cause. A navigation nobody announced reads as
 * `platform`: the page moved on its own, which is exactly what an SPA redirect or a platform-side
 * hand-off to another page looks like from here, and the two are indistinguishable by design.
 */
export function takeNavigationCause(session: BrowserPreviewSession): PendingNavigation {
  const pending = session.pendingCause;
  session.pendingCause = undefined;
  return pending ?? { cause: "platform" };
}

/** Appends one navigation, keeping the journal bounded. */
export function recordNavigation(session: BrowserPreviewSession, entry: NavigationEntry) {
  session.journal.push(entry);
  const overflow = session.journal.length - NAVIGATION_JOURNAL_LIMIT;
  if (overflow > 0) {
    session.journal.splice(0, overflow);
  }
}

export type BrowserPreviewStore = {
  sessions: Map<string, BrowserPreviewSession>;
  starting: Map<string, Promise<BrowserPreviewSnapshot>>;
  cleanupRegistered: boolean;
  cleanupPromise?: Promise<void>;
};

export function now() {
  return Date.now();
}

export function touch(session: BrowserPreviewSession) {
  session.updatedAt = now();
}

export function isBlankBrowserUrl(url: string) {
  return !url || BLANK_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

export function getOpenPages(context: BrowserContext) {
  return context.pages().filter((page) => !page.isClosed());
}

export function latestNonBlankPage(pages: Page[]) {
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index];
    if (!isBlankBrowserUrl(page.url())) {
      return page;
    }
  }
  return undefined;
}

export function normalizePreviewError(error: unknown) {
  const message = error instanceof Error ? error.message : "Failed to start browser preview";

  if (
    /existing browser session/i.test(message)
    || /profile.*in use/i.test(message)
    || message.includes("Target page, context or browser has been closed")
  ) {
    return "Browser profile is already in use or the browser was closed. Close the existing Chrome window and try again.";
  }

  return message;
}

export function applySessionError(session: BrowserPreviewSession, error: unknown) {
  session.status = "error";
  session.error = normalizePreviewError(error);
  touch(session);
}

export function toSnapshot(session?: BrowserPreviewSession): BrowserPreviewSnapshot {
  if (!session) {
    return {
      accountId: "",
      accountName: "",
      profilePath: "",
      status: "idle",
      journal: [],
      hasFrame: false,
    };
  }

  return {
    accountId: session.accountId,
    accountName: session.accountName,
    profilePath: session.profilePath,
    status: session.status,
    error: session.error,
    pageUrl: session.pageUrl,
    // Copied so a reader cannot mutate the session's own trace, and so the JSON response is a
    // snapshot rather than a live view.
    journal: session.journal.map((entry) => ({ ...entry })),
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    lastFrameAt: session.lastFrameAt,
    hasFrame: Boolean(session.frame),
  };
}

export function markClosed(session: BrowserPreviewSession) {
  session.status = "closed";
  session.context = undefined;
  session.page = undefined;
  session.streamingPage = undefined;
  touch(session);
}
