"use client";

import { useState } from "react";
import useSWR from "swr";
import { FileText, Pencil, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsolePagination } from "@/components/ui/console-pagination";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiDelete, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { knowledgeCharacterCount } from "@/lib/knowledge-base";
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

/** Where an article came from, derived from the item metadata. */
function articleSourceKey(item: ContentItem): TranslationKey {
  const metadata = item.metadata ?? {};
  if (metadata.aiWriting) return "arSourceWizard";
  const generation = String(metadata.generationType ?? "");
  if (generation.startsWith("url")) return "arSourceUrl";
  if (generation === "topic") return "arSourceAi";
  return "arSourceManual";
}

function articleImages(item: ContentItem): string[] {
  const value = item.metadata?.images;
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  return item.imagePath ? [item.imagePath] : [];
}

function imageUrl(path: string) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const fileName = path.split(/[\\/]/).pop() ?? "";
  return fileName ? `/api/agent/artifacts?file=${encodeURIComponent(fileName)}` : "";
}

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export function ArticlesWorkspace() {
  const { t } = useI18n();
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
        onExit={() => {
          setEditingItem(null);
          void mutate();
        }}
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
                            src={imageUrl(images[0])}
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
                    <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{t(articleSourceKey(item))}</td>
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
        onClose={() => setAiOpen(false)}
        onGenerated={(title) => {
          setNotice(t("arGenerated", { title }));
          void mutate();
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
