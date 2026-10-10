import { describe, expect, it } from "vitest";
import { genericProfile } from "./publish-profiles";
import { truncateThreadsPost } from "./post-format";
import {
  adaptContentToPlatform,
  buildPlatformContentProfile,
  buildPlatformContentVersionPayload,
  findPlatformContentVersion,
  formatPlatformField,
  isKnownPlatform,
  isPlatformContentVersionStale,
  listPlatformContentProfiles,
  platformVersionsMetadataKey,
  readPlatformContentVersions,
  removePlatformContentVersion,
  truncateForLimit,
  upsertPlatformContentVersion,
} from "./platform-content";
import { accountPlatforms, type ContentItem, type PlatformContentVersion } from "./types";

/**
 * CI-P2-05-01 … -07: the adapter that turns one base content item into per-platform versions.
 *
 * The rules this file pins, and why each one is worth a test:
 *
 *  - the base item is untouched by adapting it, and a version keeps its own text (A1: two objects);
 *  - every per-platform fact is read off the publish profile fields the publish path actually
 *    consults (`newPostSelectors`, `publishPageUrl`, `titleSelectors`, `contentSelectors`,
 *    `videoTabSelectors`, `videoInputSelectors`) - the adapter claims no more than that;
 *  - CoolPilot's only enforced text budget (Threads) is priced from `truncateThreadsPost`'s own
 *    constant, and an adapted Threads body is character-for-character what that formatter sends;
 *  - **no other limit exists**: every other platform's `textLimit`/`titleLimit` is `null`, because a
 *    limit CoolPilot does not enforce is unknown and must not be invented (P2-05-06);
 *  - Threads takes no title at all, so its version is titleless with the note saying why;
 *  - versions live in the item's own metadata, are read tolerantly, and a write never drops an entry
 *    this build could not read or any other metadata key;
 *  - staleness follows the base *text*, not the row's `updatedAt` (every metadata write bumps it).
 *
 * Saturday, 10 October 2026, 09:00 local.
 */
const NOW = new Date(2026, 9, 10, 9, 0, 0).getTime();

function content(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-1",
    title: "桌面收纳指南",
    body: "<p>正文</p>",
    postReadyText: "正文",
    sourceUrls: [],
    imagePath: "cover.png",
    metadata: { type: "article", images: ["cover.png"] },
    status: "ready",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("platform content profiles", () => {
  it("reads each platform's composer entry, fields and video route off its publish profile", () => {
    // 小红书's entry names its own 发布笔记 button: the path navigates and clicks it.
    expect(buildPlatformContentProfile("小红书")).toMatchObject({
      composerEntry: "new-post",
      supported: true,
      titleField: true,
      bodyField: true,
      // ... and lists a 视频 tab, which `uploadVideoToComposer` clicks before the file input.
      videoRoute: "video-tab-then-input",
    });
    // 知乎 goes straight to its editor URL and has no new-post button to click.
    expect(buildPlatformContentProfile("知乎")).toMatchObject({
      composerEntry: "direct-url",
      supported: true,
      titleField: true,
      bodyField: true,
      videoRoute: "file-input",
    });
    // 抖音 goes straight to the uploader URL.
    expect(buildPlatformContentProfile("抖音")).toMatchObject({
      composerEntry: "direct-url",
      videoRoute: "file-input",
    });
    // WordPress has no platform-specific publish profile: the shared generic fallback serves it, and
    // that fallback lists a video tab (clicked only when present) plus a file input.
    expect(buildPlatformContentProfile("WordPress")).toMatchObject({
      composerEntry: "generic",
      supported: false,
      titleField: true,
      bodyField: true,
      videoRoute: "video-tab-then-input",
    });
  });

  it("takes the third video route, and no more, from a profile that lists no video input", () => {
    // No built-in entry does this today; the adapter still has to answer honestly rather than carry a
    // video the page would never receive.
    const noVideoInput = buildPlatformContentProfile("抖音", { ...genericProfile, videoInputSelectors: [] });
    expect(noVideoInput.videoRoute).toBe("not-supported");

    // `null` means "no platform-specific entry", not "the generic profile": the two are not the same.
    expect(buildPlatformContentProfile("WordPress", null)).toMatchObject({
      supported: false,
      composerEntry: "generic",
    });
  });

  it("offers exactly the platforms CoolPilot has accounts for", () => {
    const profiles = listPlatformContentProfiles();
    expect(profiles.map((profile) => profile.platform)).toEqual([...accountPlatforms]);
    for (const platform of accountPlatforms) {
      const profile = buildPlatformContentProfile(platform);
      // Derivation, not duplication: every platform *with* a profile must not read as generic.
      expect(profile.supported).toBe(profile.composerEntry !== "generic");
      expect(isKnownPlatform(platform)).toBe(true);
    }
    expect(isKnownPlatform("微博客")).toBe(false);
  });

  it("invents no limit: Threads is the only platform CoolPilot trims text for", () => {
    const limited = listPlatformContentProfiles().filter((profile) => profile.textLimit !== null);
    expect(limited.map((profile) => profile.platform)).toEqual(["Threads"]);
    // The title dimension exists but nobody enforces it, so no number is written down for it.
    expect(listPlatformContentProfiles().every((profile) => profile.titleLimit === null)).toBe(true);
    // Every platform but Threads is offered a title field.
    expect(listPlatformContentProfiles().filter((profile) => !profile.titleField).map((p) => p.platform)).toEqual([
      "Threads",
    ]);
  });
});

describe("adaptContentToPlatform", () => {
  it("keeps the base item out of the rendition, and reads its text from postReadyText", () => {
    const base = content();
    const { version } = adaptContentToPlatform({ content: base, platform: "知乎", now: NOW });

    expect(version.body).toBe("正文");
    expect(version.title).toBe("桌面收纳指南");
    expect(version.source).toBe("derived");
    expect(version.createdAt).toBe(NOW);
    expect(version.updatedAt).toBe(NOW);
    // The base is not rewritten by adapting it (A1: the product is a separate object).
    expect(base.postReadyText).toBe("正文");
    expect(base.metadata).toEqual({ type: "article", images: ["cover.png"] });
  });

  it("walks the base fields through the same normalizer the publish path uses", () => {
    const { version, profile } = adaptContentToPlatform({
      content: content({ title: "  标题  ", postReadyText: "第一行\r\n\n\n\n第二行" }),
      platform: "知乎",
      now: NOW,
    });

    expect(profile.textLimit).toBe(null);
    expect(version.title).toBe("标题");
    expect(version.body).toBe("第一行\n\n第二行");
    // Normalizing is reported, not silent - and with no budget there is nothing to truncate.
    expect(version.adaptations).toEqual([{ code: "title-normalized" }, { code: "text-normalized" }]);
  });

  it("prices the Threads budget from the Threads formatter itself", () => {
    const long = "推".repeat(600);
    const { version, profile } = adaptContentToPlatform({
      content: content({ title: "", postReadyText: long, body: long }),
      platform: "Threads",
      now: NOW,
    });

    // Character-for-character what the Threads publish path sends: the formatter's budget minus the
    // trailing space it reserves for the composer.
    expect(version.body).toBe(truncateThreadsPost(long).trimEnd());
    expect(version.body.length).toBe(profile.textLimit);
    expect(version.body.endsWith("...")).toBe(true);
    expect(version.adaptations).toEqual([
      { code: "text-truncated", limit: profile.textLimit, originalLength: long.length },
    ]);
  });

  it("leaves a Threads post that fits exactly as the formatter leaves it", () => {
    const { version } = adaptContentToPlatform({
      content: content({ title: "", postReadyText: "很短的推文" }),
      platform: "Threads",
      now: NOW,
    });

    expect(version.body).toBe("很短的推文");
    expect(version.adaptations).toEqual([]);
  });

  it("drops a title on the one platform that is offered none, and says so", () => {
    // Threads' profile has `titleSelectors: []` and its dedicated flow fills no title either, so the
    // version does not pretend the title went anywhere.
    const threads = adaptContentToPlatform({ content: content(), platform: "Threads", now: NOW }).version;
    expect(threads.title).toBe("");
    expect(threads.adaptations).toEqual([{ code: "title-not-offered" }]);

    // A base with no title loses nothing, so there is nothing to report.
    const untitled = adaptContentToPlatform({
      content: content({ title: "   " }),
      platform: "Threads",
      now: NOW,
    }).version;
    expect(untitled.title).toBe("");
    expect(untitled.adaptations).toEqual([]);
  });

  it("hands the version the media the platform's publish path can actually take", () => {
    const withVideo = content({ metadata: { type: "video", images: ["cover.png"], videoPath: "clip.mp4" } });

    // The path uploads a video whenever the profile has a file input for it, and the cover with it.
    for (const platform of ["抖音", "知乎", "小红书"]) {
      const version = adaptContentToPlatform({ content: withVideo, platform, now: NOW }).version;
      expect({ platform, video: version.videoPath, image: version.imagePath }).toEqual({
        platform,
        video: "clip.mp4",
        image: "cover.png",
      });
      expect(version.adaptations).toEqual([]);
    }

    // A profile with no video input is the one case where the video does not travel: the publish path
    // would throw rather than upload it, so the version records what happened to it.
    const noVideoInput = { ...buildPlatformContentProfile("抖音"), videoRoute: "not-supported" as const };
    const dropped = adaptContentToPlatform({ content: withVideo, platform: "抖音", profile: noVideoInput, now: NOW });
    expect(dropped.version.videoPath).toBe("");
    expect(dropped.version.imagePath).toBe("cover.png");
    expect(dropped.version.adaptations).toEqual([{ code: "media-not-included" }]);
  });

  it("falls back to the stored image list when the cover column is empty", () => {
    const { version } = adaptContentToPlatform({
      content: content({ imagePath: "", metadata: { type: "article", images: ["a.png", "b.png"] } }),
      platform: "知乎",
      now: NOW,
    });

    expect(version.imagePath).toBe("a.png");
  });

  it("applies a title budget and a missing body field when a profile declares one", () => {
    // No built-in entry sets either today (no title budget exists, and every profile has content
    // selectors), which is exactly why the branches are pinned through an explicit profile.
    const budgeted = { ...buildPlatformContentProfile("知乎"), titleLimit: 5 };
    const titled = formatPlatformField({ profile: budgeted, field: "title", text: "桌面收纳指南" });
    expect(titled).toEqual({
      text: "桌面...",
      adaptations: [{ code: "title-truncated", limit: 5, originalLength: 6 }],
    });

    const bodyless = { ...buildPlatformContentProfile("抖音"), bodyField: false };
    const bodied = formatPlatformField({ profile: bodyless, field: "text", text: "正文" });
    expect(bodied).toEqual({ text: "", adaptations: [{ code: "text-not-offered" }] });
  });
});

describe("truncateForLimit", () => {
  it("keeps the result inside the budget and says when it cut", () => {
    expect(truncateForLimit("abc", 3)).toEqual({ text: "abc", truncated: false });
    expect(truncateForLimit("abcd", 3)).toEqual({ text: "...", truncated: true });
    expect(truncateForLimit("abcdef", 5)).toEqual({ text: "ab...", truncated: true });
    // A budget that cannot even hold the ellipsis is not applied rather than producing a wrong cut.
    expect(truncateForLimit("abcdef", 0)).toEqual({ text: "abcdef", truncated: false });
    expect(truncateForLimit("abcdef", Number.NaN)).toEqual({ text: "abcdef", truncated: false });
  });
});

describe("stored platform versions", () => {
  const version = (overrides: Partial<PlatformContentVersion> = {}): PlatformContentVersion => ({
    platform: "知乎",
    title: "标题",
    body: "正文",
    imagePath: "cover.png",
    videoPath: "",
    source: "derived",
    adaptations: [],
    baseFingerprint: "v1:1:00000000",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  it("round-trips a version through the item's own metadata", () => {
    const metadata = upsertPlatformContentVersion({ type: "article" }, version());

    expect(readPlatformContentVersions(metadata).versions).toEqual([version()]);
    expect(findPlatformContentVersion(metadata, "知乎")).toEqual(version());
    expect(findPlatformContentVersion(metadata, "抖音")).toBe(null);
  });

  it("reads tolerantly: junk entries are counted, never thrown on, never lost", () => {
    const metadata = {
      type: "article",
      [platformVersionsMetadataKey]: {
        知乎: version(),
        抖音: "手写的垃圾",
        Facebook: { platform: "Facebook", title: "缺字段" },
      },
    };

    const read = readPlatformContentVersions(metadata);
    expect(read.versions.map((entry) => entry.platform)).toEqual(["知乎"]);
    expect(read.unreadable).toBe(2);

    // A write keeps what this build cannot read, and every other metadata key with it.
    const afterWrite = upsertPlatformContentVersion(metadata, version({ platform: "小红书", body: "新" }));
    const store = afterWrite[platformVersionsMetadataKey] as Record<string, unknown>;
    // (`Object.keys().sort()` is UTF-16 order, so the Latin entry sorts before the CJK ones.)
    expect(Object.keys(store).sort()).toEqual(["Facebook", "小红书", "抖音", "知乎"]);
    expect(store["抖音"]).toBe("手写的垃圾");
    expect(afterWrite.type).toBe("article");
  });

  it("survives metadata that is not the shape it expects", () => {
    expect(readPlatformContentVersions(undefined)).toEqual({ versions: [], unreadable: 0 });
    expect(readPlatformContentVersions({})).toEqual({ versions: [], unreadable: 0 });
    expect(readPlatformContentVersions({ [platformVersionsMetadataKey]: ["知乎"] })).toEqual({
      versions: [],
      unreadable: 0,
    });
    expect(readPlatformContentVersions({ [platformVersionsMetadataKey]: "知乎" })).toEqual({
      versions: [],
      unreadable: 0,
    });
  });

  it("removes one platform and leaves the rest alone", () => {
    const metadata = upsertPlatformContentVersion(
      upsertPlatformContentVersion({}, version()),
      version({ platform: "抖音", videoPath: "clip.mp4" }),
    );

    const afterRemove = removePlatformContentVersion(metadata, "知乎");
    expect(readPlatformContentVersions(afterRemove).versions.map((entry) => entry.platform)).toEqual(["抖音"]);
    expect(readPlatformContentVersions(metadata).versions).toHaveLength(2);
    // Removing what is not there is a no-op, not an error.
    expect(readPlatformContentVersions(removePlatformContentVersion(afterRemove, "知乎")).versions).toHaveLength(1);
  });

  it("calls a version stale only when the base text moved on", () => {
    const base = content();
    const collected = adaptContentToPlatform({ content: base, platform: "知乎", now: NOW }).version;

    expect(isPlatformContentVersionStale(collected, base)).toBe(false);
    expect(isPlatformContentVersionStale(collected, content({ title: "新标题" }))).toBe(true);
    expect(isPlatformContentVersionStale(collected, content({ postReadyText: "改过的正文" }))).toBe(true);

    // The row's `updatedAt` is bumped by every metadata write, adaptations included - so storing an
    // image list or the version itself must not read as "the author changed the text" (this is why
    // ancestry is a fingerprint of the base text and not a timestamp).
    expect(isPlatformContentVersionStale(collected, content({ updatedAt: NOW + 60_000 }))).toBe(false);
    expect(isPlatformContentVersionStale(collected, content({ imagePath: "other.png" }))).toBe(false);
  });
});

describe("buildPlatformContentVersionPayload", () => {
  it("answers the base, every adapter and the saved versions", () => {
    const base = content({
      metadata: {
        type: "video",
        images: ["cover.png"],
        videoPath: "clip.mp4",
        [platformVersionsMetadataKey]: {},
      },
    });
    const payload = buildPlatformContentVersionPayload(base);
    expect(payload).toMatchObject({
      contentItemId: "item-1",
      base: {
        title: "桌面收纳指南",
        postReadyText: "正文",
        imagePath: "cover.png",
        images: ["cover.png"],
        videoPath: "clip.mp4",
        updatedAt: NOW,
      },
      versions: [],
      unreadable: 0,
    });
    expect(payload.profiles).toHaveLength(accountPlatforms.length);

    const withVersions = upsertPlatformContentVersion(
      base.metadata,
      adaptContentToPlatform({ content: base, platform: "抖音", now: NOW }).version,
    );
    const second = buildPlatformContentVersionPayload({ ...base, metadata: withVersions });
    expect(second.base.fingerprint).not.toBe("");
    expect(isPlatformContentVersionStale(second.versions[0], second.base)).toBe(false);
  });
});


