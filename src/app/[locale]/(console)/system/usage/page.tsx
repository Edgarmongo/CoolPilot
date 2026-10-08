"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { ArrowDown, ArrowUp, Calendar, Info } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { swrFetcher } from "@/lib/api-client";
import { ConsoleCard } from "@/components/ui/console-surface";
import { usageRangeDays, type UsageRangeDays, type UsageSummary } from "@/lib/types";

const numberFormatter = new Intl.NumberFormat("en-US");

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

export default function UsagePage() {
  const { t } = useI18n();
  const [range, setRange] = useState<UsageRangeDays>(7);
  const [sortDesc, setSortDesc] = useState(true);

  const { data } = useSWR<UsageSummary>(`/api/usage-records?range=${range}`, swrFetcher);
  const totals = data?.totals;

  const models = useMemo(() => {
    const list = data?.models ?? [];
    return [...list].sort((a, b) => (sortDesc ? b.totalTokens - a.totalTokens : a.totalTokens - b.totalTokens));
  }, [data, sortDesc]);

  const stats = [
    {
      key: "articles",
      label: t("usageStatArticles"),
      value: t("usageUnitArticles", { count: totals?.articles ?? 0 }),
      hint: t("usageCardNote"),
    },
    { key: "tokens", label: t("usageStatTokens"), value: formatNumber(totals?.totalTokens ?? 0) },
    { key: "words", label: t("usageStatWords"), value: formatNumber(totals?.wordCount ?? 0) },
    { key: "avgWords", label: t("usageStatAvgWords"), value: formatNumber(totals?.avgWords ?? 0) },
  ];

  return (
    <div className="space-y-6">
      <ConsoleCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-900">{t("navUsage")}</h2>
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-zinc-400" aria-hidden />
            <div className="flex items-center gap-1 rounded-full border border-sky-100 bg-white p-1">
              {usageRangeDays.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setRange(days)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    range === days ? "bg-sky-500 text-white shadow-sm" : "text-zinc-500 hover:bg-sky-50"
                  }`}
                >
                  {t("usageRangeDays", { count: days })}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.key} className="min-w-0">
              <p className="flex items-center gap-1 text-sm text-zinc-500">
                {stat.label}
                {stat.hint ? <Info className="size-3.5 text-zinc-300" aria-label={stat.hint} /> : null}
              </p>
              <p className="mt-3 truncate text-2xl font-semibold text-zinc-950">{stat.value}</p>
            </div>
          ))}
        </div>

        <p className="mt-5 border-t border-sky-50 pt-4 text-xs leading-5 text-zinc-400">{t("usageCardNote")}</p>
      </ConsoleCard>

      <ConsoleCard>
        <h2 className="text-base font-semibold text-zinc-900">{t("usageModelTable")}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              <tr className="border-b border-sky-100">
                <th className="px-3 py-3">{t("usageColModel")}</th>
                <th className="px-3 py-3 text-right">{t("usageColArticles")}</th>
                <th className="px-3 py-3 text-right">{t("usageColInputTokens")}</th>
                <th className="px-3 py-3 text-right">{t("usageColOutputTokens")}</th>
                <th className="bg-sky-50 px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setSortDesc((prev) => !prev)}
                    className="ml-auto flex items-center gap-1 text-sky-700 transition hover:text-sky-900"
                    title={t("usageTableNote")}
                  >
                    {t("usageColTotalTokens")}
                    {sortDesc ? <ArrowDown className="size-3.5" aria-hidden /> : <ArrowUp className="size-3.5" aria-hidden />}
                  </button>
                </th>
                <th className="px-3 py-3 text-right">{t("usageColAvgWords")}</th>
                <th className="px-3 py-3 text-right">{t("usageColAvgTokens")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-50">
              {models.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-sm text-zinc-400">
                    {t("usageEmpty")}
                  </td>
                </tr>
              ) : (
                models.map((model) => (
                  <tr key={`${model.provider}-${model.model}`} className="text-zinc-700">
                    <td className="px-3 py-3">
                      <p className="font-semibold text-zinc-900">{model.model}</p>
                      <p className="mt-0.5 text-xs text-zinc-400">{model.provider}</p>
                    </td>
                    <td className="px-3 py-3 text-right">{formatNumber(model.articles)}</td>
                    <td className="px-3 py-3 text-right">{formatNumber(model.inputTokens)}</td>
                    <td className="px-3 py-3 text-right">{formatNumber(model.outputTokens)}</td>
                    <td className="bg-sky-50/50 px-3 py-3 text-right font-medium text-zinc-900">
                      {formatNumber(model.totalTokens)}
                    </td>
                    <td className="px-3 py-3 text-right">{formatNumber(model.avgWords)}</td>
                    <td className="px-3 py-3 text-right">{formatNumber(model.avgTokens)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs leading-5 text-zinc-400">{t("usageTableNote")}</p>
      </ConsoleCard>
    </div>
  );
}
