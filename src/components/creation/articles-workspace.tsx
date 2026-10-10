"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { FileText, Pencil, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsolePagination } from "@/components/ui/console-pagination";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiDelete, apiGet, apiPost, swrFetcher } from "@/lib/api-client";
import { resolveArtifactImageSrc } from "@/lib/artifact-image-url";
import { contentImageList } from "@/lib/content-images";
import { useI18n } from "@/lib/i18n";
import { articleEditorPath, readArticleEditorTarget } from "@/lib/editor-link";
import { localizedPath } from "@/lib/i18n-config";
import { knowledgeCharacterCount } from "@/lib/knowledge-base";
import { contentSourceKey } from "@/lib/content-source";
import { readResearchMaterialExtractionTarget, readResearchMaterialWritingTarget } from "@/lib/research";
import type { TranslationKey } from "@/lib/locale-resources";
import type { ContentItem, ContentPage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ArticleEditor } from "./article-editor/article-editor";
import { ArticleAiDialog } from "./article-ai-dialog";
import { ContentPublishDialog } from "./content-publish-dialog";

const PAGE_SIZE = 20;

type StatusFilter = "all" | "draft" | "ready" | "posted" | "failed";

const statusLabelKeys: Record<Exclude<StatusFilter, "all">, TranslationKey> = {
  draft: "arStatusDraft",
  ready: "arStatusReady",
  posted: "arStatusPosted",
  failed: "arStatusFailed",
};

const statusClass: Record<Exclude<StatusFilter, "all">, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  ready: "bg-sky-100 text-sky-700",
  posted: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
};

function articleImages(item: ContentItem): string[] {
  // C4: one reader for the ordered image list (cover first), shared with the editor and the publish
  // adapter, instead of this file keeping its own copy of the `metadata.images` fallback rule.
  return contentImageList(item);
}

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export function ArticlesWorkspace() {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ type: "article", page: String(page), pageSize: String(PAGE_SIZE) });
  if (status !== "all") params.set("status", status);
  if (query.trim()) params.set("q", query.trim());
  const { data, mutate, isLoading } = useSWR<ContentPage>(`/api/content?${params.toString()}`, swrFetcher, {
    keepPreviousData: true,
    refreshInterval: 5000,
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const [editingItem, setEditingItem] = useState<ContentItem | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [publishItem, setPublishItem] = useState<ContentItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContentItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

  const searchParams = useSearchParams();
  const editorTarget = readArticleEditorTarget(searchParams);
  // A deep link is consumed once: the id is remembered, so an item that cannot be opened (deleted,
  // stale bookmark) reports itself and leaves the user on the list instead of retrying forever. An
  // address that asks for nothing forgets the last entry, so the same item can be opened again later.
  const openedTargetRef = useRef("");

  useEffect(() => {
    if (!editorTarget) {
      openedTargetRef.current = "";
      return;
    }
    if (openedTargetRef.current === editorTarget) return;
    let live = true;
    void (async () => {
      try {
        const item = await apiGet<ContentItem>(`/api/content/${encodeURIComponent(editorTarget)}`);
        if (!live) return;
        // The id is remembered when the attempt *settles*, never when it starts: a run that is
        // cancelled while its request is in flight (React repeats one setup/cleanup cycle per
        // client-side mount in development, and `t` is a dependency) must stay able to open the
        // item, and marking the entry as consumed up front would strand the deep link on the list.
        // Same shape as the `?topicId=` entry of the AI writing wizard (`ai-writing-workspace.tsx`).
        openedTargetRef.current = editorTarget;
        setEditingItem(item);
      } catch {
        if (!live) return;
        openedTargetRef.current = editorTarget;
        setNotice(t("arEditorOpenFailed"));
      }
    })();
    return () => {
      live = false;
    };
  }, [editorTarget, t]);

  /**
   * The hand-off from a research material (CI-P3-01): `?researchMaterialId=<id>` opens this workspace's
   * generation dialog on that material, so a library row is one click away from an article. Like the editor
   * entry above, it is consumed once and dropped from the URL - a reload lands on the list rather than
   * reopening a run the user did not start again. The id is only a *selection*: `POST /api/content/generate`
   * reads the stored row when the run happens, so no copy of the text passes through this component.
   */
  const researchTarget = readResearchMaterialWritingTarget(searchParams);
  const researchExtractionTarget = readResearchMaterialExtractionTarget(searchParams);
  const [aiResearchMaterialId, setAiResearchMaterialId] = useState("");
  const consumedResearchRef = useRef("");

  useEffect(() => {
    if (!researchTarget) {
      consumedResearchRef.current = "";
      return;
    }
    if (consumedResearchRef.current === researchTarget) return;
    consumedResearchRef.current = researchTarget;
    window.queueMicrotask(() => {
      setAiResearchMaterialId(researchTarget);
      setAiOpen(true);
    });
    window.history.replaceState(null, "", localizedPath(locale, articleEditorPath));
  }, [researchTarget, locale]);

  async function openCreate() {
    setCreating(true);
    try {
      const item = await apiPost<ContentItem>("/api/content", { title: t("aeUntitled"), type: "article" });
      await mutate();
      setEditingItem(item);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(item: ContentItem) {
    setEditingItem(item);
  }

  /**
   * Closing the editor also drops the entry parameter, so a reload shows the list instead of reopening
   * whatever was edited last.
   *
   * The native History API rather than `router.replace`: this route reads `useSearchParams` inside a
   * `Suspense` boundary (see the page), and there a `replace` whose pathname is already the current one
   * never commits - the router re-fetches the *current* URL and the address bar keeps the parameter
   * (observed against a production build of this batch). `replaceState` is the documented way to change
   * the URL without navigating, and `useSearchParams` follows it.
   */
  function closeEditor() {
    setEditingItem(null);
    void mutate();
    if (editorTarget) window.history.replaceState(null, "", localizedPath(locale, articleEditorPath));
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/content/${deleteTarget.id}`);
      setDeleteTarget(null);
      await mutate();
    } finally {
      setDeleting(false);
    }
  }

  if (editingItem) {
    return (
      <ArticleEditor
        key={editingItem.id}
        item={editingItem}
        onSaved={(next) => {
          setEditingItem(next);
          void mutate();
        }}
        onExit={closeEditor}
      />
    );
  }

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

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-white p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white">
            <FileText size={18} />
          </span>
          <div>
            <p className="font-semibold text-zinc-900">{t("aeTitle")}</p>
            <p className="text-xs text-zinc-400">{t("aeSubtitle")}</p>
          </div>
        </div>
        <Button size="sm" loading={creating} onClick={() => void openCreate()}>
          <Plus size={14} />
          {t("arNew")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder={t("arSearchPlaceholder")}
          className={cn(consoleInputClass, "w-64")}
        />
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as StatusFilter);
            setPage(1);
          }}
          className={cn(consoleInputClass, "w-32")}
        >
          <option value="all">{t("arStatusAll")}</option>
          {(Object.keys(statusLabelKeys) as Array<Exclude<StatusFilter, "all">>).map((value) => (
            <option key={value} value={value}>
              {t(statusLabelKeys[value])}
            </option>
          ))}
        </select>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setAiOpen(true)}>
            <Sparkles size={14} />
            {t("arAiTitle")}
          </Button>
        </div>
      </div>
      {isLoading ? (
        <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">
          {t("loading")}
        </p>
      ) : items.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-sky-100 bg-white px-4 py-20 text-center">
          <FileText className="size-10 text-zinc-300" />
          <p className="max-w-md text-sm text-zinc-500">{t("arEmpty")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-sky-100 bg-white">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-sky-50/60 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t("arColTitle")}</th>
                <th className="px-3 py-3 font-medium">{t("arColSource")}</th>
                <th className="px-3 py-3 font-medium">{t("arColWords")}</th>
                <th className="px-3 py-3 font-medium">{t("arColImages")}</th>
                <th className="px-3 py-3 font-medium">{t("arColStatus")}</th>
                <th className="px-3 py-3 font-medium">{t("arColCreatedAt")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("arColActions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const images = articleImages(item);
                const statusKey = (
                  ["draft", "ready", "posted", "failed"].includes(item.status) ? item.status : "ready"
                ) as Exclude<StatusFilter, "all">;
                return (
                  <tr key={item.id} className="border-t border-sky-50">
                    <td className="max-w-md px-4 py-3">
                      <div className="flex items-center gap-3">
                        {images[0] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={resolveArtifactImageSrc(images[0])}
                            alt=""
                            className="size-9 shrink-0 rounded-xl border border-sky-100 object-cover"
                          />
                        ) : (
                          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-500">
                            <FileText className="size-4" />
                          </span>
                        )}
                        <span className="truncate font-medium text-zinc-900">
                          {item.title || t("agentThreadUntitled")}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{t(contentSourceKey(item.metadata))}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-zinc-500">
                      {knowledgeCharacterCount(item.body)}
                      {t("kbCharUnit")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{images.length}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusClass[statusKey])}>
                        {t(statusLabelKeys[statusKey])}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-zinc-400">{formatDateTime(item.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(item)}
                          title={t("arEdit")}
                          className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPublishItem(item)}
                          title={t("arPublish")}
                          className="rounded-lg p-1.5 text-sky-600 transition hover:bg-sky-50"
                        >
                          <Send className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(item)}
                          title={t("arDelete")}
                          className="rounded-lg p-1.5 text-rose-500 transition hover:bg-rose-50"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-zinc-400">{t("kbTotal", { count: total })}</span>
        <ConsolePagination page={page} totalItems={total} onPageChange={setPage} />
      </div>

      <ArticleAiDialog
        open={aiOpen}
        initialResearchMaterialId={aiResearchMaterialId}
        initialIncludeExtraction={researchExtractionTarget}
        onClose={() => setAiOpen(false)}
        onGenerated={(item) => {
          setNotice(t("arGenerated", { title: item.title }));
          void mutate();
          // C1: what was just generated opens in the editor instead of ending as a toast (F-C0-4).
          setEditingItem(item);
        }}
      />
      <ContentPublishDialog
        item={publishItem}
        type="article"
        onClose={() => setPublishItem(null)}
        onPublished={() => void mutate()}
      />
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title={t("arDelete")} maxWidth="sm">
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">{t("arDeleteConfirm", { title: deleteTarget?.title ?? "" })}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("btnCancel")}
            </Button>
            <Button variant="danger" onClick={() => void handleDelete()} loading={deleting}>
              {t("btnDelete")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
