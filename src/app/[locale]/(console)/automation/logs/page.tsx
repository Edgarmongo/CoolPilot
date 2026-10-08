"use client";

import { useState } from "react";
import useSWR from "swr";
import type { RunEventRecord, RunRecord } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { swrFetcher } from "@/lib/api-client";
import { ConsolePagination, useClampConsolePage, usePagedItems } from "@/components/ui/console-pagination";

const statusClass: Record<string, string> = {
  queued: "bg-zinc-100 text-zinc-600",
  running: "bg-sky-100 text-sky-700",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  failed: "bg-rose-100 text-rose-700",
  cancelled: "bg-zinc-100 text-zinc-600",
};

export default function OperationLogsPage() {
  const { t } = useI18n();
  const { data: runs = [] } = useSWR<RunRecord[]>("/api/runs?limit=200", swrFetcher, { refreshInterval: 3000 });
  const latestRunId = runs[0]?.id;
  const { data: events = [] } = useSWR<RunEventRecord[]>(latestRunId ? `/api/runs/${latestRunId}/events` : null, swrFetcher, {
    refreshInterval: 2000,
  });
  const [page, setPage] = useState(1);
  const { pageItems, safePage } = usePagedItems(runs, page);
  useClampConsolePage(page, runs.length, setPage);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-500">{t("openRuns")}</h2>
        {runs.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">{t("emptyRuns")}</p>
        ) : (
          <div className="space-y-3">
            {pageItems.map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-white p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-900">{run.playbookId}</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {new Date(run.createdAt).toLocaleString()}
                    {run.resultMessage ? ` · ${run.resultMessage}` : ""}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusClass[run.status] ?? "bg-zinc-100 text-zinc-600"}`}>
                  {run.status}
                </span>
              </div>
            ))}
          </div>
        )}
        <ConsolePagination page={safePage} totalItems={runs.length} onPageChange={setPage} />
      </section>

      {events.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-500">{t("recentRuns")}</h2>
          <div className="space-y-2 rounded-2xl border border-sky-100 bg-white p-4">
            {events.slice(-20).map((event) => (
              <div key={event.id} className="flex items-start gap-3 text-sm">
                <span className="shrink-0 text-zinc-400">{new Date(event.createdAt).toLocaleTimeString()}</span>
                <span className={event.level === "error" ? "text-rose-600" : event.level === "warn" ? "text-amber-600" : "text-zinc-600"}>
                  {event.message}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
