import { describe, expect, it } from "vitest";
import {
  existingVideoPackageParamsSchema,
  findVideoTemplate,
  isSupportedTemplateVersion,
  isVideoTemplateId,
  videoTemplateIds,
  videoTemplateVersion,
  videoTemplates,
} from "./video-template";

/**
 * CI-P1-04-01: the template contract, where identity, version, parameters and defaults are decided.
 *
 * Three promises are pinned here:
 *
 * 1. **A template is an identity with a version.** The registry publishes exactly the ids the JSON
 *    Schema offers, and a version this build does not implement is recognised as unsupported instead of
 *    being rendered as the current one.
 * 2. **Defaults belong to the template.** An omitted `params` gets the template's own defaults.
 * 3. **A name that is not a template is not found.** No fallback, no "closest match".
 */

describe("video templates", () => {
  it("publishes one id per registered template, all of them known", () => {
    expect(videoTemplates.map((template) => template.id)).toEqual([...videoTemplateIds]);
    expect(videoTemplateIds.every(isVideoTemplateId)).toBe(true);
    expect(isVideoTemplateId("image_slideshow")).toBe(false);
  });

  it("carries a version and applies the template's own defaults", () => {
    expect(videoTemplateVersion).toBe(1);
    expect(existingVideoPackageParamsSchema.parse({})).toEqual({ subtitles: true });
    expect(existingVideoPackageParamsSchema.parse({ subtitles: false, title: "Launch" })).toEqual({
      subtitles: false,
      title: "Launch",
    });
  });

  it("finds a template by id and by nothing else", () => {
    const template = videoTemplates[0]!;
    expect(findVideoTemplate("existing_video_package")?.version).toBe(videoTemplateVersion);
    expect(findVideoTemplate("video_render")).toBeUndefined();
    expect(isSupportedTemplateVersion(template, undefined)).toBe(true);
    expect(isSupportedTemplateVersion(template, videoTemplateVersion)).toBe(true);
    expect(isSupportedTemplateVersion(template, videoTemplateVersion + 1)).toBe(false);
  });
});
