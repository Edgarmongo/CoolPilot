import { z } from "zod";
import { MEDIA_ASSET_ROOTS } from "@/lib/media-artifact-ref";

/**
 * The runtime shape of `MediaAssetRef` (CI-P1-01 §1.2 of `docs/coolpilot-integration-contracts.md`).
 *
 * It lives in its own module because more than one registry publishes it - the CI-P1-03 media registry
 * and the CI-P1-04 render tool - and two copies of the same reference shape would be two contracts that
 * can drift. `media-artifact-ref.ts` itself stays zod-free on purpose: it is imported by client
 * components, and this file is only ever reached from server-side tool definitions.
 */
export const mediaAssetRefSchema = z.object({
  /** Base name; the addressing key. Empty for a remote reference (CoolPilot holds no local copy). */
  fileName: z.string(),
  kind: z.enum(["image", "video", "audio", "subtitle", "document", "unknown"]),
  mimeType: z.string(),
  root: z.enum(MEDIA_ASSET_ROOTS),
  source: z.enum(["generated", "uploaded", "copied", "remote", "unknown"]),
  /** Address for the browser, or "" when nothing serves this root/extension yet. */
  url: z.string(),
  remoteUrl: z.string().optional(),
  external: z.boolean(),
});
