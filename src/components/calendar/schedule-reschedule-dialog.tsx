"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiErrorTranslationKey, apiPatch, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { toDateTimeLocalValue } from "@/lib/schedule";
import type { ScheduleRecord } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConsoleNotice, consoleInputClass } from "@/components/ui/console-surface";
import { scheduleTimesLabel } from "./schedule-labels";

type ScheduleRescheduleDialogProps = {
  scheduleId: string;
  /** The occurrence the user is moving, epoch ms. */
  at: number;
  onClose: () => void;
  /** Called after the server accepted the change, so the caller can refresh its own view. */
  onSaved: () => void;
};

/**
 * 修改计划发布时间 (CI-P2-04-05).
 *
 * The plan model has exactly one way to move a moment: rewrite the schedule's rule list. It has no
 * "skip this one occurrence", so this dialog replaces the whole list with a single `once` rule and
 * *says that before saving* when the current plan is recurring - a UI that showed only the new date
 * would be telling the user it moved one day while it actually rewrote their weekly rule.
 *
 * The current rules are read from `/api/schedules` (the same source the list page edits) rather than
 * from the calendar's copy, and a plan that no longer exists is reported instead of being saved over.
 */
export function ScheduleRescheduleDialog({
  scheduleId,
  at,
  onClose,
  onSaved,
}: ScheduleRescheduleDialogProps) {
  const { t, locale } = useI18n();
  const { data: schedules } = useSWR<ScheduleRecord[]>("/api/schedules", swrFetcher);
  const [value, setValue] = useState(() => toDateTimeLocalValue(new Date(at)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const schedule = (schedules ?? []).find((entry) => entry.id === scheduleId);
  const loaded = Array.isArray(schedules);
  const missing = loaded && !schedule;
  const isSingleOnce =
    schedule?.scheduleTimes.length === 1 && schedule.scheduleTimes[0]?.type === "once";

  async function handleSave() {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      setError(t("scheduleRescheduleInvalid"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiPatch(`/api/schedules/${scheduleId}`, {
        scheduleTimes: [{ type: "once", at: new Date(parsed).toISOString() }],
      });
      onSaved();
    } catch (err) {
      setError(t(apiErrorTranslationKey(err, "unknownError")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={t("scheduleRescheduleTitle")}>
      <div className="space-y-4">
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("scheduleRescheduleField")}</span>
          <input
            type="datetime-local"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={consoleInputClass}
          />
        </label>

        {missing ? (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {t("scheduleRescheduleMissing")}
          </p>
        ) : schedule && isSingleOnce ? (
          <p className="text-xs text-zinc-500">{t("scheduleRescheduleHint")}</p>
        ) : schedule ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {t("scheduleRescheduleReplacesRule", {
              rules: scheduleTimesLabel(schedule.scheduleTimes, t, locale),
            })}
          </p>
        ) : null}

        {error ? <ConsoleNotice message={error} tone="error" onDismiss={() => setError("")} /> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {t("dlgCancel")}
          </Button>
          <Button onClick={() => void handleSave()} loading={saving} disabled={missing}>
            {t("scheduleRescheduleApply")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
