import { contentImageList } from "./content-images";
import { normalizePostText, threadsPostMaxLength, threadsPostTrailingSpace } from "./post-format";
import { defaultPublishProfiles, genericProfile, type PlatformPublishProfile } from "./publish-profiles";
import { videoPathFromMetadata } from "./video-library";
import {
  accountPlatforms,
  platformContentAdaptationCodes,
  platformContentVersionSources,
  type AccountPlatform,
  type ContentItem,
  type PlatformContentAdaptation,
  type PlatformContentAdaptationCode,
  type PlatformContentProfile,
  type PlatformContentVersion,
  type PlatformContentVersionPayload,
  type PlatformContentVersionSource,
} from "./types";

/**
 * 多平台内容模型 (CI-P2-05): the adapter that turns one base content item into per-platform versions,
 * and the reader/writer for those versions.
 *
 * Where the versions live: `content_items.metadata_json` under `platformVersions`, keyed by platform -
 * the same blob that already holds `type`, `images`, `themeId` and the research links, so this card
 * adds no table, no column and no migration, and the workspace export (`metadata_json` is part of it)
 * carries the versions with their item.
 *
 * What it reuses instead of re-deriving:
 *
 *  - **which platforms exist**: `accountPlatforms` (`src/lib/types.ts`), the same list the account
 *    dialog and `POST /api/publish` validate against.
 *  - **what a platform's publish page is like**: `defaultPublishProfiles` (`src/lib/publish-profiles.ts`).
 *    `composerEntry`, `videoRoute`, `titleField` and `bodyField` are read off the profile fields the
 *    publish path actually consults (`publishPageUrl`, `newPostSelectors`, `videoTabSelectors`,
 *    `videoInputSelectors`, `titleSelectors`, `contentSelectors` - see `runConfiguredCreatePost` and
 *    `uploadVideoToComposer` in `src/lib/browser-preview-session.ts`) rather than written down a second
 *    time, so a profile change moves the adapter with it. What the adapter does *not* claim: whether a
 *    page is a video uploader or an article editor (nothing records it), and anything about images
 *    (the only image path in the codebase picks `input[type="file"]` itself, ignoring
 *    `imageInputSelectors` - so the cover travels with every version and is not a per-platform fact).
 *    Threads and 小红书 also have dedicated flows with hardcoded selectors; on the two dimensions the
 *    adapter models they agree with the profile (Threads fills no title, 小红书 fills a title).
 *  - **how text is formatted**: `normalizePostText` and the Threads budget from
 *    `src/lib/post-format.ts`. Threads is the only platform CoolPilot formats text for today, and its
 *    limit is priced from `threadsPostMaxLength` minus the trailing space that formatter reserves, so
 *    an adapted Threads body is character-for-character what the Threads publish path sends.
 *
 * What it deliberately does not do: invent a platform's real character limits, fields or upload rules.
 * A limit that CoolPilot does not enforce is `null` and stays `null` (P2-05-06). Producing a version is
 * not publishing, and no function here writes a status, a record or a schedule (P2-05-05, A2).
 */

/** The metadata key the per-platform versions live under. */
export const platformVersionsMetadataKey = "platformVersions";

/**
 * Body budgets CoolPilot's own formatter enforces, per platform. One entry, because one formatter
 * exists: `postNextThreadsContent` runs the body through `truncateThreadsPost`, whose default budget is
 * `threadsPostMaxLength`. The adapter keeps that formatter's trailing space in mind, so the budget here
 * is one character smaller - the adapted body then fits the exact space the formatter would fill.
 *
 * Every other platform has no entry because CoolPilot enforces no limit for it. That is not a claim
 * that the platform allows any length: an unenforced limit is unknown, and unknown is `null`.
 */
const enforcedTextLimits: Partial<Record<AccountPlatform, number>> = {
  Threads: threadsPostMaxLength - threadsPostTrailingSpace.length,
};

/**
 * Title budgets CoolPilot's own formatter enforces. Empty on purpose: nothing in this codebase limits
 * a platform's title today, so the dimension exists and is exercised by tests, but no number is
 * invented for it (P2-05-06).
 */
const enforcedTitleLimits: Partial<Record<AccountPlatform, number>> = {};

/** The platform-specific publish profile, or `null` when the platform falls back to the generic one. */
export function platformPublishProfile(platform: string): PlatformPublishProfile | null {
  return defaultPublishProfiles[platform as AccountPlatform] ?? null;
}

/** True when the platform is one CoolPilot has accounts and publish profiles for. */
export function isKnownPlatform(value: string): value is AccountPlatform {
  return (accountPlatforms as readonly string[]).includes(value);
}

/**
 * How the publish path opens this platform's composer, from the profile it would use:
 *
 *  - `new-post` - the profile names its own "new post" entry (`newPostSelectors` non-empty).
 *  - `direct-url` - a platform-specific profile with no entry to click: its publish URL *is* the
 *    composer.
 *  - `generic` - no platform-specific profile at all, so the shared generic entry is clicked instead.
 */
function composerEntryFromProfile(profile: PlatformPublishProfile | null): PlatformContentProfile["composerEntry"] {
  if (!profile) return "generic";
  if (profile.newPostSelectors.length > 0) return "new-post";
  return profile.publishPageUrl !== "" ? "direct-url" : "generic";
}

/**
 * Whether a video can reach the page, and what the path has to click first - the two things
 * `uploadVideoToComposer` reads. Without a video file input there is nowhere to put one, and that is
 * reported as `not-supported` rather than as a platform that takes video.
 */
function videoRouteFromProfile(profile: PlatformPublishProfile): PlatformContentProfile["videoRoute"] {
  if (profile.videoInputSelectors.length === 0) return "not-supported";
  return profile.videoTabSelectors.length > 0 ? "video-tab-then-input" : "file-input";
}

/**
 * Everything the adapter knows about one platform, and nothing more.
 *
 * `explicitProfile` lets a caller that already holds a profile (or a test pinning a route no built-in
 * entry takes today) resolve from it instead of from the built-in table; the platform name is still
 * what identifies the entry.
 */
export function buildPlatformContentProfile(
  platform: string,
  explicitProfile?: PlatformPublishProfile | null,
): PlatformContentProfile {
  const profile = explicitProfile === undefined ? platformPublishProfile(platform) : explicitProfile;
  const resolved = profile ?? genericProfile;
  return {
    platform,
    supported: profile !== null,
    composerEntry: composerEntryFromProfile(profile),
    titleField: resolved.titleSelectors.length > 0,
    bodyField: resolved.contentSelectors.length > 0,
    videoRoute: videoRouteFromProfile(resolved),
    textLimit: enforcedTextLimits[platform as AccountPlatform] ?? null,
    titleLimit: enforcedTitleLimits[platform as AccountPlatform] ?? null,
  };
}

/** The adapters on offer: every platform CoolPilot has accounts for, in `accountPlatforms` order. */
export function listPlatformContentProfiles(): PlatformContentProfile[] {
  return accountPlatforms.map((platform) => buildPlatformContentProfile(platform));
}

/**
 * Cuts `text` down to `limit` characters, `...` included, and says whether it had to.
 *
 * The rule is the one `truncateThreadsPost` uses (replace the overflow with an ellipsis that fits), and
 * the caller prices in the composer's trailing space, so an adapted Threads body is exactly what the
 * Threads publish path sends.
 */
export function truncateForLimit(text: string, limit: number): { text: string; truncated: boolean } {
  if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return { text, truncated: false };
  const allowed = Math.max(0, limit - 3);
  return { text: `${text.slice(0, allowed)}...`, truncated: true };
}

/** The two fields an adapter formats. */
export type PlatformContentField = "title" | "text";

/** The note a field leaves when the platform's profile offers no such field. */
const fieldNotOfferedCodes: Record<PlatformContentField, PlatformContentAdaptationCode> = {
  title: "title-not-offered",
  text: "text-not-offered",
};

/**
 * Normalizes one field for one platform and records what it did. Never silent: a re-laid-out text or a
 * cut body comes back as an adaptation note, so a version can explain itself; and a field the
 * platform's profile does not offer comes back empty with the note saying so, rather than being
 * formatted for a composer that has nowhere to put it.
 */
export function formatPlatformField(input: {
  profile: PlatformContentProfile;
  field: PlatformContentField;
  text: string;
}): { text: string; adaptations: PlatformContentAdaptation[] } {
  const { profile, field, text } = input;
  const normalized = normalizePostText(text);
  if (!(field === "title" ? profile.titleField : profile.bodyField)) {
    // Nothing was dropped if there was nothing to drop.
    return { text: "", adaptations: normalized === "" ? [] : [{ code: fieldNotOfferedCodes[field] }] };
  }
  const limit = field === "title" ? profile.titleLimit : profile.textLimit;
  const adaptations: PlatformContentAdaptation[] = [];
  if (normalized !== text) {
    adaptations.push({ code: field === "title" ? "title-normalized" : "text-normalized" });
  }
  if (limit === null) return { text: normalized, adaptations };
  const limited = truncateForLimit(normalized, limit);
  if (limited.truncated) {
    adaptations.push({
      code: field === "title" ? "title-truncated" : "text-truncated",
      limit,
      originalLength: normalized.length,
    });
  }
  return { text: limited.text, adaptations };
}

/** The base text a version is derived from: what the publish path sends today. */
export function platformBaseText(content: Pick<ContentItem, "body" | "postReadyText">) {
  return content.postReadyText || content.body;
}

/**
 * FNV-1a over the base title and text. Not a security hash: it exists so a version can notice that the
 * base it was taken from has moved on (`isPlatformContentVersionStale`), and it travels with the
 * version in `metadata.platformVersions`.
 */
function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The base fields a version is a rendition of: exactly the two the adapter formats. */
export type PlatformContentBase = Pick<ContentItem, "title" | "body" | "postReadyText">;

/** Fingerprint of the base title/text a version was derived from. */
export function platformBaseFingerprint(content: PlatformContentBase) {
  const value = `${content.title}\u0000${platformBaseText(content)}`;
  return `v1:${value.length}:${fnv1a(value)}`;
}

/**
 * Derives one platform's version from the base item. Pure: it reads the item and the existing publish
 * profiles, writes nothing, and publishes nothing.
 */
export function adaptContentToPlatform(input: {
  content: Pick<ContentItem, "title" | "body" | "postReadyText" | "imagePath" | "metadata" | "updatedAt">;
  platform: string;
  now?: number;
  /**
   * Resolve from this already-resolved profile instead of the built-in table. Callers that hold a
   * profile list (the versions view) pass theirs; a test can pin a route or a budget that no built-in
   * entry takes today through it.
   */
  profile?: PlatformContentProfile;
}): { version: PlatformContentVersion; profile: PlatformContentProfile } {
  const profile = input.profile ?? buildPlatformContentProfile(input.platform);
  const now = input.now ?? Date.now();
  const title = formatPlatformField({ profile, field: "title", text: input.content.title });
  const body = formatPlatformField({
    profile,
    field: "text",
    text: platformBaseText(input.content),
  });
  const adaptations = [...title.adaptations, ...body.adaptations];

  // The cover is the one piece of media every publish path hands over, so it travels with every
  // version; a video only travels where the profile has an input to receive it (P2-05-02).
  const images = contentImageList(input.content);
  const baseVideo = videoPathFromMetadata(input.content.metadata);
  const videoRoute = profile.videoRoute;
  const videoPath = videoRoute === "not-supported" ? "" : baseVideo;
  if (baseVideo !== "" && videoPath === "") adaptations.push({ code: "media-not-included" });

  return {
    profile,
    version: {
      platform: input.platform,
      title: title.text,
      body: body.text,
      imagePath: input.content.imagePath || images[0] || "",
      videoPath,
      source: "derived",
      adaptations,
      baseFingerprint: platformBaseFingerprint(input.content),
      createdAt: now,
      updatedAt: now,
    },
  };
}

/**
 * The stored `platformVersions` object, untouched - unknown entries included. Writes go through this
 * map rather than through the parsed list so that an entry this build cannot read is preserved instead
 * of being dropped on the next save.
 */
function rawVersionStore(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = metadata?.[platformVersionsMetadataKey];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function readAdaptations(value: unknown): PlatformContentAdaptation[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(platformContentAdaptationCodes);
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const code = (entry as { code?: unknown }).code;
    if (typeof code !== "string" || !known.has(code)) return [];
    const limit = (entry as { limit?: unknown }).limit;
    const originalLength = (entry as { originalLength?: unknown }).originalLength;
    return [
      {
        code: code as PlatformContentAdaptation["code"],
        ...(typeof limit === "number" && Number.isFinite(limit) ? { limit } : {}),
        ...(typeof originalLength === "number" && Number.isFinite(originalLength) ? { originalLength } : {}),
      },
    ];
  });
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readMoment(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Reads one stored entry. `null` means "not a shape this build understands". */
function readVersion(platform: string, value: unknown): PlatformContentVersion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = record.title;
  const body = record.body;
  const createdAt = readMoment(record.createdAt);
  const updatedAt = readMoment(record.updatedAt);
  const baseFingerprint = record.baseFingerprint;
  if (typeof title !== "string" || typeof body !== "string") return null;
  if (createdAt === null || updatedAt === null || typeof baseFingerprint !== "string") return null;
  const source = readString(record.source);
  return {
    platform: readString(record.platform) || platform,
    title,
    body,
    imagePath: readString(record.imagePath),
    videoPath: readString(record.videoPath),
    source: (platformContentVersionSources as readonly string[]).includes(source)
      ? (source as PlatformContentVersionSource)
      : "derived",
    adaptations: readAdaptations(record.adaptations),
    baseFingerprint,
    createdAt,
    updatedAt,
  };
}

/**
 * Every readable version of one content item, plus how many stored entries this build could not read.
 * Tolerant by design: hand-edited or newer JSON must never break a content page.
 */
export function readPlatformContentVersions(metadata: Record<string, unknown> | undefined): {
  versions: PlatformContentVersion[];
  unreadable: number;
} {
  const versions: PlatformContentVersion[] = [];
  let unreadable = 0;
  for (const [platform, value] of Object.entries(rawVersionStore(metadata))) {
    const version = readVersion(platform, value);
    if (version) versions.push(version);
    else unreadable += 1;
  }
  versions.sort((left, right) => left.platform.localeCompare(right.platform));
  return { versions, unreadable };
}

/** One version by platform, or `null`. */
export function findPlatformContentVersion(metadata: Record<string, unknown> | undefined, platform: string) {
  return readPlatformContentVersions(metadata).versions.find((version) => version.platform === platform) ?? null;
}

/**
 * Writes one version into a copy of the item's metadata. Other platforms' versions - readable or not -
 * and every other metadata key (`type`, `images`, `themeId`, research links, ...) are left alone.
 */
export function upsertPlatformContentVersion(
  metadata: Record<string, unknown> | undefined,
  version: PlatformContentVersion,
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    [platformVersionsMetadataKey]: { ...rawVersionStore(metadata), [version.platform]: version },
  };
}

/** Removes one platform's version. Removing one that is not there is a no-op, not an error. */
export function removePlatformContentVersion(
  metadata: Record<string, unknown> | undefined,
  platform: string,
): Record<string, unknown> {
  const store = rawVersionStore(metadata);
  delete store[platform];
  return { ...(metadata ?? {}), [platformVersionsMetadataKey]: store };
}

/**
 * Whether the base moved on after this version was taken. A stale version stays usable and stays
 * visible (P2-05-04): it is reported, never refreshed behind the author's back.
 */
export function isPlatformContentVersionStale(version: PlatformContentVersion, base: PlatformContentBase) {
  return version.baseFingerprint !== platformBaseFingerprint(base);
}

/** The read model behind `GET /api/content/[id]/platform-versions`. */
export function buildPlatformContentVersionPayload(
  content: Pick<
    ContentItem,
    "id" | "title" | "body" | "postReadyText" | "imagePath" | "metadata" | "updatedAt"
  >,
): PlatformContentVersionPayload {
  const { versions, unreadable } = readPlatformContentVersions(content.metadata);
  return {
    contentItemId: content.id,
    base: {
      title: content.title,
      body: content.body,
      postReadyText: content.postReadyText,
      // `imagePath` is optional on the item; the payload's is not, so an unset cover reads as empty.
      imagePath: content.imagePath ?? "",
      images: contentImageList(content),
      videoPath: videoPathFromMetadata(content.metadata),
      fingerprint: platformBaseFingerprint(content),
      updatedAt: content.updatedAt,
    },
    profiles: listPlatformContentProfiles(),
    versions,
    unreadable,
  };
}


