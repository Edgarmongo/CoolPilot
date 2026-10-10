import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api-client";
import { localeResources } from "@/lib/locale-resources";
import {
  platformAdaptationLabelKeys,
  platformAdaptationMessage,
  platformComposerEntryLabelKeys,
  platformFieldLabelKey,
  platformTextLimitMessage,
  platformTitleLimitMessage,
  platformVersionCounts,
  platformVersionDeriveTargets,
  platformVersionDraft,
  platformVersionDraftIssueKey,
  platformVersionErrorKey,
  platformVersionProfile,
  platformVersionSourceClass,
  platformVersionSourceLabelKeys,
  platformVersionStale,
  platformVideoRouteLabelKeys,
  versionTitleOffered,
  versionVideoIncluded,
} from "./platform-version-view";
import {
  platformComposerEntries,
  platformContentAdaptationCodes,
  platformContentVersionSources,
  platformVideoRoutes,
  type PlatformContentProfile,
  type PlatformContentVersion,
  type PlatformContentVersionPayload,
} from "./types";

/**
 * CI-P2-07's testable half. The view component cannot be exercised in this repository (no DOM test
 * setup - see `platform-version-view.ts`), so every decision a click has to make lives as a function
 * here and is pinned here. The rendered half is covered by `platform-versions-render.test.ts` (static
 * markup only) and the HTTP contract by the existing route tests.
 */

function profile(overrides: Partial<PlatformContentProfile> & { platform: string }): PlatformContentProfile {
  return {
    supported: true,
    composerEntry: "new-post",
    titleField: true,
    bodyField: true,
    videoRoute: "file-input",
    textLimit: null,
    titleLimit: null,
    ...overrides,
  };
}

function version(overrides: Partial<PlatformContentVersion> = {}): PlatformContentVersion {
  return {
    platform: "小红书",
    title: "标题",
    body: "正文",
    imagePath: "cover.png",
    videoPath: "",
    source: "derived",
    adaptations: [],
    baseFingerprint: "fp-1",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function payload(overrides: Partial<PlatformContentVersionPayload> = {}): PlatformContentVersionPayload {
  return {
    contentItemId: "c1",
    base: {
      title: "基线标题",
      body: "基线正文",
      postReadyText: "",
      imagePath: "",
      images: [],
      videoPath: "",
      fingerprint: "fp-1",
      updatedAt: 2,
    },
    profiles: [],
    versions: [],
    unreadable: 0,
    ...overrides,
  };
}

describe("platform version labels", () => {
  it("labels every stored enum value, so a new one cannot ship unlabelled", () => {
    for (const source of platformContentVersionSources) expect(platformVersionSourceLabelKeys[source]).toBeTruthy();
    for (const code of platformContentAdaptationCodes) expect(platformAdaptationLabelKeys[code]).toBeTruthy();
    for (const entry of platformComposerEntries) expect(platformComposerEntryLabelKeys[entry]).toBeTruthy();
    for (const route of platformVideoRoutes) expect(platformVideoRouteLabelKeys[route]).toBeTruthy();
  });

  it("gives the two sources different chips: an edited version is not what the adapter made", () => {
    expect(platformVersionSourceLabelKeys.derived).not.toBe(platformVersionSourceLabelKeys.edited);
    expect(platformVersionSourceClass.derived).not.toBe(platformVersionSourceClass.edited);
  });

  it("prints the adapter's numbers for a recorded truncation", () => {
    expect(
      platformAdaptationMessage({ code: "text-truncated", limit: 449, originalLength: 900 }),
    ).toEqual({ key: "pvAdaptTextTruncated", values: { limit: 449, original: 900 } });
    expect(
      platformAdaptationMessage({ code: "title-truncated", limit: 30, originalLength: 80 }),
    ).toEqual({ key: "pvAdaptTitleTruncated", values: { limit: 30, original: 80 } });
  });

  it("says the note is unrecorded rather than printing a placeholder", () => {
    // A hand-edited entry can carry the code without the numbers; `{limit}` must never reach the page.
    const message = platformAdaptationMessage({ code: "text-truncated" });
    expect(message).toEqual({ key: "pvAdaptTextTruncatedUnrecorded" });
    expect(message.values).toBeUndefined();
    expect(platformAdaptationMessage({ code: "title-truncated", limit: 30 })).toEqual({
      key: "pvAdaptTitleTruncatedUnrecorded",
    });
  });

  it("maps the value-less codes straight through", () => {
    expect(platformAdaptationMessage({ code: "media-not-included" })).toEqual({ key: "pvAdaptMediaNotIncluded" });
    expect(platformAdaptationMessage({ code: "title-not-offered" })).toEqual({ key: "pvAdaptTitleNotOffered" });
  });
});

describe("platform version state", () => {
  it("reports staleness by fingerprint, not by timestamp", () => {
    expect(platformVersionStale(version({ baseFingerprint: "fp-1" }), "fp-1")).toBe(false);
    expect(platformVersionStale(version({ baseFingerprint: "fp-1" }), "fp-2")).toBe(true);
    // `updatedAt` moves on every metadata write, so an equal-looking pair still compares fingerprints.
    expect(platformVersionStale(version({ baseFingerprint: "fp-2", updatedAt: 2 }), "fp-1")).toBe(true);
  });

  it("reads the title/video facts from the version's own notes", () => {
    // `title === ""` is not the signal: a hand-written version may also be empty.
    expect(versionTitleOffered(version({ title: "", adaptations: [] }))).toBe(true);
    expect(versionTitleOffered(version({ title: "", adaptations: [{ code: "title-not-offered" }] }))).toBe(false);
    expect(versionVideoIncluded(version({ adaptations: [] }))).toBe(true);
    expect(versionVideoIncluded(version({ adaptations: [{ code: "media-not-included" }] }))).toBe(false);
  });

  it("offers only the platforms without a version as derive targets", () => {
    const profiles = [
      profile({ platform: "小红书" }),
      profile({ platform: "Threads" }),
      profile({ platform: "知乎" }),
    ];
    expect(
      platformVersionDeriveTargets(profiles, [version({ platform: "小红书" })]).map((entry) => entry.platform),
    ).toEqual(["Threads", "知乎"]);
    expect(platformVersionDeriveTargets(profiles, [])).toHaveLength(3);
    expect(
      platformVersionDeriveTargets(
        profiles,
        profiles.map((entry) => version({ platform: entry.platform })),
      ),
    ).toEqual([]);
  });
});

describe("platform adapter facts", () => {
  it("reports a real budget when this layer enforces one", () => {
    // Threads is the only platform `post-format.ts` constrains today.
    expect(platformTextLimitMessage(profile({ platform: "Threads", textLimit: 449 }))).toEqual({
      key: "pvTextLimit",
      values: { limit: 449 },
    });
  });

  it("never turns a null budget into a platform claim", () => {
    // `null` means "this layer does not limit the field", not "the platform allows unlimited text".
    expect(platformTextLimitMessage(profile({ platform: "知乎", textLimit: null }))).toEqual({
      key: "pvTextLimitNone",
    });
    expect(platformTitleLimitMessage(profile({ platform: "知乎", titleLimit: null }))).toEqual({
      key: "pvTitleLimitNone",
    });
    expect(platformTitleLimitMessage(profile({ platform: "知乎", titleLimit: 30 }))).toEqual({
      key: "pvTitleLimit",
      values: { limit: 30 },
    });
  });

  it("says whether a field is filled rather than showing a bare boolean", () => {
    expect(platformFieldLabelKey(true)).toBe("pvFieldFilled");
    expect(platformFieldLabelKey(false)).toBe("pvFieldNotFilled");
  });
});

describe("platform version editor", () => {
  it("opens the editor on the stored text", () => {
    const stored = version({ title: "存稿标题", body: "存稿正文" });
    expect(platformVersionDraft(stored)).toEqual({ title: "存稿标题", body: "存稿正文" });
  });

  it("refuses only an all-empty draft", () => {
    expect(platformVersionDraftIssueKey({ title: "", body: "" })).toBe("pvNeedContent");
    expect(platformVersionDraftIssueKey({ title: "   ", body: "\n" })).toBe("pvNeedContent");
    expect(platformVersionDraftIssueKey({ title: "只有标题", body: "" })).toBeNull();
    expect(platformVersionDraftIssueKey({ title: "", body: "只有正文" })).toBeNull();
  });

  it("maps an API failure to the route's own error code", () => {
    expect(platformVersionErrorKey(new ApiClientError({ code: "NOT_FOUND", message: "内容不存在" }))).toBe(
      "error_NOT_FOUND",
    );
    expect(platformVersionErrorKey(new ApiClientError({ code: "INVALID_PAYLOAD", message: "bad" }))).toBe(
      "error_INVALID_PAYLOAD",
    );
  });

  it("falls back instead of inventing a translation", () => {
    expect(platformVersionErrorKey(new Error("boom"))).toBe("pvActionFailed");
    expect(platformVersionErrorKey(new Error("boom"), "pvLoadFailed")).toBe("pvLoadFailed");
    // An error with no code is not an API error, so it never becomes `error_undefined`.
    expect(platformVersionErrorKey(new ApiClientError({ message: "no code" }))).toBe("pvActionFailed");
  });

  it("uses only keys the dictionaries actually define", () => {
    const keys = [
      platformVersionErrorKey(new ApiClientError({ code: "NOT_FOUND", message: "x" })),
      platformVersionErrorKey(new Error("x")),
      platformVersionDraftIssueKey({ title: "", body: "" }) as "pvNeedContent",
      platformAdaptationMessage({ code: "text-truncated" }).key,
      platformTextLimitMessage(profile({ platform: "Threads", textLimit: 449 })).key,
      platformTitleLimitMessage(profile({ platform: "Threads" })).key,
    ];
    for (const dictionary of Object.values(localeResources)) {
      for (const key of keys) expect(dictionary[key].length).toBeGreaterThan(0);
    }
  });
});

describe("platform version payload view", () => {
  it("counts the versions and the unreadable entries separately", () => {
    // The unreadable count is what keeps a hand-edited entry from disappearing silently.
    expect(
      platformVersionCounts(
        payload({ versions: [version(), version({ platform: "知乎" })], unreadable: 2 }),
      ),
    ).toEqual({ count: 2, unreadable: 2 });
    expect(platformVersionCounts(payload())).toEqual({ count: 0, unreadable: 0 });
  });

  it("finds a platform's profile, and admits when it is gone", () => {
    const withProfiles = payload({ profiles: [profile({ platform: "小红书" })] });
    expect(platformVersionProfile(withProfiles, "小红书")?.platform).toBe("小红书");
    expect(platformVersionProfile(withProfiles, "知乎")).toBeNull();
  });
});
