"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  CheckCheck,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Info,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { publishRecordStatuses, publishRecordTypes, type PublishRecord, type PublishRecordStatus } from "@/lib/types";
import { apiDelete, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConsolePagination, useClampConsolePage, usePagedItems } from "@/components/ui/console-pagination";
import { ConsoleNotice, consoleInputClass } from "@/components/ui/console-surface";

type Translate = (key: TranslationKey) => string;

const statToneClass = {
  sky: "bg-sky-50 text-sky-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
} as const;

const filterControlClass =
  "min-h-9 rounded-xl border border-sky-100 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-sky-400 focus:ring-1 focus:ring-sky-400";

const recordStatusKey: Record<PublishRecordStatus, TranslationKey> = {
  queued: "publishRecordStatusQueued",
  running: "publishRecordStatusRunning",
  published: "publishRecordStatusPublished",
  drafted: "publishRecordStatusDrafted",
  failed: "publishRecordStatusFailed",
  cancelled: "publishRecordStatusCancelled",
};

const recordStatusClass: Record<PublishRecordStatus, string> = {
  queued: "bg-zinc-100 text-zinc-600",
  running: "bg-amber-100 text-amber-700",
  published: "bg-emerald-100 text-emerald-700",
  drafted: "bg-sky-100 text-sky-700",
  failed: "bg-rose-100 text-rose-700",
  cancelled: "bg-zinc-100 text-zinc-600",
};

const recordTypeKey: Record<string, TranslationKey> = {
  article: "publishRecordTypeArticle",
  post: "publishRecordTypePost",
  video: "publishRecordTypeVideo",
  image: "publishRecordTypeImage",
};

const recordMethodKey: Record<string, TranslationKey> = {
  manual: "publishRecordMethodManual",
  scheduled: "publishRecordMethodScheduled",
  auto: "publishRecordMethodAuto",
};

const recordTerminalKey: Record<string, TranslationKey> = {
  local: "publishRecordTerminalLocal",
  cloud: "publishRecordTerminalCloud",
};

function formatDateTime(value?: number) {
  return value ? new Date(value).toLocaleString() : "—";
}

function typeLabel(value: string, t: Translate) {
  if (!value) return "—";
  const key = recordTypeKey[value];
  return key ? t(key) : value;
}

function methodLabel(value: string, t: Translate) {
  if (!value) return "—";
  const key = recordMethodKey[value];
  return key ? t(key) : value;
}

function terminalLabel(value: string, t: Translate) {
  if (!value) return "—";
  const key = recordTerminalKey[value];
  return key ? t(key) : value;
}

function StatCard({
  icon,
  tone,
  value,
  label,
}: {
  icon: React.ReactNode;
  tone: keyof typeof statToneClass;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-4">
      <span className={`grid size-10 shrink-0 place-items-center rounded-2xl ${statToneClass[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xl font-semibold leading-tight text-zinc-900">{value}</p>
        <p className="truncate text-xs text-zinc-500">{label}</p>
      </div>
    </div>
  );
}

export default function PublishRecordsPage() {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const { data: records = [], mutate, isValidating } = useSWR<PublishRecord[]>(
    "/api/publish-records?limit=200",
    swrFetcher,
    { refreshInterval: 5000 },
  );

  const [platformFilter, setPlatformFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [terminalFilter, setTerminalFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [query, setQuery] = useState("");

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<PublishRecord | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);

  const stats = useMemo(
    () => ({
      total: records.length,
      published: records.filter((record) => record.status === "published").length,
      running: records.filter((record) => record.status === "running" || record.status === "queued").length,
      failed: records.filter((record) => record.status === "failed").length,
    }),
    [records],
  );

  const platforms = useMemo(
    () =>
      Array.from(new Set(records.map((record) => record.platform).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [records],
  );
  const methods = useMemo(
    () => Array.from(new Set(records.map((record) => record.method).filter(Boolean))).sort(),
    [records],
  );
  const terminals = useMemo(
    () => Array.from(new Set(records.map((record) => record.terminal).filter(Boolean))).sort(),
    [records],
  );

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const startAt = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const endAt = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;
    return records.filter((record) => {
      if (platformFilter && record.platform !== platformFilter) return false;
      if (statusFilter && record.status !== statusFilter) return false;
      if (typeFilter && record.contentType !== typeFilter) return false;
      if (methodFilter && record.method !== methodFilter) return false;
      if (terminalFilter && record.terminal !== terminalFilter) return false;
      if (startAt !== null && record.createdAt < startAt) return false;
      if (endAt !== null && record.createdAt > endAt) return false;
      if (keyword && !record.title.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [records, platformFilter, statusFilter, typeFilter, methodFilter, terminalFilter, startDate, endDate, query]);

  const { pageItems, safePage } = usePagedItems(filtered, page);
  useClampConsolePage(page, filtered.length, setPage);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allOnPageSelected = pageItems.length > 0 && pageItems.every((record) => selectedSet.has(record.id));

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  }

  function toggleAllOnPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const record of pageItems) next.delete(record.id);
      } else {
        for (const record of pageItems) next.add(record.id);
      }
      return Array.from(next);
    });
  }

  async function handleDelete(ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      for (const id of ids) {
        await apiDelete(`/api/publish-records/${id}`);
      }
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
      setDetail((current) => (current && ids.includes(current.id) ? null : current));
      await mutate();
      setNotice(t("publishRecordDeleted"));
    } finally {
      setBusy(false);
    }
  }

  function handleExport() {
    const node = rootRef.current;
    const doc = node?.ownerDocument;
    const win = doc?.defaultView;
    if (!doc || !win) return;

    const header = [
      t("publishRecordColPlatform"),
      t("publishRecordColTitle"),
      t("publishRecordColType"),
      t("publishRecordColStatus"),
      t("publishRecordColLink"),
      t("publishRecordColPublishedAt"),
    ];
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = filtered.map((record) => [
      record.platform,
      record.title,
      typeLabel(record.contentType, t),
      t(recordStatusKey[record.status] ?? "publishRecordStatusQueued"),
      record.url,
      formatDateTime(record.publishedAt ?? record.createdAt),
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => escape(String(cell))).join(",")).join("\r\n");

    const blob = new win.Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = win.URL.createObjectURL(blob);
    const anchor = doc.createElement("a");
    anchor.href = url;
    anchor.download = `publish-records-${Date.now()}.csv`;
    anchor.click();
    win.URL.revokeObjectURL(url);
  }

  return (
    <div ref={rootRef} className="space-y-5">
      {notice ? <ConsoleNotice message={notice} onDismiss={() => setNotice("")} /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<FileText className="size-4" />} tone="sky" value={stats.total} label={t("publishRecordStatRecords")} />
        <StatCard icon={<CheckCheck className="size-4" />} tone="emerald" value={stats.published} label={t("publishRecordStatPublished")} />
        <StatCard icon={<Clock className="size-4" />} tone="amber" value={stats.running} label={t("publishRecordStatRunning")} />
        <StatCard icon={<TriangleAlert className="size-4" />} tone="rose" value={stats.failed} label={t("publishRecordStatFailed")} />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-sky-100 bg-white p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)} className={filterControlClass}>
            <option value="">{t("publishRecordFilterPlatformAll")}</option>
            {platforms.map((platform) => (
              <option key={platform} value={platform}>{platform}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={filterControlClass}>
            <option value="">{t("publishRecordFilterStatusAll")}</option>
            {publishRecordStatuses.map((status) => (
              <option key={status} value={status}>{t(recordStatusKey[status])}</option>
            ))}
          </select>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={filterControlClass}>
            <option value="">{t("publishRecordFilterTypeAll")}</option>
            {publishRecordTypes.map((type) => (
              <option key={type} value={type}>{t(recordTypeKey[type])}</option>
            ))}
          </select>
          <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)} className={filterControlClass}>
            <option value="">{t("publishRecordFilterMethodAll")}</option>
            {methods.map((method) => (
              <option key={method} value={method}>{methodLabel(method, t)}</option>
            ))}
          </select>
          <select value={terminalFilter} onChange={(event) => setTerminalFilter(event.target.value)} className={filterControlClass}>
            <option value="">{t("publishRecordFilterTerminalAll")}</option>
            {terminals.map((terminal) => (
              <option key={terminal} value={terminal}>{terminalLabel(terminal, t)}</option>
            ))}
          </select>
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} aria-label={t("publishRecordStartDate")} className={filterControlClass} />
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} aria-label={t("publishRecordEndDate")} className={filterControlClass} />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("publishRecordSearch")} className={`${consoleInputClass} min-h-9 w-52 pl-9`} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" loading={isValidating} onClick={() => void mutate()}>
            <RefreshCw size={14} />
            {t("publishRecordRefresh")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
            <Download size={14} />
            {t("publishRecordExport")}
          </Button>
        </div>
      </div>

      {selectedIds.length > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-2 text-sm text-sky-800">
          <span>
            {t("publishRecordSelected")} {selectedIds.length}
          </span>
          <Button variant="danger" size="sm" loading={busy} onClick={() => void handleDelete(selectedIds)}>
            <Trash2 size={14} />
            {t("publishRecordDeleteSelected")}
          </Button>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">
          {records.length === 0 ? t("publishRecordEmpty") : t("publishRecordEmptyFiltered")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-sky-100 bg-white">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-sky-100 text-left text-xs font-semibold uppercase text-zinc-400">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAllOnPage}
                    aria-label={t("publishRecordSelectAll")}
                    className="size-4"
                  />
                </th>
                <th className="px-4 py-3">{t("publishRecordColPlatform")}</th>
                <th className="px-4 py-3">{t("publishRecordColTitle")}</th>
                <th className="px-4 py-3">{t("publishRecordColType")}</th>
                <th className="px-4 py-3">{t("publishRecordColStatus")}</th>
                <th className="px-4 py-3">{t("publishRecordColLink")}</th>
                <th className="px-4 py-3">{t("publishRecordColPublishedAt")}</th>
                <th className="px-4 py-3 text-right">{t("publishRecordColActions")}</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((record) => (
                <tr key={record.id} className="border-b border-sky-50 last:border-0 hover:bg-sky-50/40">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(record.id)}
                      onChange={() => toggleSelected(record.id)}
                      aria-label={record.title || record.id}
                      className="size-4"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-sky-50 text-[11px] font-bold text-sky-600">
                        {(record.platform || "?").slice(0, 1).toUpperCase()}
                      </span>
                      <span className="whitespace-nowrap font-medium text-zinc-800">{record.platform || "—"}</span>
                    </div>
                  </td>
                  <td className="max-w-[280px] px-4 py-3">
                    <p className="truncate font-medium text-zinc-900">{record.title || t("agentThreadUntitled")}</p>
                    {record.accountName ? <p className="truncate text-xs text-zinc-400">{record.accountName}</p> : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                      {typeLabel(record.contentType, t)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${recordStatusClass[record.status] ?? "bg-zinc-100 text-zinc-600"}`}>
                      {t(recordStatusKey[record.status] ?? "publishRecordStatusQueued")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {record.url ? (
                      <a
                        href={record.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sky-600 hover:underline"
                      >
                        <ExternalLink size={13} />
                        {t("publishRecordOpenLink")}
                      </a>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                    {formatDateTime(record.publishedAt ?? record.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setDetail(record)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sky-600 transition hover:bg-sky-50"
                        title={t("publishRecordDetails")}
                      >
                        <Info size={14} />
                        {t("publishRecordDetails")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete([record.id])}
                        disabled={busy}
                        className="rounded-lg p-1.5 text-rose-500 transition hover:bg-rose-50 disabled:opacity-50"
                        title={t("btnDelete")}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>

          </table>
        </div>
      )}

      <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <span className="text-xs text-zinc-500">{t("publishRecordCount", { count: filtered.length })}</span>
        <ConsolePagination page={safePage} totalItems={filtered.length} onPageChange={setPage} />
      </div>

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} title={t("publishRecordDetails")} maxWidth="lg">
        {detail ? (
          <dl className="space-y-2 text-sm">
            {detailRows(detail, t).map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-2 last:border-0">
                <dt className="shrink-0 text-zinc-500">{label}</dt>
                <dd className="min-w-0 break-words text-right font-medium text-zinc-800">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Dialog>
    </div>
  );
}

function detailRows(record: PublishRecord, t: Translate): Array<[string, string]> {
  return [
    [t("publishRecordColPlatform"), record.platform || "—"],
    [t("publishRecordSite"), record.accountName || "—"],
    [t("publishRecordColTitle"), record.title || "—"],
    [t("publishRecordColType"), typeLabel(record.contentType, t)],
    [t("publishRecordColStatus"), t(recordStatusKey[record.status] ?? "publishRecordStatusQueued")],
    [t("publishRecordMethod"), methodLabel(record.method, t)],
    [t("publishRecordTerminal"), terminalLabel(record.terminal, t)],
    [t("publishRecordUrl"), record.url || "—"],
    [t("publishRecordMessage"), record.message || "—"],
    [t("publishRecordCreatedAt"), formatDateTime(record.createdAt)],
    [t("publishRecordColPublishedAt"), formatDateTime(record.publishedAt)],
  ];
}
