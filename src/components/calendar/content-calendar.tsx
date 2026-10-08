"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { CalendarClock, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, CheckCheck, Clock3, Play, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsoleCard, ConsoleNotice, ConsoleSectionHeader, consoleInputClass } from "@/components/ui/console-surface";
import { swrFetcher } from "@/lib/api-client";
import {
  buildMonthGrid,
  formatClockTime,
  formatDayLabel,
  formatMonthLabel,
  gridRange,
  groupEntriesByDay,
  parseDayKey,
  slotsToScheduleTimes,
  toDayKey,
  type CalendarEntry,
  type CalendarEntryKind,
  type CalendarSummary,
} from "@/lib/calendar";
import { useI18n } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n-config";
import type { SlotStat } from "@/lib/metrics";
import type { PlaybookId, ScheduleRecord, ScheduleTime } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BestTimeSlotsPanel } from "./best-time-slots-panel";
import { CalendarMonthGrid } from "./calendar-month-grid";
import { CalendarEntryChip, calendarEntryMeta, calendarKindLabelKeys, calendarStatusLabel } from "./calendar-shared";
import { playbookLabel, scheduleTimesLabel } from "./schedule-labels";
import { ScheduleCreateDialog } from "./schedule-create-dialog";

type CalendarPayload = {
  range: { from: number; to: number };
  accountId: string;
  entries: CalendarEntry[];
  summary: CalendarSummary;
  bestSlots: SlotStat[];
  accounts: { id: string; name: string; platform: string }[];
  generatedAt: number;
};

type PendingCreate = {
  /** React key, so every request mounts a freshly initialised dialog. */
  key: string;
  scheduleTimes: ScheduleTime[];
  playbookId?: PlaybookId;
  accountId?: string;
};

const entryKinds: CalendarEntryKind[] = ["planned", "run", "publish"];
/** Hour used when a schedule is created by clicking an empty day. */
const quickAddHour = 10;

const statToneClass = {
  sky: "bg-sky-50 text-sky-600",
  slate: "bg-zinc-100 text-zinc-600",
  emerald: "bg-emerald-50 text-emerald-600",
  rose: "bg-rose-50 text-rose-600",
} as const;

function StatTile({
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


export default function ContentCalendar() {
  const { t, locale } = useI18n();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState(() => toDayKey(new Date()));
  const [accountId, setAccountId] = useState("");
  const [kinds, setKinds] = useState<CalendarEntryKind[]>(entryKinds);
  const [pending, setPending] = useState<PendingCreate | null>(null);
  const [lastUsed, setLastUsed] = useState<{ playbookId?: PlaybookId; accountId?: string }>({});
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  const weeks = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor.year, cursor.month]);
  const range = useMemo(() => gridRange(weeks), [weeks]);
  const query = `/api/calendar?from=${range.from}&to=${range.to}${accountId ? `&accountId=${encodeURIComponent(accountId)}` : ""}`;
  const { data, mutate } = useSWR<CalendarPayload>(query, swrFetcher);

  const todayKey = toDayKey(new Date());
  const entries = useMemo(
    () => (data?.entries ?? []).filter((entry) => kinds.includes(entry.kind)),
    [data?.entries, kinds],
  );
  const entriesByDay = useMemo(() => groupEntriesByDay(entries), [entries]);
  const dayEntries = entriesByDay[selectedDay] ?? [];
  const summary = data?.summary;
  const selectedDate = parseDayKey(selectedDay) ?? new Date();

  function shiftMonth(step: number) {
    setCursor((prev) => {
      const next = new Date(prev.year, prev.month + step, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  function selectDay(dayKey: string) {
    const day = parseDayKey(dayKey);
    if (!day) return;
    setSelectedDay(dayKey);
    setCursor({ year: day.getFullYear(), month: day.getMonth() });
  }

  function openCreate(scheduleTimes: ScheduleTime[]) {
    setPending({
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      scheduleTimes,
      playbookId: lastUsed.playbookId,
      accountId: lastUsed.accountId ?? accountId,
    });
  }

  function quickAdd(dayKey: string) {
    const day = parseDayKey(dayKey);
    if (!day) return;
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), quickAddHour, 0, 0, 0);
    openCreate([{ type: "once", at: at.toISOString() }]);
  }

  function handleCreated(schedule: ScheduleRecord | null, rules: ScheduleTime[]) {
    setPending(null);
    setLastUsed({ playbookId: schedule?.playbookId, accountId: schedule?.accountId });
    setNotice({
      tone: "success",
      message: t("calendarCreatedNotice", {
        rules: scheduleTimesLabel(schedule?.scheduleTimes ?? rules, t, locale),
      }),
    });
    void mutate();
  }

  return (
    <div className="space-y-6">
      {notice ? (
        <ConsoleNotice message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={<CalendarClock className="h-5 w-5" />} tone="sky" value={summary?.planned ?? 0} label={t("calendarKpiPlanned")} />
        <StatTile icon={<Play className="h-5 w-5" />} tone="slate" value={summary?.executed ?? 0} label={t("calendarKpiExecuted")} />
        <StatTile icon={<CheckCheck className="h-5 w-5" />} tone="emerald" value={summary?.published ?? 0} label={t("calendarKpiPublished")} />
        <StatTile icon={<TriangleAlert className="h-5 w-5" />} tone="rose" value={summary?.failed ?? 0} label={t("calendarKpiFailed")} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <ConsoleCard className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label={t("calendarPrevMonth")} onClick={() => shiftMonth(-1)}>
                <ChevronLeft />
              </Button>
              <h2 className="min-w-36 text-center text-lg font-semibold text-zinc-900">
                {formatMonthLabel(cursor.year, cursor.month, locale)}
              </h2>
              <Button variant="outline" size="icon" aria-label={t("calendarNextMonth")} onClick={() => shiftMonth(1)}>
                <ChevronRight />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => selectDay(todayKey)}>
                {t("calendarToday")}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                className={cn(consoleInputClass, "min-h-9 w-auto min-w-40 py-0 text-zinc-700")}
                aria-label={t("metricsAllAccounts")}
              >
                <option value="">{t("metricsAllAccounts")}</option>
                {(data?.accounts ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.platform})
                  </option>
                ))}
              </select>

              {entryKinds.map((kind) => {
                const active = kinds.includes(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setKinds((prev) =>
                        prev.includes(kind) ? prev.filter((item) => item !== kind) : [...prev, kind],
                      )
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                      active
                        ? "border-sky-300 bg-sky-50 text-sky-700"
                        : "border-sky-100 bg-white text-zinc-500 hover:border-sky-200",
                    )}
                  >
                    {t(calendarKindLabelKeys[kind])}
                  </button>
                );
              })}

              <Link
                href={localizedPath(locale, "/schedules/list")}
                className="inline-flex h-9 items-center rounded-full border border-sky-100 bg-white px-3 text-xs font-medium text-sky-700 transition hover:border-sky-200 hover:bg-sky-50"
              >
                {t("navSchedules")}
              </Link>
            </div>
          </div>

          <div className="mt-4">
            <CalendarMonthGrid
              weeks={weeks}
              month={cursor.month}
              todayKey={todayKey}
              selectedDay={selectedDay}
              entriesByDay={entriesByDay}
              onSelectDay={selectDay}
              onQuickAdd={quickAdd}
            />
          </div>
        </ConsoleCard>

        <div className="space-y-6">
          <ConsoleCard>
            <ConsoleSectionHeader icon={<CalendarDays className="h-5 w-5" />} title={t("calendarDayPlan")} />
            <p className="mt-3 text-sm font-medium text-zinc-700">
              {formatDayLabel(selectedDate, locale)}
              <span className="ml-2 text-xs font-normal text-zinc-400">
                {t("calendarDayCount", { count: dayEntries.length })}
              </span>
            </p>
            {dayEntries.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-dashed border-sky-100 px-4 py-6 text-center text-sm text-zinc-500">
                {t("calendarDayEmpty")}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {dayEntries.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-2 rounded-2xl border border-sky-100 bg-white px-3 py-2">
                    <span className="w-11 shrink-0 pt-0.5 text-xs tabular-nums text-zinc-500">
                      {formatClockTime(entry.at, locale)}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <CalendarEntryChip entry={entry} />
                      <p className="truncate text-xs text-zinc-500">
                        {t(calendarKindLabelKeys[entry.kind])} · {calendarStatusLabel(entry, t)} ·{" "}
                        {calendarEntryMeta(entry, t)}
                      </p>
                      {entry.playbookId ? (
                        <p className="truncate text-xs text-zinc-400">{playbookLabel(entry.playbookId, t)}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <Button type="button" variant="outline" size="sm" className="mt-3 w-full" onClick={() => quickAdd(selectedDay)}>
              <CalendarPlus />
              {t("calendarAddForDay")}
            </Button>
          </ConsoleCard>
          <BestTimeSlotsPanel
            slots={data?.bestSlots ?? []}
            onApply={(slots) => openCreate(slotsToScheduleTimes(slots))}
          />

          <ConsoleCard>
            <ConsoleSectionHeader icon={<Clock3 className="h-5 w-5" />} title={t("calendarUpcomingTitle")} />
            {summary && summary.upcoming.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {summary.upcoming.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => selectDay(entry.dayKey)}
                      className="w-full rounded-2xl border border-sky-100 bg-white px-3 py-2 text-left transition hover:border-sky-200 hover:bg-sky-50/50"
                    >
                      <span className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                        <span>{formatDayLabel(entry.at, locale)}</span>
                        <span className="tabular-nums">{formatClockTime(entry.at, locale)}</span>
                      </span>
                      <span className="mt-1 block truncate text-sm text-zinc-800">{entry.title}</span>
                      <span className="block truncate text-xs text-zinc-400">{calendarEntryMeta(entry, t)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-2xl border border-dashed border-sky-100 px-4 py-6 text-center text-sm text-zinc-500">
                {t("calendarUpcomingEmpty")}
              </p>
            )}
          </ConsoleCard>
        </div>
      </div>
      {pending ? (
        <ScheduleCreateDialog
          key={pending.key}
          scheduleTimes={pending.scheduleTimes}
          defaultPlaybookId={pending.playbookId}
          defaultAccountId={pending.accountId}
          onClose={() => setPending(null)}
          onCreated={handleCreated}
        />
      ) : null}
    </div>
  );
}