import { localizedPath, type Locale } from "@/lib/i18n-config";
import type { TranslationKey } from "@/lib/locale-resources";
import type { TopicRecord, TopicStatus } from "@/lib/types";

/**
 * Client-safe topic helpers (CI-P2-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Nothing here touches the database: the topic workspace filters the list it already has and the
 * wizard receives its material as text, which is what keeps this module importable from a browser
 * component and testable without a database (the same split `@/lib/products` uses).
 */

export const topicStatuses = ["active", "archived"] as const;

export const topicStatusLabelKeys: Record<TopicStatus, TranslationKey> = {
  active: "tpStatusActive",
  archived: "tpStatusArchived",
};

/** The topic list's own search: what the user typed, against every field they can see. */
export function topicMatchesQuery(topic: TopicRecord, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  return (
    topic.title.toLowerCase().includes(keyword) ||
    topic.description.toLowerCase().includes(keyword) ||
    topic.source.toLowerCase().includes(keyword) ||
    topic.keywords.some((entry) => entry.toLowerCase().includes(keyword))
  );
}

/**
 * What a topic becomes when it enters the writing wizard: the free-text material of step 1.
 *
 * It is the topic's own fields, worded as material, rather than a hidden second channel into the
 * prompt: the user sees exactly what was carried over in the wizard's textarea, can edit it there,
 * and the topic itself is not modified by writing about it.
 */
export function topicMaterialText(topic: TopicRecord) {
  return [
    `选题：${topic.title}`,
    topic.description.trim() ? `说明：${topic.description.trim()}` : "",
    topic.keywords.length ? `关键词：${topic.keywords.join("、")}` : "",
    topic.sourceUrl.trim()
      ? `来源：${topic.sourceUrl.trim()}`
      : topic.source.trim()
        ? `来源：${topic.source.trim()}`
        : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The hand-off from "a topic is worth writing about" to "the wizard is writing it" (P2-01-04).
 *
 * Same shape as `@/lib/editor-link`: a query parameter on the existing wizard route, read once by the
 * wizard and remembered by the generation entry as `topicId`, so the article keeps the link back.
 */
export const topicWritingParam = "topicId";

/** The wizard route the parameter hangs off, without a locale prefix. */
export const topicWritingPath = "/creation/ai-writing";

/** `/{locale}/creation/ai-writing?topicId={id}` - the link a topic row offers. */
export function topicWritingHref(locale: Locale, topicId: string) {
  const id = topicId.trim();
  if (!id) return localizedPath(locale, topicWritingPath);
  return localizedPath(locale, `${topicWritingPath}?${topicWritingParam}=${encodeURIComponent(id)}`);
}

/**
 * The topic id the current URL asks the wizard to write about, or `""` when it asks for nothing.
 *
 * Typed structurally rather than as `URLSearchParams` so the caller can pass Next's read-only
 * `useSearchParams()` result unchanged.
 */
export function readTopicWritingTarget(search: { get(name: string): string | null } | null | undefined) {
  return (search?.get(topicWritingParam) ?? "").trim();
}
