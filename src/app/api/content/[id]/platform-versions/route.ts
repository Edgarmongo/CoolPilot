import { getContentItem, updateContentItem } from "@/db/repository";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import {
  adaptContentToPlatform,
  buildPlatformContentVersionPayload,
  findPlatformContentVersion,
  isKnownPlatform,
  platformBaseFingerprint,
  platformBaseText,
  removePlatformContentVersion,
  upsertPlatformContentVersion,
} from "@/lib/platform-content";
import type { PlatformContentVersion } from "@/lib/types";
import { platformVersionPatchSchema, platformVersionUpsertSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 多平台内容模型 (CI-P2-05) over HTTP: one base content item, its per-platform versions.
 *
 * - `GET` - the base, the adapters on offer and the saved versions (read-only).
 * - `POST` - `derive` runs the adapter over the base; `save` stores what the author wrote.
 * - `PATCH` - edits the text of a version that exists, and marks it `edited`.
 * - `DELETE ?platform=` - drops one version. Dropping one that is not there is a no-op.
 *
 * The versions are written into the item's own `metadata_json` through `updateContentItem`, which
 * merges metadata: no table, no migration, no other metadata key touched, and the workspace export
 * carries them with the item. **Nothing here publishes**: no status of this route's own, no
 * `publish_records` row, no schedule - an adapted version is not evidence that a platform took
 * anything (P2-05-05).
 */

/** The `[id]` segment, as Next.js hands it to the handler. */
async function readItemId(context: { params: Promise<{ id: string }> }) {
  return (await context.params).id;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const item = await getContentItem(await readItemId(context));
    if (!item) return fail("NOT_FOUND", 404);
    return ok(buildPlatformContentVersionPayload(item));
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = await readItemId(context);
    const item = await getContentItem(id);
    if (!item) return fail("NOT_FOUND", 404);

    const parsed = await parseJson(request, platformVersionUpsertSchema);
    if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
    const { platform, mode, title, body } = parsed.data;
    if (!isKnownPlatform(platform)) {
      return fail("INVALID_PAYLOAD", 400, `未接入的平台：${platform}`);
    }

    const now = Date.now();
    let version: PlatformContentVersion;
    if (mode === "save") {
      if (title === undefined && body === undefined) {
        return fail("INVALID_PAYLOAD", 400, "保存平台版本需要 title 或 body。");
      }
      // A hand-written rendition starts from the base and carries no media of its own: this build has
      // no field for that yet, and inventing one would be a claim the publish path does not honour.
      version = {
        platform,
        title: title ?? item.title,
        body: body ?? platformBaseText(item),
        imagePath: "",
        videoPath: "",
        source: "edited",
        adaptations: [],
        baseFingerprint: platformBaseFingerprint(item),
        createdAt: now,
        updatedAt: now,
      };
    } else {
      version = adaptContentToPlatform({ content: item, platform, now }).version;
    }

    const updated = await updateContentItem(id, {
      metadata: upsertPlatformContentVersion(item.metadata, version),
    });
    // The item was read a moment ago; if it is gone now, say that instead of answering a payload
    // built from `null`.
    if (!updated) return fail("NOT_FOUND", 404);
    return ok(buildPlatformContentVersionPayload(updated));
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = await readItemId(context);
    const item = await getContentItem(id);
    if (!item) return fail("NOT_FOUND", 404);

    const parsed = await parseJson(request, platformVersionPatchSchema);
    if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
    const { platform, title, body } = parsed.data;
    const existing = findPlatformContentVersion(item.metadata, platform);
    // Editing a version that was never taken is not an edit this route can apply: the caller has to
    // derive it first, or save it with POST - which is where the media and provenance come from.
    if (!existing) return fail("NOT_FOUND", 404);

    const version: PlatformContentVersion = {
      ...existing,
      title: title ?? existing.title,
      body: body ?? existing.body,
      source: "edited",
      updatedAt: Date.now(),
    };
    const updated = await updateContentItem(id, {
      metadata: upsertPlatformContentVersion(item.metadata, version),
    });
    if (!updated) return fail("NOT_FOUND", 404);
    return ok(buildPlatformContentVersionPayload(updated));
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = await readItemId(context);
    const item = await getContentItem(id);
    if (!item) return fail("NOT_FOUND", 404);

    const platform = (new URL(request.url).searchParams.get("platform") ?? "").trim();
    if (!platform) return fail("INVALID_PAYLOAD", 400, "缺少 platform 参数。");

    const updated = await updateContentItem(id, {
      metadata: removePlatformContentVersion(item.metadata, platform),
    });
    if (!updated) return fail("NOT_FOUND", 404);
    return ok(buildPlatformContentVersionPayload(updated));
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}
