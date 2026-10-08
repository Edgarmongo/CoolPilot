import { localizedPath, type Locale } from "@/lib/i18n-config";

/**
 * The hand-off from "content was just produced" to "content is being edited" (P5-C1, F-C0-4 of
 * `docs/creator-workflow-audit.md`).
 *
 * The article editor is a state of the 文章创作 workspace, not a route of its own
 * (`src/components/creation/articles-workspace.tsx` renders `ArticleEditor` in place of the list), so
 * the two generators - the AI writing wizard and the article AI dialog - hand their result over
 * through this one query parameter instead of a second screen: the workspace opens the item when it
 * sees it and the editor's own state does the rest.
 *
 * `?edit=<content id>` is an *entry*, not state. The workspace drops it when the editor closes, so a
 * reload lands on the list again instead of re-opening whatever was last edited.
 */
export const articleEditorParam = "edit";

/** The list route the parameter hangs off, without a locale prefix. */
export const articleEditorPath = "/creation/articles";

/**
 * `/{locale}/creation/articles?edit={id}` - the deep link the generators link to.
 *
 * An empty id yields the plain list path rather than a link that would open nothing.
 */
export function articleEditorHref(locale: Locale, contentId: string) {
  const id = contentId.trim();
  if (!id) return localizedPath(locale, articleEditorPath);
  return localizedPath(locale, `${articleEditorPath}?${articleEditorParam}=${encodeURIComponent(id)}`);
}

/**
 * The content id the current URL asks the editor to open, or `""` when the URL asks for nothing.
 *
 * Typed structurally rather than as `URLSearchParams` so the caller can pass Next's read-only
 * `useSearchParams()` result unchanged.
 */
export function readArticleEditorTarget(search: { get(name: string): string | null } | null | undefined) {
  return (search?.get(articleEditorParam) ?? "").trim();
}
