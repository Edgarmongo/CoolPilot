import { z } from "zod";

export const postDraftSchema = z.object({
  title: z.string().min(1).describe("Short, catchy social post title in the requested language."),
  body: z.string().min(1).describe("Ready-to-post body text in the requested language."),
});
export type PostDraft = z.infer<typeof postDraftSchema>;

export const articleTranslationSchema = z.object({
  title: z.string().min(1).describe("The article title translated into the requested language."),
  paragraphs: z
    .array(z.string())
    .min(1)
    .describe(
      "Every source paragraph translated into the requested language, in the exact same order and count as the source. One entry per source paragraph.",
    ),
});
export type ArticleTranslation = z.infer<typeof articleTranslationSchema>;

export const imagePromptSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe(
      "A single production-ready image generation prompt covering composition, subject, style, lighting, and aspect ratio.",
    ),
});
export type ImagePrompt = z.infer<typeof imagePromptSchema>;

export const chatTitleSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("A 2 to 8 word chat title, no quotation marks, no markdown, no trailing punctuation."),
});
export type ChatTitle = z.infer<typeof chatTitleSchema>;

export const metricInsightSchema = z.object({
  verdict: z
    .enum(["hit", "met", "miss"])
    .describe("Overall verdict of how this content performed versus the account/platform baseline."),
  summary: z
    .string()
    .min(1)
    .describe("One or two sentences explaining the performance in plain language."),
  factors: z
    .array(z.string())
    .max(6)
    .describe("Likely reasons for the performance (title, topic, timing, format, platform)."),
  suggestions: z
    .array(z.string())
    .max(6)
    .describe("Concrete, actionable improvements for the next post."),
});
export type MetricInsightResult = z.infer<typeof metricInsightSchema>;

export const toolPlanSchema = z.object({
  steps: z
    .array(
      z.object({
        tool: z.string().min(1).describe("The exact tool name to invoke."),
        input: z.record(z.string(), z.unknown()).default({}).describe("Arguments object for the tool."),
        reason: z.string().optional().describe("Why this step is needed."),
      }),
    )
    .default([])
    .describe("Ordered list of tool calls to fulfil the user request."),
});
export type ToolPlan = z.infer<typeof toolPlanSchema>;
export type ToolPlanStep = ToolPlan["steps"][number];
