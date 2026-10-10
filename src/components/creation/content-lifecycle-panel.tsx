"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { CalendarClock, ExternalLink } from "lucide-react";
import { ScheduleRescheduleDialog } from "@/components/calendar/schedule-reschedule-dialog";
import { Button } from "@/components/ui/button";
import { formatClockTime, formatDayLabel } from "@/lib/calendar";
import { useI18n } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n-config";
import { swrFetcher } from "@/lib/api-client";
import type { ContentLifecyclePayload } from "@/lib/types";
import {
  contentStatusClass,
  contentStatusLabelKeys,
  lifecycleStageClass,
  lifecycleStageLabelKeys,
  publishTaskStatusClass,
  publishTaskStatusLabelKeys,
} from "./content-labels";

/**
 * 内容生命周期与日历 (CI-P2-04) inside the content detail view.
 *
 * It shows the two axes separately (P2-04-07): 内容状态 is `content_items.status`, 生命周期阶段 is the
 * mapping in `src/lib/content-lifecycle.ts`, and below them the plan (P2-04-03) and the publish
 * records per platform (P2-04-06). When records exist but none of them says a platform accepted the
 * content, the panel says so in those words instead of leaving a chip to imply a success.
 */
export default function ContentLifecyclePanel({
  contentItemId,
  onChanged,
}: {
  contentItemId: string;
  /** Called when the plan was moved, so the host view can refresh what it shows. */
  onChanged?: () => void;
}) {
  const { t, locale } = useI18n();
  const [reschedule, setReschedule] = useState<{ scheduleId: string; at: number } | null>(null);
  const url = `/api/content/lifecycle?contentItemId=${encodeURIComponent(contentItemId)}&limit=1`;
  const { data, mutate } = useSWR<ContentLifecyclePayload>(url, swrFetcher);
  const row = data?.rows[0];
  const scanned = data?.scan;

  return (
    <section className="min-w-0 space-y-3 rounded-[28px] border border-sky-100 bg-sky-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase text-zinc-400">{t("contentLifecycleTitle")}</h3>
        {row ? (
          <>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${lifecycleStageClass[row.stage]}`}>
              {t(lifecycleStageLabelKeys[row.stage])}
            </span>
            <span className="text-xs text-zinc-500">
              {t("contentLifecycleContentStatus")}:{" "}
              {row.contentStatus ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${contentStatusClass[row.contentStatus]}`}
                >
                  {t(contentStatusLabelKeys[row.contentStatus])}
                </span>
              ) : (
                <span>{t("contentLifecycleContentGone")}</span>
              )}
            </span>
          </>
        ) : (
          <span className="text-xs text-zinc-500">{t("loading")}</span>
        )}
      </div>

      {row ? (
        <>
          <p className="text-xs text-zinc-500">{t("contentLifecycleStageHint")}</p>

          <div className="rounded-2xl bg-white p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500">
              <CalendarClock className="size-3.5" />
              {t("contentLifecyclePlan")}
            </p>
            {row.plan ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-800">
                <span className="tabular-nums">
                  {formatDayLabel(row.plan.at, locale)} {formatClockTime(row.plan.at, locale)}
                </span>
                <span className="text-xs text-zinc-500">
                  {[row.plan.accountName, row.plan.platform].filter(Boolean).join(" · ") || t("unspecified")}
                </span>
                {row.plan.enabled ? null : (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                    {t("disabled")}
                  </span>
                )}
                {row.plan.repeating ? (
                  <span className="text-xs text-zinc-400">
                    {t("contentLifecyclePlanOccurrences", { count: row.planCount })}
                  </span>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReschedule({ scheduleId: row.plan!.scheduleId, at: row.plan!.at })}
                >
                  {t("scheduleRescheduleOpen")}
                </Button>
              </div>
            ) : (
              <p className="mt-1 text-sm text-zinc-500">{t("contentLifecycleNoPlan")}</p>
            )}
          </div>

          <div className="rounded-2xl bg-white p-3">
            <p className="text-xs font-semibold text-zinc-500">{t("contentLifecyclePublish")}</p>
            {row.publish.records === 0 ? (
              <p className="mt-1 text-sm text-zinc-500">{t("contentLifecycleNoRecords")}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {row.publish.platforms.map((platform) => (
                  <li
                    key={platform.key || "unattributed"}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="min-w-0 text-zinc-800">
                      {[platform.accountName, platform.platform].filter(Boolean).join(" · ") || t("unspecified")}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${publishTaskStatusClass[platform.lastStatus]}`}
                    >
                      {t(publishTaskStatusLabelKeys[platform.lastStatus])}
                    </span>
                    <span className="text-xs tabular-nums text-zinc-400">
                      {formatDayLabel(platform.lastAt, locale)} {formatClockTime(platform.lastAt, locale)}
                    </span>
                    {platform.published > 0 ? (
                      <span className="text-xs text-emerald-700">
                        {t("contentLifecyclePlatformPublished", { count: platform.published })}
                      </span>
                    ) : null}
                    {platform.url ? (
                      <a
                        href={platform.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sky-600 hover:underline"
                      >
                        <ExternalLink size={12} />
                        {t("publishRecordOpenLink")}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {row.publish.hasOnlyUnfinishedRecords ? (
              <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {t("contentLifecycleUnfinishedNotice")}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-zinc-400">
              {t("contentLifecycleRecordCounts", {
                records: row.publish.records,
                published: row.publish.byStatus.published,
                runs: row.executions.runs,
              })}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href={localizedPath(locale, "/schedules/calendar")}
              className="text-xs text-sky-600 hover:underline"
            >
              {t("navContentCalendar")}
            </Link>
            {scanned ? (
              <span className="text-xs text-zinc-400">
                {t("contentLifecycleScan", {
                  records: scanned.publishRecords,
                  limit: scanned.publishRecordsLimit,
                })}
              </span>
            ) : null}
          </div>
        </>
      ) : null}

      {reschedule ? (
        <ScheduleRescheduleDialog
          scheduleId={reschedule.scheduleId}
          at={reschedule.at}
          onClose={() => setReschedule(null)}
          onSaved={() => {
            setReschedule(null);
            void mutate();
            onChanged?.();
          }}
        />
      ) : null}
    </section>
  );
}
