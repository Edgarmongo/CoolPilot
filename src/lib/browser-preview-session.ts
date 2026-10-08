import path from "node:path";
import type { BrowserContext, CDPSession, Locator, Page } from "playwright-core";
import { launchSiteProfileContext } from "./browser";
import {
  applySessionError,
  DEFAULT_SITE_URL,
  getOpenPages,
  isBlankBrowserUrl,
  latestNonBlankPage,
  markClosed,
  now,
  PREVIEW_SIZE,
  touch,
  toSnapshot,
  type BrowserPreviewSession,
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
    await page.goto(options.siteUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
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
  bindContextLifecycle(session, context, site);

  const page = await pickSessionPage(session);
  bindPageLifecycle(session, page, site);
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
 * Reads the live session page to decide whether an assisted publish has landed:
 * the page left the editor URL, or a success confirmation is visible.
 */
export async function checkPublishResult(accountId: string): Promise<{ published: boolean; url: string }> {
  const page = activeSessionPage(accountId);
  if (!page) return { published: false, url: "" };
  const url = page.url();
  if (url && !looksLikeEditorUrl(url)) {
    return { published: true, url };
  }
  const bodyText = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
  if (publishSuccessPattern.test(bodyText)) {
    return { published: true, url };
  }
  return { published: false, url };
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
  if (text) {
    const bodyInput = await firstVisibleLocator(page, [
      'div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea',
    ]);
    if (bodyInput) {
      await bodyInput
        .fill(text, { timeout: 15_000 })
        .catch(async () => {
          await bodyInput.click({ timeout: 10_000 });
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
    return { url: page.url(), drafted: true, published: false, title, text };
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

// Specific success phrases — intentionally narrow so a "Publish" button label
// elsewhere on the page does not read as success.
const publishSuccessPattern =
  /发布成功|发表成功|发布完成|已发布成功|Published successfully|successfully published|Your (?:post|article) (?:was|has been) (?:published|posted)/i;

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

async function runConfiguredCreatePost(
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

  if (videoPath) {
    // Upload first: most platforms only unlock the title/description fields once
    // the video has been picked up.
    log.step("uploading video");
    await uploadVideoToComposer(page, profile, videoPath);
  }

  if (title) {
    const picked = await pickVisible(page, profile.titleSelectors);
    log.step(`title input: ${picked.selector || "(none)"}`);
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
      await page.waitForTimeout(8000);
    }
  }

  if (!publish) {
    await debugScreenshot(page, scope, "draft-prefilled", log);
    log.step(`prefilled draft (no publish click) url=${page.url()}`);
    return { url: page.url(), drafted: true, published: false, title, text };
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
