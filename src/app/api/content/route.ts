import { createContentItem, listContentItems, reconcileContentImagesFromChatHistory } from "@/db/repository";
import { fail, ok, parseJson } from "@/lib/api";
import { parseContentFilter } from "@/lib/content-filter";
import { contentCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await reconcileContentImagesFromChatHistory();
  return ok(await listContentItems(parseContentFilter(request.url)));
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, contentCreateSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const images = parsed.data.images.filter(Boolean);
  const videoPath = parsed.data.videoPath;
  const item = await createContentItem({
    title: parsed.data.title,
    body: parsed.data.body,
    postReadyText: parsed.data.postReadyText,
    sourceUrls: parsed.data.sourceUrls,
    imagePath: images[0],
    metadata: videoPath ? { type: parsed.data.type, images, videoPath } : { type: parsed.data.type, images },
    status: "ready",
  });
  return ok(item, { status: 201 });
}
