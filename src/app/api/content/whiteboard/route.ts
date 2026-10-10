import { createContentItem } from "@/db/repository";
import { fail, ok } from "@/lib/api";

export const runtime = "nodejs";

/** The kind 文章创作 filters on - the same default `contentCreateSchema` applies. */
const DEFAULT_TYPE = "article";

/** The pattern `listContentItems()` accepts: any other value could never be filtered back out. */
const TYPE_PATTERN = /^[a-z0-9-]+$/i;

/**
 * The whiteboard's 匯出到內容庫 (CI-SC-01).
 *
 * It used to store `{ source: "whiteboard" }` alone, and `metadata.type` is the only key the console
 * lists filter on (`listContentItems()`, `?type=article` in 文章创作), so an export landed in 内容库 and
 * nowhere else: it could not be listed with the articles and had no entry into the editor. The type is
 * part of this contract now, defaulted exactly the way `POST /api/content` defaults it, and guarded by
 * the same pattern the filter uses so a caller cannot store a kind no list can read back.
 *
 * The response shape (`{ item }`, 201) is unchanged - the Drawnix dialog only checks `response.ok`.
 */
export async function POST(request: Request) {
  try {
    const data = (await request.json()) as { title?: string; body?: string; type?: string };
    const title = data?.title || "白板内容";
    const body = data?.body || "";
    const requestedType = typeof data?.type === "string" ? data.type.trim() : "";
    const type = TYPE_PATTERN.test(requestedType) ? requestedType : DEFAULT_TYPE;
    const item = await createContentItem({
      title,
      body,
      postReadyText: body,
      metadata: { type, source: "whiteboard" },
      status: "draft",
    });
    return ok({ item }, { status: 201 });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "Failed to save whiteboard content",
      500
    );
  }
}

