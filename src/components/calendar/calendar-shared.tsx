"use client";

import { CheckCircle2, Clock3, Loader2, TriangleAlert } from "lucide-react";
import { isFailedStatus, isSuccessStatus, type CalendarEntry, type CalendarEntryKind } from "@/lib/calendar";
import type { TranslationKey } from "@/lib/locale-resources";
import { cn } from "@/lib/utils";
import type { Translate } from "./schedule-labels";

const plannedStatusKeys: Record<string, TranslationKey> = {
  scheduled: "scheduleStatusScheduled",
  queued: "scheduleStatusQueued",
  running: "scheduleStatusRunning",
  posted: "scheduleStatusPosted",
  failed: "scheduleStatusFailed",
  missed: "scheduleStatusMissed",
  cancelled: "scheduleStatusCancelled",
  disabled: "disabled",
};

const runStatusKeys: Record<string, TranslationKey> = {
  queued: "runStatusQueued",
  running: "runStatusRunning",
  success: "runStatusSuccess",
  warning: "runStatusWarning",
  failed: "runStatusFailed",
  cancelled: "runStatusCancelled",
};

const publishStatusKeys: Record<string, TranslationKey> = {
  queued: "publishRecordStatusQueued",
  running: "publishRecordStatusRunning",
  published: "publishRecordStatusPublished",
  drafted: "publishRecordStatusDrafted",
  failed: "publishRecordStatusFailed",
  cancelled: "publishRecordStatusCancelled",
};

export const calendarKindLabelKeys: Record<CalendarEntryKind, TranslationKey> = {
  planned: "calendarKindPlanned",
  run: "calendarKindRun",
  publish: "calendarKindPublish",
};

export function calendarStatusLabel(entry: CalendarEntry, t: Translate) {
  const table =
    entry.kind === "planned" ? plannedStatusKeys : entry.kind === "run" ? runStatusKeys : publishStatusKeys;
  const key = table[entry.status];
  return key ? t(key) : entry.status;
}

export function calendarEntryToneClass(entry: CalendarEntry) {
  if (isFailedStatus(entry.status)) return "border-rose-200 bg-rose-50 text-rose-700";
  if (isSuccessStatus(entry.status)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (entry.status === "running") return "border-amber-200 bg-amber-50 text-amber-700";
  if (entry.kind === "planned") {
    return entry.enabled === false
      ? "border-zinc-200 bg-zinc-50 text-zinc-500"
      : "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

export function CalendarEntryIcon({ entry, className }: { entry: CalendarEntry; className?: string }) {
  if (isFailedStatus(entry.status)) return <TriangleAlert className={className} />;
  if (isSuccessStatus(entry.status)) return <CheckCircle2 className={className} />;
  if (entry.status === "running") return <Loader2 className={className} />;
  return <Clock3 className={className} />;
}

export function CalendarEntryChip({
  entry,
  time,
  className,
}: {
  entry: CalendarEntry;
  /** Pre-formatted clock time; omit inside the month grid. */
  time?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex w-full items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] leading-tight",
        calendarEntryToneClass(entry),
        className,
      )}
    >
      <CalendarEntryIcon entry={entry} className="size-3 shrink-0" />
      {time ? <span className="shrink-0 tabular-nums">{time}</span> : null}
      <span className={cn("truncate", entry.kind === "planned" && entry.enabled === false ? "line-through" : "")}>
        {entry.contentTitle || entry.title || "—"}
      </span>
    </span>
  );
}

/** `{accountName} · {platform}` for the day agenda, omitting empty parts. */
export function calendarEntryMeta(entry: CalendarEntry, t: Translate) {
  const parts = [entry.accountName || t("unspecified")];
  if (entry.platform) parts.push(entry.platform);
  return parts.join(" · ");
}
