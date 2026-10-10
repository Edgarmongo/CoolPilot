import type { BrandRecord } from "@/lib/types";

/**
 * Client-safe brand helpers (CI-P2-02 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Nothing here touches the database: the workspace filters the list it already has and the wizard
 * shows what a selection will inject, which is what keeps this module importable from a browser
 * component and testable without a database (the same split `@/lib/products` and `@/lib/topics` use).
 */

/** The brand list's own search: what the user typed, against every field they can see. */
export function brandMatchesQuery(brand: BrandRecord, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  return (
    brand.name.toLowerCase().includes(keyword) ||
    brand.description.toLowerCase().includes(keyword) ||
    brand.targetAudience.toLowerCase().includes(keyword) ||
    brand.tone.toLowerCase().includes(keyword) ||
    brand.keywords.some((entry) => entry.toLowerCase().includes(keyword)) ||
    brand.bannedWords.some((entry) => entry.toLowerCase().includes(keyword))
  );
}

/**
 * What a selected brand will contribute to the writing context, in the user's language.
 *
 * The labels are arguments rather than lookups, because this module is locale-free: the wizard passes
 * the four it translated. Only the fields that will actually be injected are shown - an empty 禁用表达
 * is silence, not a promise.
 */
export function brandContextSummary(
  brand: BrandRecord,
  labels: { audience: string; tone: string; keywords: string; banned: string },
) {
  return [
    brand.targetAudience.trim() ? `${labels.audience}：${brand.targetAudience.trim()}` : "",
    brand.tone.trim() ? `${labels.tone}：${brand.tone.trim()}` : "",
    brand.keywords.length ? `${labels.keywords}：${brand.keywords.join("、")}` : "",
    brand.bannedWords.length ? `${labels.banned}：${brand.bannedWords.join("、")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
