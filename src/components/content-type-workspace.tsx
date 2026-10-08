"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Plus, Send } from "lucide-react";
import type { ContentItem, ContentPage } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConsolePagination, useClampConsolePage, usePagedItems } from "@/components/ui/console-pagination";
import { consoleInputClass } from "@/components/ui/console-surface";
import { GenerateContentPanel } from "@/components/generate-content-panel";
import { ContentPublishDialog } from "./creation/content-publish-dialog";

function metadataType(item: ContentItem) {
  const value = item.metadata?.type;
  return typeof value === "string" ? value : "";
}

export function ContentTypeWorkspace({ type }: { type: string }) {
  const { t } = useI18n();
  const { data, mutate } = useSWR<ContentPage>("/api/content?page=1&pageSize=200", swrFetcher, {
    refreshInterval: 5000,
  });
  const items = useMemo(
    () => (data?.items ?? []).filter((item) => metadataType(item) === type),
    [data, type],
  );

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [tab, setTab] = useState<"ai" | "manual">("ai");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [postReadyText, setPostReadyText] = useState("");
  const [saving, setSaving] = useState(false);

  const [publishItem, setPublishItem] = useState<ContentItem | null>(null);

  const { data: imageData } = useSWR<{ images: { fileName: string; url: string }[] }>("/api/images", swrFetcher);
  const imageLibrary = imageData?.images ?? [];
  const [selectedImages, setSelectedImages] = useState<string[]>([]);

  const [page, setPage] = useState(1);
  const { pageItems, safePage } = usePagedItems(items, page);
  useClampConsolePage(page, items.length, setPage);

  async function handleManualCreate() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await apiPost("/api/content", { title: title.trim(), body, postReadyText, type, images: selectedImages });
      setTitle("");
      setBody("");
      setPostReadyText("");
      setSelectedImages([]);
      setIsCreateOpen(false);
      void mutate();
    } finally {
      setSaving(false);
    }
  }

  function openPublish(item: ContentItem) {
    setPublishItem(item);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">{t("dataCenterSubtitle")}</p>
        <Button size="sm" onClick={() => setIsCreateOpen(true)}>
          <Plus size={14} />
          {t("btnNewContent")}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">
          {t("emptyGeneric")}
        </p>
      ) : (
        <div className="space-y-3">
          {pageItems.map((item) => (
            <article key={item.id} className="rounded-2xl border border-sky-100 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-zinc-900">{item.title || t("agentThreadUntitled")}</h3>
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium capitalize text-zinc-600">
                  {item.status}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-zinc-600">
                {item.postReadyText || item.body}
              </p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-zinc-400">{new Date(item.createdAt).toLocaleString()}</span>
                <Button variant="outline" size="sm" onClick={() => openPublish(item)}>
                  <Send size={14} />
                  {t("publishConfirm")}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <ConsolePagination page={safePage} totalItems={items.length} onPageChange={setPage} />

      <Dialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title={t("btnNewContent")} maxWidth="lg">
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab("ai")}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                tab === "ai" ? "bg-sky-100 text-sky-700" : "text-zinc-500 hover:bg-zinc-100"
              }`}
            >
              {t("contentTabAi")}
            </button>
            <button
              type="button"
              onClick={() => setTab("manual")}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                tab === "manual" ? "bg-sky-100 text-sky-700" : "text-zinc-500 hover:bg-zinc-100"
              }`}
            >
              {t("contentTabManual")}
            </button>
          </div>

          {tab === "ai" ? (
            <GenerateContentPanel type={type} onGenerated={() => void mutate()} />
          ) : (
            <div className="space-y-4">
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                <span>{t("agentToolField_title")}</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={consoleInputClass} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                <span>{t("agentToolField_body")}</span>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} className={`${consoleInputClass} min-h-28 resize-none`} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                <span>{t("agentToolField_postReadyText")}</span>
                <textarea value={postReadyText} onChange={(e) => setPostReadyText(e.target.value)} className={`${consoleInputClass} min-h-20 resize-none`} />
              </label>

              <div>
                <p className="mb-2 text-sm font-medium text-zinc-700">{t("imageSelect")}</p>
                {imageLibrary.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-sky-100 px-3 py-6 text-center text-xs text-zinc-400">
                    {t("emptyImages")}
                  </p>
                ) : (
                  <div className="grid max-h-44 grid-cols-4 gap-2 overflow-y-auto">
                    {imageLibrary.map((img) => {
                      const selected = selectedImages.includes(img.fileName);
                      return (
                        <button
                          key={img.fileName}
                          type="button"
                          onClick={() =>
                            setSelectedImages((prev) => (selected ? prev.filter((f) => f !== img.fileName) : [...prev, img.fileName]))
                          }
                          className={`overflow-hidden rounded-lg border-2 ${selected ? "border-sky-500" : "border-transparent"}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt={img.fileName} className="aspect-square w-full object-cover" />
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="mt-1 text-xs text-zinc-400">
                  {t("imageSelectHint")} {selectedImages.length}
                </p>
              </div>

              <Button onClick={handleManualCreate} loading={saving} disabled={!title.trim()}>
                {t("btnSave")}
              </Button>
            </div>
          )}
        </div>
      </Dialog>

      <ContentPublishDialog
        item={publishItem}
        type={type}
        onClose={() => setPublishItem(null)}
        onPublished={() => void mutate()}
      />
    </div>
  );
}
