import { createContentItem, listContentItems, reconcileContentImagesFromChatHistory } from "@/db/repository";
import { fail, ok, parseJson } from "@/lib/api";
import { parseContentFilter } from "@/lib/content-filter";
import { storedImagePatch } from "@/lib/content-image-assets";
import { contentCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await reconcileContentImagesFromChatHistory();
  return ok(await listContentItems(parseContentFilter(request.url)));
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, contentCreateSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  // C4: whatever shape the caller sent (a library file name, a local path, an app URL) is stored as the
  // one shape an item holds, with each image's identity and origin written beside it. Nothing is
  // downloaded here on purpose: a create request must not start a network fetch behind the caller's back,
  // so a reference with no local copy is stored as it came and marked `external` in its provenance.
  const imagePatch = storedImagePatch(parsed.data.images.filter(Boolean));
  const images = imagePatch.images;
  const videoPath = parsed.data.videoPath;
  const source = parsed.data.source;
  // `source` is added only when the caller names one (CI-SC-01), so the metadata of every existing
  // caller stays byte-identical: `{ type, images }`, plus `videoPath` for a video.
  const metadata: Record<string, unknown> = videoPath
    ? { type: parsed.data.type, ...imagePatch, videoPath }
    : { type: parsed.data.type, ...imagePatch };
  if (source) metadata.source = source;
  const item = await createContentItem({
    title: parsed.data.title,
    body: parsed.data.body,
    postReadyText: parsed.data.postReadyText,
    sourceUrls: parsed.data.sourceUrls,
    imagePath: images[0],
    metadata,
    status: "ready",
  });
  return ok(item, { status: 201 });
}
