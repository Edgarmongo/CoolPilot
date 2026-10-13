"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ExternalLink, Lightbulb, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsoleCard, ConsoleNotice, ConsoleSectionHeader } from "@/components/ui/console-surface";
import type { AiBudgetStrategy, AiBudgetStrategyLines } from "@/lib/ai-budget";
import { ApiClientError, apiErrorTranslationKey, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n-config";
import type { TranslationKey } from "@/lib/locale-resources";
import type { AiQualityPayload, QualitySuggestion } from "@/lib/quality-cost";
import type { UsageRangeDays } from "@/lib/types";

/**
 * 质量与优化 (CI-P7-04): what the window measured, what one qualified output cost, and which
 * suggestions the figures support - with the one write that changes anything.
 *
 * The page renders the four positions its server sends, and adds nothing to them:
 *
 *  - a figure nobody could state is `null` and reads 无法计量, never `0` - a window with no adopted
 *    output has no unit cost, and a pass rate over no call is not 100%;
 *  - 人工修改幅度 is printed as what the workspace actually recorded (how many platform renditions a
 *    human rewrote) plus the explicit fact that a character-level magnitude is not stored anywhere;
 *  - every suggestion is drawn with the basis the server attached to *that* suggestion, so a rule's
 *    title can never appear beside another rule's numbers, and a suggestion with no settings to change
 *    says so instead of offering a button that would do nothing;
 *  - the only button that writes anything sends a **suggestion id**, and the tier it means is decided
 *    on the server when the click arrives - so a premise that stopped holding is refused (`409`) rather
 *    than applied on a stale reading, which is the failure this page has to show honestly.
 *
 * What it does not do: it never calls a successful request "quality", never turns 采用率 into a quality
 * verdict, and never claims a saving. The only effect it describes is the tier's own stop lines, printed
 * from the server's `strategyLines` beside the one button that writes that tier.
 */

const qualityUrl = (range: UsageRangeDays) => `/api/ai-cost-center/quality?range=${range}`;

/** The tiers' own names, from the budget tab's vocabulary, so one tier has one name in the product. */
const strategyLabelKeys: Record<AiBudgetStrategy, TranslationKey> = {
  "cost-saving": "budgetStrategyCostSaving",
  balanced: "budgetStrategyBalanced",
  "quality-first": "budgetStrategyQualityFirst",
};

/** Everything the copy for one suggestion needs: the dictionary and the locale's own formatters. */
interface SuggestionCopyInput {
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  amount: (value: number) => string;
  percent: (value: number) => string;
  number: (value: number) => string;
  strategyName: (strategy: AiBudgetStrategy) => string;
}

/**
 * One suggestion's four sentences, in the basis it came with.
 *
 * A `switch`: the union is what makes this readable - inside a case, `suggestion.basis` is narrowed to
 * that rule's own fields, so a title cannot be printed with another rule's numbers.
 */
function suggestionCopy(
  suggestion: QualitySuggestion,
  input: SuggestionCopyInput,
): { title: string; basis: string; effect: string; risk: string } {
  const { t, amount, percent, number } = input;
  switch (suggestion.id) {
    case "switch-to-cost-saving": {
      const { currency, spentAmount, limitAmount, spentShare, strategy } = suggestion.basis;
      return {
        title: t("qualitySuggestionCostSavingTitle"),
        basis: t("qualitySuggestionCostSavingBasis", {
          spent: `${currency} ${amount(spentAmount)}`,
          limit: `${currency} ${amount(limitAmount)}`,
          share: percent(spentShare),
          strategy: input.strategyName(strategy),
        }),
        effect: t("qualitySuggestionCostSavingEffect"),
        risk: t("qualitySuggestionCostSavingRisk"),
      };
    }
    case "record-prices": {
      const { requests, unpricedRequests } = suggestion.basis;
      return {
        title: t("qualitySuggestionRecordPricesTitle"),
        basis: t("qualitySuggestionRecordPricesBasis", {
          unpriced: number(unpricedRequests),
          requests: number(requests),
        }),
        effect: t("qualitySuggestionRecordPricesEffect"),
        risk: t("qualitySuggestionRecordPricesRisk"),
      };
    }
    case "enable-budget": {
      const { currency, windowAmount, requests } = suggestion.basis;
      return {
        title: t("qualitySuggestionEnableBudgetTitle"),
        basis: t("qualitySuggestionEnableBudgetBasis", {
          amount: `${currency} ${amount(windowAmount)}`,
          requests: number(requests),
        }),
        effect: t("qualitySuggestionEnableBudgetEffect"),
        risk: t("qualitySuggestionEnableBudgetRisk"),
      };
    }
    case "investigate-failed-calls": {
      const { calls, requests, retries, failedCalls, singleRequestSuccessRate } = suggestion.basis;
      return {
        title: t("qualitySuggestionFailedCallsTitle"),
        basis: t("qualitySuggestionFailedCallsBasis", {
          calls: number(calls),
          requests: number(requests),
          retries: number(retries),
          failed: number(failedCalls),
          pass: singleRequestSuccessRate === null ? t("qualityNotMeasured") : percent(singleRequestSuccessRate),
        }),
        effect: t("qualitySuggestionFailedCallsEffect"),
        risk: t("qualitySuggestionFailedCallsRisk"),
      };
    }
    case "review-adoption": {
      const { created, adopted, adoptionRate } = suggestion.basis;
      return {
        title: t("qualitySuggestionAdoptionTitle"),
        basis: t("qualitySuggestionAdoptionBasis", {
          created: number(created),
          adopted: number(adopted),
          rate: percent(adoptionRate),
        }),
        effect: t("qualitySuggestionAdoptionEffect"),
        risk: t("qualitySuggestionAdoptionRisk"),
      };
    }
  }
}

export default function QualityPanel({
  range,
  onOpenTab,
}: {
  range: UsageRangeDays;
  /** Switches the cost center to another tab in place, instead of reloading the page for `?tab=`. */
  onOpenTab: (tab: "budget") => void;
}) {
  const { t, locale } = useI18n();
  const { data, error, mutate } = useSWR<AiQualityPayload>(qualityUrl(range), swrFetcher, {
    revalidateOnFocus: false,
  });
  const [applying, setApplying] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  // Money keeps the ledger's 6 decimals: on this page a fraction of a cent is often the whole figure.
  const amountFormat = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }), [locale]);
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const percentFormat = useMemo(
    () => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }),
    [locale],
  );
  const dayFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);

  const copyInput = useMemo<SuggestionCopyInput>(
    () => ({
      t,
      amount: (value) => amountFormat.format(value),
      percent: (value) => percentFormat.format(value),
      number: (value) => numberFormat.format(value),
      strategyName: (strategy) => t(strategyLabelKeys[strategy]),
    }),
    [t, amountFormat, numberFormat, percentFormat],
  );

  /** A share the server could not state reads 无法计量 - not 0%, which would be a measurement. */
  const share = (value: number | null) =>
    value === null ? t("qualityNotMeasured") : percentFormat.format(value);
  /** The count behind a rate travels with it, so a percentage is never the only evidence. */
  const rateOf = (part: number, whole: number) =>
    t("qualityRateBasis", { part: numberFormat.format(part), whole: numberFormat.format(whole) });
  const money = (currency: string, value: number) => `${currency || t("costCenterCurrencyUnstated")} ${amountFormat.format(value)}`;

  /**
   * What the tier in force actually does, read from the table the server sent rather than from this page's
   * own copy of the rules - the same reading the budget tab prints, from the same payload field. It is
   * drawn here because this tier is the one thing the button on this page writes; a tier whose line this
   * page had never heard of is still described correctly, and a tier with no shares says so rather than
   * being turned into "no limit".
   */
  function strategyLineText(lines: AiBudgetStrategyLines) {
    const lineShare = (value: number | null) =>
      value === null ? t("budgetStrategyNoShare") : percentFormat.format(value);
    if (lines.callShare === null && lines.stepShare === null) {
      return lines.stepStopsAtZero ? t("budgetStrategyLineNone") : t("budgetStrategyStepStopDeclined");
    }
    return t("budgetStrategyLineShares", { call: lineShare(lines.callShare), step: lineShare(lines.stepShare) });
  }

  /**
   * Ask the server to apply one suggestion.
   *
   * The body is a suggestion *id*: which tier that means is the server's decision, remade now. The
   * answer is the window measured after the write, so the page replaces its data with it rather than
   * guessing what changed - and a `409` (the premise stopped holding between the read and the click)
   * is shown as itself, because that is the honest failure of this loop.
   */
  async function applySuggestion(suggestionId: string) {
    setApplying(suggestionId);
    setNotice(null);
    try {
      const answer = await apiPost<AiQualityPayload>(qualityUrl(range), { suggestionId });
      await mutate(answer, { revalidate: false });
      if (answer.applied) {
        setNotice({
          tone: "success",
          message: t("qualitySuggestionApplied", {
            from: t(strategyLabelKeys[answer.applied.from]),
            to: t(strategyLabelKeys[answer.applied.to]),
          }),
        });
      }
    } catch (caught) {
      const details = caught instanceof ApiClientError ? (caught.details as { reason?: string } | undefined) : undefined;
      setNotice({
        tone: "error",
        message:
          details?.reason === "suggestion-not-applicable"
            ? t("qualitySuggestionNotApplicable")
            : t(apiErrorTranslationKey(caught, "qualitySuggestionApplyFailed")),
      });
    } finally {
      setApplying(null);
    }
  }

  if (error) {
    return (
      <ConsoleCard>
        <p className="text-sm text-red-700">{t("qualityLoadFailed")}</p>
      </ConsoleCard>
    );
  }

  if (!data) {
    return (
      <ConsoleCard>
        <p className="text-sm text-zinc-500">{t("qualityLoading")}</p>
      </ConsoleCard>
    );
  }

  const { calls, content, humanEdits, objective, suggestions, budget, applied } = data;

  return (
    <div className="space-y-6">
      <ConsoleCard>
        <ConsoleSectionHeader icon={<Sparkles className="size-5" aria-hidden />} title={t("qualityMetricsTitle")} />
        <p className="mt-3 text-sm leading-6 text-zinc-600">{t("qualityIntro")}</p>
        <p className="mt-2 text-xs leading-5 text-zinc-400">
          {t("qualityWindow", {
            days: range,
            from: dayFormat.format(new Date(data.from)),
            to: dayFormat.format(new Date(data.to)),
          })}
        </p>

        {notice ? (
          <div className="mt-3">
            <ConsoleNotice message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />
          </div>
        ) : null}
        {data.truncated ? (
          <p className="mt-3 text-xs leading-5 text-amber-700">{t("qualityTruncated")}</p>
        ) : null}

        {/* Nine readings, each labelled with what it measured rather than what it implies. `value` is
            无法计量 wherever the server had no denominator, and `note` always carries the count. */}
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Stat
            label={t("qualityMetricCalls")}
            value={numberFormat.format(calls.calls)}
            note={t("qualityMetricCallsNote", {
              requests: numberFormat.format(calls.requests),
              perCall: calls.requestsPerCall === null ? t("qualityNotMeasured") : amountFormat.format(calls.requestsPerCall),
            })}
          />
          <Stat
            label={t("qualityMetricFirstPass")}
            value={share(calls.singleRequestSuccessRate)}
            note={t("qualityMetricFirstPassNote", { basis: rateOf(calls.singleRequestSuccesses, calls.calls) })}
          />
          <Stat
            label={t("qualityMetricFirstRequest")}
            value={share(calls.firstRequestSuccessRate)}
            note={t("qualityMetricFirstRequestNote", { basis: rateOf(calls.firstRequestSuccesses, calls.calls) })}
          />
          <Stat
            label={t("qualityMetricRetries")}
            value={numberFormat.format(calls.retries)}
            note={t("qualityMetricRetriesNote", {
              share: share(calls.retryShare),
              requests: numberFormat.format(calls.requests),
            })}
          />
          <Stat
            label={t("qualityMetricFailedCalls")}
            value={numberFormat.format(calls.failedCalls)}
            note={t("qualityMetricFailedCallsNote")}
          />
          <Stat
            label={t("qualityMetricUnresolved")}
            value={numberFormat.format(calls.unresolvedPredecessorRequests)}
            note={t("qualityMetricUnresolvedNote")}
          />
          <Stat
            label={t("qualityMetricAdoption")}
            value={share(content.adoptionRate)}
            note={t("qualityMetricAdoptionNote", { basis: rateOf(content.adopted, content.created) })}
          />
          <Stat
            label={t("qualityMetricHumanEdits")}
            value={share(humanEdits.editRate)}
            note={t("qualityMetricHumanEditsNote", {
              basis: rateOf(humanEdits.editedVersions, humanEdits.versions),
              derived: numberFormat.format(humanEdits.derivedVersions),
            })}
          />
          <Stat
            label={t("qualityMetricEditMagnitude")}
            value={t("qualityNotMeasured")}
            note={t("qualityMetricEditMagnitudeNote")}
          />
        </dl>

        <p className="mt-4 text-xs leading-5 text-zinc-500">{t("qualityMetricsSource")}</p>
        <p className="mt-2 text-xs leading-5 text-zinc-500">{t("qualityMetricsNoQualityClaim")}</p>
        {humanEdits.truncated ? (
          <p className="mt-2 text-xs leading-5 text-amber-700">{t("qualityHumanEditsTruncated")}</p>
        ) : null}
        {humanEdits.unreadableVersions > 0 ? (
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            {t("qualityHumanEditsUnreadable", { count: numberFormat.format(humanEdits.unreadableVersions) })}
          </p>
        ) : null}
      </ConsoleCard>

      <ConsoleCard>
        <ConsoleSectionHeader icon={<Wand2 className="size-5" aria-hidden />} title={t("qualityObjectiveTitle")} />
        <p className="mt-3 text-sm leading-6 text-zinc-600">{t("qualityObjectiveIntro")}</p>

        {objective.byCurrency.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">{t("qualityObjectiveNone")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="pb-2 pr-4 font-medium">{t("qualityObjectiveCurrency")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("qualityObjectiveOutputs")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("qualityObjectiveAttributed")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("qualityObjectiveWindow")}</th>
                  <th className="pb-2 font-medium">{t("qualityObjectivePerOutput")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {objective.byCurrency.map((row) => (
                  <tr key={row.currency || "unstated"}>
                    <td className="py-2 pr-4 font-medium text-zinc-800">
                      {row.currency || t("costCenterCurrencyUnstated")}
                    </td>
                    <td className="py-2 pr-4 text-zinc-600">{numberFormat.format(objective.adoptedOutputs)}</td>
                    <td className="py-2 pr-4 text-zinc-600">{money(row.currency, row.attributedAmount)}</td>
                    <td className="py-2 pr-4 text-zinc-600">{money(row.currency, row.windowAmount)}</td>
                    {/* A partial figure is a floor (`≥`) and says so; no output to divide by is 无法计量,
                        because a unit cost of 0 would read as "this was free". */}
                    <td className="py-2 text-zinc-900">
                      {row.costPerOutput === null
                        ? t("qualityNotMeasured")
                        : objective.costIsComplete
                          ? money(row.currency, row.costPerOutput)
                          : t("qualityObjectiveFloor", { amount: money(row.currency, row.costPerOutput) })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs leading-5 text-zinc-500">
          {objective.tokensPerOutput === null
            ? t("qualityObjectiveTokensNone")
            : t("qualityObjectiveTokens", { tokens: numberFormat.format(Math.round(objective.tokensPerOutput)) })}
        </p>
        <p className="mt-2 text-xs leading-5 text-zinc-500">{t("qualityObjectiveAttributionNote")}</p>
        {objective.unattributedByCurrency.length > 0 ? (
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            {t("qualityObjectiveUnattributed", {
              amounts: objective.unattributedByCurrency
                .map((row) => money(row.currency, row.amount))
                .join(" · "),
            })}
          </p>
        ) : null}
        {objective.attributionPartial ? (
          <p className="mt-2 text-xs leading-5 text-amber-700">
            {t("qualityObjectiveAttributionPartial", {
              adopted: numberFormat.format(objective.adoptedOutputs),
              attributed: numberFormat.format(objective.attributedOutputs),
            })}
          </p>
        ) : null}
        {!objective.costIsComplete ? (
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            {t("qualityObjectiveIncomplete", {
              unpriced: numberFormat.format(objective.unpricedRequests),
              unmeasured: numberFormat.format(objective.unmeasuredRequests),
            })}
          </p>
        ) : null}
      </ConsoleCard>

      <ConsoleCard>
        <ConsoleSectionHeader icon={<Lightbulb className="size-5" aria-hidden />} title={t("qualitySuggestionsTitle")} />
        <p className="mt-3 text-sm leading-6 text-zinc-600">{t("qualitySuggestionsIntro")}</p>
        {/* The tier the button below writes, read from the server's own table - and the note says when it
            cannot act at all, instead of describing a stop that could not happen under these settings. */}
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          <span className="font-medium text-zinc-700">{t("budgetStatusStrategy")}</span>{" "}
          {t(strategyLabelKeys[budget.settings.strategy])} -{" "}
          {budget.settings.policy === "block" && budget.settings.monthlyLimit !== null
            ? strategyLineText(budget.strategyLines[budget.settings.strategy])
            : t("budgetStatusStrategyInactive")}
        </p>
        {applied ? (
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            {t("qualitySuggestionAppliedNote", { time: dayFormat.format(new Date(applied.at)) })}
          </p>
        ) : null}

        {suggestions.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">{t("qualitySuggestionsNone")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {suggestions.map((suggestion) => {
              const copy = suggestionCopy(suggestion, copyInput);
              return (
                <li key={suggestion.id} className="rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-zinc-900">{copy.title}</p>
                    {/* The action is the suggestion's own: a tier to apply, a page that holds the missing
                        input, or the plain statement that this one has no setting behind it. */}
                    {suggestion.action.kind === "strategy" ? (
                      <Button
                        variant="secondary"
                        loading={applying === suggestion.id}
                        onClick={() => void applySuggestion(suggestion.id)}
                      >
                        <Wand2 className="size-4" aria-hidden />
                        {t("qualitySuggestionApply")}
                      </Button>
                    ) : suggestion.action.kind === "link" && suggestion.action.target === "price-catalog" ? (
                      <Link
                        href={`${localizedPath(locale, "/system/models")}?tab=prices`}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:underline"
                      >
                        <ExternalLink className="size-4" aria-hidden />
                        {t("qualitySuggestionOpenPriceCatalog")}
                      </Link>
                    ) : suggestion.action.kind === "link" ? (
                      <button
                        type="button"
                        onClick={() => onOpenTab("budget")}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:underline"
                      >
                        <ExternalLink className="size-4" aria-hidden />
                        {t("qualitySuggestionOpenBudgetTab")}
                      </button>
                    ) : (
                      <span className="text-xs text-zinc-500">{t("qualitySuggestionNoKnob")}</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-zinc-600">
                    <span className="font-medium text-zinc-700">{t("qualitySuggestionBasisLabel")}</span> {copy.basis}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-600">
                    <span className="font-medium text-zinc-700">{t("qualitySuggestionEffectLabel")}</span> {copy.effect}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-700">
                    <span className="font-medium">{t("qualitySuggestionRiskLabel")}</span> {copy.risk}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </ConsoleCard>
    </div>
  );
}

/** One labelled figure. `note` carries what the figure cannot say by itself (a floor, or a count). */
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-zinc-900">{value}</dd>
      {note ? <dd className="mt-1 text-xs leading-5 text-zinc-500">{note}</dd> : null}
    </div>
  );
}


