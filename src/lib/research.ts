import { localizedPath, type Locale } from "@/lib/i18n-config";
import type { TranslationKey } from "@/lib/locale-resources";
import {
  researchMaterialKinds,
  researchMaterialStatuses,
  type ResearchMaterialKind,
  type ResearchMaterialRecord,
  type ResearchMaterialStatus,
} from "@/lib/types";

/**
 * Client-safe research-material helpers (CI-P3-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Nothing here touches the database: the workspace filters the list it already has, and the generation
 * entries compose their material from the row they read - which is what keeps this module importable
 * from a browser component and testable without a database (the same split `@/lib/topics` uses).
 */

export const researchMaterialKindLabelKeys: Record<ResearchMaterialKind, TranslationKey> = {
  text: "rsKindText",
  url: "rsKindUrl",
  file: "rsKindFile",
  // CI-P3-02: a transcript's material is labelled by what the source file was, not by "file".
  audio: "rsKindAudio",
  video: "rsKindVideo",
};

export const researchMaterialStatusLabelKeys: Record<ResearchMaterialStatus, TranslationKey> = {
  draft: "rsStatusDraft",
  ready: "rsStatusReady",
  empty: "rsStatusEmpty",
  failed: "rsStatusFailed",
};

export function isResearchMaterialKind(value: unknown): value is ResearchMaterialKind {
  return (researchMaterialKinds as readonly string[]).includes(value as string);
}

export function isResearchMaterialStatus(value: unknown): value is ResearchMaterialStatus {
  return (researchMaterialStatuses as readonly string[]).includes(value as string);
}

/**
 * How much of a stored material may enter a prompt.
 *
 * The reader caps a page at 12 000 characters; a prompt is not a library, so the injected window is
 * smaller. The cap is a documented limitation of the hand-off, never a claim about the record: what the
 * workspace shows and what the API answers is the whole stored text.
 */
export const researchMaterialPromptLimit = 6_000;

/** Only `http(s)` pages are sources the image resolver (or this reader) can read. */
export function isReadableResearchUrl(url: string) {
  return /^https?:\/\//i.test(url.trim());
}

/** The material list's own search: what the user typed, against every field they can see. */
export function researchMaterialMatchesQuery(material: ResearchMaterialRecord, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  return (
    material.title.toLowerCase().includes(keyword) ||
    material.content.toLowerCase().includes(keyword) ||
    material.sourceUrl.toLowerCase().includes(keyword) ||
    material.fileName.toLowerCase().includes(keyword) ||
    material.tags.some((entry) => entry.toLowerCase().includes(keyword))
  );
}

/** True when a stored material actually has text a generation could be written from. */
export function researchMaterialHasText(material: ResearchMaterialRecord) {
  return material.content.trim().length > 0;
}

/**
 * The status a material honestly starts (or restarts) in (CI-P3-01): `ready` when there is text to write
 * from, `draft` when there is not.
 *
 * Only these two are ever derived, because only they are facts the caller already has. `empty` and
 * `failed` are outcomes of reading a source and are written by `api/research/[id]/fetch` alone, which is
 * what keeps "抓取成功" a claim no create or edit can make.
 *
 * Read together with `fetchedAt`, `ready` is also specific: a `ready` material with a read time carries
 * text that came from its source, and one without carries text the user provided.
 */
export function derivedResearchStatus(content: string): ResearchMaterialStatus {
  return content.trim() ? "ready" : "draft";
}

/**
 * What a research material becomes when it enters a generation prompt (P3-01-04).
 *
 * Two distinctions are kept here rather than being flattened into one string:
 *
 * - **A source is not its text.** The url is labelled 来源 and the body 正文, so a material whose page was
 *   never read (or failed to read) contributes a title and a link and *no* invented 正文 - the prompt
 *   never receives text that only looks like the page.
 * - **The stored text is what was read.** Nothing is summarised, rewritten or guessed on the way in: the
 *   model sees the record's own `content`, which is the same text the workspace shows the user.
 */
export function researchMaterialPromptText(material: ResearchMaterialRecord) {
  const content = material.content.trim();
  return [
    `研究素材：${material.title}`,
    material.sourceUrl.trim() ? `来源：${material.sourceUrl.trim()}` : "",
    content ? `正文：\n${content.slice(0, researchMaterialPromptLimit)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The source urls a stored material adds to an article's image sources (P3-01-05).
 *
 * The url travels exactly when the material contributed text: an article's sources are the pages it was
 * written from, so a material whose page was never read is not one of them - and the image resolver,
 * which reads whatever url it is given, is never sent to a page this run did not use.
 */
export function researchMaterialSourceUrls(material: ResearchMaterialRecord) {
  const url = material.sourceUrl.trim();
  if (!researchMaterialHasText(material) || !isReadableResearchUrl(url)) return [];
  return [url];
}

/**
 * The hand-off from "this material is worth writing from" to "the dialog is writing it" (P3-01-04).
 *
 * The AI generation dialog lives in the 文章创作 workspace, so a material row links there with its id and
 * the workspace opens the dialog with that material selected. The id is an *entry*, not state, and the
 * text still never travels through the browser: when the run happens the route reads the stored row
 * (`POST /api/content/generate`'s `researchMaterialId`), exactly as it reads a selected topic or brand.
 */
export const researchMaterialWritingParam = "researchMaterialId";

/** The workspace route the parameter hangs off, without a locale prefix. */
export const researchMaterialWritingPath = "/creation/articles";

/** `/{locale}/creation/articles?researchMaterialId={id}` - the link a material row offers. */
export function researchMaterialWritingHref(
  locale: Locale,
  materialId: string,
  options: { includeExtraction?: boolean } = {},
) {
  const id = materialId.trim();
  if (!id) return localizedPath(locale, researchMaterialWritingPath);
  const extra = options.includeExtraction ? `&${researchMaterialExtractionParam}=1` : "";
  return localizedPath(
    locale,
    `${researchMaterialWritingPath}?${researchMaterialWritingParam}=${encodeURIComponent(id)}${extra}`,
  );
}

/**
 * The parameter that asks the generation dialog to *also* read the material's stored 研究提炼 (CI-P3-03).
 *
 * It rides along with `researchMaterialId` and is a separate flag on purpose: opening the dialog on a
 * material is one decision ("write from this"), and handing the distillation to the writer is another
 * ("and use what was distilled from it"). A material whose result nobody asked to use reaches the prompt
 * exactly as it did before this card.
 */
export const researchMaterialExtractionParam = "includeExtraction";

/** True when the current URL asks the generation dialog to use the material's stored extraction. */
export function readResearchMaterialExtractionTarget(
  search: { get(name: string): string | null } | null | undefined,
) {
  return (search?.get(researchMaterialExtractionParam) ?? "").trim() === "1";
}

/** The material id the current URL asks the creation workspace to write from, or `""` for nothing. */
export function readResearchMaterialWritingTarget(search: { get(name: string): string | null } | null | undefined) {
  return (search?.get(researchMaterialWritingParam) ?? "").trim();
}

