"use client";

import { CalendarPlus } from "lucide-react";
import { toDayKey, type CalendarEntry } from "@/lib/calendar";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CalendarEntryChip } from "./calendar-shared";
import { weekdayLabelKeys } from "./schedule-labels";

const maxChipsPerCell = 3;

export function CalendarMonthGrid({
  weeks,
  month,
  todayKey,
  selectedDay,
  entriesByDay,
  onSelectDay,
  onQuickAdd,
}: {
  weeks: Date[][];
  /** 0-based month the grid is centred on; other weeks render muted. */
  month: number;
  todayKey: string;
  selectedDay: string;
  entriesByDay: Record<string, CalendarEntry[]>;
  onSelectDay: (dayKey: string) => void;
  onQuickAdd: (dayKey: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="overflow-hidden rounded-2xl border border-sky-100">
      <div className="grid grid-cols-7 border-b border-sky-100 bg-sky-50/60">
        {weekdayLabelKeys.map((key) => (
          <div key={key} className="px-1 py-2 text-center text-xs font-semibold text-sky-700">
            {t(key)}
          </div>
        ))}
      </div>
      <div className="divide-y divide-sky-100">
        {weeks.map((week) => (
          <div key={toDayKey(week[0])} className="grid grid-cols-7 divide-x divide-sky-100">
            {week.map((day) => {
              const dayKey = toDayKey(day);
              const dayEntries = entriesByDay[dayKey] ?? [];
              const inMonth = day.getMonth() === month;
              const isToday = dayKey === todayKey;
              const isSelected = dayKey === selectedDay;
              const hidden = dayEntries.length - maxChipsPerCell;

              return (
                <div
                  key={dayKey}
                  className={cn("group relative min-h-28 px-1.5 py-1.5", inMonth ? "bg-white" : "bg-zinc-50/80")}
                >
                  <button
                    type="button"
                    onClick={() => onSelectDay(dayKey)}
                    className="flex w-full items-center gap-1 text-left"
                    aria-current={isToday ? "date" : undefined}
                  >
                    <span
                      className={cn(
                        "grid size-6 place-items-center rounded-full text-xs font-semibold",
                        isToday ? "bg-sky-600 text-white" : inMonth ? "text-zinc-700" : "text-zinc-400",
                      )}
                    >
                      {day.getDate()}
                    </span>
                    {isToday ? <span className="text-[10px] text-sky-600">{t("calendarToday")}</span> : null}
                  </button>

                  <div className="mt-1 space-y-1">
                    {dayEntries.slice(0, maxChipsPerCell).map((entry) => (
                      <CalendarEntryChip key={entry.id} entry={entry} />
                    ))}
                    {hidden > 0 ? (
                      <button
                        type="button"
                        onClick={() => onSelectDay(dayKey)}
                        className="w-full px-1 text-left text-[10px] font-medium text-sky-600 hover:underline"
                      >
                        {t("calendarMoreEntries", { count: hidden })}
                      </button>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => onQuickAdd(dayKey)}
                    aria-label={t("calendarAddForDay")}
                    title={t("calendarAddForDay")}
                    className="absolute right-1 top-1 hidden rounded-full border border-sky-200 bg-white p-0.5 text-sky-600 hover:bg-sky-50 group-hover:block"
                  >
                    <CalendarPlus className="size-3.5" />
                  </button>

                  {isSelected ? (
                    <span className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-inset ring-sky-400" />
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
