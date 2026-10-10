import { ZodError, z } from "zod";
import { mediaAssetRefSchema } from "@/lib/media-asset-schema";
import { taskStatuses } from "@/lib/tasks/task-view";
import {
  existingVideoPackageMaterialsSchema,
  existingVideoPackageParamsSchema,
  existingVideoPackageTemplate,
  existingVideoPackageTemplateId,
  findVideoTemplate,
  isSupportedTemplateVersion,
  videoTemplateIds,
  type ExistingVideoPackageParams,
  type VideoCaption,
  type VideoTemplateDefinition,
  type VideoTemplateId,
} from "./video-template";

/**
 * CI-P1-04-02/03/04: the render task contract of `docs/coolpilot-capability-integration-plan.md` §4.
 *
 * This is the pure half of the card: what a render request is, what a render outcome is, and the
 * vocabulary of honest refusal. It opens no file, writes no row and never claims a render happened.
 *
 * Four rules it exists to keep:
 *
 * 1. **A render task is a real task of the existing task system.** `videoRenderPlaybookId` is the task
 *    type a row of `runs` carries, so the task is queryable through CI-P1-02's `GET /api/tasks/<id>`
 *    (`videoRenderTaskLookup()` is the path shape `toolTaskLookup()` builds), carries its progress in
 *    its own `run_events` and is cancelled by the existing `POST /api/runs/<id>/cancel`. No second task
 *    table, no new status word.
 * 2. **Input is refused before anything runs, and what a schema cannot express is refused by name.**
 *    Everything the JSON-Schema-expressible contract can reject is rejected by Zod (the caller gets
 *    `INVALID_INPUT` and nothing was written). What a schema cannot express - a template version this
 *    build does not implement, a caption window that ends before it starts - is refused with a stable
 *    code of this vocabulary and recorded on the task rather than hidden.
 * 3. **The artifacts are CI-P1-01 references.** The outcome describes its products as `MediaAssetRef`,
 *    so a caller reads a rendered file exactly the way it reads any other media file of the workspace;
 *    `<renderId>.srt`/`.json` land in `videos/` and honestly report `url: ""` - the unified contract's
 *    sentinel for "no route serves this root/extension yet" - instead of inventing a fourth route.
 * 4. **No encode is claimed.** The installed renderer reports `encoded: false`, so nothing downstream
 *    can read a packaged file as a transcoded one.
 */

/** The task type a render row carries (`runs.playbook_id`); one literal, shared by every writer. */
export const videoRenderPlaybookId = "video_render";

/** Where a caller polls the render task - the same shape CI-P1-03's `toolTaskLookup()` builds. */
export function videoRenderTaskLookup(taskId: string) {
  return `/api/tasks/${encodeURIComponent(taskId)}`;
}

/** The names a render refusal can carry. Stable strings: a caller may branch on them. */
export const videoRenderFailureCodes = [
  /** The parameters of a queued render row are not a valid render request at all. */
  "REQUEST_INVALID",
  /** The named template is not one this build implements. */
  "TEMPLATE_UNKNOWN",
  /** The template is implemented, but not at the version the caller pinned. */
  "TEMPLATE_VERSION_UNAVAILABLE",
  /** The video material is not a file of this workspace's `videos/` section. */
  "MATERIAL_NOT_FOUND",
  /** The video material is a remote address; packaging happens on files the workspace already holds. */
  "MATERIAL_NOT_LOCAL",
  /** The material is not a video this library stores. */
  "MATERIAL_UNSUPPORTED",
  /** The cover material is not a file of the workspace image roots. */
  "COVER_NOT_FOUND",
  /** The cover exists but nothing can serve its bytes as an image. */
  "COVER_UNSUPPORTED",
  /** A caption window is empty, backwards, or has no text. */
  "CAPTIONS_INVALID",
  /** The renderer threw an error of its own; the message keeps its text. */
  "RENDER_FAILED",
  /** The workspace refused a write (permissions, disk, a vanished directory). */
  "WORKSPACE_WRITE_FAILED",
] as const;

export type VideoRenderFailureCode = (typeof videoRenderFailureCodes)[number];

export function describeVideoRenderFailure(code: VideoRenderFailureCode, detail: string) {
  return `${code}: ${detail}`;
}

/** A refusal of the render pipeline; the message is the product's own sentence and names the code. */
export class VideoRenderFailure extends Error {
  readonly code: VideoRenderFailureCode;

  constructor(code: VideoRenderFailureCode, detail: string) {
    super(describeVideoRenderFailure(code, detail));
    this.name = "VideoRenderFailure";
    this.code = code;
  }
}


/**
 * The identity a caller names: the template and, optionally, the version it was written against.
 * `version` is optional because "the current one" is the sane default for a fresh request, and the
 * caller gets the version actually used back in the outcome.
 */
export const videoTemplateRefSchema = z.object({
  id: z.enum(videoTemplateIds),
  version: z.number().int().positive().optional(),
});

/**
 * One input branch, built from the same registry discovery publishes. `params` carries no schema-level
 * default: Zod's `default()` does not re-parse the default value, so a `{}` default would silently drop
 * the template's own defaults - `resolveVideoRenderInput()` applies them instead.
 */
function templateInputSchema<TParams extends z.ZodType, TMaterials extends z.ZodType>(
  template: VideoTemplateDefinition<TParams, TMaterials>,
) {
  return z.object({
    template: z.object({
      id: z.literal(template.id),
      version: z.number().int().positive().optional(),
    }),
    materials: template.materialsSchema,
    params: template.paramsSchema.optional(),
  });
}

/**
 * The render request.
 *
 * It is a plain union rather than a `discriminatedUnion` because the discriminator (`template.id`) is
 * nested, and it is written out branch by branch rather than mapped over `videoTemplates` so each branch
 * keeps its own types - an erased `ZodType` would make the whole request `unknown`, and a contract nobody
 * can type is not a contract. The list is kept in step with `videoTemplates` by hand: a second template
 * adds its branch here, its resolver in `resolveVideoRenderInput()` and its row in `videoTemplates`, and
 * `TEMPLATE_UNKNOWN` catches a template that is registered without a resolver.
 */
export const videoRenderInputSchema = z.union([templateInputSchema(existingVideoPackageTemplate)]);

export type VideoRenderInput = z.infer<typeof videoRenderInputSchema>;

/** The parameters of the only template this build implements, with its defaults applied. */
export type VideoRenderParams = ExistingVideoPackageParams;

export type ResolvedVideoRender = {
  template: VideoTemplateDefinition;
  /** `{ id, version }` with the version this build implements filled in. */
  templateRef: { id: VideoTemplateId; version: number };
  materials: { video: string; cover?: string };
  params: VideoRenderParams;
};

/** A template's parameters, resolved to what the renderer reads. */
export type ResolvedVideoCaptions = {
  captions: VideoCaption[];
  /** True when the request arrived out of order and was sorted by start; the renderer logs that fact. */
  sorted: boolean;
};

/**
 * The caption list as the renderer reads it, or a refusal naming the offending entry.
 *
 * The order is never rewritten silently: an unsorted list is sorted (`Array.sort` is stable, so equal
 * starts keep the caller's order) and the fact is reported through `sorted`, because an SRT index is
 * meaningful to a viewer.
 */
export function resolveVideoCaptions(captions: readonly VideoCaption[]): ResolvedVideoCaptions {
  captions.forEach((caption, index) => {
    if (!caption.text.trim()) {
      throw new VideoRenderFailure("CAPTIONS_INVALID", `caption #${index + 1} has no text`);
    }
    if (caption.endMs <= caption.startMs) {
      throw new VideoRenderFailure(
        "CAPTIONS_INVALID",
        `caption #${index + 1} ends at ${caption.endMs}ms, which is not after its start ${caption.startMs}ms`,
      );
    }
  });
  const sorted = captions.every(
    (caption, index) => index === 0 || caption.startMs >= (captions[index - 1] as VideoCaption).startMs,
  );
  return { captions: sorted ? [...captions] : [...captions].sort((a, b) => a.startMs - b.startMs), sorted };
}

function requestIssues(error: ZodError) {
  return error.issues
    .slice(0, 10)
    .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.code}`)
    .join("; ");
}

/**
 * The validated, defaulted request a task needs before it may touch the workspace.
 *
 * Both callers of a render task go through here - the tool entry, which has already validated the input,
 * and the task executor, which reads the same parameters back out of `runs.params_json`. A `queued` row
 * created through `POST /api/runs` with junk parameters therefore lands on this refusal instead of
 * crashing the renderer.
 */
export function resolveVideoRenderInput(raw: unknown): ResolvedVideoRender {
  const parsed = videoRenderInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new VideoRenderFailure("REQUEST_INVALID", requestIssues(parsed.error));
  }
  const request = parsed.data;
  const template = findVideoTemplate(request.template.id);
  if (!template) {
    throw new VideoRenderFailure(
      "TEMPLATE_UNKNOWN",
      `this build implements "${videoTemplateIds.join('", "')}"`,
    );
  }
  if (!isSupportedTemplateVersion(template, request.template.version)) {
    throw new VideoRenderFailure(
      "TEMPLATE_VERSION_UNAVAILABLE",
      `template "${template.id}" version ${request.template.version} is not implemented; this build implements version ${template.version}`,
    );
  }

  switch (template.id) {
    case existingVideoPackageTemplateId:
      return {
        template,
        templateRef: { id: template.id, version: template.version },
        materials: existingVideoPackageMaterialsSchema.parse(request.materials),
        params: existingVideoPackageParamsSchema.parse(request.params ?? {}),
      };
    default:
      // Unreachable while `videoTemplates` and this switch are one list: a template registered without a
      // resolver stops here instead of being rendered as some other template.
      throw new VideoRenderFailure("TEMPLATE_UNKNOWN", `template "${template.id}" has no resolver`);
  }
}

/**
 * What a render task produced, as CI-P1-01 references. A file whose root/extension has no serving route
 * yet reports `url: ""`; that is the contract's "not addressable", never "does not exist".
 */
export const videoRenderArtifactsSchema = z.object({
  video: mediaAssetRefSchema,
  cover: mediaAssetRefSchema.nullable(),
  subtitles: mediaAssetRefSchema.nullable(),
  metadata: mediaAssetRefSchema,
});

/** The renderer that ran, and whether it encodes frames (it does not, today). */
export const videoRendererInfoSchema = z.object({
  name: z.string(),
  encoded: z.boolean(),
});

/**
 * What the render tool answers with: the real task, its canonical status (CI-P1-02-01's vocabulary), the
 * artifacts, and where to poll. `taskId` is what `callTool()` resolves against the task view, so an id
 * that names no task cannot leave this tool.
 */
export const videoRenderOutputSchema = z.object({
  taskId: z.string(),
  taskStatus: z.enum(taskStatuses),
  taskRawStatus: z.string(),
  lookup: z.string(),
  template: z.object({ id: z.string(), version: z.number().int() }),
  renderer: videoRendererInfoSchema,
  artifacts: videoRenderArtifactsSchema,
  /** Bytes of the deliverable video file, as written. */
  videoBytes: z.number().int().nonnegative(),
  /** Facts the caller should read: a reordered caption list, why no cover is attached, and so on. */
  notes: z.array(z.string()),
});

export type VideoRenderOutput = z.infer<typeof videoRenderOutputSchema>;

