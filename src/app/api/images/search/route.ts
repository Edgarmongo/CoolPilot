import { fail, ok } from "@/lib/api";
import { ONLINE_IMAGE_LIMIT, searchOnlineImages } from "@/lib/image-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Searches the online image library. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim();
  if (!query) return ok({ images: [] });

  const requested = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 48) : ONLINE_IMAGE_LIMIT;

  try {
    const images = await searchOnlineImages(query, limit);
    return ok({ images });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Image search failed", 502);
  }
}
