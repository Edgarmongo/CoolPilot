import { fail, ok } from "@/lib/api";
import { HOT_TOPICS_ALL, fetchHotTopics, hotTopicPlatforms } from "@/lib/hot-topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const platform = params.get("platform")?.trim() || HOT_TOPICS_ALL;
  const query = params.get("q")?.trim() ?? "";
  try {
    const items = await fetchHotTopics(platform, query);
    return ok({ items, platforms: hotTopicPlatforms });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to fetch hot topics", 500);
  }
}
