"use client";

import { consoleInputClass } from "@/components/ui/console-surface";
import { useI18n } from "@/lib/i18n";
import type { ScheduleTimeDraft } from "@/lib/schedule";
import type { ScheduleTimeType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { scheduleTimeTypeLabelKeys, weekdayLabelKeys } from "./schedule-labels";

const editorTypes: ScheduleTimeType[] = ["daily", "weekly", "monthly", "once", "interval"];

function toggleNumber(list: number[], value: number) {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value].sort((a, b) => a - b);
}

/** Recurrence picker shared by the schedule list and the content calendar. */
export function ScheduleTimeEditor({
  draft,
  onChange,
}: {
  draft: ScheduleTimeDraft;
  onChange: (next: ScheduleTimeDraft) => void;
}) {
  const { t } = useI18n();
  const chipClass = (active: boolean) =>
    cn(
      "rounded-full border px-2.5 py-1 text-xs font-medium transition",
      active
        ? "border-sky-300 bg-sky-50 text-sky-700"
        : "border-sky-100 bg-white text-zinc-500 hover:border-sky-200 hover:text-zinc-700",
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {editorTypes.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={draft.type === type}
            className={chipClass(draft.type === type)}
            onClick={() => onChange({ ...draft, type })}
          >
            {t(scheduleTimeTypeLabelKeys[type])}
          </button>
        ))}
      </div>

      {draft.type === "once" ? (
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("scheduleFieldDateTime")}</span>
          <input
            type="datetime-local"
            value={draft.dateTime}
            onChange={(event) => onChange({ ...draft, dateTime: event.target.value })}
            className={consoleInputClass}
          />
        </label>
      ) : draft.type === "interval" ? (
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("scheduleFieldEveryMinutes")}</span>
          <input
            type="number"
            min={5}
            max={43_200}
            step={5}
            value={draft.everyMinutes}
            onChange={(event) => onChange({ ...draft, everyMinutes: Number(event.target.value) })}
            className={consoleInputClass}
          />
        </label>
      ) : (
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("scheduleFieldTime")}</span>
          <input
            type="time"
            value={draft.time}
            onChange={(event) => onChange({ ...draft, time: event.target.value })}
            className={consoleInputClass}
          />
        </label>
      )}

      {draft.type === "weekly" ? (
        <div className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("scheduleFieldWeekdays")}</span>
          <div className="flex flex-wrap gap-1.5">
            {weekdayLabelKeys.map((key, weekday) => (
              <button
                key={key}
                type="button"
                aria-pressed={draft.weekdays.includes(weekday)}
                className={chipClass(draft.weekdays.includes(weekday))}
                onClick={() => onChange({ ...draft, weekdays: toggleNumber(draft.weekdays, weekday) })}
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {draft.type === "monthly" ? (
        <div className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("scheduleFieldMonthDays")}</span>
          <div className="grid grid-cols-7 gap-1 sm:grid-cols-10">
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={draft.monthDays.includes(day)}
                className={chipClass(draft.monthDays.includes(day))}
                onClick={() => onChange({ ...draft, monthDays: toggleNumber(draft.monthDays, day) })}
              >
                {day}
              </button>
            ))}
          </div>
          <p className="text-xs font-normal text-zinc-400">{t("scheduleFieldMonthDaysHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
