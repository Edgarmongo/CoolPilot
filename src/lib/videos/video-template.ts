import { z } from "zod";

/**
 * CI-P1-04-01: the video template contract of
 * `docs/coolpilot-capability-integration-plan.md` §4 (`P1-04-01 定义视频模板的标识、版本、参数和默认值`).
 *
 * A template is a *description of what to render*: an identity, a version, the material references it
 * reads and the parameters it accepts, each with the default this build applies. Nothing here touches
 * the disk, the database or the clock, and nothing here claims a render happened - the renderer
 * (`./video-renderer.ts`) is what produces files, and the task (`./video-render-task.ts`) is what
 * records the outcome.
 *
 * Three rules this file keeps:
 *
 * 1. **A template is published only when a renderer can really run it.** The registry below is the
 *    vocabulary `inputJsonSchema()` exposes to a caller, so listing a template this build cannot
 *    render would advertise a capability that does not exist. `image_slideshow` and friends belong to
 *    P1-04-06, which decides whether an encoder is adopted at all.
 * 2. **The version is part of the identity.** A caller may pin `{ id, version }`; a version this build
 *    does not implement is refused by name (`TEMPLATE_VERSION_UNAVAILABLE`) instead of being silently
 *    rendered as the current one - a template's meaning may change between versions.
 * 3. **Defaults live with the template, not with the caller.** `params` is optional in the request and
 *    is completed here, so the pipeline never invents a per-call default of its own.
 */

/** One line of a subtitle track: the window (milliseconds) it is shown in and its text. */
export const videoCaptionSchema = z.object({
  /** Inclusive start of the window; `0` is the first frame. */
  startMs: z.number().int().nonnegative(),
  /** Exclusive end of the window. Whether it is *after* `startMs` is checked by `resolveVideoCaptions()`. */
  endMs: z.number().int().positive(),
  text: z.string(),
});

export type VideoCaption = z.infer<typeof videoCaptionSchema>;

/** The template identifiers this build implements. One source of truth for the published contract. */
export const videoTemplateIds = ["existing_video_package"] as const;

export type VideoTemplateId = (typeof videoTemplateIds)[number];

export const existingVideoPackageTemplateId = "existing_video_package" as const;

/** The version of every template this build defines, until a template needs its own history. */
export const videoTemplateVersion = 1;

/**
 * Parameters of `existing_video_package`. `subtitles` is the template's output requirement - it decides
 * whether the package carries a subtitle sidecar, and it defaults to `true` because a caption list that
 * the caller sent was sent to be used.
 */
export const existingVideoPackageParamsSchema = z.object({
  /** Written into the package metadata; never onto a video frame (no encoder draws text here). */
  title: z.string().max(120).optional(),
  captions: z.array(videoCaptionSchema).max(500).optional(),
  /** Output requirement: write `<renderId>.srt` for `captions`. An empty caption list writes nothing. */
  subtitles: z.boolean().optional().default(true),
});

export type ExistingVideoPackageParams = z.infer<typeof existingVideoPackageParamsSchema>;

/** The material references `existing_video_package` reads; both are CI-P1-01 references. */
export const existingVideoPackageMaterialsSchema = z.object({
  /** The video to package. Resolved against the workspace `videos/` section. */
  video: z.string().min(1),
  /** Optional cover, resolved against the workspace image roots; the package carries it unchanged. */
  cover: z.string().min(1).optional(),
});

export type ExistingVideoPackageMaterials = z.infer<typeof existingVideoPackageMaterialsSchema>;

/** A template as a caller reads it: identity, version, the materials it reads and its parameters. */
export type VideoTemplateDefinition<
  TParams extends z.ZodType = z.ZodType,
  TMaterials extends z.ZodType = z.ZodType,
> = {
  id: VideoTemplateId;
  version: number;
  description: string;
  /** The CI-P1-01 references this template reads (resolved by the renderer, never by this module). */
  materialsSchema: TMaterials;
  /** This template's own parameters, with the defaults it applies. */
  paramsSchema: TParams;
};

/**
 * `existing_video_package`: package material the workspace already holds. Keeping the concrete schema
 * types on the constant (not just `z.ZodType`) is what lets the render request be typed per template.
 */
export const existingVideoPackageTemplate: VideoTemplateDefinition<
  typeof existingVideoPackageParamsSchema,
  typeof existingVideoPackageMaterialsSchema
> = {
  id: existingVideoPackageTemplateId,
  version: videoTemplateVersion,
  description:
    "Package an existing video of this workspace as a deliverable: the video file, an optional cover and subtitle track, and the render metadata. No frames are encoded.",
  materialsSchema: existingVideoPackageMaterialsSchema,
  paramsSchema: existingVideoPackageParamsSchema,
};

/** The templates this build implements, in the order discovery publishes them. */
export const videoTemplates: readonly VideoTemplateDefinition[] = [existingVideoPackageTemplate];

export function isVideoTemplateId(value: string): value is VideoTemplateId {
  return (videoTemplateIds as readonly string[]).includes(value);
}

/** The template a caller named, or `undefined` - never a fallback to another template. */
export function findVideoTemplate(id: string): VideoTemplateDefinition | undefined {
  return videoTemplates.find((template) => template.id === id);
}

/** True when `version` means "the version this build implements" (`undefined` = the current one). */
export function isSupportedTemplateVersion(template: VideoTemplateDefinition, version?: number) {
  return version === undefined || version === template.version;
}
