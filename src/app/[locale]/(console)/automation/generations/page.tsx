"use client";

import { useState } from "react";
import useSWR from "swr";
import type { ContentPage } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { swrFetcher } from "@/lib/api-client";
import { ConsolePagination, useClampConsolePage, usePagedItems } from "@/components/ui/console-pagination";

function metaString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : "";
}

export default function GenerationsPage() {
  const { t } = useI18n();
  const { data } = useSWR<ContentPage>("/api/content?page=1&pageSize=200", swrFetcher, { refreshInterval: 5000 });
  const items = data?.items ?? [];
  const [page, setPage] = useState(1);
  const { pageItems, safePage } = usePagedItems(items, page);
  useClampConsolePage(page, items.length, setPage);

  return (
    <div className="space-y-5">
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">{t("emptyGeneric")}</p>
      ) : (
        <div className="space-y-3">
          {pageItems.map((item) => (
            <article key={item.id} className="rounded-2xl border border-sky-100 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-zinc-900">{item.title || t("agentThreadUntitled")}</h3>
                  <p className="mt-1 text-xs text-zinc-400">
                    {[metaString(item.metadata, "provider"), metaString(item.metadata, "model")].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium capitalize text-zinc-600">{item.status}</span>
              </div>
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-zinc-600">{item.postReadyText || item.body}</p>
              <p className="mt-3 text-xs text-zinc-400">{new Date(item.createdAt).toLocaleString()}</p>
            </article>
          ))}
        </div>
      )}
      <ConsolePagination page={safePage} totalItems={items.length} onPageChange={setPage} />
    </div>
  );
}
