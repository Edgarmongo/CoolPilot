import { fail, ok, parseJson } from "@/lib/api";
import { artifactImageUrl } from "@/lib/artifact-image-url";
import { fetchRemoteImageToArtifacts, isFetchableImageUrl } from "@/lib/remote-image";
import { imageFromUrlSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Downloads a remote image into the artifacts directory and returns the local
 * URL, so images picked from the online library keep rendering inside the app
 * instead of hotlinking a third-party host.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, imageFromUrlSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  // Many search results point at hosts that are slow or blocked, so the
  // preview URL is tried as a second attempt.
  if (!isFetchableImageUrl(parsed.data.url) && !isFetchableImageUrl(parsed.data.fallbackUrl)) {
    return fail("UNSUPPORTED_IMAGE", 400);
  }

  try {
    const fileName = await fetchRemoteImageToArtifacts({
      url: parsed.data.url,
      fallbackUrl: parsed.data.fallbackUrl,
    });
    return ok({ fileName, url: artifactImageUrl(fileName) }, { status: 201 });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Image download failed", 502);
  }
}

