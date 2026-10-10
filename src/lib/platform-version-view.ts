import { apiErrorTranslationKey } from "@/lib/api-client";
import type { TranslationKey } from "@/lib/locale-resources";
import type {
  PlatformComposerEntry,
  PlatformContentAdaptation,
  PlatformContentAdaptationCode,
  PlatformContentProfile,
  PlatformContentVersion,
  PlatformContentVersionPayload,
  PlatformContentVersionSource,
  PlatformVideoRoute,
} from "@/lib/types";

/**
 * 多平台内容版本管理 UI (CI-P2-07) - the pure part of the view.
 *
 * Why this file exists at all: the repository has **no DOM test setup** (`vitest.config.ts` is
 * `environment: "node"` and only collects `src/**\/*.test.ts`), so component interaction cannot be
 * tested here. Everything a user's click has to decide - which label a stored fact maps to, whether a
 * version is stale, whether a draft may be saved, which platforms can still be derived, which
 * translation an API error belongs to - is therefore kept out of the component and tested as a plain
 * function (`platform-version-view.test.ts`, node environment).
 *
 * Three rules this module keeps, matching the model it reads (CI-P2-05):
 *
 *  - **No invented platform facts.** A `null` limit is reported as "this layer enforces no budget",
 *    never as a platform's own limit; the module only translates the numbers
 *    `PlatformContentProfile` already carries.
 *  - **A version states what this layer did, not what a platform did** (`source`, `adaptations`), and
 *    staleness is a plain fingerprint comparison - nothing here refreshes a version.
 *  - **No publish semantics.** Nothing in this module reads or writes a status, a record or a plan.
 */

/** One render-ready message: a dictionary key plus its interpolation values (the shape `t()` takes). */
export type PlatformVersionMessage = {
  key: TranslationKey;
  values?: Record<string, string | number>;
};

/** `derived` = produced by the adapter; `edited` = the author changed it by hand. */
export const platformVersionSourceLabelKeys: Record<PlatformContentVersionSource, TranslationKey> = {
  derived: "pvSourceDerived",
  edited: "pvSourceEdited",
};

/** The two sources read differently on purpose: an edited version is no longer what the adapter made. */
export const platformVersionSourceClass: Record<PlatformContentVersionSource, string> = {
  derived: "bg-sky-100 text-sky-700",
  edited: "bg-violet-100 text-violet-700",
};

export const platformAdaptationLabelKeys: Record<PlatformContentAdaptationCode, TranslationKey> = {
  "text-normalized": "pvAdaptTextNormalized",
  "text-truncated": "pvAdaptTextTruncated",
  "text-not-offered": "pvAdaptTextNotOffered",
  "title-normalized": "pvAdaptTitleNormalized",
  "title-truncated": "pvAdaptTitleTruncated",
  "title-not-offered": "pvAdaptTitleNotOffered",
  "media-not-included": "pvAdaptMediaNotIncluded",
};

export const platformComposerEntryLabelKeys: Record<PlatformComposerEntry, TranslationKey> = {
  "new-post": "pvComposerEntryNewPost",
  "direct-url": "pvComposerEntryDirectUrl",
  generic: "pvComposerEntryGeneric",
};

export const platformVideoRouteLabelKeys: Record<PlatformVideoRoute, TranslationKey> = {
  "video-tab-then-input": "pvVideoRouteTabThenInput",
  "file-input": "pvVideoRouteFileInput",
  "not-supported": "pvVideoRouteNotSupported",
};

/**
 * The label for one adaptation note. Truncation is the only code that carries numbers, and a stored
 * note that lost them (hand-edited JSON) says so instead of printing `{limit}` into the page.
 */
export function platformAdaptationMessage(adaptation: PlatformContentAdaptation): PlatformVersionMessage {
  const { limit, originalLength } = adaptation;
  if (adaptation.code === "text-truncated" || adaptation.code === "title-truncated") {
    if (typeof limit === "number" && typeof originalLength === "number") {
      return {
        key: adaptation.code === "text-truncated" ? "pvAdaptTextTruncated" : "pvAdaptTitleTruncated",
        values: { limit, original: originalLength },
      };
    }
    return {
      key: adaptation.code === "text-truncated" ? "pvAdaptTextTruncatedUnrecorded" : "pvAdaptTitleTruncatedUnrecorded",
    };
  }
  return { key: platformAdaptationLabelKeys[adaptation.code] };
}

/**
 * Whether the base moved on after this version was taken. Compared the way the model compares it -
 * fingerprint against fingerprint - so the UI reports exactly what `GET` answers and never a guess
 * based on `updatedAt` (which any metadata write bumps).
 */
export function platformVersionStale(version: PlatformContentVersion, baseFingerprint: string) {
  return version.baseFingerprint !== baseFingerprint;
}

/**
 * Whether the publish path fills a title on this platform. Read from the version's own notes rather
 * than from `title === ""`, because an empty title can also be a hand-written one.
 */
export function versionTitleOffered(version: PlatformContentVersion) {
  return !version.adaptations.some((adaptation) => adaptation.code === "title-not-offered");
}

/** Whether this version carries the base's video. Absence is recorded as `media-not-included`. */
export function versionVideoIncluded(version: PlatformContentVersion) {
  return !version.adaptations.some((adaptation) => adaptation.code === "media-not-included");
}

/** The platforms an author can still derive a version for: connected ones without a stored version. */
export function platformVersionDeriveTargets(
  profiles: PlatformContentProfile[],
  versions: PlatformContentVersion[],
): PlatformContentProfile[] {
  const taken = new Set(versions.map((version) => version.platform));
  return profiles.filter((profile) => !taken.has(profile.platform));
}

/** The adapter budget for the body field, as this layer knows it (`null` is not "unlimited"). */
export function platformTextLimitMessage(profile: PlatformContentProfile): PlatformVersionMessage {
  return profile.textLimit === null
    ? { key: "pvTextLimitNone" }
    : { key: "pvTextLimit", values: { limit: profile.textLimit } };
}

/** The adapter budget for the title field. Same honesty rule as `platformTextLimitMessage`. */
export function platformTitleLimitMessage(profile: PlatformContentProfile): PlatformVersionMessage {
  return profile.titleLimit === null
    ? { key: "pvTitleLimitNone" }
    : { key: "pvTitleLimit", values: { limit: profile.titleLimit } };
}

/** Whether the publish path has a field to fill, said in words rather than as a boolean. */
export function platformFieldLabelKey(filled: boolean): TranslationKey {
  return filled ? "pvFieldFilled" : "pvFieldNotFilled";
}

/** The draft a version's editor opens with: the stored text, unmodified. */
export function platformVersionDraft(version: PlatformContentVersion) {
  return { title: version.title, body: version.body };
}

/**
 * What is missing before a version can be saved, or `null` when nothing is. `PATCH` writes the fields
 * it is given and the route rejects a `save` without text, so an all-empty draft is the one thing the
 * view refuses to send on its own.
 */
export function platformVersionDraftIssueKey(draft: { title: string; body: string }): TranslationKey | null {
  return draft.title.trim() || draft.body.trim() ? null : "pvNeedContent";
}

/**
 * The translation for a failed call: the route's own error code when it has one (`error_NOT_FOUND`
 * for content that was deleted meanwhile, `error_INVALID_PAYLOAD`, ...), otherwise the caller's
 * fallback. Never a silent success.
 */
export function platformVersionErrorKey(error: unknown, fallback: TranslationKey = "pvActionFailed"): TranslationKey {
  return apiErrorTranslationKey(error, fallback);
}

/** The values the panel's header chips interpolate. */
export function platformVersionCounts(payload: PlatformContentVersionPayload) {
  return { count: payload.versions.length, unreadable: payload.unreadable };
}

/** The profile of one stored version's platform, or `null` when `profiles` no longer lists it. */
export function platformVersionProfile(
  payload: PlatformContentVersionPayload,
  platform: string,
): PlatformContentProfile | null {
  return payload.profiles.find((profile) => profile.platform === platform) ?? null;
}
