import { z } from "zod";
import type { AgentToolDefinition } from "@/lib/agent/contracts";
import { createDefaultToolRegistry } from "@/lib/agent/local-tools";
import { ToolRegistry } from "@/lib/agent/tool-registry";
import { mediaAssetRefSchema } from "@/lib/media-asset-schema";
import { listMediaAssets } from "@/lib/media-artifact-library";
import { MEDIA_ASSET_ROOTS } from "@/lib/media-artifact-ref";
import { videoRenderTool, videoRenderToolName } from "@/lib/videos/video-render-tool";

/**
 * CI-P1-03-06: the thin media registry of `docs/coolpilot-integration-contracts.md` §3.3.
 *
 * It is the same `ToolRegistry` and the same `AgentToolDefinition` shape the Agent loop uses - a
 * second execution framework does not exist - and it holds only the tools a caller that is **not** the
 * Agent loop can honestly run. What decides membership is what a tool reads out of its context:
 *
 *   | tool                         | reads out of the context                                       |
 *   | ---------------------------- | -------------------------------------------------------------- |
 *   | `generate_image_file`        | the `generateImage` permission only - **reused here**           |
 *   | `media_list_assets`          | nothing (a pure read of the workspace) - **added here**         |
 *   | `video_render`               | nothing (CI-P1-04's render task) - **added here**               |
 *   | `browser_*` (4)              | `context.site` and `context.profilePath`: an Agent's browser profile |
 *   | `generate_social_post_draft` | `context.site`, `context.systemPrompt`; it writes an item       |
 *   | `generate_image_prompt`      | `context.systemPrompt` (the Agent's own prompt)                 |
 *   | `threads_create_post`        | `context.site`, `context.profilePath` - publishing              |
 *   | `xiaohongshu_create_post`    | `context.site`, `context.profilePath` - publishing              |
 *
 * The eight excluded tools are not refused because they are unused: they are refused because the only
 * value `asAgentContext()` could hand them is a fabricated one (an empty profile path, a missing site),
 * and §3.3 forbids turning an Agent-private dependency into a public capability by faking it. They stay
 * in the Agent registry, where the Agent loop supplies the real thing.
 *
 * `generate_image_file` is **reused by reference** from the default registry rather than copied: one
 * definition means the Agent path and the media path cannot drift apart, and the tool already reads
 * nothing Agent-private - it asks for the `generateImage` permission, which the thin context answers
 * with `confirm`.
 */

/** The tools this registry reuses unchanged from the Agent registry. */
export const reusedMediaToolNames = ["generate_image_file"] as const;

/** The tools this registry adds itself, because they read nothing Agent-private. */
export const thinMediaToolNames = ["media_list_assets", videoRenderToolName] as const;

export const mediaToolNames = [...reusedMediaToolNames, ...thinMediaToolNames];

/** More than a listing needs; a bound keeps one call from walking a workspace into a response. */
export const maxMediaAssetLimit = 500;

const mediaListAssetsInputSchema = z.object({
  /** One of the four roots `paths.ts` defines; every root when omitted. */
  root: z.enum(MEDIA_ASSET_ROOTS).optional(),
  limit: z.number().int().min(1).max(maxMediaAssetLimit).optional(),
});

const mediaListAssetsOutputSchema = z.object({
  /** The references the caller asked for, in root order then file-name order (the library's own order). */
  assets: z.array(mediaAssetRefSchema),
  /** Files the workspace holds in total, so `assets.length !== total` stays visible as a filter or a limit. */
  total: z.number().int().nonnegative(),
  /** How many matched the `root` filter before `limit` was applied. */
  matched: z.number().int().nonnegative(),
  byRoot: z.record(z.string(), z.number().int().nonnegative()),
});

/**
 * The workspace's media files as the unified reference of CI-P1-01 (`MediaAssetRef`).
 *
 * Read-only: it resolves the five roots without creating them, writes nothing and needs no approval.
 * Its output is the reference shape the publishing flow, the media pages and now tool callers all
 * share, which is what makes it more than a file listing.
 */
export const mediaListAssetsTool: AgentToolDefinition<
  typeof mediaListAssetsInputSchema,
  typeof mediaListAssetsOutputSchema
> = {
  name: "media_list_assets",
  description:
    "List the media files this workspace holds (artifacts, videos, media, product-images, brand-logos) as unified asset references. Read-only.",
  inputSchema: mediaListAssetsInputSchema,
  outputSchema: mediaListAssetsOutputSchema,
  async execute(input) {
    const all = await listMediaAssets();
    const byRoot: Record<string, number> = {};
    for (const asset of all) {
      byRoot[asset.root] = (byRoot[asset.root] ?? 0) + 1;
    }
    const filtered = input.root ? all.filter((asset) => asset.root === input.root) : all;
    const assets = typeof input.limit === "number" ? filtered.slice(0, input.limit) : filtered;
    return { assets, total: all.length, matched: filtered.length, byRoot };
  },
};

/**
 * A fresh thin registry. `source` is the default (Agent) registry the reused definitions come from; a
 * test may pass its own to make the reuse explicit without touching the real one.
 */
export function createMediaToolRegistry(source: ToolRegistry = createDefaultToolRegistry()): ToolRegistry {
  const registry = new ToolRegistry();
  for (const name of reusedMediaToolNames) {
    registry.register(source.get(name));
  }
  registry.register(mediaListAssetsTool);
  registry.register(videoRenderTool);
  return registry;
}

let cachedMediaToolRegistry: ToolRegistry | null = null;

/** The registry the entry serves: built once, so discovery and execution cannot disagree about it. */
export function getMediaToolRegistry(): ToolRegistry {
  cachedMediaToolRegistry ??= createMediaToolRegistry();
  return cachedMediaToolRegistry;
}

