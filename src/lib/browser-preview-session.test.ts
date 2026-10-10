import { describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { runConfiguredCreatePost } from "./browser-preview-session";
import { getPublishDebugLog } from "./publish-debug";
import { getPublishProfile } from "./publish-profiles";

/**
 * The prefill half of the assisted publish (`runConfiguredCreatePost`, C2 of
 * `docs/creator-workflow-audit.md`).
 *
 * `drafted` is read as "the platform now holds a draft of this content" - the run panel says so to
 * the author, and the agent path decides what to tell them from it (`lib/agent/langgraph-engine.ts`)
 * - so it has to be a claim about the page rather than about having reached it. The case that
 * exposed the difference is 小红书: opening the platform through the 发布笔记 entry lands on
 * `/publish/publish?from=menu&target=video`, a page the profile's title and content selectors match
 * nothing on. The run still answered `drafted: true` while its own log said `title input: (none)`
 * and `content input: (none)`, so an empty prefill was indistinguishable from a real one and the
 * author was told to finish a page holding nothing.
 *
 * The fake page is the smallest one that can answer the two questions the prefill asks - which
 * selectors are showing, and what each of them accepts - so "the page took nothing" and "the page
 * took the title" are the test's own variables and nothing else is. Since C2-1a the run also answers
 * *per field* (`evidence`), which is what the smoke needed: "the draft was prepared" has to name the
 * parts the page took, and an image the page never accepted has to be visible as such rather than
 * hidden behind an editor that opened.
 */

/** 小红书's draft page, as the 发布笔记 entry opens it. */
const draftUrl = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video";

const title = "桌面收纳指南";
const text = "桌面收纳的三条原则。";

/** One run's log, joined - the fix has to be readable there, not only in the return value. */
const logLines = (scope: string) => getPublishDebugLog(scope).lines.join("\n");

/**
 * A page showing exactly `visible` and nothing else, recording every write it accepts.
 *
 * `innerText` answers `bodyText` for any selector, the way the login check and the publish check
 * use it; everything else about a selector - visibility, fills, clicks - is decided by whether that
 * exact string is in `visible`.
 */
function fakePage(options: { url: string; bodyText?: string; visible?: string[] }) {
  const current = { url: options.url };
  const visible = new Set(options.visible ?? []);
  const filled: { selector: string; value: string }[] = [];

  const page = {
    url: () => current.url,
    isClosed: () => false,
    goto: async (next: string) => {
      current.url = next;
    },
    waitForTimeout: async () => undefined,
    // `debugScreenshot` is a no-op unless publish debug logging is switched on in the environment.
    screenshot: async () => undefined,
    keyboard: { insertText: async (value: string) => filled.push({ selector: "(keyboard)", value }) },
    locator(selector: string) {
      const api = {
        first: () => api,
        isVisible: async () => visible.has(selector),
        click: async () => undefined,
        fill: async (value: string) => {
          filled.push({ selector, value });
        },
        count: async () => (visible.has(selector) ? 1 : 0),
        setInputFiles: async () => undefined,
        innerText: async () => options.bodyText ?? "",
      };
      return api;
    },
  };

  return { page: page as unknown as Page, filled };
}

describe("runConfiguredCreatePost prefill", () => {
  it("reports drafted=false when the platform page took neither field", async () => {
    const profile = await getPublishProfile("小红书");
    const { page, filled } = fakePage({ url: draftUrl });

    const result = await runConfiguredCreatePost(page, profile, { title, text }, "c2-prefill-none");

    expect(result).toMatchObject({ drafted: false, published: false, url: draftUrl });
    // C2-1a: the answer names which part of the draft the page refused, so the panel can show the
    // author their draft's own gap instead of an editor with everything missing from it.
    expect(result).toMatchObject({ evidence: { title: "empty", text: "empty", media: "not_offered" } });
    expect(filled).toHaveLength(0);
    // The two lines the smoke run showed, as assertions instead of a log to read by hand - and the
    // answer they add up to.
    expect(logLines("c2-prefill-none")).toContain("title input: (none)");
    expect(logLines("c2-prefill-none")).toContain("content input: (none)");
    expect(logLines("c2-prefill-none")).toContain("no field took the content: reporting drafted=false");
    expect(logLines("c2-prefill-none")).toContain("draft evidence: title=empty text=empty media=not_offered");
  });

  it("keeps drafted=true when the page took the title, and says which field it took", async () => {
    const profile = await getPublishProfile("小红书");
    const titleSelector = profile.titleSelectors[0];
    const { page, filled } = fakePage({ url: draftUrl, visible: [titleSelector] });

    const result = await runConfiguredCreatePost(page, profile, { title, text }, "c2-prefill-title");

    expect(result.drafted).toBe(true);
    expect(result).toMatchObject({ evidence: { title: "filled", text: "empty" } });
    expect(filled).toEqual([{ selector: titleSelector, value: title }]);
    expect(logLines("c2-prefill-title")).toContain(`title input: ${titleSelector}`);
    // The field the page did not take is still reported as missing: `drafted` says whether anything
    // happened, `evidence` says which half of the prefill it was.
    expect(logLines("c2-prefill-title")).toContain("content input: (none)");
  });

  it("keeps drafted=true for a run that had no title or text to prefill", async () => {
    // A run with nothing to hand over: every part is `not_offered`, so the page cannot be said to
    // have taken nothing and the answer stays what it always was. The fix is about what the page did
    // with content it was offered, not about what a run without content means (C2-1a).
    const profile = await getPublishProfile("小红书");
    const { page } = fakePage({ url: draftUrl });

    const result = await runConfiguredCreatePost(page, profile, {}, "c2-prefill-media-only");

    expect(result).toMatchObject({ drafted: true, published: false, url: draftUrl });
    expect(result).toMatchObject({ evidence: { title: "not_offered", text: "not_offered", media: "not_offered" } });
  });

  it("reports the media as empty when the page kept the image", async () => {
    // The case the old `wantedFields === 0` rule could not see. An image-only draft had no title and
    // no text to fill, so `drafted` stayed true however the page answered the upload: the author was
    // sent to an editor without their image in it, and nothing anywhere said the upload was lost.
    const profile = await getPublishProfile("小红书");
    const { page } = fakePage({ url: draftUrl });

    const result = await runConfiguredCreatePost(
      page,
      profile,
      { imagePath: "C:/library/cover.png" },
      "c2-prefill-image-refused",
    );

    expect(result).toMatchObject({
      drafted: false,
      evidence: { title: "not_offered", text: "not_offered", media: "empty" },
    });
    expect(logLines("c2-prefill-image-refused")).toContain("image upload: (no file input) - nothing uploaded");
  });

  it("reports the media as filled once the page has taken the video", async () => {
    // The positive side of the same rule. The profile is overridden rather than taken from the
    // platform's list: what is being pinned is the run's answer about a page that accepted the file,
    // not 小红书's selectors (those live in `publish-profiles`).
    const profile = {
      ...(await getPublishProfile("小红书")),
      videoTabSelectors: [],
      videoInputSelectors: ['input[type="file"][accept*="video"]'],
    };
    const { page } = fakePage({ url: draftUrl, visible: profile.videoInputSelectors });

    const result = await runConfiguredCreatePost(page, profile, { videoPath: "C:/library/clip.mp4" }, "c2-prefill-video");

    expect(result).toMatchObject({
      drafted: true,
      evidence: { title: "not_offered", text: "not_offered", media: "filled" },
    });
  });
});
