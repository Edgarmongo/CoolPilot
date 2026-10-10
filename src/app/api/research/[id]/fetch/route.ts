import { getResearchMaterial, recordResearchFetch } from "@/db/repositories/research";
import { fail, ok } from "@/lib/api";
import { isReadableResearchUrl } from "@/lib/research";
import { fetchArticleText } from "@/lib/scraper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reads a material's source page and records what really came back (P3-01-02 of
 * `docs/coolpilot-capability-integration-plan.md`).
 *
 * The reader is the one the URL-import path already uses (`fetchArticleText`), so what counts as a
 * page's 正文 is the same everywhere in this app - and only its result is written here:
 *
 * - a page that answered and carried text → `ready`, the text stored as `content`, `fetchedAt` stamped;
 * - a page that answered without usable text → `empty` and the reason, `fetchedAt` stamped, the record's
 *   existing text kept (the page contributed nothing, it did not retract anything);
 * - a page that did not answer (HTTP error, DNS, timeout) → `failed` and the reader's own reason, with
 *   neither `content` nor `fetchedAt` touched.
 *
 * Failure is not an HTTP failure here: the *attempt* succeeded and its outcome is on the record, which is
 * exactly what "不得伪造抓取成功" asks for, so an existing material always answers 200 with its stored
 * state - and a caller that only checks the status code is the one caller this contract cannot protect.
 * The response body is the material itself, so nothing has to be inferred from an envelope.
 *
 * No status is accepted from the client, and none is invented: `empty` is only reachable through an
 * answer with no text, `failed` only through a reader that threw.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const material = await getResearchMaterial(id);
  if (!material) return fail("NOT_FOUND", 404);
  const url = material.sourceUrl.trim();
  if (!isReadableResearchUrl(url)) return fail("INVALID_PAYLOAD", 400, "this material has no readable source url");

  try {
    const page = await fetchArticleText(url);
    const text = page.text.trim();
    const read = await recordResearchFetch(id, {
      status: text ? "ready" : "empty",
      // The reason is only stored when there is one: 读取成功但没有正文 is what the `empty` status *is*, so the
      // screen words it (in the reader's language) and the row does not carry a second, untranslated copy.
      statusMessage: "",
      imageUrl: page.imageUrl,
      ...(text ? { content: text } : {}),
      fetchedAt: Date.now(),
    });
    return ok(read);
  } catch (error) {
    const read = await recordResearchFetch(id, {
      status: "failed",
      statusMessage: (error as Error).message || "读取失败",
    });
    // The row moved while this read was running; the material is gone and there is nothing to record.
    if (!read) return fail("NOT_FOUND", 404);
    return ok(read);
  }
}
