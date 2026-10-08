"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConsoleNotice, consoleInputClass } from "@/components/ui/console-surface";
import { apiErrorTranslationKey, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { draftToScheduleTimes, scheduleTimesToDraft, type ScheduleTimeDraft } from "@/lib/schedule";
import {
  playbookIds,
  type AccountRecord,
  type PlaybookId,
  type ScheduleRecord,
  type ScheduleTime,
} from "@/lib/types";
import { playbookLabel, scheduleTimeLabel, scheduleTimesLabel } from "./schedule-labels";
import { ScheduleTimeEditor } from "./schedule-time-editor";

/**
 * Creates a schedule. The caller mounts it with a React `key` per request, so
 * the draft below always starts from the props of that request.
 */
export function ScheduleCreateDialog({
  scheduleTimes,
  defaultPlaybookId,
  defaultAccountId,
  onClose,
  onCreated,
}: {
  /** Rules the new schedule starts with; a single rule stays editable. */
  scheduleTimes: ScheduleTime[];
  defaultPlaybookId?: PlaybookId;
  defaultAccountId?: string;
  onClose: () => void;
  onCreated: (schedule: ScheduleRecord | null, rules: ScheduleTime[]) => void;
}) {
  const { t, locale } = useI18n();
  const { data: accounts = [] } = useSWR<AccountRecord[]>("/api/accounts", swrFetcher);
  const editable = scheduleTimes.length <= 1;
  const [draft, setDraft] = useState<ScheduleTimeDraft>(() => scheduleTimesToDraft(scheduleTimes));
  const [playbookId, setPlaybookId] = useState<PlaybookId>(defaultPlaybookId ?? playbookIds[0]);
  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const rules = editable ? draftToScheduleTimes(draft) : scheduleTimes;

  async function handleSubmit() {
    if (rules.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const created = await apiPost<ScheduleRecord>("/api/schedules", {
        playbookId,
        accountId: accountId || undefined,
        enabled: true,
        scheduleTimes: rules,
        params: title.trim() ? { title: title.trim() } : {},
      });
      onCreated(created ?? null, rules);
    } catch (submitError) {
      setError(t(apiErrorTranslationKey(submitError, "calendarCreateFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={t("calendarCreateSchedule")} maxWidth="lg">
      <div className="space-y-4">
        {editable ? (
          <ScheduleTimeEditor draft={draft} onChange={setDraft} />
        ) : (
          <div className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("calendarSelectedSlots")}</span>
            <div className="flex flex-wrap gap-1.5">
              {scheduleTimes.map((entry, index) => (
                <span
                  key={`${entry.type}-${index}`}
                  className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700"
                >
                  {scheduleTimeLabel(entry, t, locale)}
                </span>
              ))}
            </div>
          </div>
        )}

        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("playbook")}</span>
          <select
            value={playbookId}
            onChange={(event) => setPlaybookId(event.target.value as PlaybookId)}
            className={consoleInputClass}
          >
            {playbookIds.map((id) => (
              <option key={id} value={id}>
                {playbookLabel(id, t)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("site")}</span>
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={consoleInputClass}>
            <option value="">{t("unspecified")}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.platform})
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("scheduleFieldTitle")}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("scheduleFieldTitlePlaceholder")}
            className={consoleInputClass}
          />
        </label>

        <p className="rounded-2xl border border-sky-100 bg-sky-50/60 px-3 py-2 text-xs text-sky-700">
          {t("calendarPreviewRules", { rules: scheduleTimesLabel(rules, t, locale) })}
        </p>

        {rules.length === 0 ? <p className="text-xs text-rose-600">{t("scheduleCreateEmpty")}</p> : null}
        {error ? <ConsoleNotice message={error} tone="error" onDismiss={() => setError("")} /> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("btnCancel")}
          </Button>
          <Button type="button" loading={saving} disabled={rules.length === 0} onClick={() => void handleSubmit()}>
            {t("calendarCreateSchedule")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
