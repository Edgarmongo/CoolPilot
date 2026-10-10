import { fail, ok } from "@/lib/api";
import { MEDIA_ASSET_ROOTS, isMediaAssetRoot, toMediaAssetRef } from "@/lib/media-artifact-ref";
import { listMediaAssets } from "@/lib/media-artifact-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The unified media query entry of CI-P1-01-04.
 *
 * Read-only by design: it lists what the four roots hold, or resolves one reference, and never writes,
 * never creates a directory and never adds a fifth way to serve bytes - `/api/agent/artifacts` and
 * `/api/videos` still do that, and the contract froze their URL shapes (`docs/coolpilot-integration-contracts.md` §1).
 *
 *   GET /api/media/assets               -> { assets: MediaAssetRef[] }
 *   GET /api/media/assets?ref=<value>   -> { asset: MediaAssetRef }
 *   GET /api/media/assets?ref=<value>&root=product-images
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const reference = params.get("ref");
  if (reference === null) {
    return ok({ assets: await listMediaAssets() });
  }

  const root = params.get("root") ?? "";
  if (!root) {
    return ok({ asset: toMediaAssetRef(reference) });
  }
  if (!isMediaAssetRoot(root)) {
    return fail("Unknown media root", 400, { root, allowed: MEDIA_ASSET_ROOTS });
  }
  return ok({ asset: toMediaAssetRef(reference, { root }) });
}
