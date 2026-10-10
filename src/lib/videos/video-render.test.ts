import { describe, expect, it } from "vitest";
import { inputJsonSchema } from "@/lib/tools/tool-call";
import { taskStatuses } from "@/lib/tasks/task-view";
import {
  VideoRenderFailure,
  resolveVideoCaptions,
  resolveVideoRenderInput,
  videoRenderInputSchema,
  videoRenderOutputSchema,
  videoRenderPlaybookId,
  videoRenderTaskLookup,
} from "./video-render";

/**
 * CI-P1-04-02/03/04: the render request and outcome contract, where the contract is decided.
 *
 * Four promises are pinned here:
 *
 * 1. **The published contract is the parser.** `inputJsonSchema()` (CI-P1-03) describes the schema
 *    `resolveVideoRenderInput()` parses, and it is expressible - never the `null` sentinel, which would
 *    publish a tool whose parameters nobody can read.
 * 2. **Defaults belong to the template.** An omitted `params` is completed (`subtitles: true`), so the
 *    renderer never invents a per-call default of its own.
 * 3. **What a schema cannot express is refused by name.** A template version this build does not
 *    implement, a caption window that ends before it starts, a caption with no text and junk parameters
 *    all raise a `VideoRenderFailure` whose message names the code.
 * 4. **The outcome speaks CI-P1-02's vocabulary.** `videoRenderOutputSchema` accepts only canonical
 *    `TaskStatus` values, so the raw `runs` literal (`success`) can never be handed to a caller as the
 *    status of the task it created.
 */

const request = {
  template: { id: "existing_video_package" },
  materials: { video: "clip.mp4" },
};

describe("video render request", () => {
  it("publishes a JSON Schema that describes the same request it parses", () => {
    const schema = inputJsonSchema(videoRenderInputSchema);

    expect(schema).not.toBeNull();
    const branch = (schema as { anyOf: Array<Record<string, unknown>> }).anyOf[0] as {
      properties: Record<string, { const?: string; required?: string[] }>;
      required?: string[];
    };
    expect(branch.properties.template).toMatchObject({
      properties: { id: { const: "existing_video_package" } },
    });
    expect(branch.properties.materials).toMatchObject({ required: ["video"] });
    expect(branch.required).toEqual(["template", "materials"]);
  });

  it("accepts a request and completes the template's defaults", () => {
    const resolved = resolveVideoRenderInput(request);

    expect(resolved.templateRef).toEqual({ id: "existing_video_package", version: 1 });
    expect(resolved.materials).toEqual({ video: "clip.mp4" });
    expect(resolved.params).toEqual({ subtitles: true });
  });

  it("refuses junk parameters with the queued-run vocabulary, not a crash", () => {
    expect(() => resolveVideoRenderInput({ template: { id: "existing_video_package" } }))
      .toThrowError(/^REQUEST_INVALID: /);
    expect(() => resolveVideoRenderInput({ ...request, materials: {} })).toThrowError(/^REQUEST_INVALID: /);
  });

  it("refuses a template version this build does not implement", () => {
    const failure = (() => {
      try {
        resolveVideoRenderInput({ ...request, template: { id: "existing_video_package", version: 2 } });
        return null;
      } catch (error) {
        return error as VideoRenderFailure;
      }
    })();

    expect(failure?.code).toBe("TEMPLATE_VERSION_UNAVAILABLE");
    expect(failure?.message).toContain("version 2");
    expect(failure?.message).toContain("version 1");
  });

  it("refuses a template id that is not published", () => {
    const parsed = videoRenderInputSchema.safeParse({ ...request, template: { id: "image_slideshow" } });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["template", "id"]);
  });
});

describe("video captions", () => {
  const captions = [
    { startMs: 0, endMs: 1_500, text: "  first  " },
    { startMs: 1_500, endMs: 3_000, text: "second" },
  ];

  it("keeps an ordered list as it is", () => {
    expect(resolveVideoCaptions(captions)).toEqual({ captions, sorted: true });
  });

  it("sorts an unordered list and says so instead of hiding it", () => {
    const resolved = resolveVideoCaptions([captions[1]!, captions[0]!]);

    expect(resolved.sorted).toBe(false);
    expect(resolved.captions.map((caption) => caption.text)).toEqual(["  first  ", "second"]);
  });

  it("refuses a window that ends before it starts, and text that is only whitespace", () => {
    expect(() => resolveVideoCaptions([{ startMs: 1_000, endMs: 1_000, text: "x" }]))
      .toThrowError(/^CAPTIONS_INVALID: caption #1 ends at 1000ms/);
    expect(() => resolveVideoCaptions([{ startMs: 0, endMs: 10, text: "   " }]))
      .toThrowError(/^CAPTIONS_INVALID: caption #1 has no text/);
  });
});

describe("video render outcome", () => {
  const asset = (fileName: string, kind: "video" | "subtitle" | "document") => ({
    fileName,
    kind,
    mimeType: "video/mp4",
    root: "videos" as const,
    source: "uploaded" as const,
    url: kind === "video" ? `/api/videos?file=${fileName}` : "",
    external: false,
  });

  const output = {
    taskId: "run-123",
    taskStatus: "succeeded",
    taskRawStatus: "success",
    lookup: "/api/tasks/run-123",
    template: { id: "existing_video_package", version: 1 },
    renderer: { name: "existing-video-package", encoded: false },
    artifacts: {
      video: asset("render-1.mp4", "video"),
      cover: null,
      subtitles: asset("render-1.srt", "subtitle"),
      metadata: asset("render-1.json", "document"),
    },
    videoBytes: 12,
    notes: [],
  };

  it("answers in CI-P1-02's canonical status vocabulary", () => {
    expect(videoRenderOutputSchema.parse(output).taskStatus).toBe("succeeded");
    expect(taskStatuses).toContain("succeeded");
    // The raw `runs` literal is not a canonical status: a caller can never mistake one for the other.
    expect(videoRenderOutputSchema.safeParse({ ...output, taskStatus: "success" }).success).toBe(false);
  });

  it("carries CI-P1-01 references, including the ones with no serving route yet", () => {
    const parsed = videoRenderOutputSchema.parse(output);

    expect(parsed.artifacts.video.url).toBe("/api/videos?file=render-1.mp4");
    // `url: ""` is the unified contract's "nothing serves this root/extension yet" - not "no file".
    expect(parsed.artifacts.subtitles?.url).toBe("");
    expect(
      videoRenderOutputSchema.safeParse({
        ...output,
        artifacts: { ...output.artifacts, video: { ...asset("x.mp4", "video"), root: "nowhere" } },
      }).success,
    ).toBe(false);
  });

  it("names the task type and the address a caller polls", () => {
    expect(videoRenderPlaybookId).toBe("video_render");
    expect(videoRenderTaskLookup("run-123")).toBe("/api/tasks/run-123");
    expect(videoRenderTaskLookup("a/b c")).toBe("/api/tasks/a%2Fb%20c");
  });
});

