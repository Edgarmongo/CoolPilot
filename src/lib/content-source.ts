import type { TranslationKey } from "@/lib/locale-resources";

/**
 * Where a content item came from, derived from its metadata - the 来源 column of 文章创作
 * (CI-P2-01 introduced the topic/wizard distinction; CI-SC-01 moved the mapping here so the canvas
 * origins are pinned by a test instead of being read off a component).
 *
 * The first two branches are the canvas entry points: `metadata.source` is written by the whiteboard
 * export route and by the mind map draft, and without them those items would fall through to
 * 手动录入 - a claim about how the user typed the text, which is not what happened. Every later branch
 * keeps the order and the readings this mapping has always had.
 */
export function contentSourceKey(metadata: Record<string, unknown> | null | undefined): TranslationKey {
  const source = typeof metadata?.source === "string" ? metadata.source.trim() : "";
  if (source === "mindmap") return "arSourceMindmap";
  if (source === "whiteboard") return "arSourceWhiteboard";
  // A run opened from the topic list is more specific than "written in the wizard" (CI-P2-01).
  if (metadata?.topicId) return "arSourceTopic";
  if (metadata?.aiWriting) return "arSourceWizard";
  const generation = String(metadata?.generationType ?? "");
  if (generation.startsWith("url")) return "arSourceUrl";
  if (generation === "topic") return "arSourceAi";
  return "arSourceManual";
}
