"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { CalendarDays, FileText, Send, Sparkles, Video } from "lucide-react";
import type { AccountRecord, PlaybookId, ScheduleRecord } from "@/lib/types";
import {
  defaultScheduleTimeDraft,
  draftToScheduleTimes,
  formatRunTime,
  type ScheduleTimeDraft,
} from "@/lib/schedule";
import { useI18n } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n-config";
import { apiErrorTranslationKey, apiPost, swrFetcher } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConsoleNotice, consoleInputClass } from "@/components/ui/console-surface";
import { ConsolePagination, useClampConsolePage, usePagedItems } from "@/components/ui/console-pagination";
import { ScheduleTimeEditor } from "@/components/calendar/schedule-time-editor";
import { playbookLabel, scheduleTimesLabel } from "@/components/calendar/schedule-labels";
import type { TranslationKey } from "@/lib/locale-resources";

const scheduleStatusLabelKeys: Record<ScheduleRecord["status"], TranslationKey> = {
  scheduled: "scheduleStatusScheduled",
  queued: "scheduleStatusQueued",
  running: "scheduleStatusRunning",
  posted: "scheduleStatusPosted",
  failed: "scheduleStatusFailed",
  missed: "scheduleStatusMissed",
  cancelled: "scheduleStatusCancelled",
};

function scheduleStatusClass(status: ScheduleRecord["status"]) {
  if (status === "scheduled" || status === "queued") return "bg-amber-100 text-amber-700";
  if (status === "running") return "bg-sky-100 text-sky-700";
  if (status === "posted") return "bg-emerald-100 text-emerald-700";
  if (status === "failed" || status === "missed") return "bg-rose-100 text-rose-700";
  return "bg-zinc-100 text-zinc-600";
}

const planEntries: Array<{
  id: string;
  labelKey: TranslationKey;
  icon: typeof Sparkles;
  playbookId: PlaybookId | null;
}> = [
  { id: "ai-article", labelKey: "planAiArticle", icon: Sparkles, playbookId: "topic_article_generator" },
  { id: "word", labelKey: "planWord", icon: FileText, playbookId: "article_scraper_rewriter" },
  { id: "graphic", labelKey: "planGraphic", icon: Send, playbookId: "threads_compose_post" },
  { id: "video", labelKey: "planVideo", icon: Video, playbookId: null },
];

export default function SchedulesListPage() {
  const { t, locale } = useI18n();
  const { data: schedules = [], mutate } = useSWR<ScheduleRecord[]>("/api/schedules", swrFetcher);
  const { data: accounts = [] } = useSWR<AccountRecord[]>("/api/accounts", swrFetcher);
  const [page, setPage] = useState(1);
  const { pageItems: visibleSchedules, safePage } = usePagedItems(schedules, page);
  useClampConsolePage(page, schedules.length, setPage);

  const [planTarget, setPlanTarget] = useState<{ labelKey: TranslationKey; playbookId: PlaybookId } | null>(null);
  const [accountId, setAccountId] = useState("");
  const [draft, setDraft] = useState<ScheduleTimeDraft>(() => defaultScheduleTimeDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const scheduleTimes = draftToScheduleTimes(draft);

  function accountLabel(id?: string) {
    if (!id) return t("unspecified");
    const account = accounts.find((item) => item.id === id);
    return account ? `${account.name} (${account.platform})` : t("unspecified");
  }

  async function handleCreatePlan() {
    if (!planTarget || scheduleTimes.length === 0) return;
    setSaving(true);
    setError("");
    try {
      await apiPost("/api/schedules", {
        playbookId: planTarget.playbookId,
        accountId: accountId || undefined,
        enabled: true,
        scheduleTimes,
        params: {},
      });
      setPlanTarget(null);
      setAccountId("");
      setDraft(defaultScheduleTimeDraft());
      await mutate();
    } catch (submitError) {
      setError(t(apiErrorTranslationKey(submitError, "calendarCreateFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-900">{t("schedulesTitle")}</h2>
        <Link
          href={localizedPath(locale, "/schedules/calendar")}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-sky-100 bg-white px-4 text-sm font-medium text-sky-700 transition hover:border-sky-200 hover:bg-sky-50"
        >
          <CalendarDays className="size-4" />
          {t("navContentCalendar")}
        </Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {planEntries.map((entry) => {
          const Icon = entry.icon;
          const disabled = !entry.playbookId;
          return (
            <button
              key={entry.id}
              type="button"
              disabled={disabled}
              onClick={() => entry.playbookId && setPlanTarget({ labelKey: entry.labelKey, playbookId: entry.playbookId })}
              className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition ${
                disabled
                  ? "cursor-not-allowed border-zinc-100 bg-zinc-50 opacity-60"
                  : "border-sky-100 bg-white hover:border-sky-200 hover:bg-sky-50/40"
              }`}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-medium text-zinc-900">{t(entry.labelKey)}</p>
                {disabled ? <p className="text-xs text-zinc-400">{t("planComingSoon")}</p> : null}
              </div>
            </button>
          );
        })}
      </section>

      <section className="space-y-4">
        {schedules.length === 0 ? (
          <p className="border-y border-dashed border-border py-6 text-center text-sm text-zinc-500">
            {t("emptySchedules")}
          </p>
        ) : (
          <div className="space-y-3">
            {visibleSchedules.map((schedule) => (
              <div key={schedule.id} className="grid gap-3 border-b border-border py-4 md:grid-cols-[1fr_180px_180px] md:items-center">
                <div>
                  <div className="font-semibold text-zinc-900 text-[15px]">{playbookLabel(schedule.playbookId, t)}</div>
                  <p className="text-xs text-zinc-400 mt-1">
                    {t("scheduleTimes")}: {scheduleTimesLabel(schedule.scheduleTimes, t, locale)}
                  </p>
                  <p className="text-xs text-zinc-400 mt-1">
                    {t("site")}: {accountLabel(schedule.accountId)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${scheduleStatusClass(schedule.status)}`}>
                    {t(scheduleStatusLabelKeys[schedule.status])}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${schedule.enabled ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
                    {schedule.enabled ? t("enabled") : t("disabled")}
                  </span>
                </div>
                <div className="text-sm text-zinc-500 font-medium">
                  {t("nextRun")}: {schedule.nextRunAt ? formatRunTime(schedule.nextRunAt, locale) : t("notScheduled")}
                </div>
              </div>
            ))}
          </div>
        )}
        <ConsolePagination page={safePage} totalItems={schedules.length} onPageChange={setPage} />
      </section>

      <Dialog open={Boolean(planTarget)} onClose={() => setPlanTarget(null)} title={planTarget ? t(planTarget.labelKey) : ""}>
        <div className="space-y-4">
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("site")}</span>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={consoleInputClass}>
              <option value="">{t("unspecified")}</option>
              {accounts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.platform})
                </option>
              ))}
            </select>
          </label>
          <ScheduleTimeEditor draft={draft} onChange={setDraft} />
          {error ? <ConsoleNotice message={error} tone="error" onDismiss={() => setError("")} /> : null}
          <Button onClick={() => void handleCreatePlan()} loading={saving} disabled={scheduleTimes.length === 0}>
            {t("btnCreate")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
