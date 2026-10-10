"use client";

import { Fragment, useMemo, useState } from "react";
import useSWR from "swr";
import { ArrowDown, ArrowUp, Calendar, Info } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { swrFetcher } from "@/lib/api-client";
import { ConsoleCard } from "@/components/ui/console-surface";
import BudgetPanel from "@/components/cost-center/budget-panel";
import type { TranslationKey } from "@/lib/locale-resources";
import {
  usageRangeDays,
  type AiCostCenterCallFilters,
  type AiCostCenterCallsPayload,
  type AiCostCenterPayload,
  type AiUsageCallRetryChange,
  type AiUsageCallRetryKind,
  type AiUsageCallView,
  type AiUsageCostSource,
  type UsageModelSummary,
  type UsageRangeDays,
} from "@/lib/types";

/**
 * 「AI 成本与质量优化中心」的首页 (CI-P7-02).
 *
 * The page renders only what the ledger can state, and it names which of the four money states each
 * figure came from (`computed` / `provider-reported` / `unpriced` / `unknown`). Three things this
 * surface deliberately refuses to do:
 *
 *  - add a CNY row to a USD row - there is no rate in this database, so the totals stay per currency;
 *  - write `0` where no figure exists - an unpriced call is counted as unpriced, and `null` stays
 *    `null` all the way to the screen;
 *  - call a partial figure the bill - `costIsComplete` decides which sentence is printed.
 *
 * The three sections that are not built yet are reachable as tabs and say so in words. They show no
 * placeholder numbers, because a demonstration figure and a real one look the same at a glance.
 */

export type CostCenterTab = "overview" | "calls" | "budget" | "quality";

/**
 * The order the tabs are drawn in. Deliberately module-local: a server component cannot read a
 * runtime value out of a `"use client"` module (it gets a client reference, not the array), so
 * `system/cost-center/page.tsx` keeps its own copy for validating `?tab=` - the same split as
 * `system/models/page.tsx`.
 */
const costCenterTabs: readonly CostCenterTab[] = ["overview", "calls", "budget", "quality"];

const numberFormat = new Intl.NumberFormat("en-US");
/** Money keeps the ledger's 6 decimals: a fraction of a cent is often the whole figure here. */
const amountFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

/** Each `cost_source` in the page's own words - the four states a figure can be in. */
const costSourceLabels: Record<AiUsageCostSource, TranslationKey> = {
  "provider-reported": "costCenterSourceProviderReported",
  computed: "costCenterSourceComputed",
  unpriced: "costCenterSourceUnpriced",
  unknown: "costCenterSourceUnknown",
};

const tabLabels: Record<CostCenterTab, TranslationKey> = {
  overview: "costCenterTabOverview",
  calls: "costCenterTabCalls",
  budget: "costCenterTabBudget",
  quality: "costCenterTabQuality",
};

/**
 * What a tab that is not built yet names as its own card, so the wording cannot drift. Only 质量与优化
 * is still in this list: 预算与预估 is `BudgetPanel` below, which reads its figures from the ledger and
 * its guarantee from the server.
 */
const tabTasks: Record<Extract<CostCenterTab, "quality">, TranslationKey> = {
  quality: "costCenterTaskQuality",
};

/** The 调用明细 filters before the reader touches anything. */
const noCallFilters: AiCostCenterCallFilters = {
  purpose: "",
  outcome: "",
  costSource: "",
  model: "",
  retryOnly: false,
  contentItemId: "",
  taskId: "",
};

/** One page of requests. Small enough that a page's detail still reads as a list. */
const callPageSize = 25;

/** How each retry kind is named - read off the predecessor row, never off `attemptIndex`. */
const retryLabels: Record<AiUsageCallRetryKind, TranslationKey> = {
  "first-request": "costCenterCallsRetryFirst",
  "self-correction": "costCenterCallsRetrySelfCorrection",
  "after-failed-request": "costCenterCallsRetryAfterFailed",
  "unresolved-predecessor": "costCenterCallsRetryUnresolved",
};

/** Which recorded identity fields differ between a retry and the request it followed. */
const retryChangeLabels: Record<AiUsageCallRetryChange, TranslationKey> = {
  provider: "costCenterCallsChangeProvider",
  model: "costCenterCallsChangeModel",
  endpoint: "costCenterCallsChangeEndpoint",
  credential: "costCenterCallsChangeCredential",
};

/** One filter dropdown. Local to this file: only the calls tab draws filters. */
function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-40 flex-col gap-1 text-xs font-medium text-zinc-500">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-sky-100 bg-white px-2 py-1.5 text-sm text-zinc-700"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A money cell that admits when part of its group could not state a figure at all. */
function CostCell({ amount, hasUnpriced }: { amount: number; hasUnpriced: boolean }) {
  return (
    <span className="text-zinc-700">
      {hasUnpriced ? "≥ " : ""}
      {amountFormat.format(amount)}
    </span>
  );
}

export default function CostCenterClient({ initialTab }: { initialTab: CostCenterTab }) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<CostCenterTab>(initialTab);
  const [range, setRange] = useState<UsageRangeDays>(7);
  const [sortDesc, setSortDesc] = useState(true);

  const { data, error } = useSWR<AiCostCenterPayload>(`/api/ai-cost-center?range=${range}`, swrFetcher, {
    revalidateOnFocus: false,
  });

  const [callFilters, setCallFilters] = useState<AiCostCenterCallFilters>(noCallFilters);
  const [callOffset, setCallOffset] = useState(0);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);

  /**
   * The 调用明细 reading is fetched only while its tab is open: SWR with a `null` key does nothing, so
   * the overview never pays for a query nobody is looking at.
   */
  const callsKey = useMemo(() => {
    if (tab !== "calls") return null;
    const params = new URLSearchParams({
      range: String(range),
      offset: String(callOffset),
      limit: String(callPageSize),
    });
    if (callFilters.purpose) params.set("purpose", callFilters.purpose);
    if (callFilters.outcome) params.set("outcome", callFilters.outcome);
    if (callFilters.costSource) params.set("source", callFilters.costSource);
    if (callFilters.model) params.set("model", callFilters.model);
    if (callFilters.retryOnly) params.set("retry", "1");
    if (callFilters.contentItemId) params.set("contentItemId", callFilters.contentItemId);
    if (callFilters.taskId) params.set("taskId", callFilters.taskId);
    return `/api/ai-cost-center/calls?${params.toString()}`;
  }, [tab, range, callFilters, callOffset]);

  const { data: callsData, error: callsError } = useSWR<AiCostCenterCallsPayload>(callsKey, swrFetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  /** Any filter change starts the list over: page 4 of the old result is not page 4 of the new one. */
  function updateCallFilters(patch: Partial<AiCostCenterCallFilters>) {
    setCallFilters((previous) => ({ ...previous, ...patch }));
    setCallOffset(0);
  }

  /** A new window means a new list, for the same reason. */
  function changeRange(next: UsageRangeDays) {
    setRange(next);
    setCallOffset(0);
  }

  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
    [locale],
  );

  const callViews = callsData?.calls ?? [];
  const callByContent = callsData?.byContent ?? [];
  const callOptions = callsData?.options;
  const callTotals = callsData?.totals;
  const matchedCurrencies = callsData?.matchedCostByCurrency ?? [];
  const pageFrom = callsData && callsData.matched > 0 ? callsData.offset + 1 : 0;
  const pageTo = callsData ? callsData.offset + callViews.length : 0;

  /** Tokens for a text call, the recorded units for everything else - never an invented reading. */
  function usageText(view: AiUsageCallView) {
    const units = Object.entries(view.quantity);
    if (units.length > 0) {
      return units.map(([unit, amount]) => `${unit} ${numberFormat.format(Number(amount) || 0)}`).join(" · ");
    }
    return `${numberFormat.format(view.entry.tokens.inputTokens)} / ${numberFormat.format(view.entry.tokens.outputTokens)}`;
  }

  /** What the row changed about itself, as the retry chain reads it. */
  function retryChangedText(view: AiUsageCallView) {
    if (view.retry.changed.length === 0) return t("costCenterCallsRetrySame");
    return t("costCenterCallsRetryChanged", {
      fields: view.retry.changed.map((field) => t(retryChangeLabels[field])).join(" / "),
    });
  }

  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit" }),
    [locale],
  );

  const ledger = data?.ledger;
  const totals = ledger?.totals;
  const usageTotals = data?.usage.totals;
  const currencies = useMemo(() => ledger?.costByCurrency ?? [], [ledger]);
  const sources = useMemo(() => ledger?.byCostSource ?? [], [ledger]);
  const purposes = useMemo(() => ledger?.byPurpose ?? [], [ledger]);
  const models = useMemo(() => ledger?.byModel ?? [], [ledger]);
  const days = useMemo(() => ledger?.byDay ?? [], [ledger]);
  const allKinds = useMemo(() => data?.catalog.meteredKinds ?? [], [data]);
  const pricedKinds = useMemo(() => data?.catalog.pricedKinds ?? [], [data]);
  const unpricedKinds = useMemo(
    () => allKinds.filter((kind) => !pricedKinds.includes(kind)),
    [allKinds, pricedKinds],
  );
  const maxDayCost = useMemo(() => days.reduce((max, day) => Math.max(max, day.costAmount), 0), [days]);
  const legacyModels = useMemo(() => {
    const list: UsageModelSummary[] = data?.usage.models ?? [];
    return [...list].sort((a, b) => (sortDesc ? b.totalTokens - a.totalTokens : a.totalTokens - b.totalTokens));
  }, [data, sortDesc]);

  /** The currency is part of the amount, not decoration: two of them are never one figure. */
  const currencyLabel = (currency: string) => currency || t("costCenterCurrencyUnstated");
  const money = (currency: string, amount: number) => `${currencyLabel(currency)} ${amountFormat.format(amount)}`;
  const articles = usageTotals?.articles ?? 0;
  const costIsComplete = totals?.costIsComplete ?? false;
  /** The old 用量统计 headline numbers, kept as the "what did we get for it" side of the page. */
  const legacyStats = [
    {
      key: "articles",
      label: t("usageStatArticles"),
      value: t("usageUnitArticles", { count: articles }),
    },
    { key: "words", label: t("usageStatWords"), value: numberFormat.format(usageTotals?.wordCount ?? 0) },
    { key: "avgWords", label: t("usageStatAvgWords"), value: numberFormat.format(usageTotals?.avgWords ?? 0) },
  ];

  return (
    <div className="space-y-6">
      <ConsoleCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-900">{t("navAiCostCenter")}</h2>
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-zinc-400" aria-hidden />
            <div className="flex items-center gap-1 rounded-full border border-sky-100 bg-white p-1">
              {usageRangeDays.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => changeRange(option)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    range === option ? "bg-sky-500 text-white shadow-sm" : "text-zinc-500 hover:bg-sky-50"
                  }`}
                >
                  {t("usageRangeDays", { count: option })}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-zinc-400">{t("costCenterIntro")}</p>

        <div className="mt-5 flex w-full gap-2 overflow-x-auto border-b border-border pb-2">
          {costCenterTabs.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setTab(entry)}
              className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                tab === entry
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-zinc-500 hover:bg-sky-50 hover:text-zinc-900"
              }`}
            >
              {t(tabLabels[entry])}
            </button>
          ))}
        </div>
      </ConsoleCard>

      {error ? (
        <ConsoleCard>
          <p className="text-sm text-red-700">{t("costCenterLoadFailed")}</p>
        </ConsoleCard>
      ) : null}

      {tab === "budget" ? <BudgetPanel /> : null}

      {tab === "quality" ? (
        <ConsoleCard>
          <h2 className="text-base font-semibold text-zinc-900">{t(tabLabels[tab])}</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-600">{t(tabTasks[tab])}</p>
          <p className="mt-2 text-xs leading-5 text-zinc-400">{t("costCenterStubNote")}</p>
        </ConsoleCard>
      ) : null}

      {tab === "calls" ? (
        <>
          <ConsoleCard>
            <h2 className="text-base font-semibold text-zinc-900">{t("costCenterCallsIntro")}</h2>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <FilterSelect
                label={t("costCenterCallsFilterPurpose")}
                allLabel={t("costCenterCallsFilterAll")}
                value={callFilters.purpose}
                options={(callOptions?.purposes ?? []).map((purpose) => ({ value: purpose, label: purpose }))}
                onChange={(value) => updateCallFilters({ purpose: value })}
              />
              <FilterSelect
                label={t("costCenterCallsFilterModel")}
                allLabel={t("costCenterCallsFilterAll")}
                value={callFilters.model}
                options={(callOptions?.models ?? []).map((model) => ({ value: model.key, label: model.label }))}
                onChange={(value) => updateCallFilters({ model: value })}
              />
              <FilterSelect
                label={t("costCenterCallsFilterOutcome")}
                allLabel={t("costCenterCallsFilterAll")}
                value={callFilters.outcome}
                options={(callOptions?.outcomes ?? []).map((outcome) => ({ value: outcome, label: outcome }))}
                onChange={(value) => updateCallFilters({ outcome: value as AiCostCenterCallFilters["outcome"] })}
              />
              <FilterSelect
                label={t("costCenterCallsFilterSource")}
                allLabel={t("costCenterCallsFilterAll")}
                value={callFilters.costSource}
                options={(callOptions?.costSources ?? []).map((source) => ({
                  value: source,
                  label: t(costSourceLabels[source]),
                }))}
                onChange={(value) => updateCallFilters({ costSource: value as AiCostCenterCallFilters["costSource"] })}
              />
              <label className="flex items-center gap-2 text-xs font-medium text-zinc-500">
                <input
                  type="checkbox"
                  checked={callFilters.retryOnly}
                  onChange={(event) => updateCallFilters({ retryOnly: event.target.checked })}
                  className="size-4 rounded border-sky-200"
                />
                {t("costCenterCallsFilterRetry")}
              </label>
            </div>
            {callFilters.retryOnly || callFilters.contentItemId || callFilters.taskId ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                {callFilters.contentItemId ? (
                  <span className="rounded-full border border-sky-200 px-2 py-0.5 text-sky-800">
                    {t("costCenterCallsFilterContent")}: <span className="font-mono">{callFilters.contentItemId}</span>
                  </span>
                ) : null}
                {callFilters.taskId ? (
                  <span className="rounded-full border border-sky-200 px-2 py-0.5 text-sky-800">
                    {t("costCenterCallsFilterTask")}: <span className="font-mono">{callFilters.taskId}</span>
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => updateCallFilters({ retryOnly: false, contentItemId: "", taskId: "" })}
                  className="rounded-full border border-sky-200 px-2 py-0.5 text-sky-700 transition hover:bg-sky-50"
                >
                  {t("costCenterCallsFilterClear")}
                </button>
              </div>
            ) : null}
            <p className="mt-3 text-xs leading-5 text-zinc-400">{t("costCenterCallsFilterNote")}</p>

            {callTotals ? (
              <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3">
                <p className="text-sm text-zinc-700">
                  {t("costCenterCallsMatched", {
                    attempts: numberFormat.format(callsData?.matched ?? 0),
                    retries: numberFormat.format(callTotals.retries),
                  })}
                </p>
                <p className="mt-1 text-sm text-zinc-700">
                  {t("costCenterCallsMatchedCost")}
                  {": "}
                  {matchedCurrencies.length === 0
                    ? t("costCenterCallsMatchedNoCost")
                    : matchedCurrencies.map((entry) => money(entry.currency, entry.amount)).join(" · ")}
                </p>
                {callsData?.scan.truncated ? (
                  <p className="mt-1 text-xs leading-5 text-amber-800">
                    {t("costCenterCallsScanNote", { limit: numberFormat.format(callsData.scan.limit) })}
                  </p>
                ) : null}
                {callsData?.scan.traceCapped ? (
                  <p className="mt-1 text-xs leading-5 text-amber-800">{t("costCenterCallsTraceCapNote")}</p>
                ) : null}
              </div>
            ) : null}
          </ConsoleCard>

          <ConsoleCard>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-zinc-900">{t("costCenterCallsTableCard")}</h2>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <button
                  type="button"
                  disabled={callOffset === 0}
                  onClick={() => setCallOffset(Math.max(0, callOffset - callPageSize))}
                  className="rounded-lg border border-sky-100 px-2 py-1 transition enabled:hover:bg-sky-50 disabled:opacity-40"
                >
                  {t("costCenterCallsPagePrev")}
                </button>
                <span>
                  {t("costCenterCallsPageRange", {
                    from: numberFormat.format(pageFrom),
                    to: numberFormat.format(pageTo),
                    total: numberFormat.format(callsData?.matched ?? 0),
                  })}
                </span>
                <button
                  type="button"
                  disabled={!callsData?.hasMore}
                  onClick={() => setCallOffset(callOffset + callPageSize)}
                  className="rounded-lg border border-sky-100 px-2 py-1 transition enabled:hover:bg-sky-50 disabled:opacity-40"
                >
                  {t("costCenterCallsPageNext")}
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-400">{t("costCenterCallsTableNote")}</p>
            {callsError ? <p className="mt-3 text-sm text-red-700">{t("costCenterLoadFailed")}</p> : null}
            {!callsData && !callsError ? <p className="mt-4 text-sm text-zinc-400">{t("loading")}</p> : null}
            {callsData && callViews.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-400">{t("costCenterCallsEmpty")}</p>
            ) : null}
            {callViews.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[1080px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-sky-100 text-xs uppercase tracking-wide text-zinc-400">
                      <th className="py-2 pr-3 font-medium">{t("costCenterCallsColTime")}</th>
                      <th className="py-2 pr-3 font-medium">{t("costCenterCallsColPurpose")}</th>
                      <th className="py-2 pr-3 font-medium">{t("costCenterCallsColModel")}</th>
                      <th className="py-2 pr-3 font-medium">{t("costCenterCallsColEndpoint")}</th>
                      <th className="py-2 pr-3 font-medium">{t("costCenterCallsColOutcome")}</th>
                      <th className="py-2 pr-3 font-medium">{t("costCenterCallsColAttempt")}</th>
                      <th className="py-2 pr-3 font-medium">{t("costCenterCallsColUsage")}</th>
                      <th className="py-2 pr-3 font-medium">{t("costCenterCallsColCompleteness")}</th>
                      <th className="py-2 pr-3 font-medium">{t("costCenterCallsFilterSource")}</th>
                      <th className="py-2 pr-3 font-medium">{t("costCenterColCost")}</th>
                      <th className="py-2 font-medium">{t("costCenterCallsColDetail")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callViews.map((view) => (
                      <Fragment key={view.entry.id}>
                        <tr className="border-b border-sky-50 align-top">
                          <td className="py-2 pr-3 whitespace-nowrap text-zinc-500">
                            {timeFormat.format(view.entry.createdAt)}
                          </td>
                          <td className="py-2 pr-3 text-zinc-700">
                            {view.entry.purpose || t("costCenterPurposeUnclassified")}
                          </td>
                          <td className="py-2 pr-3 text-zinc-700">
                            <span className="block">{view.entry.modelId || view.entry.providerId}</span>
                            <span className="block text-xs text-zinc-400">{view.entry.providerId}</span>
                          </td>
                          <td className="py-2 pr-3 text-xs text-zinc-500">
                            {view.entry.endpointId || t("costCenterCallsTraceNone")}
                          </td>
                          <td className="py-2 pr-3 text-zinc-700">{view.entry.outcome}</td>
                          <td className="py-2 pr-3 text-zinc-500">
                            {`#${view.group.index + 1}/${view.group.attempts}`}
                            <span className="mt-1 block text-xs text-zinc-400">{t(retryLabels[view.retry.kind])}</span>
                          </td>
                          <td className="py-2 pr-3 text-zinc-500">{usageText(view)}</td>
                          <td className="py-2 pr-3 text-zinc-500">{view.entry.completeness}</td>
                          <td className="py-2 pr-3 text-zinc-500">{t(costSourceLabels[view.entry.costSource])}</td>
                          <td className="py-2 pr-3 text-zinc-700">
                            {view.entry.costAmount === null
                              ? t("costCenterSourceNoAmount")
                              : money(view.entry.costCurrency, view.entry.costAmount)}
                          </td>
                          <td className="py-2">
                            <button
                              type="button"
                              onClick={() => setExpandedCall(expandedCall === view.entry.id ? null : view.entry.id)}
                              className="text-xs font-medium text-sky-700 transition hover:text-sky-900"
                            >
                              {expandedCall === view.entry.id ? t("costCenterCallsHide") : t("costCenterCallsShow")}
                            </button>
                          </td>
                        </tr>
                        {expandedCall === view.entry.id ? (
                          <tr className="border-b border-sky-50 bg-sky-50/30">
                            <td colSpan={11} className="px-3 py-4">
                              <div className="grid gap-5 lg:grid-cols-3">
                                <div className="space-y-2 text-xs leading-5 text-zinc-600">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                                    {t("costCenterCallsGroupTitle")}
                                  </p>
                                  <p>
                                    {t("costCenterCallsGroupLine", {
                                      attempts: numberFormat.format(view.group.attempts),
                                      failed: numberFormat.format(view.group.failedRequests),
                                      index: numberFormat.format(view.group.index + 1),
                                    })}
                                  </p>
                                  <p>
                                    {t("costCenterCallsGroupCost")}
                                    {": "}
                                    {view.group.costByCurrency.length === 0
                                      ? t("costCenterSourceNoAmount")
                                      : view.group.costByCurrency
                                          .map(
                                            (entry) =>
                                              `${view.group.costIsComplete ? "" : "≥ "}${money(entry.currency, entry.amount)}`,
                                          )
                                          .join(" · ")}
                                  </p>
                                  {view.group.costIsComplete ? null : (
                                    <p className="text-amber-800">{t("costCenterCallsGroupCostBound")}</p>
                                  )}
                                  <p>{t(retryLabels[view.retry.kind])}</p>
                                  <p>{retryChangedText(view)}</p>
                                  {view.retry.parent ? (
                                    <p className="font-mono text-[11px] text-zinc-500">
                                      {`${view.retry.parent.id} · #${view.retry.parent.attemptIndex + 1} · ${view.retry.parent.outcome}`}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="space-y-2 text-xs leading-5 text-zinc-600">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                                    {t("costCenterCallsPricingTitle")}
                                  </p>
                                  {view.entry.pricing ? (
                                    <>
                                      <p>{`${view.entry.pricing.meteredKind} · ${view.entry.pricing.currency}`}</p>
                                      {view.entry.pricing.unitPrice !== undefined ? (
                                        <p>
                                          {t("costCenterCallsPricingUnit", {
                                            unit: view.entry.pricing.unitLabel ?? "",
                                            price: amountFormat.format(view.entry.pricing.unitPrice),
                                          })}
                                        </p>
                                      ) : (
                                        <p>
                                          {t("costCenterCallsPricingToken", {
                                            input: amountFormat.format(view.entry.pricing.inputPerMillion),
                                            output: amountFormat.format(view.entry.pricing.outputPerMillion),
                                          })}
                                        </p>
                                      )}
                                      <p>
                                        {t("costCenterCallsPricingMeta", {
                                          version: view.entry.pricing.priceVersion || t("costCenterCallsTraceNone"),
                                          source: view.entry.pricing.source || t("costCenterCallsTraceNone"),
                                        })}
                                      </p>
                                    </>
                                  ) : (
                                    <p>{t("costCenterCallsPricingNone")}</p>
                                  )}
                                  <p>
                                    {t("costCenterCallsCredential")}
                                    {": "}
                                    <span className="font-mono">
                                      {view.entry.credentialLabel || t("costCenterCallsTraceNone")}
                                    </span>
                                  </p>
                                  <p>
                                    {t("costCenterCallsQuantity")}
                                    {": "}
                                    {Object.keys(view.quantity).length > 0
                                      ? usageText(view)
                                      : t("costCenterCallsQuantityNone")}
                                  </p>
                                  <p>
                                    {t("costCenterCallsDuration")}
                                    {": "}
                                    {view.entry.durationMs > 0
                                      ? `${numberFormat.format(view.entry.durationMs)} ms`
                                      : t("costCenterCallsDurationUnmeasured")}
                                  </p>
                                  <p>
                                    {t("costCenterCallsError")}
                                    {": "}
                                    {view.entry.errorSummary || t("costCenterCallsErrorNone")}
                                  </p>
                                </div>
                                <div className="space-y-2 text-xs leading-5 text-zinc-600">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                                    {t("costCenterCallsTraceTitle")}
                                  </p>
                                  <p>
                                    {t("costCenterCallsTraceContent")}
                                    {": "}
                                    {view.trace.content
                                      ? view.trace.content.found
                                        ? `${view.trace.content.title || view.trace.content.id} · ${view.trace.content.status}`
                                        : `${view.trace.contentItemId} · ${t("costCenterCallsTraceContentMissing")}`
                                      : t("costCenterCallsTraceContentNone")}
                                  </p>
                                  <p>
                                    {t("costCenterCallsTraceTask")}
                                    {": "}
                                    {view.trace.task
                                      ? `${view.trace.task.kind} · ${view.trace.task.type} · ${view.trace.task.status} (${view.trace.task.rawStatus})`
                                      : t("costCenterCallsTraceTaskNone")}
                                    {view.trace.taskRef
                                      ? ` · ${t("costCenterCallsTraceTaskRef", { field: view.trace.taskRef })}`
                                      : ""}
                                  </p>
                                  <p>
                                    {t("costCenterCallsTraceNode")}
                                    {": "}
                                    <span className="font-mono">{view.trace.nodeId || t("costCenterCallsTraceNone")}</span>
                                  </p>
                                  <p>
                                    {t("costCenterCallsTraceAsset")}
                                    {": "}
                                    <span className="font-mono">
                                      {view.trace.outputAssetId || t("costCenterCallsTraceNone")}
                                    </span>
                                  </p>
                                  <p className="font-mono text-[11px] text-zinc-400">{view.entry.id}</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="mt-4 text-xs leading-5 text-zinc-400">{t("costCenterCallsRawNote")}</p>
          </ConsoleCard>

          <ConsoleCard>
            <h2 className="text-base font-semibold text-zinc-900">{t("costCenterCallsByContentTitle")}</h2>
            <p className="mt-2 text-xs leading-5 text-zinc-400">{t("costCenterCallsByContentNote")}</p>
            {callsData && callByContent.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-400">{t("usageEmpty")}</p>
            ) : null}
            {callByContent.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-sky-100 text-xs uppercase tracking-wide text-zinc-400">
                      <th className="py-2 pr-4 font-medium">{t("costCenterCallsTraceContent")}</th>
                      <th className="py-2 pr-4 font-medium">{t("costCenterColAttempts")}</th>
                      <th className="py-2 pr-4 font-medium">{t("costCenterColTokens")}</th>
                      <th className="py-2 pr-4 font-medium">{t("costCenterColCost")}</th>
                      <th className="py-2 pr-4 font-medium">{t("costCenterCallsColPending")}</th>
                      <th className="py-2 pr-4 font-medium">{t("costCenterCallsColChain")}</th>
                      <th className="py-2 font-medium">{t("costCenterCallsByContentFilter")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callByContent.map((group) => (
                      <tr key={group.contentItemId || "unattributed"} className="border-b border-sky-50">
                        <td className="py-2 pr-4 text-zinc-700">
                          {group.contentItemId === "" ? (
                            t("costCenterCallsByContentUnattributed")
                          ) : group.content?.found ? (
                            group.content.title || group.content.id
                          ) : (
                            <span className="font-mono text-xs">{group.contentItemId}</span>
                          )}
                          {group.contentItemId && group.content && !group.content.found ? (
                            <span className="ml-2 text-xs text-amber-700">
                              {t("costCenterCallsTraceContentMissing")}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-4 text-zinc-500">{numberFormat.format(group.attempts)}</td>
                        <td className="py-2 pr-4 text-zinc-500">{numberFormat.format(group.totalTokens)}</td>
                        <td className="py-2 pr-4 text-zinc-700">
                          {group.costByCurrency.length === 0
                            ? t("costCenterSourceNoAmount")
                            : group.costByCurrency
                                .map(
                                  (entry) =>
                                    `${group.costIsComplete ? "" : "≥ "}${money(entry.currency, entry.amount)}`,
                                )
                                .join(" · ")}
                          {group.costIsComplete ? null : (
                            <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                              {t("costCenterHasUnpriced")}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-zinc-500">
                          {`${numberFormat.format(group.unpricedAttempts)} / ${numberFormat.format(group.unmeasuredAttempts)}`}
                        </td>
                        <td className="py-2 pr-4 text-xs text-zinc-500">
                          {group.taskIds.length === 0 ? (
                            t("costCenterCallsTraceNone")
                          ) : (
                            group.taskIds.map((id) => (
                              <span key={id} className="block font-mono">
                                {id}
                              </span>
                            ))
                          )}
                          {group.nodeIds.length > 0 ? (
                            <span className="mt-1 block text-zinc-400">{group.nodeIds.join(" · ")}</span>
                          ) : null}
                        </td>
                        <td className="py-2">
                          {group.contentItemId ? (
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedCall(null);
                                updateCallFilters({ contentItemId: group.contentItemId });
                              }}
                              className="text-xs font-medium text-sky-700 transition hover:text-sky-900"
                            >
                              {t("costCenterCallsByContentFilter")}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </ConsoleCard>
        </>
      ) : null}

      {tab === "overview" ? (
        <>
          <ConsoleCard>
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
              <div className="min-w-0">
                <p className="flex items-center gap-1 text-sm text-zinc-500">
                  {t("costCenterStatCost")}
                  <Info className="size-3.5 text-zinc-300" aria-label={t("costCenterStatCostNote")} />
                </p>
                {currencies.length === 0 ? (
                  <p className="mt-3 text-lg font-semibold text-zinc-400">{t("costCenterStatCostNone")}</p>
                ) : (
                  <ul className="mt-3 space-y-1">
                    {currencies.map((entry) => (
                      <li key={entry.currency} className="truncate text-2xl font-semibold text-zinc-950">
                        {money(entry.currency, entry.amount)}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs leading-5 text-zinc-400">{t("costCenterStatCostNote")}</p>
                <p className={`mt-2 text-xs leading-5 ${costIsComplete ? "text-emerald-700" : "text-amber-700"}`}>
                  {costIsComplete
                    ? t("costCenterCostComplete")
                    : t("costCenterCostPartial", {
                        unpriced: numberFormat.format(totals?.unpricedAttempts ?? 0),
                        unmeasured: numberFormat.format(totals?.unmeasuredAttempts ?? 0),
                      })}
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-sm text-zinc-500">{t("costCenterStatTokens")}</p>
                <p className="mt-3 truncate text-2xl font-semibold text-zinc-950">
                  {numberFormat.format(totals?.totalTokens ?? 0)}
                </p>
                <p className="mt-3 text-xs leading-5 text-zinc-400">
                  {t("costCenterStatTokensNote", {
                    input: numberFormat.format(totals?.inputTokens ?? 0),
                    output: numberFormat.format(totals?.outputTokens ?? 0),
                  })}
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-sm text-zinc-500">{t("costCenterStatDelivered")}</p>
                <p className="mt-3 truncate text-2xl font-semibold text-zinc-950">
                  {t("usageUnitArticles", { count: articles })}
                </p>
                <p className="mt-3 text-xs leading-5 text-zinc-400">{t("costCenterStatDeliveredNote")}</p>
              </div>

              <div className="min-w-0">
                <p className="flex items-center gap-1 text-sm text-zinc-500">
                  {t("costCenterStatAvgCost")}
                  <Info className="size-3.5 text-zinc-300" aria-label={t("costCenterStatAvgCostNote")} />
                </p>
                {costIsComplete && articles > 0 && currencies.length > 0 ? (
                  <ul className="mt-3 space-y-1">
                    {currencies.map((entry) => (
                      <li key={entry.currency} className="truncate text-2xl font-semibold text-zinc-950">
                        {money(entry.currency, entry.amount / articles)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-lg font-semibold text-zinc-400">{t("costCenterStatAvgCostNA")}</p>
                )}
                <p className="mt-3 text-xs leading-5 text-zinc-400">{t("costCenterStatAvgCostNote")}</p>
              </div>
            </div>
          </ConsoleCard>

          <ConsoleCard>
            <h2 className="text-base font-semibold text-zinc-900">{t("costCenterTrustCard")}</h2>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <div className="space-y-3">
                <p className="text-sm text-zinc-700">
                  {t("costCenterTrustAttempts", {
                    attempts: numberFormat.format(totals?.attempts ?? 0),
                    successes: numberFormat.format(totals?.successes ?? 0),
                    failures: numberFormat.format(totals?.failures ?? 0),
                    interrupted: numberFormat.format(totals?.interrupted ?? 0),
                  })}
                </p>
                <p className="text-xs leading-5 text-zinc-500">
                  {t("costCenterTrustRetries", { count: numberFormat.format(totals?.retries ?? 0) })}
                </p>
                <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3">
                  <p className="text-xs font-semibold text-amber-900">{t("costCenterBudgetCard")}</p>
                  <p className="mt-1 text-xs leading-5 text-amber-900/80">{t("costCenterBudgetUnset")}</p>
                  <p className="mt-1 text-xs leading-5 text-amber-900/70">{t("costCenterBudgetNote")}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {t("costCenterSourcesTitle")}
                </p>
                <ul className="mt-3 space-y-2">
                  {sources.map((entry) => (
                    <li key={entry.source} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-zinc-700">{t(costSourceLabels[entry.source])}</span>
                      <span className="text-zinc-500">
                        {t("costCenterSourceAttempts", { count: numberFormat.format(entry.attempts) })}
                        {" · "}
                        {entry.costAmount === null
                          ? t("costCenterSourceNoAmount")
                          : amountFormat.format(entry.costAmount)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs leading-5 text-zinc-400">{t("costCenterSourcesNote")}</p>
              </div>
            </div>
          </ConsoleCard>

          <ConsoleCard>
            <h2 className="text-base font-semibold text-zinc-900">{t("costCenterPurposeTable")}</h2>
            <p className="mt-2 text-xs leading-5 text-zinc-400">{t("costCenterPurposeNote")}</p>
            {purposes.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-400">{t("usageEmpty")}</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-sky-100 text-xs uppercase tracking-wide text-zinc-400">
                      <th className="py-2 pr-4 font-medium">{t("costCenterColPurpose")}</th>
                      <th className="py-2 pr-4 font-medium">{t("costCenterColAttempts")}</th>
                      <th className="py-2 pr-4 font-medium">{t("costCenterColTokens")}</th>
                      <th className="py-2 font-medium">{t("costCenterColCost")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purposes.map((row) => (
                      <tr key={row.key} className="border-b border-sky-50">
                        <td className="py-2 pr-4 text-zinc-700">
                          {row.label || t("costCenterPurposeUnclassified")}
                          {row.hasUnpricedAttempts ? (
                            <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                              {t("costCenterHasUnpriced")}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-4 text-zinc-500">{numberFormat.format(row.attempts)}</td>
                        <td className="py-2 pr-4 text-zinc-500">{numberFormat.format(row.totalTokens)}</td>
                        <td className="py-2">
                          <CostCell amount={row.costAmount} hasUnpriced={row.hasUnpricedAttempts} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ConsoleCard>

          <ConsoleCard>
            <h2 className="text-base font-semibold text-zinc-900">{t("costCenterTrendCard")}</h2>
            <p className="mt-2 text-xs leading-5 text-zinc-400">{t("costCenterTrendNote")}</p>
            {days.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-400">{t("costCenterTrendEmpty")}</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {days.map((day) => (
                  <li key={day.dayStart} className="flex items-center gap-3 text-sm">
                    <span className="w-14 shrink-0 text-xs text-zinc-500">{dayFormat.format(day.dayStart)}</span>
                    <div className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-sky-50">
                      <div
                        className="h-full rounded-full bg-sky-500"
                        style={{ width: `${maxDayCost > 0 ? (day.costAmount / maxDayCost) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right text-zinc-700">
                      {amountFormat.format(day.costAmount)}
                    </span>
                    <span className="w-24 shrink-0 text-right text-xs text-zinc-400">
                      {t("costCenterColTokens")} {numberFormat.format(day.totalTokens)}
                    </span>
                    {day.unpricedAttempts > 0 ? (
                      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                        {t("costCenterHasUnpriced")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </ConsoleCard>

          <ConsoleCard>
            <h2 className="text-base font-semibold text-zinc-900">{t("costCenterModelTable")}</h2>
            <p className="mt-2 text-xs leading-5 text-zinc-400">{t("costCenterModelNote")}</p>
            {models.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-400">{t("usageEmpty")}</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-sky-100 text-xs uppercase tracking-wide text-zinc-400">
                      <th className="py-2 pr-4 font-medium">{t("usageColModel")}</th>
                      <th className="py-2 pr-4 font-medium">{t("costCenterColAttempts")}</th>
                      <th className="py-2 pr-4 font-medium">{t("costCenterColTokens")}</th>
                      <th className="py-2 font-medium">{t("costCenterColCost")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((row) => (
                      <tr key={row.key} className="border-b border-sky-50">
                        <td className="py-2 pr-4 text-zinc-700">
                          <span className="block">{row.label}</span>
                          <span className="block text-xs text-zinc-400">{row.key.replace("::", " · ")}</span>
                        </td>
                        <td className="py-2 pr-4 text-zinc-500">{numberFormat.format(row.attempts)}</td>
                        <td className="py-2 pr-4 text-zinc-500">{numberFormat.format(row.totalTokens)}</td>
                        <td className="py-2">
                          <CostCell amount={row.costAmount} hasUnpriced={row.hasUnpricedAttempts} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ConsoleCard>

          <ConsoleCard>
            <h2 className="text-base font-semibold text-zinc-900">{t("costCenterCatalogCard")}</h2>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t("costCenterCatalogPriced")}
              </span>
              {pricedKinds.length === 0 ? (
                <span className="text-sm text-zinc-400">{t("costCenterCatalogNone")}</span>
              ) : (
                pricedKinds.map((kind) => (
                  <span key={kind} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                    {kind}
                  </span>
                ))
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t("costCenterCatalogUnpriced")}
              </span>
              {unpricedKinds.length === 0 ? (
                <span className="text-sm text-zinc-400">{t("costCenterCatalogNone")}</span>
              ) : (
                unpricedKinds.map((kind) => (
                  <span key={kind} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700">
                    {kind}
                  </span>
                ))
              )}
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-400">{t("costCenterCatalogNote")}</p>
          </ConsoleCard>

          <ConsoleCard>
            <h2 className="text-base font-semibold text-zinc-900">{t("navUsage")}</h2>
            <p className="mt-2 text-xs leading-5 text-zinc-400">{t("costCenterLegacyNote")}</p>
            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              {legacyStats.map((stat) => (
                <div key={stat.key} className="min-w-0">
                  <p className="text-sm text-zinc-500">{stat.label}</p>
                  <p className="mt-3 truncate text-2xl font-semibold text-zinc-950">{stat.value}</p>
                </div>
              ))}
            </div>
            <p className="mt-5 border-t border-sky-50 pt-4 text-xs leading-5 text-zinc-400">{t("usageCardNote")}</p>

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
                        onClick={() => setSortDesc((previous) => !previous)}
                        className="ml-auto flex items-center gap-1 text-sky-700 transition hover:text-sky-900"
                        title={t("usageTableNote")}
                      >
                        {t("usageColTotalTokens")}
                        {sortDesc ? (
                          <ArrowDown className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowUp className="size-3.5" aria-hidden />
                        )}
                      </button>
                    </th>
                    <th className="px-3 py-3 text-right">{t("usageColAvgWords")}</th>
                    <th className="px-3 py-3 text-right">{t("usageColAvgTokens")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sky-50">
                  {legacyModels.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-12 text-center text-sm text-zinc-400">
                        {t("usageEmpty")}
                      </td>
                    </tr>
                  ) : (
                    legacyModels.map((model) => (
                      <tr key={`${model.provider}-${model.model}`} className="text-zinc-700">
                        <td className="px-3 py-3">
                          <p className="font-semibold text-zinc-900">{model.model}</p>
                          <p className="mt-0.5 text-xs text-zinc-400">{model.provider}</p>
                        </td>
                        <td className="px-3 py-3 text-right">{numberFormat.format(model.articles)}</td>
                        <td className="px-3 py-3 text-right">{numberFormat.format(model.inputTokens)}</td>
                        <td className="px-3 py-3 text-right">{numberFormat.format(model.outputTokens)}</td>
                        <td className="bg-sky-50/50 px-3 py-3 text-right font-medium text-zinc-900">
                          {numberFormat.format(model.totalTokens)}
                        </td>
                        <td className="px-3 py-3 text-right">{numberFormat.format(model.avgWords)}</td>
                        <td className="px-3 py-3 text-right">{numberFormat.format(model.avgTokens)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs leading-5 text-zinc-400">{t("usageTableNote")}</p>
          </ConsoleCard>
        </>
      ) : null}
    </div>
  );
}
