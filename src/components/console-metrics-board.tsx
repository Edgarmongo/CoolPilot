"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  BarChart3,
  CheckCheck,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  Info,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
  Play,
  CalendarClock,
} from "lucide-react";
import { apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import {
  bestTimeSlots,
  computeBaseline,
  interactionCount,
  topPerformers,
  zeroPerformers,
} from "@/lib/metrics";
import type {
  AccountRecord,
  MetricInsight,
  MetricInsightVerdict,
  MetricOverview,
  MetricSeries,
  MetricStatus,
  MetricsSettings,
  PlatformMetricOverview,
  PublishRecord,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConsoleCard, ConsoleNotice, ConsoleSectionHeader, consoleInputClass } from "@/components/ui/console-surface";
import { ConsolePagination, useClampConsolePage, usePagedItems } from "@/components/ui/console-pagination";

type SyncState = {
  state: "idle" | "running" | "done" | "failed";
  total: number;
  processed: number;
  updated: number;
  failed: number;
  message?: string;
};

type Overview = MetricOverview & { pendingCount: number };

const RANGES = [7, 30, 90] as const;

const metricStatusToneClass: Record<MetricStatus, string> = {
  pending: "bg-zinc-100 text-zinc-600",
  collected: "bg-emerald-100 text-emerald-700",
  stale: "bg-amber-100 text-amber-700",
  failed: "bg-rose-100 text-rose-700",
  dead: "bg-zinc-200 text-zinc-500",
  manual: "bg-sky-100 text-sky-700",
};

const metricStatusKey: Record<MetricStatus, TranslationKey> = {
  pending: "metricsStatusPending",
  collected: "metricsStatusCollected",
  stale: "metricsStatusStale",
  failed: "metricsStatusFailed",
  dead: "metricsStatusDead",
  manual: "metricsStatusManual",
};

const WEEKDAY_KEYS: TranslationKey[] = [
  "metricsWeekdaySun",
  "metricsWeekdayMon",
  "metricsWeekdayTue",
  "metricsWeekdayWed",
  "metricsWeekdayThu",
  "metricsWeekdayFri",
  "metricsWeekdaySat",
];

const verdictKey: Record<MetricInsightVerdict, TranslationKey> = {
  hit: "metricsInsightVerdictHit",
  met: "metricsInsightVerdictMet",
  miss: "metricsInsightVerdictMiss",
};

const verdictToneClass: Record<MetricInsightVerdict, string> = {
  hit: "bg-emerald-100 text-emerald-700",
  met: "bg-sky-100 text-sky-700",
  miss: "bg-rose-100 text-rose-700",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatDateTime(value?: number) {
  return value ? new Date(value).toLocaleString() : "—";
}

function platformIcon() {
  return <Globe2 className="h-4 w-4" />;
}

export function ConsoleMetricsBoard() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"board" | "retro">("board");
  const [range, setRange] = useState<number>(30);
  const [platform, setPlatform] = useState("");
  const [accountId, setAccountId] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [editTarget, setEditTarget] = useState<PublishRecord | null>(null);
  const [detailTarget, setDetailTarget] = useState<PublishRecord | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);

  const { data: accounts = [] } = useSWR<AccountRecord[]>("/api/accounts", swrFetcher);
  const { data: overview, mutate: mutateOverview } = useSWR<Overview>(
    `/api/metrics/overview?range=${range}`,
    swrFetcher,
    { refreshInterval: 20_000 },
  );
  const { data: content = [], mutate: mutateContent } = useSWR<PublishRecord[]>(
    `/api/metrics/content?range=${range}`,
    swrFetcher,
    { refreshInterval: 20_000 },
  );
  const { data: settings, mutate: mutateSettings } = useSWR<MetricsSettings>("/api/metrics/settings", swrFetcher);
  const { data: sync, mutate: mutateSync } = useSWR<SyncState>("/api/metrics/sync", swrFetcher, {
    refreshInterval: (latest) => (latest?.state === "running" ? 1500 : 0),
  });

  const syncState = sync?.state;
  useEffect(() => {
    if (syncState === "done") {
      void mutateOverview();
      void mutateContent();
    }
  }, [syncState, mutateOverview, mutateContent]);

  const platforms = useMemo(() => {
    const set = new Set<string>();
    for (const account of accounts) set.add(account.platform);
    for (const entry of overview?.byPlatform ?? []) set.add(entry.platform);
    return Array.from(set).sort();
  }, [accounts, overview]);

  const filtered = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return content
      .filter((record) => (platform ? record.platform === platform : true))
      .filter((record) => (accountId ? record.accountId === accountId : true))
      .filter((record) => (status ? record.metricStatus === status : true))
      .filter((record) => (lower ? record.title.toLowerCase().includes(lower) : true))
      .slice()
      .sort((a, b) => b.views - a.views || interactionCount(b) - interactionCount(a));
  }, [content, platform, accountId, status, query]);

  const { pageItems, safePage } = usePagedItems(filtered, page);
  useClampConsolePage(page, filtered.length, setPage);

  async function runSync(scope: { accountId?: string; platform?: string; publishRecordId?: string }) {
    try {
      await apiPost("/api/metrics/sync", scope);
      await mutateSync();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function saveMetrics(target: PublishRecord, patch: Record<string, unknown>) {
    try {
      await apiPatch(`/api/metrics/${target.id}`, patch);
      await Promise.all([mutateContent(), mutateOverview()]);
      setEditTarget(null);
      setNotice({ tone: "success", message: t("metricsSaved") });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  const totals = overview?.totals;
  const running = sync?.state === "running";

  const kpiCards: Array<{ key: string; label: string; value: string; icon: React.ReactNode }> = [
    { key: "posts", label: t("metricsKpiPosted"), value: formatNumber(totals?.posts ?? 0), icon: <FileText className="h-5 w-5" /> },
    { key: "views", label: t("metricsKpiViews"), value: formatNumber(totals?.views ?? 0), icon: <Globe2 className="h-5 w-5" /> },
    { key: "interactions", label: t("metricsKpiInteractions"), value: formatNumber(totals?.interactions ?? 0), icon: <Sparkles className="h-5 w-5" /> },
    { key: "followers", label: t("metricsKpiFollowers"), value: formatNumber(totals?.followers ?? 0), icon: <BarChart3 className="h-5 w-5" /> },
    { key: "engagement", label: t("metricsKpiEngagementRate"), value: formatPercent(totals?.engagementRate ?? 0), icon: <CheckCheck className="h-5 w-5" /> },
    { key: "completion", label: t("metricsKpiCompletionRate"), value: formatPercent((totals?.completionRate ?? 0) / 100), icon: <Clock className="h-5 w-5" /> },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500">{t("metricsSubtitle")}</p>

      {notice ? <ConsoleNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <select className={consoleInputClass + " max-w-32"} value={range} onChange={(event) => setRange(Number(event.target.value))}>
          {RANGES.map((days) => (
            <option key={days} value={days}>{t("metricsRangeDays", { days })}</option>
          ))}
        </select>
        <select className={consoleInputClass + " max-w-40"} value={platform} onChange={(event) => setPlatform(event.target.value)}>
          <option value="">{t("metricsAllPlatforms")}</option>
          {platforms.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select className={consoleInputClass + " max-w-48"} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
          <option value="">{t("metricsAllAccounts")}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.name}</option>
          ))}
        </select>
        <select className={consoleInputClass + " max-w-40"} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">{t("metricsAllStatuses")}</option>
          {(["pending", "collected", "stale", "failed", "dead", "manual"] as MetricStatus[]).map((value) => (
            <option key={value} value={value}>{t(metricStatusKey[value])}</option>
          ))}
        </select>
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            className={consoleInputClass + " pl-9"}
            placeholder={t("metricsSearchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button
          type="button"
          onClick={() => void runSync({ accountId: accountId || undefined, platform: platform || undefined })}
          disabled={running}
          loading={running}
        >
          <RefreshCw className="h-4 w-4" />
          {running ? t("metricsSyncing") : t("metricsSyncNow")}
        </Button>
        <button
          type="button"
          ref={exportButtonRef}
          onClick={() => {
            const win = exportButtonRef.current?.ownerDocument.defaultView;
            win?.location.assign("/api/metrics/export?format=csv");
          }}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-sky-100 bg-white px-4 text-sm text-sky-700 transition hover:bg-sky-50"
        >
          <Download className="h-4 w-4" />
          {t("metricsExportCsv")}
        </button>
      </div>

      {running && sync ? (
        <p className="text-xs text-sky-600">{t("metricsSyncProgress", { done: sync.processed, total: sync.total })}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {(["board", "retro"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              tab === value ? "bg-sky-600 text-white shadow-sm" : "bg-white text-zinc-600 ring-1 ring-sky-100 hover:bg-sky-50"
            }`}
          >
            {value === "board" ? t("metricsTabBoard") : t("metricsTabRetro")}
          </button>
        ))}
      </div>

      {tab === "board" ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {kpiCards.map((card) => (
              <div key={card.key} className="rounded-[28px] border border-sky-100 bg-white p-5 shadow-[0_12px_28px_rgba(37,99,235,0.06)]">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-zinc-500">{card.label}</p>
                  <span className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white">{card.icon}</span>
                </div>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950">{card.value}</p>
              </div>
            ))}
          </div>

          {(totals?.zeroData ?? 0) > 0 ? (
            <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <TriangleAlert className="h-4 w-4" />
              {t("metricsKpiZeroData", { count: totals?.zeroData ?? 0 })}
            </div>
          ) : null}
          <ConsoleCard>
            <ConsoleSectionHeader icon={<Globe2 className="h-5 w-5" />} title={t("metricsPlatformOverview")} />
            {(overview?.byPlatform ?? []).length === 0 ? (
              <p className="mt-4 rounded-2xl border border-dashed border-sky-100 px-4 py-8 text-center text-sm text-zinc-500">{t("emptyGeneric")}</p>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(overview?.byPlatform ?? []).map((entry: PlatformMetricOverview) => (
                  <div key={entry.platform} className="rounded-2xl border border-sky-100 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-semibold text-zinc-900">{platformIcon()}{entry.platform}</span>
                      <button
                        type="button"
                        onClick={() => void runSync({ platform: entry.platform })}
                        disabled={running}
                        className="text-xs text-sky-600 transition hover:underline disabled:opacity-50"
                      >
                        {t("metricsRefreshNow")}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <span>{t("metricsKpiPosted")}: <b className="text-zinc-800">{entry.posts}</b></span>
                      <span>{t("metricsKpiViews")}: <b className="text-zinc-800">{formatNumber(entry.views)}</b></span>
                      <span>{t("metricsKpiInteractions")}: <b className="text-zinc-800">{formatNumber(entry.interactions)}</b></span>
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-400">{t("metricsLastSynced")}: {formatDateTime(entry.lastSyncedAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </ConsoleCard>
          <ConsoleCard>
            <ConsoleSectionHeader icon={<BarChart3 className="h-5 w-5" />} title={t("metricsContentRanking")} />
            {filtered.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-dashed border-sky-100 px-4 py-8 text-center text-sm text-zinc-500">{t("emptyGeneric")}</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-400">
                      <th className="px-3 py-2 font-medium">{t("publishRecordColTitle")}</th>
                      <th className="px-3 py-2 font-medium">{t("publishRecordColPlatform")}</th>
                      <th className="px-3 py-2 font-medium">{t("publishRecordSite")}</th>
                      <th className="px-3 py-2 font-medium">{t("publishRecordColType")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("metricsKpiViews")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("metricsKpiInteractions")}</th>
                      <th className="px-3 py-2 font-medium">{t("publishRecordColStatus")}</th>
                      <th className="px-3 py-2 font-medium">{t("publishRecordColPublishedAt")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("publishRecordOpenLink")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((record) => (
                      <tr key={record.id} className="border-b border-zinc-50 last:border-0 hover:bg-sky-50/40">
                        <td className="max-w-72 px-3 py-3">
                          <button type="button" onClick={() => setDetailTarget(record)} className="line-clamp-1 text-left font-medium text-zinc-900 hover:text-sky-700">
                            {record.title || "—"}
                          </button>
                        </td>
                        <td className="px-3 py-3 text-zinc-600">{record.platform || "—"}</td>
                        <td className="px-3 py-3 text-zinc-600">{record.accountName || "—"}</td>
                        <td className="px-3 py-3 text-zinc-600">{record.contentType || "—"}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-zinc-800">{formatNumber(record.views)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-zinc-800">{formatNumber(interactionCount(record))}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${metricStatusToneClass[record.metricStatus]}`}>
                            {t(metricStatusKey[record.metricStatus])}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{formatDateTime(record.publishedAt ?? record.createdAt)}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button type="button" onClick={() => setEditTarget(record)} className="text-xs text-zinc-500 transition hover:text-sky-700">
                              {t("metricsEditTitle")}
                            </button>
                            {record.url ? (
                              <a href={record.url} target="_blank" rel="noreferrer" className="inline-flex items-center text-sky-600 hover:underline">
                                <ExternalLink size={13} />
                              </a>
                            ) : (
                              <span className="text-zinc-300">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 flex justify-end">
                  <ConsolePagination page={safePage} totalItems={filtered.length} onPageChange={setPage} />
                </div>
              </div>
            )}
          </ConsoleCard>
        </>
      ) : null}

      {tab === "retro" ? <RetroSection records={filtered} onDetail={setDetailTarget} /> : null}

      <div className="grid gap-3 border-t border-zinc-100 pt-4 md:grid-cols-3">
        <MiniStat icon={<Globe2 className="h-4 w-4" />} label={t("dashboardTotalSites")} value={accounts.length} />
        <MiniStat icon={<FileText className="h-4 w-4" />} label={t("dashboardTotalContent")} value={content.length} />
        <MiniStat icon={<Clock className="h-4 w-4" />} label={t("metricsStatusPending")} value={overview?.pendingCount ?? 0} />
      </div>

      <label className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white px-4 py-3 text-sm text-zinc-600">
        <input
          type="checkbox"
          className="size-4 accent-sky-600"
          checked={Boolean(settings?.autoRefreshEnabled)}
          onChange={(event) => {
            void apiPatch("/api/metrics/settings", { autoRefreshEnabled: event.target.checked }).then(() => mutateSettings());
          }}
        />
        <span>
          <span className="font-medium text-zinc-800">{t("metricsAutoRefresh")}</span>
          <span className="ml-2 text-xs text-zinc-400">{t("metricsAutoRefreshHint")}</span>
        </span>
      </label>

      {editTarget ? (
        <EditMetricsDialog record={editTarget} onClose={() => setEditTarget(null)} onSave={saveMetrics} />
      ) : null}
      {detailTarget ? (
        <MetricDetailDialog record={detailTarget} records={content} onClose={() => setDetailTarget(null)} />
      ) : null}
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-zinc-100 bg-zinc-50/60 px-4 py-3">
      <span className="text-zinc-400">{icon}</span>
      <div>
        <p className="text-xs text-zinc-400">{label}</p>
        <p className="text-lg font-semibold text-zinc-700">{value}</p>
      </div>
    </div>
  );
}
function RetroSection({
  records,
  onDetail,
}: {
  records: PublishRecord[];
  onDetail: (record: PublishRecord) => void;
}) {
  const { t } = useI18n();
  const slots = bestTimeSlots(records);
  const top = topPerformers(records, 5);
  const zero = zeroPerformers(records, 10);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ConsoleCard>
        <ConsoleSectionHeader icon={<CalendarClock className="h-5 w-5" />} title={t("metricsRetroBestTime")} />
        {slots.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-sky-100 px-4 py-8 text-center text-sm text-zinc-500">{t("metricsRetroEmpty")}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {slots.map((slot) => (
              <li key={`${slot.weekday}-${slot.hour}`} className="flex items-center justify-between rounded-2xl border border-sky-100 bg-white px-4 py-2 text-sm">
                <span className="text-zinc-700">{t(WEEKDAY_KEYS[slot.weekday])} · {String(slot.hour).padStart(2, "0")}:00</span>
                <span className="text-zinc-500">
                  <b className="text-zinc-800">{slot.avgInteractions.toFixed(1)}</b> {t("metricsKpiInteractions")} · {slot.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ConsoleCard>

      <ConsoleCard>
        <ConsoleSectionHeader icon={<Play className="h-5 w-5" />} title={t("metricsRetroTop")} />
        {top.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-sky-100 px-4 py-8 text-center text-sm text-zinc-500">{t("metricsRetroEmpty")}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {top.map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-white px-4 py-2 text-sm">
                <button type="button" onClick={() => onDetail(record)} className="line-clamp-1 flex-1 text-left text-zinc-800 hover:text-sky-700">
                  {record.title || "—"}
                </button>
                <span className="shrink-0 text-zinc-500">{formatNumber(record.views)} · {formatNumber(interactionCount(record))}</span>
              </li>
            ))}
          </ul>
        )}
      </ConsoleCard>

      <ConsoleCard className="lg:col-span-2">
        <ConsoleSectionHeader icon={<TriangleAlert className="h-5 w-5" />} title={t("metricsRetroZero")} />
        {zero.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-sky-100 px-4 py-8 text-center text-sm text-zinc-500">{t("metricsRetroEmpty")}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {zero.map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-3 rounded-2xl border border-amber-100 bg-amber-50/50 px-4 py-2 text-sm">
                <button type="button" onClick={() => onDetail(record)} className="line-clamp-1 flex-1 text-left text-zinc-800 hover:text-sky-700">
                  {record.title || "—"}
                </button>
                <span className="shrink-0 text-amber-700">{record.platform} · {record.accountName}</span>
              </li>
            ))}
          </ul>
        )}
      </ConsoleCard>
    </div>
  );
}
function EditMetricsDialog({
  record,
  onClose,
  onSave,
}: {
  record: PublishRecord;
  onClose: () => void;
  onSave: (record: PublishRecord, patch: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    views: String(record.views),
    likes: String(record.likes),
    comments: String(record.comments),
    shares: String(record.shares),
    favorites: String(record.favorites),
    followsDelta: String(record.followsDelta),
    completionRate: record.completionRate !== undefined ? String(record.completionRate) : "",
    metricStatus: record.metricStatus as MetricStatus,
  });

  const numericFields: Array<{ key: "views" | "likes" | "comments" | "shares" | "favorites" | "followsDelta" | "completionRate"; label: string }> = [
    { key: "views", label: t("metricsKpiViews") },
    { key: "likes", label: t("metricsEditLikes") },
    { key: "comments", label: t("metricsEditComments") },
    { key: "shares", label: t("metricsEditShares") },
    { key: "favorites", label: t("metricsEditFavorites") },
    { key: "followsDelta", label: t("metricsEditFollowsDelta") },
    { key: "completionRate", label: t("metricsEditCompletionRate") },
  ];

  function submit() {
    const patch: Record<string, unknown> = { metricStatus: form.metricStatus };
    for (const field of numericFields) {
      const raw = form[field.key].trim();
      if (field.key === "completionRate") {
        patch.completionRate = raw === "" ? null : Number(raw);
      } else {
        patch[field.key] = raw === "" ? 0 : Math.max(0, Math.trunc(Number(raw) || 0));
      }
    }
    onSave(record, patch);
  }

  return (
    <Dialog open onClose={onClose} title={t("metricsEditTitle")} maxWidth="lg">
      <div className="space-y-3 pt-2 text-sm">
        <p className="line-clamp-2 text-zinc-500">{record.title || "—"}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {numericFields.map((field) => (
            <label key={field.key} className="space-y-1">
              <span className="text-xs text-zinc-500">{field.label}</span>
              <input
                type="number"
                className={consoleInputClass}
                value={form[field.key]}
                onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
              />
            </label>
          ))}
          <label className="space-y-1">
            <span className="text-xs text-zinc-500">{t("publishRecordColStatus")}</span>
            <select
              className={consoleInputClass}
              value={form.metricStatus}
              onChange={(event) => setForm((current) => ({ ...current, metricStatus: event.target.value as MetricStatus }))}
            >
              {(["pending", "collected", "stale", "failed", "dead", "manual"] as MetricStatus[]).map((value) => (
                <option key={value} value={value}>{t(metricStatusKey[value])}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("btnCancel")}</Button>
          <Button type="button" onClick={submit}>{t("btnSave")}</Button>
        </div>
      </div>
    </Dialog>
  );
}
function MetricDetailDialog({
  record,
  records,
  onClose,
}: {
  record: PublishRecord;
  records: PublishRecord[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data: series } = useSWR<MetricSeries>(`/api/metrics/series?id=${record.id}`, swrFetcher);
  const baseline = useMemo(() => computeBaseline(records, record), [records, record]);
  const [insight, setInsight] = useState<MetricInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const result = await apiPost<MetricInsight>("/api/metrics/insights", { publishRecordId: record.id });
      setInsight(result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={t("metricsInsightTitle")} maxWidth="xl">
      <div className="space-y-4 pt-2 text-sm">
        <p className="flex items-center gap-2 font-medium text-zinc-900">
          <Info className="h-4 w-4 text-sky-500" />
          {record.title || "—"}
        </p>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <MetricBox label={t("metricsKpiViews")} value={formatNumber(record.views)} />
          <MetricBox label={t("metricsKpiInteractions")} value={formatNumber(interactionCount(record))} />
          <MetricBox label={t("metricsKpiEngagementRate")} value={formatPercent(record.views > 0 ? interactionCount(record) / record.views : 0)} />
          <MetricBox label={t("publishRecordColPublishedAt")} value={formatDateTime(record.publishedAt ?? record.createdAt)} />
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-zinc-500">{t("metricsTrend")}</p>
          {series && series.points.length > 0 ? (
            <Sparkline points={series.points.map((point) => point.views)} />
          ) : (
            <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-4 text-center text-xs text-zinc-400">{t("metricsTrendEmpty")}</p>
          )}
        </div>

        <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-3 text-xs text-zinc-600">
          <p>{t("metricsBaselineAccount")}: <b className="text-zinc-900">{formatNumber(baseline.accountAvgViews)}</b> ({baseline.accountCount})</p>
          <p>{t("metricsBaselinePlatform")}: <b className="text-zinc-900">{formatNumber(baseline.platformAvgViews)}</b> ({baseline.platformCount})</p>
        </div>

        <div className="border-t border-zinc-100 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1 text-sm font-medium text-zinc-800">
              <Sparkles className="h-4 w-4 text-sky-500" />
              {t("metricsInsight")}
            </span>
            <Button type="button" size="sm" onClick={generate} loading={loading} disabled={loading}>
              {loading ? t("metricsInsightGenerating") : t("metricsInsight")}
            </Button>
          </div>
          {error ? <p className="text-xs text-rose-600">{t("metricsInsightFailed")}: {error}</p> : null}
          {insight ? (
            <div className="space-y-2">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${verdictToneClass[insight.verdict]}`}>
                {t(verdictKey[insight.verdict])}
              </span>
              <p className="text-zinc-700">{insight.summary}</p>
              {insight.factors.length > 0 ? (
                <>
                  <p className="text-xs font-medium text-zinc-500">{t("metricsInsightFactors")}</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-zinc-600">
                    {insight.factors.map((factor, index) => (
                      <li key={index}>{factor}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {insight.suggestions.length > 0 ? (
                <>
                  <p className="text-xs font-medium text-zinc-500">{t("metricsInsightSuggestions")}</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-zinc-600">
                    {insight.suggestions.map((suggestion, index) => (
                      <li key={index}>{suggestion}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-100 bg-white px-3 py-2">
      <p className="text-[11px] text-zinc-400">{label}</p>
      <p className="font-semibold text-zinc-800">{value}</p>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const width = 320;
  const height = 64;
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((value, index) => `${(index * step).toFixed(1)},${(height - (value / max) * (height - 8) - 4).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full text-sky-500" preserveAspectRatio="none">
      <polyline points={coords.join(" ")} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

