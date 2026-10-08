"use client";

import { useState } from "react";
import { CalendarPlus, Sparkles } from "lucide-react";
import { ConsoleCard, ConsoleSectionHeader } from "@/components/ui/console-surface";
import { Button } from "@/components/ui/button";
import { slotsToScheduleTimes } from "@/lib/calendar";
import { useI18n } from "@/lib/i18n";
import type { SlotStat } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { scheduleTimeLabel, weekdayLabelKeys } from "./schedule-labels";

function slotKey(slot: SlotStat) {
  return `${slot.weekday}-${slot.hour}`;
}

/**
 * Best publishing times derived from real engagement (`bestTimeSlots`). Picking
 * slots turns them into weekly rules through `slotsToScheduleTimes`.
 */
export function BestTimeSlotsPanel({
  slots,
  onApply,
}: {
  slots: SlotStat[];
  onApply: (slots: SlotStat[]) => void;
}) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);

  const chosen = slots.filter((slot) => selected.includes(slotKey(slot)));
  const rules = slotsToScheduleTimes(chosen);

  function toggle(slot: SlotStat) {
    const key = slotKey(slot);
    setSelected((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  }

  return (
    <ConsoleCard>
      <ConsoleSectionHeader icon={<Sparkles className="h-5 w-5" />} title={t("metricsRetroBestTime")} />
      <p className="mt-3 text-xs text-zinc-500">{t("calendarBestTimeHint")}</p>

      {slots.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-sky-100 px-4 py-6 text-center text-sm text-zinc-500">
          {t("metricsRetroEmpty")}
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {slots.map((slot) => {
              const active = selected.includes(slotKey(slot));
              return (
                <li key={slotKey(slot)}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggle(slot)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-sm transition",
                      active
                        ? "border-sky-300 bg-sky-50 text-sky-800"
                        : "border-sky-100 bg-white text-zinc-700 hover:border-sky-200",
                    )}
                  >
                    <span>
                      {t(weekdayLabelKeys[slot.weekday])} · {String(slot.hour).padStart(2, "0")}:00
                    </span>
                    <span className="text-xs text-zinc-500">
                      <b className="text-zinc-800">{slot.avgInteractions.toFixed(1)}</b> {t("metricsKpiInteractions")} ·{" "}
                      {slot.count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {rules.length > 0 ? (
            <p className="mt-3 rounded-2xl border border-sky-100 bg-sky-50/60 px-3 py-2 text-xs text-sky-700">
              {t("calendarSelectedSlots")}: {rules.map((rule) => scheduleTimeLabel(rule, t, locale)).join(" / ")}
            </p>
          ) : null}

          <Button type="button" className="mt-3 w-full" disabled={chosen.length === 0} onClick={() => onApply(chosen)}>
            <CalendarPlus />
            {t("calendarApplySlots")}
          </Button>
        </>
      )}
    </ConsoleCard>
  );
}
