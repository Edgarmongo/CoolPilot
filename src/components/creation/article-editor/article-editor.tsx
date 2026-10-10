"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Copy,
  Eye,
  Image as ImageIcon,
  Languages,
  LayoutTemplate,
  PenLine,
  Save,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiPatch } from "@/lib/api-client";
import { resolveArtifactImageSrc } from "@/lib/artifact-image-url";
import {
  articleCharacterCount,
  articleThemeCss,
  articleThemes,
  buildArticleExportHtml,
  defaultArticleThemeId,
  ensureArticleHtml,
  findArticleTheme,
  htmlToPlainText,
  isArticleThemeId,
  type ArticleThemeId,
} from "@/lib/article-themes";
import { contentImageList } from "@/lib/content-images";
import { useI18n } from "@/lib/i18n";
import type { ContentItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ContentPublishDialog } from "../content-publish-dialog";
import { ArticleEditorToolbar } from "./article-editor-toolbar";
import { ArticleImageDialog } from "./article-image-dialog";
import { ArticleRewriteDialog } from "./article-rewrite-dialog";
import { ArticleTranslateDialog } from "./article-translate-dialog";

/** Width presets offered when an inserted image is selected. */
const IMAGE_WIDTH_PRESETS = ["25%", "50%", "75%", "100%"] as const;

/** Corner handles used to drag an image wider or narrower. */
const IMAGE_HANDLES: Array<{ key: string; direction: number; style: React.CSSProperties }> = [
  { key: "nw", direction: -1, style: { left: -7, top: -7, cursor: "nwse-resize" } },
  { key: "ne", direction: 1, style: { right: -7, top: -7, cursor: "nesw-resize" } },
  { key: "sw", direction: -1, style: { left: -7, bottom: -7, cursor: "nesw-resize" } },
  { key: "se", direction: 1, style: { right: -7, bottom: -7, cursor: "nwse-resize" } },
];

/** A minimal in-editor padding allowance so images never touch the edges. */
const EDITOR_PADDING = 48;

type Box = { top: number; left: number; width: number; height: number };

/** Position of `element` relative to a positioned `container`. */
function elementBox(element: HTMLElement, container: HTMLElement): Box {
  const rect = element.getBoundingClientRect();
  const base = container.getBoundingClientRect();
  return {
    top: rect.top - base.top,
    left: rect.left - base.left,
    width: rect.width,
    height: rect.height,
  };
}

function storedThemeId(item: ContentItem): ArticleThemeId {
  const value = item.metadata?.themeId;
  return isArticleThemeId(value) ? value : defaultArticleThemeId;
}

/** Full-page rich-text editor for a single article, matching the 文章创作 screen. */
export function ArticleEditor({
  item,
  onSaved,
  onExit,
}: {
  item: ContentItem;
  onSaved: (item: ContentItem) => void;
  onExit: () => void;
}) {
  const { t } = useI18n();
  const initialHtml = useMemo(() => ensureArticleHtml(item.body), [item.body]);
  const [title, setTitle] = useState(item.title);
  const [html, setHtml] = useState(initialHtml);
  const [themeId, setThemeId] = useState<ArticleThemeId>(() => storedThemeId(item));
  const [images, setImages] = useState<string[]>(() => contentImageList(item));
  const [preview, setPreview] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [imageMode, setImageMode] = useState<"inline" | "cover" | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  // The body editor is intentionally left uncontrolled so React never rewrites
  // its DOM. React re-applies `dangerouslySetInnerHTML` on the first update
  // after mount, which used to blank the freshly pasted content (so the first
  // paste from another app looked like a no-op). We seed the HTML imperatively
  // instead, and only when the source body actually changes.
  const seededNodeRef = useRef<HTMLDivElement | null>(null);
  const seededHtmlRef = useRef<string | null>(null);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    // The editor DOM is uncontrolled. Re-seed when the stored body changes and
    // also whenever React hands us a different node, otherwise a re-mounted
    // editor would stay blank (that made saved articles look empty).
    if (seededNodeRef.current === el && seededHtmlRef.current === initialHtml) return;
    seededNodeRef.current = el;
    seededHtmlRef.current = initialHtml;
    el.innerHTML = initialHtml;
  }, [initialHtml]);

  // The selected image lives in a ref (DOM nodes must not sit in state); the
  // `imageBox` state drives the selection frame painted over it.
  const selectedImageRef = useRef<HTMLImageElement | null>(null);
  const [imageBox, setImageBox] = useState<Box | null>(null);

  // Keep the selection frame aligned when the window is resized.
  useEffect(() => {
    const view = editorRef.current?.ownerDocument.defaultView;
    if (!view) return;
    const handle = () => {
      const element = selectedImageRef.current;
      const container = editorRef.current?.parentElement;
      if (element && element.isConnected && container) setImageBox(elementBox(element, container));
    };
    view.addEventListener("resize", handle);
    return () => view.removeEventListener("resize", handle);
  }, []);

  const theme = findArticleTheme(themeId);
  const wordCount = articleCharacterCount(html);
  const cover = images[0] ?? "";
  const shortId = item.id.slice(0, 8).toUpperCase();

  function syncFromEditor() {
    if (editorRef.current) setHtml(editorRef.current.innerHTML);
  }

  function runCommand(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncFromEditor();
  }

  function insertLink() {
    const url = window.prompt(t("aeLinkPrompt"), "https://");
    if (!url) return;
    runCommand("createLink", url);
  }

  function applyTheme(next: ArticleThemeId) {
    clearImageSelection();
    setThemeId(next);
    setPreview(true);
  }

  function pickCover(image: { fileName: string }) {
    setImages((prev) => [image.fileName, ...prev.filter((entry) => entry !== image.fileName)].slice(0, 12));
  }

  function insertImage(image: { fileName: string }) {
    const url = resolveArtifactImageSrc(image.fileName);
    // Leave preview mode first so the body is editable again before inserting.
    setPreview(false);
    window.setTimeout(() => {
      const el = editorRef.current;
      const ownerDocument = el?.ownerDocument;
      if (!el || !ownerDocument) return;
      const selection = ownerDocument.getSelection();
      const caretInside = Boolean(selection && selection.rangeCount > 0 && el.contains(selection.anchorNode));
      el.focus();
      // `execCommand` inserts at the current caret, but the picker dialog steals
      // the selection, so fall back to appending the image at the end of the body.
      if (!caretInside && selection) {
        const range = ownerDocument.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      ownerDocument.execCommand("insertHTML", false, `<img src="${url}" alt="" />`);
      syncFromEditor();
    }, 0);
  }

  function clearImageSelection() {
    selectedImageRef.current = null;
    setImageBox(null);
  }

  /** Clicking a body image selects it so it can be resized or removed. */
  function selectImage(target: EventTarget | null) {
    const container = editorRef.current?.parentElement;
    const element = target as HTMLElement | null;
    if (!container || !element || element.tagName !== "IMG") {
      clearImageSelection();
      return;
    }
    const image = element as HTMLImageElement;
    selectedImageRef.current = image;
    setImageBox(elementBox(image, container));
  }

  function applyImageWidth(width: string) {
    const element = selectedImageRef.current;
    const container = editorRef.current?.parentElement;
    if (!element || !container) return;
    element.style.width = width;
    element.style.height = "auto";
    syncFromEditor();
    setImageBox(elementBox(element, container));
  }

  function removeSelectedImage() {
    const element = selectedImageRef.current;
    if (!element) return;
    element.remove();
    clearImageSelection();
    syncFromEditor();
  }

  /** Drags a corner handle to change an image's width (height follows). */
  function startImageResize(event: React.PointerEvent<HTMLButtonElement>, direction: number) {
    const element = selectedImageRef.current;
    const container = editorRef.current?.parentElement;
    const view = element?.ownerDocument.defaultView;
    if (!element || !container || !view) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = element.getBoundingClientRect().width;
    const maxWidth = Math.max(container.clientWidth - EDITOR_PADDING, 80);
    const handleMove = (moveEvent: PointerEvent) => {
      const next = Math.min(Math.max(startWidth + direction * (moveEvent.clientX - startX), 60), maxWidth);
      element.style.width = `${Math.round(next)}px`;
      element.style.height = "auto";
      setImageBox(elementBox(element, container));
    };
    const handleUp = () => {
      view.removeEventListener("pointermove", handleMove);
      view.removeEventListener("pointerup", handleUp);
      syncFromEditor();
    };
    view.addEventListener("pointermove", handleMove);
    view.addEventListener("pointerup", handleUp);
  }

  async function copyText(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(message);
    } catch {
      setNotice(t("aeCopyFailed"));
    }
  }

  async function save(status?: ContentItem["status"]) {
    setSaving(true);
    try {
      const plain = htmlToPlainText(html);
      const updated = await apiPatch<ContentItem>(`/api/content/${item.id}`, {
        title: title.trim() || item.title,
        body: html,
        postReadyText: plain,
        images,
        themeId,
        ...(status ? { status } : {}),
      });
      onSaved(updated);
      setNotice(status === "draft" ? t("aeDraftSaved") : t("aeSaved"));
    } finally {
      setSaving(false);
    }
  }

  async function openPublish() {
    if (!publishOpen) await save().catch(() => undefined);
    setPublishOpen(true);
  }

  function handleRewritten(updated: ContentItem) {
    onSaved(updated);
    setTitle(updated.title);
    setHtml(ensureArticleHtml(updated.body));
    setNotice(t("rwDone"));
  }

  function handleTranslated(updated: ContentItem) {
    onSaved(updated);
    setTitle(updated.title);
    setHtml(ensureArticleHtml(updated.body));
    setNotice(t("trDone"));
  }

  /** The original Markdown-ish rendering used while editing. */
  const plainBodyClass =
    "min-h-[420px] p-6 text-[15px] leading-7 text-zinc-800 outline-none [&_blockquote]:border-l-4 [&_blockquote]:border-zinc-300 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-500 [&_h1]:mb-3 [&_h1]:mt-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-semibold [&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-lg [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6";
  // The default theme adds no styling, so its preview stays at the original
  // rendering (identical to content typed or pasted in).
  const editorClass = preview && theme.styles ? "article-theme min-h-[420px] p-6 outline-none" : plainBodyClass;

  const actionButton = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm transition",
      active ? "bg-sky-100 text-sky-700" : "text-zinc-500 hover:bg-zinc-100",
    );

  return (
    <div className="space-y-4">
      {notice ? (
        <div className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <span className="truncate">{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="ml-3 font-bold opacity-70 hover:opacity-100">
            ×
          </button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-[0_12px_28px_rgba(37,99,235,0.06)]">
        <div className="flex items-center gap-3 border-b border-sky-50 px-4 py-2">
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100"
          >
            <ArrowLeft className="size-4" />
            {t("aeBack")}
          </button>
          <span className="ml-auto text-xs text-zinc-400">{saving ? t("aeSaving") : t("aeAutoHint")}</span>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-3">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("arFieldTitlePlaceholder")}
              className="w-full border-none bg-transparent text-2xl font-bold text-zinc-900 outline-none placeholder:text-zinc-300"
            />

            <div className="flex flex-wrap items-center gap-1 border-b border-zinc-100 pb-2">
              <button
                type="button"
                className={actionButton(!preview)}
                onClick={() => {
                  clearImageSelection();
                  setPreview(false);
                }}
              >
                <PenLine className="size-4" />
                {t("aeEdit")}
              </button>
              <button
                type="button"
                className={actionButton(preview)}
                onClick={() => {
                  clearImageSelection();
                  setPreview(true);
                }}
              >
                <Eye className="size-4" />
                {t("aePreview")}
              </button>
              <button
                type="button"
                className={actionButton(layoutOpen)}
                onClick={() => {
                  clearImageSelection();
                  setLayoutOpen((prev) => !prev);
                  setPreview(true);
                }}
              >
                <LayoutTemplate className="size-4" />
                {t("aeFormat")}
              </button>

              <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
                <span>
                  {t("aeWords")}: <span className="tabular-nums text-zinc-500">{wordCount}</span>
                </span>
                <span>
                  {t("aeArticleId")}: <span className="font-mono text-zinc-500">{shortId}</span>
                </span>
              </div>
            </div>

            {layoutOpen ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2">
                <span className="text-sm text-zinc-500">{t("aeTheme")}</span>
                <select
                  value={themeId}
                  onChange={(event) => applyTheme(event.target.value as ArticleThemeId)}
                  className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-sky-400"
                >
                  {articleThemes.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => applyTheme(themeId)}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm text-zinc-500 transition hover:bg-white"
                >
                  <Wand2 className="size-4" />
                  {t("aeReformat")}
                </button>
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={() => void copyText(buildArticleExportHtml(html, theme, title), t("aeCopyHtmlDone"))}
                >
                  <Copy size={14} />
                  {t("aeCopyHtml")}
                </Button>
              </div>
            ) : null}

            {!preview ? (
              <ArticleEditorToolbar
                onCommand={runCommand}
                onInsertImage={() => setImageMode("inline")}
                onLink={insertLink}
              />
            ) : null}

            <div className="relative rounded-xl border border-zinc-100">
              <style dangerouslySetInnerHTML={{ __html: articleThemeCss(theme) }} />
              <div
                ref={editorRef}
                contentEditable={!preview}
                onInput={syncFromEditor}
                onBlur={syncFromEditor}
                onClick={(event) => selectImage(event.target)}
                className={editorClass}
              />
              {!html && !preview ? (
                <span className="pointer-events-none absolute left-6 top-6 text-sm text-zinc-300">
                  {t("aeBodyPlaceholder")}
                </span>
              ) : null}

              {imageBox && !preview ? (
                <>
                  <div
                    className="pointer-events-none absolute z-10"
                    style={{
                      top: imageBox.top,
                      left: imageBox.left,
                      width: imageBox.width,
                      height: imageBox.height,
                      outline: "2px solid #0ea5e9",
                      outlineOffset: "2px",
                      borderRadius: "0.5rem",
                    }}
                  >
                    {IMAGE_HANDLES.map((handle) => (
                      <button
                        key={handle.key}
                        type="button"
                        title={t("aeImageResize")}
                        aria-label={t("aeImageResize")}
                        onPointerDown={(event) => startImageResize(event, handle.direction)}
                        className="pointer-events-auto absolute size-3 rounded-full border-2 border-sky-500 bg-white"
                        style={handle.style}
                      />
                    ))}
                  </div>
                  <div
                    className="absolute z-10 flex items-center gap-1 rounded-xl border border-sky-100 bg-white px-2 py-1 shadow-lg"
                    style={{ top: imageBox.top + imageBox.height + 8, left: imageBox.left }}
                  >
                    <span className="px-1 text-xs text-zinc-400">{t("aeImageSize")}</span>
                    {IMAGE_WIDTH_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => applyImageWidth(preset)}
                        className="rounded-lg px-1.5 py-0.5 text-xs text-zinc-600 transition hover:bg-sky-50"
                      >
                        {preset}
                      </button>
                    ))}
                    <button
                      type="button"
                      title={t("aeImageRemove")}
                      aria-label={t("aeImageRemove")}
                      onClick={removeSelectedImage}
                      className="ml-1 rounded-lg p-1 text-rose-500 transition hover:bg-rose-50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <aside className="space-y-3">
            <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-3">
              <p className="mb-2 text-sm font-medium text-zinc-700">{t("aePublishSection")}</p>
              <Button className="w-full" onClick={() => void openPublish()}>
                <Send size={15} />
                {t("aeGoPublish")}
              </Button>
              <Button
                variant="outline"
                className="mt-2 w-full"
                loading={saving}
                onClick={() => void save("draft")}
              >
                <Save size={15} />
                {t("aeSaveDraft")}
              </Button>
            </div>

            <div className="rounded-2xl border border-sky-100 bg-white p-3">
              <p className="mb-2 text-sm font-medium text-zinc-700">{t("aeCoverSection")}</p>
              <div className="grid h-32 place-items-center overflow-hidden rounded-xl border border-dashed border-zinc-200 bg-zinc-50">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resolveArtifactImageSrc(cover)} alt="" className="h-32 w-full object-cover" />
                ) : (
                  <div className="grid place-items-center gap-1 text-center text-xs text-zinc-400">
                    <ImageIcon className="size-6 text-zinc-300" />
                    <span>{t("aeCoverHint")}</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setImageMode("cover")}
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-sm text-zinc-700 transition hover:bg-accent"
              >
                <ImageIcon className="size-4" />
                {t("aeSetCover")}
              </button>
            </div>

            <div className="rounded-2xl border border-sky-100 bg-white p-3">
              <p className="mb-2 text-sm font-medium text-zinc-700">{t("aeAiTools")}</p>
              <div className="space-y-2">
                {[
                  { key: "rewrite", icon: <Sparkles className="size-4" />, label: t("aeToolRewrite"), run: () => setRewriteOpen(true) },
                  { key: "translate", icon: <Languages className="size-4" />, label: t("aeToolTranslate"), run: () => setTranslateOpen(true) },
                  {
                    key: "beautify",
                    icon: <LayoutTemplate className="size-4" />,
                    label: t("aeToolBeautify"),
                    run: () => {
                      setLayoutOpen(true);
                      setPreview(true);
                    },
                  },
                  { key: "image", icon: <ImageIcon className="size-4" />, label: t("aeToolInsertImage"), run: () => setImageMode("inline") },
                  {
                    key: "copy",
                    icon: <Copy className="size-4" />,
                    label: t("aeToolCopyBody"),
                    run: () => void copyText(htmlToPlainText(html), t("aeBodyCopied")),
                  },
                ].map((tool) => (
                  <button
                    key={tool.key}
                    type="button"
                    onClick={tool.run}
                    className="flex w-full items-center gap-2 rounded-xl border border-sky-100 px-3 py-2 text-sm text-zinc-700 transition hover:bg-sky-50"
                  >
                    {tool.icon}
                    {tool.label}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>

      <ArticleRewriteDialog
        open={rewriteOpen}
        onClose={() => setRewriteOpen(false)}
        itemId={item.id}
        originalText={htmlToPlainText(html)}
        onRewritten={handleRewritten}
      />
      <ArticleTranslateDialog
        open={translateOpen}
        onClose={() => setTranslateOpen(false)}
        itemId={item.id}
        originalText={htmlToPlainText(html)}
        originalTitle={title}
        onTranslated={handleTranslated}
      />
      <ArticleImageDialog
        open={imageMode !== null}
        onClose={() => setImageMode(null)}
        onPick={(image) => {
          if (imageMode === "cover") pickCover(image);
          else insertImage(image);
        }}
      />
      <ContentPublishDialog
        item={publishOpen ? item : null}
        type="article"
        onClose={() => setPublishOpen(false)}
        onPublished={() => {
          setPublishOpen(false);
          setNotice(t("aePublished"));
        }}
      />
    </div>
  );
}
