import path from "node:path";
import type { BrowserContext, CDPSession, Locator, Page } from "playwright-core";
import { launchSiteProfileContext } from "./browser";
import {
  applySessionError,
  DEFAULT_SITE_URL,
  draftPrepared,
  getOpenPages,
  isBlankBrowserUrl,
  latestNonBlankPage,
  markClosed,
  noteNavigationCause,
  now,
  PREVIEW_SIZE,
  recordNavigation,
  takeNavigationCause,
  touch,
  toSnapshot,
  type BrowserPreviewSession,
  type DraftFieldOutcome,
  type NavigationEntry,
  type PlatformSignal,
  type PublishDraftEvidence,
  type PublishDraftReceipt,
  type StartBrowserPreviewOptions,
} from "./browser-preview-shared";
import {
  closeBrowserPreviewSessionContext,
  getBrowserPreviewStore,
} from "./browser-preview-store";
import { artifactsRoot } from "./paths";
import type { AccountRecord } from "./types";
import { getMetricProfile } from "./metric-profiles";
import { getPublishProfile, type PlatformPublishProfile } from "./publish-profiles";
import { createPublishLog, isPublishDebugEnabled, type PublishLogger } from "./publish-debug";

/**
 * 知乎 (and many rich editors) run looping CSS animations — shimmer skeletons,
 * "marching-ants" dashed drop zones and pulsing save indicators. A CDP screencast
 * captures every repaint, so those animations surface in the preview as a
 * constant flicker. Freezing animations keeps the mirrored page visually stable
 * without touching layout, content or interaction. Set COOLPILOT_PREVIEW_STABILIZE=0
 * to opt out.
 */
const PREVIEW_STABILIZE_CSS = "*,*::before,*::after{animation:none !important;}";

function previewStabilizeEnabled() {
  return process.env.COOLPILOT_PREVIEW_STABILIZE !== "0";
}

/** Injects the freeze style into an already-loaded page (no reload needed). */
async function applyPreviewStabilizer(page: Page) {
  if (!previewStabilizeEnabled() || page.isClosed()) return;
  await page
    .evaluate((css) => {
      if (!document.documentElement) return;
      if (document.querySelector("style[data-coolpilot-preview-stabilize]")) return;
      const style = document.createElement("style");
      style.setAttribute("data-coolpilot-preview-stabilize", "");
      style.textContent = css;
      (document.head ?? document.documentElement).appendChild(style);
    }, PREVIEW_STABILIZE_CSS)
    .catch(() => undefined);
}

/** Re-applies the freeze style on every navigation and sub-frame of the context. */
async function stabilizePreviewContext(context: BrowserContext) {
  if (!previewStabilizeEnabled()) return;
  await context
    .addInitScript((css) => {
      const apply = () => {
        if (!document.documentElement) return;
        const style = document.createElement("style");
        style.setAttribute("data-coolpilot-preview-stabilize", "");
        style.textContent = css;
        (document.head ?? document.documentElement).appendChild(style);
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", apply, { once: true });
      } else {
        apply();
      }
    }, PREVIEW_STABILIZE_CSS)
    .catch(() => undefined);
}

async function closeSpareBlankPages(context: BrowserContext, activePage: Page) {
  const blankPages = getOpenPages(context).filter(
    (page) => page !== activePage && isBlankBrowserUrl(page.url()),
  );

  await Promise.all(blankPages.map((page) => page.close().catch(() => undefined)));
}

async function startStreaming(session: BrowserPreviewSession, page: Page) {
  await applyPreviewStabilizer(page);

  if (session.streamingPage === page) {
    return;
  }

  const previousPage = session.streamingPage;
  session.streamingPage = page;

  if (previousPage && previousPage !== page && !previousPage.isClosed()) {
    await previousPage.screencast.stop().catch(() => undefined);
  }

  await page.screencast.start({
    size: PREVIEW_SIZE,
    quality: 85,
    onFrame: ({ data }) => {
      if (session.streamingPage !== page) {
        return;
      }

      session.frame = Buffer.from(data);
      session.lastFrameAt = now();
      session.page = page;
      session.pageUrl = page.url();
      touch(session);
    },
  });
}

async function pickSessionPage(session: BrowserPreviewSession) {
  const context = session.context;
  if (!context) {
    throw new Error("Browser preview session is missing context");
  }

  const currentPage = session.page && !session.page.isClosed() ? session.page : undefined;
  const pages = getOpenPages(context);

  return latestNonBlankPage(currentPage ? [currentPage, ...pages.filter((page) => page !== currentPage)] : pages)
    ?? currentPage
    ?? pages[pages.length - 1]
    ?? context.newPage();
}

async function activatePage(
  session: BrowserPreviewSession,
  page: Page,
  options: {
    siteUrl?: string;
    bringToFront?: boolean;
    closeBlankPages?: boolean;
  } = {},
) {
  if (page.isClosed()) {
    return;
  }

  if (options.siteUrl && isBlankBrowserUrl(page.url())) {
    // The only navigation this function performs, announced so the journal can attribute it - unless
    // the caller already announced its own, which is more specific than "activate" (boot).
    if (!session.pendingCause) noteNavigationCause(session, "activate");
    await page.goto(options.siteUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  } else {
    // Nothing is about to move. A cause announced by a caller that then decided not to navigate must
    // not be claimed by somebody else's navigation later, which is how a trace starts lying.
    session.pendingCause = undefined;
  }

  session.page = page;
  session.pageUrl = page.url();
  session.error = undefined;

  if (options.bringToFront !== false) {
    await page.bringToFront().catch(() => undefined);
  }

  await startStreaming(session, page);

  if (options.closeBlankPages !== false && session.context) {
    await closeSpareBlankPages(session.context, page);
  }

  session.status = "ready";
  touch(session);
}

function bindPageLifecycle(session: BrowserPreviewSession, page: Page, site: AccountRecord) {
  if (session.boundPages.has(page)) {
    return;
  }

  session.boundPages.add(page);

  const syncPageUrl = () => {
    if (session.page === page || session.streamingPage === page) {
      session.pageUrl = page.url();
      touch(session);
    }

    if (page !== session.page && !isBlankBrowserUrl(page.url())) {
      void activatePage(session, page, {
        bringToFront: false,
        closeBlankPages: false,
      }).catch((error) => applySessionError(session, error));
    }
  };

  // C2-1c: the navigation itself is recorded first, with the cause whoever asked for it announced -
  // before any other handler reacts to it, so a later failure cannot leave the trace incomplete.
  // A navigation nobody announced reads as `platform`, which is the case the C2 smoke could not
  // answer after the fact: the page moved on its own and the session was gone before anyone asked.
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) {
      return;
    }
    recordNavigation(session, { at: now(), url: page.url(), ...takeNavigationCause(session) });
    captureNavigationExcerpt(session, page);
  });

  page.on("framenavigated", syncPageUrl);
  page.on("load", syncPageUrl);
  page.on("close", () => {
    if (session.page !== page && session.streamingPage !== page) {
      return;
    }

    const context = session.context;
    if (!context) {
      markClosed(session);
      return;
    }

    const remainingPages = getOpenPages(context).filter((candidate) => candidate !== page);
    const nextPage = latestNonBlankPage(remainingPages) ?? remainingPages[remainingPages.length - 1];

    if (!nextPage) {
      markClosed(session);
      return;
    }

    void activatePage(session, nextPage, {
      siteUrl: site.url || DEFAULT_SITE_URL,
      bringToFront: false,
    }).catch((error) => applySessionError(session, error));
  });
}

/**
 * Fills in what the page showed just after the navigation that was just recorded (C2-1c).
 *
 * Asynchronous and best-effort, because the thing it is there for is short-lived: a platform's
 * success confirmation is on screen for a couple of seconds, and the poll that reads the live page
 * (every 2.5 s in the run panel) can easily arrive after it is gone. The excerpt keeps what the page
 * said while it said it, so the verify can read a confirmation the poll itself never saw.
 */
function captureNavigationExcerpt(session: BrowserPreviewSession, page: Page) {
  const entry = session.journal[session.journal.length - 1];
  if (!entry) return;
  void page
    .waitForTimeout(700)
    .then(() => page.locator("body").innerText({ timeout: 1500 }))
    .then((text) => {
      entry.bodyExcerpt = text.replace(/\s+/g, " ").trim().slice(0, 200);
    })
    .catch(() => undefined);
}

function bindContextLifecycle(session: BrowserPreviewSession, context: BrowserContext, site: AccountRecord) {
  if (session.contextBound) {
    return;
  }

  session.contextBound = true;

  context.on("page", (page) => {
    bindPageLifecycle(session, page, site);

    if (!session.page || isBlankBrowserUrl(session.page.url())) {
      void activatePage(session, page, {
        siteUrl: site.url || DEFAULT_SITE_URL,
        bringToFront: false,
      }).catch((error) => applySessionError(session, error));
    }
  });

  context.on("close", () => {
    markClosed(session);
  });
}

async function bootPreviewSession(
  session: BrowserPreviewSession,
  site: AccountRecord,
  options: StartBrowserPreviewOptions,
) {
  const context = await launchSiteProfileContext(site.profilePath, { headless: options.headless });

  session.context = context;
  await stabilizePreviewContext(context);
  await installPlatformSignalWatcher(context);
  bindContextLifecycle(session, context, site);

  const page = await pickSessionPage(session);
  bindPageLifecycle(session, page, site);
  // C2-1c: the first navigation of the session is the only one nothing else can be blamed for.
  noteNavigationCause(session, "boot");
  await activatePage(session, page, {
    siteUrl: site.url || DEFAULT_SITE_URL,
    bringToFront: options.bringToFront ?? true,
  });
}

export function getBrowserPreviewSession(accountId: string) {
  return toSnapshot(getBrowserPreviewStore().sessions.get(accountId));
}

export function getBrowserPreviewFrame(accountId: string) {
  const session = getBrowserPreviewStore().sessions.get(accountId);
  if (!session?.frame) return null;
  // The version lets the frame route answer conditional requests (304) so the
  // client can skip re-downloading/re-decoding a frame that has not changed.
  return { data: session.frame, version: `${session.lastFrameAt ?? 0}-${session.frame.length}` };
}

const LOGIN_URL_PATTERN =
  /(\/login|\/signin|sign[-_]?in|\/passwd|\/passport|\/sso|\/oauth|authoriz|account\/login|user\/login)/i;

export type BrowserLoginState = {
  /** Whether a browser page exists and can be inspected. */
  ready: boolean;
  /** Best-effort detection result; true when the page no longer looks like a login wall. */
  loggedIn: boolean;
  url: string;
  reason: "idle" | "blank" | "loading" | "login_visible" | "ok";
};

/**
 * Best-effort login detection for the account login flow.
 *
 * A page is treated as "logged in" when it has navigated to a real (non-blank) URL, that
 * URL does not look like a login route, and the visible body no longer contains any of the
 * platform's login text patterns. This is intentionally conservative: it is better to keep
 * waiting than to close the window while the user is still signing in.
 */
export async function getBrowserLoginState(
  accountId: string,
  loginTextPatterns: string[] = [],
): Promise<BrowserLoginState> {
  const session = getBrowserPreviewStore().sessions.get(accountId);
  const page = session?.page && !session.page.isClosed() ? session.page : undefined;

  if (!page) {
    return { ready: false, loggedIn: false, url: "", reason: "idle" };
  }

  const url = page.url();
  if (isBlankBrowserUrl(url)) {
    return { ready: true, loggedIn: false, url, reason: "blank" };
  }

  if (LOGIN_URL_PATTERN.test(url)) {
    return { ready: true, loggedIn: false, url, reason: "login_visible" };
  }

  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 3_000 })
    .catch(() => "");

  if (!bodyText.trim()) {
    return { ready: true, loggedIn: false, url, reason: "loading" };
  }

  const lowered = bodyText.toLowerCase();
  const patterns = loginTextPatterns.filter((pattern) => pattern.trim().length > 0);
  if (patterns.some((pattern) => lowered.includes(pattern.toLowerCase()))) {
    return { ready: true, loggedIn: false, url, reason: "login_visible" };
  }

  return { ready: true, loggedIn: true, url, reason: "ok" };
}

export type SiteLoginProbe = {
  status: "signed_in" | "signed_out" | "unknown";
  /** `login_url` is the strong signal (the platform redirected to a login route). */
  reason: "ok" | "login_url" | "login_text" | "no_url" | "error";
  url: string;
  message?: string;
};

/**
 * Read-only sign-in probe for the account health check (账号健康度风控).
 *
 * It opens (or reuses) the account profile headlessly, visits the page that
 * publishing itself drives, and reports whether that page shows a login wall.
 * It never clicks, types or publishes — the only side effect is navigation, so a
 * session the user already has open is never closed by the caller contract:
 * callers must check `getBrowserPreviewSession()` first and close only sessions
 * they started.
 */
export async function probeSiteLogin(
  site: AccountRecord,
  options: StartBrowserPreviewOptions = { headless: true, bringToFront: false },
): Promise<SiteLoginProbe> {
  const profile = await getPublishProfile(site.platform);
  const targetUrl = (profile.publishPageUrl || site.url || "").trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    return { status: "unknown", reason: "no_url", url: "" };
  }

  try {
    const { page } = await getReadySitePage(site, options);
    const onTargetHost = page.url().includes(new URL(targetUrl).host);
    if (!onTargetHost || LOGIN_URL_PATTERN.test(page.url())) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(1500);
    }

    const url = page.url();
    if (LOGIN_URL_PATTERN.test(url)) {
      return { status: "signed_out", reason: "login_url", url };
    }

    const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
    if (!bodyText.trim()) {
      return { status: "unknown", reason: "error", url, message: "Page did not render" };
    }

    const lowered = bodyText.toLowerCase();
    const wallVisible = profile.loginTextPatterns
      .filter((pattern) => pattern.trim().length > 0)
      .some((pattern) => lowered.includes(pattern.toLowerCase()));
    if (wallVisible) {
      return { status: "signed_out", reason: "login_text", url };
    }

    return { status: "signed_in", reason: "ok", url };
  } catch (error) {
    return {
      status: "unknown",
      reason: "error",
      url: "",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

const cdpSessions = new WeakMap<Page, CDPSession>();

async function getCdpSession(page: Page) {
  let cdp = cdpSessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    cdpSessions.set(page, cdp);
  }
  return cdp;
}

export type BrowserInputPayload =
  | {
      type: "mouse";
      x: number;
      y: number;
      event: "mousePressed" | "mouseReleased" | "mouseMoved";
      button?: "left" | "right" | "middle";
      clickCount?: number;
      /** CDP buttons bitmask; 1 marks a left-button drag (for text selection). */
      buttons?: number;
    }
  | { type: "wheel"; x: number; y: number; deltaX?: number; deltaY?: number }
  | { type: "text"; text: string }
  | { type: "key"; key: string; code?: string; keyCode?: number; /** CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */ modifiers?: number };

export async function dispatchBrowserInput(accountId: string, input: BrowserInputPayload) {
  const session = getBrowserPreviewStore().sessions.get(accountId);
  if (!session?.page || session.page.isClosed()) {
    throw new Error("Browser preview is not ready");
  }
  const page = session.page;
  // C2-1c: forwarded input is the author's hand on the page. A click or a key that navigates is
  // theirs, not the platform's - which is the whole difference the trace has to preserve.
  noteNavigationCause(session, "user", input.type);
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 };
  const cdp = await getCdpSession(page);

  if (input.type === "mouse") {
    const x = Math.round(input.x * viewport.width);
    const y = Math.round(input.y * viewport.height);
    await cdp.send("Input.dispatchMouseEvent", {
      type: input.event,
      x,
      y,
      button: input.button ?? "left",
      clickCount: input.clickCount ?? 1,
      ...(typeof input.buttons === "number" ? { buttons: input.buttons } : {}),
    });
  } else if (input.type === "wheel") {
    const x = Math.round(input.x * viewport.width);
    const y = Math.round(input.y * viewport.height);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: input.deltaX ?? 0,
      deltaY: input.deltaY ?? 0,
    });
  } else if (input.type === "text") {
    await cdp.send("Input.insertText", { text: input.text });
  } else if (input.type === "key") {
    const base = {
      key: input.key,
      code: input.code ?? input.key,
      windowsVirtualKeyCode: input.keyCode ?? 0,
      ...(typeof input.modifiers === "number" ? { modifiers: input.modifiers } : {}),
    };
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
}

function activeSessionPage(accountId: string) {
  const session = getBrowserPreviewStore().sessions.get(accountId);
  const page = session?.page ?? session?.streamingPage;
  return page && !page.isClosed() ? page : null;
}

/**
 * Remembers what the draft this session just created actually was, so a later verify can turn
 * "the author published" into a fact about a content item (C2 of `docs/creator-workflow-audit.md`).
 *
 * The receipt lives on the session because the session is what performed the draft: identity is
 * claimed here, by the server, and not sent back by the client on the next request. A draft that
 * names no content item has no identity to record, so it is not remembered at all.
 *
 * Since C2-1a the receipt also carries what the page did with the prefill (`drafted` and its
 * per-field `evidence`), so "a draft was prepared" is a claim with the observation behind it rather
 * than a claim that the run did not throw.
 */
export function rememberPublishDraft(
  accountId: string,
  draft: Omit<PublishDraftReceipt, "draftedAt">,
): boolean {
  const session = getBrowserPreviewStore().sessions.get(accountId);
  if (!session || !draft.contentItemId.trim()) return false;
  session.publishDraft = { ...draft, draftedAt: now() };
  touch(session);
  return true;
}

/**
 * Takes - and thereby consumes - the receipt of the draft this session is holding. Consuming is
 * the idempotency (D1): the first verify that reports success takes it, and a poll that repeats
 * while the client is still advancing finds nothing left to record.
 */
export function takePublishReceipt(accountId: string): PublishDraftReceipt | null {
  const session = getBrowserPreviewStore().sessions.get(accountId);
  const receipt = session?.publishDraft;
  if (!session || !receipt) return null;
  session.publishDraft = undefined;
  touch(session);
  return receipt;
}

/**
 * What the verify concluded (C2-1b of `docs/assisted-publishing-engine.md`).
 *
 * Three answers, because two were not enough. `published` is a fact and only a platform statement
 * authorizes it: a confirmation the page showed, or a URL the platform only serves once a post
 * exists. `unknown` is the state that did not exist when the smoke wrote its two false rows - the
 * page moved off the draft and nothing says a post exists - and it is deliberately *not* a softer
 * `published`: the caller writes nothing from it. `waiting` is the draft page still being on screen.
 *
 * 宁可 unknown，不要伪造 published：a false negative loses one row while the note still exists, a
 * false positive corrupts 发布记录, the calendar, metric matching and the item's own status, and it
 * looks exactly like a real fact.
 */
export type PublishOutcome = "waiting" | "published" | "unknown";

/** `checkPublishResult`'s answer, with the observation that produced it. */
export type PublishVerification = {
  /**
   * Whether the platform stated that a post exists - the only thing the verify route writes a fact
   * from. Kept beside `outcome` because it is the field every existing reader (the run panel, the
   * agent layer) asks for, and it means exactly `outcome === "published"`.
   */
  published: boolean;
  outcome: PublishOutcome;
  url: string;
  /**
   * How the answer was reached, in the words the publish record stores (D5). This check reads
   * observations - a phrase, a URL, a navigation - so the fact it authorizes has to carry the
   * observation behind it: "the database says published" must be answerable with "because the
   * session was showing this".
   */
  evidence: string;
  /** The navigation trace behind the answer, oldest first (C2-1c). */
  journal: NavigationEntry[];
};

/**
 * Reads the live session page to decide whether an assisted publish has landed (C2-1b).
 *
 * Three answers, in this order - and only the first of them authorizes a fact:
 *
 *   `published`  the platform said so: a confirmation the page is showing, the same confirmation
 *                captured the moment it appeared, or a URL that is itself a statement (a success
 *                screen, a permalink namespace).
 *   `unknown`    the page left the draft page and nothing speaks for a post. Reported, never
 *                written - this is the state the smoke's two false rows should have been in.
 *   `waiting`    the draft page is still on screen.
 *
 * "The URL changed" is deliberately not on that list. It is navigation evidence: recorded in the
 * journal, used to bound what `unknown` means, and never enough on its own.
 *
 * C2 fix A: "left the editor" used to be `!looksLikeEditorUrl(url)` - a claim about what an editor
 * URL looks like. 小红书's editor is `/publish/publish?from=menu&target=video`, which no editor
 * pattern matches, so the check answered "published" on the first poll after the prefill, for a page
 * nothing had been sent from. The receipt now carries the URL the draft finished on, and "left" is
 * measured against that.
 *
 * The C2 smoke narrowed it again: "the page moved" is not yet "a post exists". The smoke found the
 * session on 小红书's creator home (`/new/home`) six minutes after the prefill with the draft
 * receipt still on it, and the moved path - no editor pattern matched, no hub pattern to match -
 * was read as a publish: the run panel flipped the tab to 已发布, closed the session and dropped the
 * author's editor, and a `publish_records` row was written for a note nobody had sent. Leaving the
 * draft page is also what dropping the draft, idling out or clicking the platform's own home does,
 * so `leftDraftPage` now requires the landing page to be one a post appears on.
 *
 * The receipt is read here, not taken: knowing where the draft was is *context* for the observation,
 * while authority over the fact stays with `takePublishReceipt` in the verify route (D1).
 */
export async function checkPublishResult(accountId: string): Promise<PublishVerification> {
  const session = getBrowserPreviewStore().sessions.get(accountId);
  const journal = session?.journal ?? [];
  const page = activeSessionPage(accountId);
  if (!page) {
    return { published: false, outcome: "waiting", url: "", evidence: "no live session page", journal };
  }

  const url = page.url();
  const receipt = session?.publishDraft;
  const draftUrl = receipt?.editorUrl ?? "";

  // 1. The page saying it, right now: the platform's own confirmation, wherever it is shown -
  // including while the editor is still the page, which is what a post published without a
  // navigation looks like.
  const bodyText = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
  if (publishSuccessPattern.test(bodyText)) {
    return {
      published: true,
      outcome: "published",
      url,
      evidence: `success confirmation visible${url ? ` at ${url}` : ""}`,
      journal,
    };
  }

  // 2. A page left for a URL that *is* a statement by the platform: a success screen, or a permalink
  // namespace it only serves for a post that exists. The move is required, because the draft page
  // itself can be full of post-shaped URLs (Threads drafts at `/post/edit/<id>`), and a URL is only
  // strong when it is somewhere the draft is not.
  if (leftDraftPage(url, draftUrl)) {
    const landing = recognizeStrongLanding(url);
    if (landing) {
      return {
        published: true,
        outcome: "published",
        url,
        evidence: `session left the editor URL at ${url} (${landing === "success" ? "success page" : "post URL"})`,
        journal,
      };
    }
  }

  // 3. The platform having said it while the page was showing it (C2-1c). Bounded to this draft's
  // window, so a confirmation from an earlier run on the same session can never be re-used.
  if (receipt) {
    const captured = [...journalConfirmations(journal, receipt.draftedAt), ...(await readPlatformSignals(page))]
      .filter((signal) => signal.at >= receipt.draftedAt)
      .sort((left, right) => left.at - right.at);
    const first = captured[0];
    if (first) {
      return {
        published: true,
        outcome: "published",
        url,
        evidence: `success confirmation "${first.text}" seen at ${first.url} and captured when it appeared`,
        journal,
      };
    }
  }

  // 4. The page moved and nothing speaks for a post. This is the C2 smoke's second false row
  // (`creator.xiaohongshu.com/new/home` with the draft still on the session) and the state the
  // record was missing: reported, never written.
  if (pageMovedOffDraft(url, draftUrl)) {
    return {
      published: false,
      outcome: "unknown",
      url,
      evidence: `${notPublishedEvidence(url, draftUrl)} (navigation only: no platform confirmation)`,
      journal,
    };
  }

  return { published: false, outcome: "waiting", url, evidence: notPublishedEvidence(url, draftUrl), journal };
}

/**
 * Best-effort cleanup: try to delete the just-created draft on the current page.
 * Platform DOMs differ, so this only clicks a delete affordance when it finds
 * one and reports whether it believes the draft was removed.
 */
export async function discardDraft(accountId: string): Promise<{ discarded: boolean }> {
  const page = activeSessionPage(accountId);
  if (!page) return { discarded: false };
  const clicked = await clickFirstVisible(page, [
    'button:has-text("删除草稿")',
    'text="删除草稿"',
    '[aria-label="删除"]',
    'button:has-text("删除")',
    '.Modal button:has-text("删除")',
    '[role="dialog"] button:has-text("删除")',
  ]);
  if (!clicked) return { discarded: false };
  await page.waitForTimeout(1200);
  await clickFirstVisible(page, [
    '[role="dialog"] button:has-text("确定")',
    '[role="dialog"] button:has-text("确认")',
    '.Modal button:has-text("确定")',
    'button:has-text("确认删除")',
  ]);
  await page.waitForTimeout(800);
  return { discarded: true };
}

export async function startBrowserPreviewSession(site: AccountRecord, options: StartBrowserPreviewOptions = {}) {
  const store = getBrowserPreviewStore();
  const existing = store.sessions.get(site.id);

  if (existing?.status === "ready" && existing.context) {
    try {
      const page = await pickSessionPage(existing);
      bindPageLifecycle(existing, page, site);
      await activatePage(existing, page, {
        siteUrl: site.url || DEFAULT_SITE_URL,
        bringToFront: options.bringToFront ?? true,
      });
      return toSnapshot(existing);
    } catch (error) {
      applySessionError(existing, error);
      return toSnapshot(existing);
    }
  }

  const inflight = store.starting.get(site.id);
  if (inflight) {
    return inflight;
  }

  if (existing) {
    await stopBrowserPreviewSession(site.id);
  }

  const session: BrowserPreviewSession = {
    accountId: site.id,
    accountName: site.name,
    profilePath: site.profilePath,
    status: "starting",
    startedAt: now(),
    updatedAt: now(),
    journal: [],
    contextBound: false,
    boundPages: new WeakSet<Page>(),
  };

  store.sessions.set(site.id, session);

  const startup = bootPreviewSession(session, site, options)
    .then(() => toSnapshot(session))
    .catch(async (error) => {
      applySessionError(session, error);
      await session.context?.close().catch(() => undefined);
      return toSnapshot(session);
    })
    .finally(() => {
      store.starting.delete(site.id);
    });

  store.starting.set(site.id, startup);
  return startup;
}

export async function stopBrowserPreviewSession(accountId: string) {
  const store = getBrowserPreviewStore();
  const session = store.sessions.get(accountId);
  store.starting.delete(accountId);

  if (!session) {
    return false;
  }

  await closeBrowserPreviewSessionContext(session);
  store.sessions.delete(accountId);
  return true;
}

export type SiteBrowserToolName =
  | "browser_goto"
  | "browser_screenshot"
  | "browser_snapshot"
  | "browser_click"
  | "browser_type"
  | "browser_press"
  | "browser_tab_control"
  | "threads_create_post"
  | "xiaohongshu_create_post"
  | "configured_create_post"
  | "collect_metrics";

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

async function pickVisible(page: Page, selectors: string[]): Promise<{ locator: Locator | null; selector: string }> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 1200 }).catch(() => false)) {
      return { locator, selector };
    }
  }
  return { locator: null, selector: "" };
}

async function firstVisibleLocator(page: Page, selectors: string[]) {
  return (await pickVisible(page, selectors)).locator;
}

/** Clicks the first visible match and reports which selector matched (for logging). */
async function clickVisibleLogged(page: Page, selectors: string[]): Promise<{ clicked: boolean; selector: string }> {
  const { locator, selector } = await pickVisible(page, selectors);
  if (!locator) return { clicked: false, selector: "" };
  await locator.click({ timeout: 10_000 }).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!/intercepts pointer events|not stable|not receiving pointer events/i.test(message)) {
      throw error;
    }
    await locator.click({ timeout: 10_000, force: true });
  });
  return { clicked: true, selector };
}

async function clickFirstVisible(page: Page, selectors: string[]) {
  return (await clickVisibleLogged(page, selectors)).clicked;
}

/** Saves a debug screenshot (only when COOLPILOT_PUBLISH_DEBUG is on). */
async function debugScreenshot(page: Page, scope: string, label: string, log: PublishLogger) {
  if (!isPublishDebugEnabled() || page.isClosed()) return;
  const file = path.join(artifactsRoot(), `${scope}-publish-${label}-${Date.now()}.png`);
  await page.screenshot({ path: file }).catch(() => undefined);
  log.screenshot(file);
}

/** First attached file input matching any selector (file inputs are usually hidden). */
async function fileInputMatching(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) return locator;
  }
  return null;
}

/**
 * Uploads a local video into the open composer and waits for the platform to
 * finish processing it. Video handling differs wildly per platform, so the
 * selectors and the wait time come from the platform publish profile.
 */
async function uploadVideoToComposer(page: Page, profile: PlatformPublishProfile, videoPath: string) {
  if (profile.videoTabSelectors.length > 0) {
    await clickFirstVisible(page, profile.videoTabSelectors);
    await page.waitForTimeout(1500);
  }

  const fileInput = await fileInputMatching(page, profile.videoInputSelectors);
  if (!fileInput) {
    throw new Error("Video upload field was not found. Adjust the platform selectors in Publish Settings.");
  }

  await fileInput.setInputFiles(videoPath, { timeout: 60_000 });
  await page.waitForTimeout(profile.videoUploadWaitMs);
}

async function threadsLoginRequired(page: Page) {
  const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  return /log in|sign up|continue with instagram|login to see|登入|註冊 threads|使用 instagram 帳號繼續|改以用戶名稱登入/i.test(bodyText);
}

async function runThreadsCreatePost(page: Page, args: Record<string, unknown>) {
  const text = requireString(args.text, "text");
  const publish = args.publish === true;
  const imagePath = typeof args.imagePath === "string" ? args.imagePath.trim() : "";
  const videoPath = typeof args.videoPath === "string" ? args.videoPath.trim() : "";

  if (!/^https:\/\/(www\.)?threads\.(net|com)\//i.test(page.url())) {
    await page.goto("https://www.threads.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
  }

  const loginRequired = await threadsLoginRequired(page);
  if (loginRequired) {
    return { url: page.url(), drafted: false, published: false, loginRequired: true };
  }

  await clickFirstVisible(page, [
    '[aria-label="Create"]',
    '[aria-label="New thread"]',
    '[aria-label*="New thread"]',
    '[aria-label*="Create"]',
    'text="What\'s new?"',
    'text="Start a thread"',
    'text="新串文"',
    'text="發佈串文"',
    'text="發布串文"',
  ]);
  await page.waitForTimeout(1500);

  const composer = await firstVisibleLocator(page, [
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea',
    '[aria-label*="Start a thread"]',
    '[aria-label*="What\'s new"]',
    '[aria-label*="有什麼新鮮事"]',
  ]);
  if (!composer) {
    if (await threadsLoginRequired(page)) {
      return { url: page.url(), drafted: false, published: false, loginRequired: true };
    }
    throw new Error("Threads composer was not found. Open the logged-in Threads home page and try again.");
  }
  await composer.fill(text, { timeout: 15_000 }).catch(async () => {
    await composer.click({ timeout: 10_000 });
    await page.keyboard.insertText(text);
  });

  // Threads accepts a single attachment: a video wins over a still image.
  if (imagePath || videoPath) {
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count()) {
      await fileInput.setInputFiles(videoPath || imagePath, { timeout: 60_000 });
      await page.waitForTimeout(videoPath ? 45_000 : 8000);
    }
  }

  if (!publish) {
    return { url: page.url(), drafted: true, published: false, text };
  }

  const clickedPublish = await clickFirstVisible(page, [
    '[role="dialog"] div[role="button"]:has-text("Post")',
    '[role="dialog"] div[role="button"]:has-text("發佈")',
    '[role="dialog"] div[role="button"]:has-text("發布")',
    '[role="dialog"] button:has-text("Post")',
    '[role="dialog"] button:has-text("發佈")',
    '[role="dialog"] button:has-text("發布")',
    'div[role="button"]:has-text("Post")',
    'div[role="button"]:has-text("發佈")',
    'div[role="button"]:has-text("發布")',
    'button:has-text("Post")',
    'button:has-text("發佈")',
    'button:has-text("發布")',
  ]);
  if (!clickedPublish) {
    throw new Error("Threads publish button was not found after drafting the post.");
  }
  await page.waitForTimeout(5000);
  const composerStillVisible = await page
    .locator('div[contenteditable="true"][role="textbox"], div[contenteditable="true"], textarea')
    .first()
    .isVisible({ timeout: 1200 })
    .catch(() => false);
  if (composerStillVisible) {
    const clickedAgain = await clickFirstVisible(page, [
      '[role="dialog"] div[role="button"]:has-text("Post")',
      '[role="dialog"] div[role="button"]:has-text("發佈")',
      '[role="dialog"] div[role="button"]:has-text("發布")',
      '[role="dialog"] button:has-text("Post")',
      '[role="dialog"] button:has-text("發佈")',
      '[role="dialog"] button:has-text("發布")',
    ]);
    if (clickedAgain) {
      await page.waitForTimeout(5000);
    }
  }
  const stillDrafting = await page
    .locator('div[contenteditable="true"][role="textbox"], div[contenteditable="true"], textarea')
    .first()
    .isVisible({ timeout: 1200 })
    .catch(() => false);
  if (stillDrafting) {
    throw new Error("Threads post is still in the composer after clicking publish.");
  }
  return { url: page.url(), drafted: true, published: true, text };
}

async function xiaohongshuLoginRequired(page: Page) {
  const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  return /登录|登入|扫码登录|手机号登录|验证码登录|login|sign in|sign up/i.test(bodyText);
}

async function runXiaohongshuCreatePost(page: Page, args: Record<string, unknown>) {
  const title = requireString(args.title, "title");
  const text = typeof args.text === "string" ? args.text : typeof args.body === "string" ? args.body : "";
  const publish = args.publish === true;
  const imagePath = typeof args.imagePath === "string" ? args.imagePath.trim() : "";
  const videoPath = typeof args.videoPath === "string" ? args.videoPath.trim() : "";
  const mediaPath = videoPath || imagePath;

  if (
    !/^https:\/\/(www\.)?xiaohongshu\.com\//i.test(page.url()) &&
    !/^https:\/\/creator\.xiaohongshu\.com\//i.test(page.url())
  ) {
    await page.goto("https://creator.xiaohongshu.com/", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }

  const loginRequired = await xiaohongshuLoginRequired(page);
  if (loginRequired) {
    return { url: page.url(), drafted: false, published: false, loginRequired: true };
  }

  // 点击"发布笔记"入口（多选择器容错，需根据实际页面调试）
  await clickFirstVisible(page, [
    'text="发布笔记"',
    'text="发布"',
    'button:has-text("发布笔记")',
    'button:has-text("发布")',
    '[class*="publish"]',
    '[class*="create-note"]',
  ]);
  await page.waitForTimeout(2000);

  // 填写标题
  const titleInput = await firstVisibleLocator(page, [
    'input[placeholder*="标题"]',
    'input[placeholder*="填写标题"]',
    'input[placeholder*="标题，最多"]',
    'input[type="text"]',
  ]);
  if (titleInput) {
    await titleInput
      .fill(title, { timeout: 15_000 })
      .catch(async () => {
        await titleInput.click({ timeout: 10_000 });
        await page.keyboard.insertText(title);
      });
  }

  // 填写正文
  let bodyInput: Locator | null = null;
  if (text) {
    bodyInput = await firstVisibleLocator(page, [
      'div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea',
    ]);
    if (bodyInput) {
      await bodyInput
        .fill(text, { timeout: 15_000 })
        .catch(async () => {
          await bodyInput?.click({ timeout: 10_000 });
          await page.keyboard.insertText(text);
        });
    }
  }

  // 上传图片或视频
  if (mediaPath) {
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count()) {
      await fileInput.setInputFiles(mediaPath, { timeout: 60_000 });
      await page.waitForTimeout(videoPath ? 45_000 : 8000);
    }
  }

  if (!publish) {
    // B (fix): opening the editor is not prefilling it - the 小红书-named tool's version of the same
    // lie the configured path told. Report a draft only when a field actually took the content.
    const drafted = Boolean(titleInput || bodyInput);
    return { url: page.url(), drafted, published: false, title, text };
  }

  const clickedPublish = await clickFirstVisible(page, [
    'button:has-text("发布")',
    'div[role="button"]:has-text("发布")',
    '[class*="publish"]:has-text("发布")',
    'text="发布"',
  ]);
  if (!clickedPublish) {
    throw new Error("小红书发布按钮未找到，请确认已登录并打开发布页面。");
  }
  await page.waitForTimeout(5000);

  return { url: page.url(), drafted: true, published: true, title, text };
}

/** Editor-style URLs (a draft that was only saved, not published). */
function looksLikeEditorUrl(url: string) {
  return /\/(edit|write)(?:[/?#]|$)/i.test(url);
}

/** The path of a URL, or `null` when the string does not parse. */
function urlPath(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/**
 * Path segments that belong to a platform's own chrome rather than to a post: signing in, the home
 * feed, the creator dashboard. A page like this is what a platform shows *around* a draft - it is
 * where an editor hands the session back when the draft is dropped, the tab is idled out, the
 * upload is lost or the author clicks their way out - and a post never appears on one.
 */
const PLATFORM_SHELL_PATH_PATTERN =
  /^(?:login|logout|sign-?in|sign-?up|passport|sso|oauth\d?|home|index|welcome)$/i;

/**
 * Path segments that belong to making a post: the composer, the uploader, the saved drafts.
 *
 * 小红书's editor is the worked example - `creator.xiaohongshu.com/publish/publish` - and it is
 * worth spelling out why this pattern is not `looksLikeEditorUrl`: that one only knows `/edit` and
 * `/write`, so without this guard the smoke's *first* false positive (a receipt whose `editorUrl`
 * was blank, compared against this very editor page) still reads as "left the editor for a page
 * that is not an editor" and writes a record whose URL is the editor.
 */
const COMPOSER_PATH_PATTERN =
  /^(?:publish|create|upload|compose|draft|drafts|edit|write|editor|contribute)$/i;

/**
 * A URL that is the platform confirming the post exists, typically right where the composer was
 * (`.../publish/success?target=video`). The composer pattern above would otherwise reject it.
 */
const SUCCESS_URL_PATTERN = /(?:^|\/)(?:success|successful|published)(?:[/?#]|$)/i;

/**
 * Whether the page is one the platform shows *before* a post exists - its own chrome, or the page
 * the post is being written on (C2 smoke).
 *
 * Landing here is navigation, not a publish, which is what the smoke's second false positive was:
 * `creator.xiaohongshu.com/new/home` with the draft receipt still on the session.
 */
function isPrePostUrl(url: string) {
  const path = urlPath(url);
  // An unparseable URL says nothing about where the page is; silence beats a guess (see below).
  if (path === null) return false;
  // A bare origin is a landing page, not a post.
  if (path === "/") return true;
  // A success screen is the post's own page, even though it sits under the composer's path.
  if (SUCCESS_URL_PATTERN.test(url)) return false;
  return path
    .split("/")
    .filter(Boolean)
    .some((segment) => PLATFORM_SHELL_PATH_PATTERN.test(segment) || COMPOSER_PATH_PATTERN.test(segment));
}

/**
 * Whether the session page has left the page the draft was created on *for a post* (C2 fix A,
 * narrowed by the C2 smoke).
 *
 * With a receipt this compares against where the draft actually was, and the comparison is by
 * *path*: a changed path is a navigation, while a changed query or hash is the platform switching
 * tabs or steps on one screen (小红书's `?target=video` -> `?target=image`), which is the author
 * editing the draft rather than having sent it. `looksLikeEditorUrl` stays as a second guard so a
 * navigation to *another* editor page is not read as a publish either, and `isPrePostUrl` rejects
 * the platform's own chrome and its composers. What is left - a permalink, a post page, a success
 * screen - is what a publish looks like; the success phrase is the other way to say it.
 *
 * Without a receipt URL the comparison has no draft page to make, so the page's own shape is all
 * that is left: a page that is neither an editor, nor the platform's chrome, nor a composer counts
 * as a post. That answer is only ever a UI claim - the verify route writes no fact without a
 * receipt to attribute (D1) - and it is what keeps the poll *after* a success, whose receipt that
 * success spent, from reporting the live post as unpublished.
 */
function leftDraftPage(url: string, draftUrl: string) {
  // No live URL at all is not evidence that a page moved.
  if (!url) return false;
  // A page a post cannot be on is not a publish, whatever the receipt says: an editor, the platform's
  // own chrome, a composer. Leaving a draft page is also what dropping the draft, idling out or
  // clicking the platform's home does, and the C2 smoke read exactly that as a publish (a row whose
  // URL is `/new/home`, on an item nobody had drafted on).
  if (looksLikeEditorUrl(url) || isPrePostUrl(url)) return false;
  // An unparseable URL says nothing about where the page is; silence beats a guess.
  const current = urlPath(url);
  if (current === null) return false;
  if (!draftUrl.trim()) return true;
  const draft = urlPath(draftUrl);
  if (!draft) return false;
  return current !== draft;
}

/**
 * Why the URL branch said no, in the words of the observation - the non-success half of D5's
 * evidence, and the string the run panel's debug log shows while the author is still editing.
 */
function notPublishedEvidence(url: string, draftUrl: string) {
  const shown = url || "(blank)";
  // No receipt URL, and the page's own shape - the only thing left to go on - said no.
  if (!draftUrl.trim()) return `no draft receipt, and the page is not a post: ${shown}`;
  const current = urlPath(url);
  const draft = urlPath(draftUrl);
  if (!current || !draft || current === draft) return `still the editor URL ${shown}`;
  return `left the draft page for a page that is not a post: ${shown}`;
}

/**
 * Whether the session is on a different page than the one the draft was made on (C2-1b).
 *
 * Compared by path, so the platform stepping through tabs on one screen (`?target=video` ->
 * `?target=image`) is not a move - which is the same reason `leftDraftPage` compares paths. This is
 * the difference between "the author is still in the draft" (`waiting`) and "the draft page is gone
 * and nothing says a post exists" (`unknown`), and it is deliberately *not* narrowed to post-shaped
 * pages: landing on the platform's own home with a draft receipt in hand is the C2 smoke's second
 * false row, and calling that "still waiting" would hide it a second time.
 */
function pageMovedOffDraft(url: string, draftUrl: string) {
  if (!url || !draftUrl.trim()) return false;
  const current = urlPath(url);
  const draft = urlPath(draftUrl);
  if (current === null || draft === null) return false;
  return current !== draft;
}

/**
 * URL namespaces a platform only serves for a post that exists.
 *
 * Intentionally the narrowest useful list. It is not a guess about any platform's selectors - the C2
 * smoke's lesson was that guessing those is what produced the false rows - but the general shape of
 * a permalink: `/post/<id>`, `/explore/<id>`, `/video/<id>`. A landing URL that does not match is
 * `unknown`, never `published`, so this list can only ever *withhold* a fact; the platform's own
 * confirmation text remains the primary evidence. Per-platform post shapes belong to the adapter
 * seam (`docs/assisted-publishing-engine.md` §7), which is where 小红书's measured shape will land.
 */
const POST_URL_PATTERN = /(?:^|\/)(?:post|posts|note|notes|explore|video|videos|status|item)(?:\/|$)/i;

/** The URL shapes that are themselves the platform stating that a post exists. */
function recognizeStrongLanding(url: string): "success" | "post" | null {
  if (!url) return null;
  if (SUCCESS_URL_PATTERN.test(url)) return "success";
  if (POST_URL_PATTERN.test(url)) return "post";
  return null;
}

/**
 * Confirmations the journal kept while the page was showing them (C2-1c).
 *
 * The excerpt on a navigation entry is what the page said a moment *after* it moved, which is where
 * a platform that confirms before redirecting leaves its confirmation. Reading it here - instead of
 * only reading the live page - is what stops a two-second toast from being invisible to a 2.5 s poll.
 */
function journalConfirmations(journal: NavigationEntry[], since: number): PlatformSignal[] {
  const signals: PlatformSignal[] = [];
  for (const entry of journal) {
    if (entry.at < since || !entry.bodyExcerpt) continue;
    const match = publishSuccessPattern.exec(entry.bodyExcerpt);
    if (match) signals.push({ at: entry.at, url: entry.url, text: match[0] });
  }
  return signals;
}

// Specific success phrases — intentionally narrow so a "Publish" button label
// elsewhere on the page does not read as success.
const publishSuccessPattern =
  /发布成功|发表成功|发布完成|已发布成功|Published successfully|successfully published|Your (?:post|article) (?:was|has been) (?:published|posted)/i;

/** How many confirmations a page keeps for the verify to find (C2-1c). */
const PLATFORM_SIGNAL_LIMIT = 10;

/**
 * Watches every page in the context for the platform's own confirmation, and keeps the moment it
 * appeared (C2-1c).
 *
 * The run panel polls once every 2.5 s and a success toast lives about that long, so "read the live
 * page at poll time" is a coin flip on the strongest evidence a platform gives. This witness runs
 * inside the page - installed for every document, throttled to at most one scan per 700 ms of DOM
 * activity - and records the phrase with its timestamp and URL, which the verify then reads back
 * (`readPlatformSignals`). It also makes the difference between "小红书 showed no confirmation" and
 * "our poll missed it" answerable, which is the question the smoke it ships with exists to ask.
 *
 * `innerText` is what is scanned, so hidden help text ("发布成功后…") does not count.
 */
async function installPlatformSignalWatcher(context: BrowserContext) {
  await context
    .addInitScript(
      ({ source, flags, limit }) => {
        const store = window as unknown as { __coolpilotSignals?: PlatformSignal[] };
        if (store.__coolpilotSignals) return;
        // Annotated, because an assignment from a bare `[]` narrows to `never[]`.
        const seen: PlatformSignal[] = (store.__coolpilotSignals = []);
        const pattern = new RegExp(source, flags);
        let scheduled = false;
        const scan = () => {
          try {
            const text = document.body ? document.body.innerText : "";
            const match = pattern.exec(text);
            if (!match) return;
            if (seen.length >= limit) seen.shift();
            seen.push({ at: Date.now(), text: match[0].slice(0, 120), url: location.href });
          } catch {
            // A page mid-navigation can throw on innerText; the next scan tries again.
          }
        };
        const schedule = () => {
          if (scheduled) return;
          scheduled = true;
          window.setTimeout(() => {
            scheduled = false;
            scan();
          }, 700);
        };
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", schedule, { once: true });
        } else {
          schedule();
        }
        try {
          // `document` and not `documentElement`: the init script runs at document start, before the
          // element exists, and an observer that cannot attach would silently drop the watch.
          new MutationObserver(schedule).observe(document, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        } catch {
          // No observer means only the initial scan runs; that is still one look per page load.
        }
      },
      { source: publishSuccessPattern.source, flags: publishSuccessPattern.flags, limit: PLATFORM_SIGNAL_LIMIT },
    )
    .catch(() => undefined);
}

/** What the witness installed by `installPlatformSignalWatcher` saw on this page. */
async function readPlatformSignals(page: Page): Promise<PlatformSignal[]> {
  try {
    const raw = await page.evaluate(
      () => ((window as unknown as { __coolpilotSignals?: PlatformSignal[] }).__coolpilotSignals ?? []),
    );
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/**
 * Best-effort verification that a post actually published, rather than trusting
 * that a "publish" button was merely clicked. Success = the page navigated away
 * from the editor, or a success confirmation appeared. When neither happens the
 * content was only saved as a draft, so we report it as `drafted` to keep publish
 * records honest.
 */
async function verifyPublishResult(page: Page, editorUrl: string, log?: PublishLogger): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const url = page.url();
    if (url !== editorUrl && !looksLikeEditorUrl(url)) {
      log?.step(`verify #${attempt}: url changed -> ${url}`);
      return true;
    }
    const bodyText = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
    if (publishSuccessPattern.test(bodyText)) {
      log?.step(`verify #${attempt}: success phrase detected`);
      return true;
    }
    await page.waitForTimeout(1000);
  }
  log?.step(`verify: timed out after ${attempt} attempt(s), url still ${page.url()}`);
  return false;
}

/**
 * The generic configured-publish path: every platform whose draft goes through a publish profile
 * (`configured_create_post`, which is what `/api/publish/draft` uses).
 *
 * Exported for its unit test: the `drafted` answer is a claim about the platform page, and pinning
 * it needs a page whose own selectors decide the answer, not a real account (`C2 fix B`, see
 * `src/lib/browser-preview-session.test.ts`).
 */
export async function runConfiguredCreatePost(
  page: Page,
  profile: PlatformPublishProfile,
  args: Record<string, unknown>,
  scope: string,
) {
  const log = createPublishLog(scope);
  const title = typeof args.title === "string" ? args.title.trim() : "";
  const text = typeof args.text === "string" ? args.text : typeof args.body === "string" ? args.body : "";
  const publish = args.publish === true;
  const imagePath = typeof args.imagePath === "string" ? args.imagePath.trim() : "";
  const videoPath = typeof args.videoPath === "string" ? args.videoPath.trim() : "";

  log.step(
    `start publish=${publish} title=${title.length}ch text=${text.length}ch image=${imagePath ? "y" : "n"} video=${videoPath ? "y" : "n"}`,
  );

  if (profile.publishPageUrl) {
    const targetHost = new URL(profile.publishPageUrl).host;
    if (!page.url().includes(targetHost)) {
      log.step(`navigate -> ${profile.publishPageUrl}`);
      await page.goto(profile.publishPageUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    }
  }
  log.step(`url after nav: ${page.url()}`);

  const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  const loginRequired = profile.loginTextPatterns.some((pattern) => new RegExp(pattern, "i").test(bodyText));
  log.step(`login check: ${loginRequired ? "REQUIRED" : "ok"} body[0:160]=${JSON.stringify(bodyText.slice(0, 160))}`);
  if (loginRequired) {
    await debugScreenshot(page, scope, "login-required", log);
    return { url: page.url(), drafted: false, published: false, loginRequired: true };
  }

  const newPost = await clickVisibleLogged(page, profile.newPostSelectors);
  log.step(`new post entry: ${newPost.selector || "(none)"} clicked=${newPost.clicked}`);
  await page.waitForTimeout(1500);

  let mediaUploaded = false;
  if (videoPath) {
    // Upload first: most platforms only unlock the title/description fields once
    // the video has been picked up.
    log.step("uploading video");
    await uploadVideoToComposer(page, profile, videoPath);
    mediaUploaded = true;
  }

  // C2-1a: record what the page did with each piece, not how much we had to give it. The old
  // `wanted`/`filled` counters said that *something* happened but never which part, so "the editor
  // is open" and "the draft is filled" stayed the same answer to everyone downstream.
  let titleOutcome: DraftFieldOutcome = "not_offered";
  let textOutcome: DraftFieldOutcome = "not_offered";

  if (title) {
    const picked = await pickVisible(page, profile.titleSelectors);
    log.step(`title input: ${picked.selector || "(none)"}`);
    titleOutcome = picked.locator ? "filled" : "empty";
    if (picked.locator) {
      await picked.locator.fill(title, { timeout: 15_000 }).catch(async () => {
        await picked.locator?.click({ timeout: 10_000 });
        await page.keyboard.insertText(title);
      });
    }
  }

  if (text) {
    const picked = await pickVisible(page, profile.contentSelectors);
    log.step(`content input: ${picked.selector || "(none)"}`);
    textOutcome = picked.locator ? "filled" : "empty";
    if (picked.locator) {
      await picked.locator.fill(text, { timeout: 15_000 }).catch(async () => {
        await picked.locator?.click({ timeout: 10_000 });
        await page.keyboard.insertText(text);
      });
    }
  }

  if (imagePath) {
    // With a video attached only a dedicated image input may take the cover;
    // otherwise the generic input would upload the cover as a second video.
    const fileInput = videoPath
      ? await fileInputMatching(page, ['input[type="file"][accept*="image"]'])
      : page.locator('input[type="file"]').first();
    if (fileInput && (await fileInput.count())) {
      log.step("uploading image");
      await fileInput.setInputFiles(imagePath, { timeout: 15_000 });
      mediaUploaded = true;
      await page.waitForTimeout(8000);
    } else {
      // C2-1a: media was handed over and no input took it. Recorded rather than swallowed - an image
      // draft the page refused is a draft the author has to make by hand.
      log.step("image upload: (no file input) - nothing uploaded");
    }
  }

  const evidence: PublishDraftEvidence = {
    title: titleOutcome,
    text: textOutcome,
    media: videoPath || imagePath ? (mediaUploaded ? "filled" : "empty") : "not_offered",
  };

  if (!publish) {
    await debugScreenshot(page, scope, "draft-prefilled", log);
    log.step(`prefilled draft (no publish click) url=${page.url()}`);
    log.step(`draft evidence: title=${evidence.title} text=${evidence.text} media=${evidence.media}`);
    // B (fix, sharpened by C2-1a): "drafted" is a claim about the page, not about having reached it.
    // 小红书's 发布笔记 entry opens `/publish/publish?from=menu&target=video`, where the profile's
    // title and content selectors match nothing: the run answered `drafted: true` with both fields
    // "(none)" in its own log, which told the author to finish a page holding nothing. The answer was
    // made to follow what the page took; C2-1a makes it say *which* part of the draft it took, and
    // keeps a run that had nothing to hand over (`not_offered` everywhere) from reading as a failure.
    const drafted = draftPrepared(evidence);
    if (!drafted) log.step("no field took the content: reporting drafted=false");
    return { url: page.url(), drafted, evidence, published: false, title, text };
  }

  const editorUrl = page.url();
  await debugScreenshot(page, scope, "before-publish", log);
  const publishClick = await clickVisibleLogged(page, profile.publishButtonSelectors);
  log.step(`publish button: ${publishClick.selector || "(none)"} clicked=${publishClick.clicked}`);
  if (!publishClick.clicked) {
    throw new Error("Publish button not found. Adjust the platform selectors in Publish Settings.");
  }
  await page.waitForTimeout(3000);
  await debugScreenshot(page, scope, "after-publish", log);

  // Some platforms show a confirmation modal after the primary publish button.
  if (profile.confirmButtonSelectors.length > 0) {
    const confirmClick = await clickVisibleLogged(page, profile.confirmButtonSelectors);
    log.step(`confirm button: ${confirmClick.selector || "(none)"} clicked=${confirmClick.clicked}`);
  }

  // Only report "published" when the post verifiably went live; otherwise the
  // content was saved as a draft and the record should say so.
  const published = await verifyPublishResult(page, editorUrl, log);
  log.step(`verify: published=${published} url=${page.url()}`);
  await debugScreenshot(page, scope, published ? "published" : "draft", log);
  return { url: page.url(), drafted: !published, published, title, text };
}

async function getReadySitePage(site: AccountRecord, options: StartBrowserPreviewOptions = {}) {
  await startBrowserPreviewSession(site, options);
  const session = getBrowserPreviewStore().sessions.get(site.id);
  if (!session?.context) {
    throw new Error("Browser preview session is not available");
  }

  const page = await pickSessionPage(session);
  bindPageLifecycle(session, page, site);
  await activatePage(session, page, {
    siteUrl: site.url || DEFAULT_SITE_URL,
    bringToFront: options.bringToFront ?? true,
  });
  return { session, page };
}

async function summarizePage(page: Page, accountId: string) {
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 1500 })
    .catch(() => "");

  return {
    accountId,
    url: page.url(),
    title: await page.title().catch(() => ""),
    text: bodyText.slice(0, 4000),
    snapshot: getBrowserPreviewSession(accountId),
  };
}

export async function runSiteBrowserTool(
  site: AccountRecord,
  input: {
    name: SiteBrowserToolName;
    args?: Record<string, unknown>;
  },
  options: StartBrowserPreviewOptions = { bringToFront: true },
) {
  const { session, page } = await getReadySitePage(site, options);
  const args = input.args ?? {};

  // C2-1c: whatever this call navigates to is attributed to it, by name. A draft tool says `draft`,
  // everything else says `tool` - so a trace reads `draft:configured_create_post` or
  // `tool:collect_metrics` instead of "the page moved", which is what the smoke could not answer.
  const draftTools: SiteBrowserToolName[] = ["configured_create_post", "xiaohongshu_create_post", "threads_create_post"];
  noteNavigationCause(session, draftTools.includes(input.name) ? "draft" : "tool", input.name);

  if (input.name === "browser_goto") {
    const url = requireString(args.url, "url");
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("browser_goto requires an http(s) URL");
    }
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }

  if (input.name === "browser_screenshot") {
    const filePath = path.join(artifactsRoot(), `${site.id}-browser-${Date.now()}.png`);
    await page.screenshot({ path: filePath, fullPage: args.fullPage !== false });
    return { ...(await summarizePage(page, site.id)), path: filePath };
  }

  if (input.name === "browser_click") {
    const selector = requireString(args.selector, "selector");
    await page.locator(selector).first().click({ timeout: 15_000 });
  }

  if (input.name === "browser_type") {
    const selector = requireString(args.selector, "selector");
    const text = requireString(args.text, "text");
    const clear = args.clear !== false;
    const locator = page.locator(selector).first();
    if (clear) {
      await locator.fill(text, { timeout: 15_000 });
    } else {
      await locator.type(text, { timeout: 15_000 });
    }
  }

  if (input.name === "browser_press") {
    const key = requireString(args.key, "key");
    const selector = typeof args.selector === "string" ? args.selector.trim() : "";
    if (selector) {
      await page.locator(selector).first().press(key, { timeout: 15_000 });
    } else {
      await page.keyboard.press(key);
    }
  }

  if (input.name === "browser_tab_control") {
    const action = requireString(args.action, "action");
    if (action === "new") {
      const nextPage = await session.context!.newPage();
      bindPageLifecycle(session, nextPage, site);
      if (typeof args.url === "string" && /^https?:\/\//i.test(args.url)) {
        await nextPage.goto(args.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      }
      await activatePage(session, nextPage, { bringToFront: true, closeBlankPages: false });
      return summarizePage(nextPage, site.id);
    }

    if (action === "select") {
      const index = Number(args.index ?? 0);
      const pages = getOpenPages(session.context!);
      const nextPage = pages[index];
      if (!nextPage) {
        throw new Error("Browser tab not found");
      }
      await activatePage(session, nextPage, { bringToFront: true, closeBlankPages: false });
      return summarizePage(nextPage, site.id);
    }

    if (action === "close") {
      await page.close().catch(() => undefined);
      const nextPage = await pickSessionPage(session);
      await activatePage(session, nextPage, {
        siteUrl: site.url || DEFAULT_SITE_URL,
        bringToFront: true,
      });
      return summarizePage(nextPage, site.id);
    }

    throw new Error("Unsupported browser_tab_control action");
  }

  if (input.name === "threads_create_post") {
    const result = await runThreadsCreatePost(page, args);
    return { ...(await summarizePage(page, site.id)), ...result };
  }

  if (input.name === "xiaohongshu_create_post") {
    const result = await runXiaohongshuCreatePost(page, args);
    return { ...(await summarizePage(page, site.id)), ...result };
  }

  if (input.name === "configured_create_post") {
    const profile = await getPublishProfile(site.platform);
    const result = await runConfiguredCreatePost(page, profile, args, site.id);
    return { ...(await summarizePage(page, site.id)), ...result };
  }

  if (input.name === "collect_metrics") {
    const profile = getMetricProfile(site.platform);
    const targetUrl =
      typeof args.url === "string" && /^https?:\/\//i.test(args.url)
        ? args.url
        : profile.statsPageUrl;
    if (targetUrl && !page.url().startsWith(targetUrl)) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
      await page.waitForTimeout(3000);
    }
    const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    const loginRequired = profile.loginTextPatterns.some((pattern) => new RegExp(pattern, "i").test(bodyText));
    return {
      ...(await summarizePage(page, site.id)),
      platform: site.platform,
      loginRequired,
      bodyText,
    };
  }

  await page.bringToFront().catch(() => undefined);
  await startStreaming(session, page);
  session.page = page;
  session.pageUrl = page.url();
  touch(session);

  return summarizePage(page, site.id);
}
