"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Gauge, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ConsoleCard,
  ConsoleNotice,
  ConsoleSectionHeader,
  consoleInputClass,
} from "@/components/ui/console-surface";
import { SelectField } from "@/components/ui/form-controls";
import { apiErrorTranslationKey, apiPost, apiPut, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import {
  aiPriceCurrencies,
  aiUsageKindIsTokenMetered,
  aiUsageMeteredKinds,
  type AiPriceCurrency,
} from "@/lib/types";
import { usageKindLabelKeys } from "@/lib/ai-usage-labels";
import type {
  AiBudgetDecision,
  AiBudgetDecisionReason,
  AiBudgetPolicy,
  AiBudgetSettings,
  AiBudgetSpend,
  AiBudgetStrategy,
  AiBudgetStrategyLines,
  AiBudgetUnknownCostPolicy,
} from "@/lib/ai-budget";
import { EstimateSummary } from "./estimate-summary";
import {
  budgetDecisionLabelKeys,
  budgetDecisionToneClass,
  estimateRequestFor,
  type EstimateFormMeasurement,
  type EstimatePreviewAnswer,
} from "./estimate-view";

/**
 * 预算与预估 (CI-P7-03): what the month has cost, what the ceiling is, and what one call would do to
 * it - asked of the server, which is the side that actually decides.
 *
 * Four things this screen refuses to do, all of them for the same reason (a guess must not look like
 * a bill):
 *
 *  - it never draws a placeholder figure, and it never writes `0` where nothing was stated: a month
 *    with unpriced rows shows the amount as a **floor** (`≥`) and says which rows are missing;
 *  - it prints the enforcement vocabulary it was handed (`in-process-soft`) instead of paraphrasing
 *    it into "hard limit": a check inside this process is not a cross-process cap;
 *  - it asks `/api/ai-cost-center/estimate` rather than estimating in the page, so a preview cannot
 *    disagree with the gate that would refuse the call - and that endpoint is read-only, so asking
 *    twenty times costs nothing;
 *  - it keeps the period's own window (a natural calendar month) visible, because the 用量统计 window
 *    above is a rolling range and the two numbers are meant to differ;
 *  - it prints the tier the server says is in force, and what that tier does at each boundary, taken from
 *    the server's own table (CI-P7-03-C1) - so a call that a tier's own line stopped is never shown as one
 *    that crossed the limit, and a tier that is not in force is shown as changing no verdict.
 */

const budgetUrl = "/api/ai-cost-center/budget";
const estimateUrl = "/api/ai-cost-center/estimate";

type BudgetPayload = {
  settings: AiBudgetSettings;
  /** The semantics of the gate, as the server names them. Never re-worded here. */
  enforcement: string;
  period: { key: string; start: number; end: number };
  spent: AiBudgetSpend;
  reserved: number;
  inFlightCount: number;
  remaining: number | null;
  policies: AiBudgetPolicy[];
  unknownCostPolicies: AiBudgetUnknownCostPolicy[];
  /** CI-P7-03-C1: the tiers the server implements, and what each one does at each boundary. */
  strategies: AiBudgetStrategy[];
  strategyLines: Record<AiBudgetStrategy, AiBudgetStrategyLines>;
};

/**
 * The boxes this page's preview is driven from: all strings, because that is what a controlled input
 * holds - `""` is the user's way of saying "not stated", and `estimateRequestFor` turns that into the
 * omitted field (never a 0) the endpoint's schema accepts.
 */
type EstimateForm = Required<EstimateFormMeasurement>;

type BudgetForm = {
  policy: AiBudgetPolicy;
  /** A string, because "" is the user's way of saying "no limit stated" - which is not `0`. */
  monthlyLimit: string;
  currency: AiPriceCurrency;
  unknownCostPolicy: AiBudgetUnknownCostPolicy;
  strategy: AiBudgetStrategy;
};

/**
 * Mirrors `defaultAiBudgetSettings`; the server's answer overwrites it as soon as it arrives. The tier
 * starts at `balanced` - the behaviour this install was running before tiers existed - so the form never
 * shows a stop the user did not choose while the real answer is still in flight.
 */
const emptyBudgetForm: BudgetForm = {
  policy: "off",
  monthlyLimit: "",
  currency: "CNY",
  unknownCostPolicy: "allow",
  strategy: "balanced",
};

function formOf(settings: AiBudgetSettings): BudgetForm {
  return {
    policy: settings.policy,
    monthlyLimit: settings.monthlyLimit === null ? "" : String(settings.monthlyLimit),
    currency: settings.currency,
    unknownCostPolicy: settings.unknownCostPolicy,
    strategy: settings.strategy,
  };
}

const policyLabelKeys: Record<AiBudgetPolicy, TranslationKey> = {
  off: "budgetPolicyOff",
  warn: "budgetPolicyWarn",
  block: "budgetPolicyBlock",
};

const unknownCostLabelKeys: Record<AiBudgetUnknownCostPolicy, TranslationKey> = {
  allow: "budgetUnknownCostAllow",
  block: "budgetUnknownCostBlock",
};

const strategyLabelKeys: Record<AiBudgetStrategy, TranslationKey> = {
  "cost-saving": "budgetStrategyCostSaving",
  balanced: "budgetStrategyBalanced",
  "quality-first": "budgetStrategyQualityFirst",
};

const certaintyLabelKeys: Record<AiBudgetDecision["certainty"], TranslationKey> = {
  definite: "budgetDecisionDefinite",
  possible: "budgetDecisionPossible",
  "not-applicable": "budgetDecisionNotApplicable",
  // CI-P7-03-C1: a refusal the tier's own line made, below the limit - never worded as a crossed limit.
  "strategy-line": "budgetDecisionStrategyLine",
};

const reasonLabelKeys: Record<AiBudgetDecisionReason, TranslationKey> = {
  "budget-off": "budgetReasonOff",
  "no-limit": "budgetReasonNoLimit",
  "within-limit": "budgetReasonWithinLimit",
  "near-limit": "budgetReasonNearLimit",
  "over-limit": "budgetReasonOverLimit",
  "over-limit-warning": "budgetReasonOverLimitWarning",
  "unknown-cost-not-counted": "budgetReasonUnknownCostNotCounted",
  "unknown-cost-refused": "budgetReasonUnknownCostRefused",
  "spend-incomplete": "budgetReasonSpendIncomplete",
  "currency-not-compared": "budgetReasonCurrencyNotCompared",
  "hold-lost-to-concurrent-call": "budgetReasonHoldLost",
  // CI-P7-03-C1: each tier's own stop is reported under its own words, so a strategy line is never read
  // as an exhausted budget and a step that started at zero headroom says why.
  "cost-saving-call-line": "budgetReasonCostSavingCallLine",
  "cost-saving-remaining-line": "budgetReasonCostSavingRemainingLine",
  "step-line-declined-by-strategy": "budgetReasonStepLineDeclined",
};

export default function BudgetPanel() {
  const { t, locale } = useI18n();
  const { data, error, mutate } = useSWR<BudgetPayload>(budgetUrl, swrFetcher, { revalidateOnFocus: false });

  const [form, setForm] = useState<BudgetForm>(emptyBudgetForm);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  const [estimateForm, setEstimateForm] = useState<EstimateForm>({
    providerId: "",
    modelId: "",
    // `text` is what this install mostly spends on, and the dimension decides which row of the catalog
    // the preview is priced from - not a different rate for the same row.
    meteredKind: "text",
    inputText: "",
    maxOutputTokens: "",
    quantity: "",
  });
  const [estimating, setEstimating] = useState(false);
  const [preview, setPreview] = useState<EstimatePreviewAnswer | null>(null);
  const [previewError, setPreviewError] = useState("");

  /**
   * The saved settings are the source of truth, so every arrival of a fresh answer - the first read and
   * the one after a save - puts the form back on what is actually stored. Nothing is written on mount:
   * opening this page must not change a setting.
   */
  useEffect(() => {
    if (!data) return;
    const next = formOf(data.settings);
    // Deferred like `ResearchFormDialog` does, so the seed is a task of its own rather than a second
    // render set off from inside the effect.
    window.queueMicrotask(() => setForm(next));
  }, [data]);

  const amountFormat = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }), [locale]);
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const dayFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);
  // The shares the tier table states, as percentages - formatted by the locale, and not re-derived here.
  const percentFormat = useMemo(() => new Intl.NumberFormat(locale, { style: "percent" }), [locale]);
  // The dimension in hand decides which boxes this preview is driven from - and, on the server side,
  // which rate it is compared against.
  const estimateTokenMetered = aiUsageKindIsTokenMetered(estimateForm.meteredKind);

  /**
   * What the tier in hand actually does, read from the table the server sent rather than from this page's
   * own copy of the rules: a tier whose line this page had never heard of is still described correctly.
   * A tier with no shares is described as adding no line, and the one that declines the step's
   * zero-headroom stop says so - nothing here turns "no line of its own" into "no limit".
   */
  function strategyLineText(lines: AiBudgetStrategyLines) {
    const share = (value: number | null) =>
      value === null ? t("budgetStrategyNoShare") : percentFormat.format(value);
    if (lines.callShare === null && lines.stepShare === null) {
      return lines.stepStopsAtZero ? t("budgetStrategyLineNone") : t("budgetStrategyStepStopDeclined");
    }
    return t("budgetStrategyLineShares", { call: share(lines.callShare), step: share(lines.stepShare) });
  }

  function update<Key extends keyof BudgetForm>(key: Key, value: BudgetForm[Key]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    const rawLimit = form.monthlyLimit.trim();
    // An empty box is "no ceiling stated" and travels as null. It is never turned into 0, which would
    // read as "spend nothing" - a decision the user did not make.
    const monthlyLimit = rawLimit === "" ? null : Number(rawLimit);
    if (monthlyLimit !== null && !Number.isFinite(monthlyLimit)) {
      setSaving(false);
      setNotice({ tone: "error", message: t("budgetLimitInvalid") });
      return;
    }
    try {
      await apiPut(budgetUrl, {
        policy: form.policy,
        monthlyLimit,
        currency: form.currency,
        unknownCostPolicy: form.unknownCostPolicy,
        // The tier is saved with the rest: only `block` with a stated limit will let it act, and the server
        // is the side that decides that - this page does not try to pre-empt it.
        strategy: form.strategy,
      });
      setNotice({ tone: "success", message: t("budgetSaved") });
      await mutate();
    } catch (error) {
      setNotice({ tone: "error", message: t(apiErrorTranslationKey(error, "budgetSaveFailed")) });
    } finally {
      setSaving(false);
    }
  }

  async function estimate() {
    setEstimating(true);
    setPreviewError("");
    // The dimension picks the half of the request that travels: a per-image estimate sends how many
    // images the call will consume and no text at all, so the server is never handed a token count to
    // multiply a per-image rate by.
    const request = estimateRequestFor(estimateForm);
    // A half-typed figure is refused here, in this page's own words. Sent as `NaN` the schema would
    // answer 400 with a field name the user never saw on screen.
    const malformed =
      (request.quantity !== null && !Number.isFinite(request.quantity)) ||
      (request.maxOutputTokens !== null && !Number.isFinite(request.maxOutputTokens));
    if (malformed) {
      setEstimating(false);
      setPreviewError(t("budgetEstimateNumberInvalid"));
      return;
    }
    try {
      const answer = await apiPost<EstimatePreviewAnswer>(estimateUrl, request);
      setPreview(answer);
    } catch (error) {
      setPreview(null);
      setPreviewError(t(apiErrorTranslationKey(error, "budgetEstimateFailed")));
    } finally {
      setEstimating(false);
    }
  }

  return (
    <div className="space-y-6">
      {notice ? (
        <ConsoleNotice message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}

      <ConsoleCard>
        <ConsoleSectionHeader icon={<Gauge className="size-5" aria-hidden />} title={t("budgetStatusTitle")} />
        <p className="mt-4 text-xs leading-5 text-zinc-500">{t("budgetIntro")}</p>

        {error ? <p className="mt-4 text-sm text-red-700">{t("budgetStatusUnavailable")}</p> : null}

        {!error && !data ? <p className="mt-4 text-sm text-zinc-500">{t("budgetLoading")}</p> : null}

        {data ? (
          <>
            <dl className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Stat
                label={t("budgetStatusPeriod")}
                value={data.period.key}
                note={t("budgetStatusPeriodRange", {
                  from: dayFormat.format(data.period.start),
                  to: dayFormat.format(data.period.end - 1),
                })}
              />
              <Stat label={t("budgetStatusPolicy")} value={t(policyLabelKeys[data.settings.policy])} />
              <Stat
                label={t("budgetStatusUnknownCost")}
                value={t(unknownCostLabelKeys[data.settings.unknownCostPolicy])}
              />
              <Stat
                label={t("budgetStatusStrategy")}
                value={t(strategyLabelKeys[data.settings.strategy])}
                // CI-P7-03-C1: the tier only acts under `block` with a stated limit, so when it is not in
                // force the note says that instead of describing a stop that cannot happen right now.
                note={
                  data.settings.policy === "block" && data.settings.monthlyLimit !== null
                    ? strategyLineText(data.strategyLines[data.settings.strategy])
                    : t("budgetStatusStrategyInactive")
                }
              />
              <Stat
                label={t("budgetStatusLimit")}
                value={
                  data.settings.monthlyLimit === null
                    ? t("budgetStatusLimitNone")
                    : `${data.settings.currency} ${amountFormat.format(data.settings.monthlyLimit)}`
                }
              />
              <Stat
                label={t("budgetStatusSpent")}
                // `≥` when a row in the month states no figure: the total is then a floor, and the note
                // below says which rows are missing rather than leaving it unexplained.
                value={`${data.spent.currency} ${data.spent.isComplete ? "" : "≥ "}${amountFormat.format(
                  data.spent.amount,
                )}`}
                note={
                  data.spent.isComplete
                    ? undefined
                    : t("budgetStatusSpentFloor", {
                        unpriced: numberFormat.format(data.spent.unpricedAttempts),
                        unmeasured: numberFormat.format(data.spent.unmeasuredAttempts),
                        otherCurrency: numberFormat.format(data.spent.otherCurrencyAttempts),
                        currencies: data.spent.otherCurrencies.join(", "),
                      })
                }
              />
              <Stat
                label={t("budgetStatusReserved")}
                value={amountFormat.format(data.reserved)}
                note={t("budgetStatusInFlight", { count: numberFormat.format(data.inFlightCount) })}
              />
              <Stat
                label={t("budgetStatusRemaining")}
                value={
                  data.remaining === null ? t("budgetStatusRemainingNone") : amountFormat.format(data.remaining)
                }
              />
            </dl>

            {data.spent.truncated ? (
              <p className="mt-3 text-xs leading-5 text-amber-800">{t("budgetStatusTruncated")}</p>
            ) : null}

            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
              <p className="font-medium">{t("budgetEnforcementTitle")}</p>
              {/* The server names the guarantee; this page prints it and adds nothing. */}
              <p className="mt-1">{t("budgetEnforcementGuarantee", { enforcement: data.enforcement })}</p>
              <p className="mt-1">{t("budgetEnforcementUnknownCost")}</p>
            </div>
          </>
        ) : null}
      </ConsoleCard>

      <ConsoleCard>
        <ConsoleSectionHeader icon={<Save className="size-5" aria-hidden />} title={t("budgetSettingsTitle")} />
        <p className="mt-4 text-xs leading-5 text-zinc-500">{t("budgetSettingsIntro")}</p>

        {data ? (
          <>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SelectField
                label={t("budgetStatusPolicy")}
                value={form.policy}
                onChange={(value) => update("policy", value)}
                options={data.policies.map((policy) => ({ value: policy, label: t(policyLabelKeys[policy]) }))}
              />
              <SelectField
                label={t("budgetSettingsUnknownCostLabel")}
                value={form.unknownCostPolicy}
                onChange={(value) => update("unknownCostPolicy", value)}
                options={data.unknownCostPolicies.map((policy) => ({
                  value: policy,
                  label: t(unknownCostLabelKeys[policy]),
                }))}
              />
              {/* CI-P7-03-C1. The tiers come from the server's vocabulary, and the sentence under the form
                  describes the one *selected in the form* rather than the saved one, so the choice is made
                  with its own rule in front of it. */}
              <SelectField
                label={t("budgetSettingsStrategyLabel")}
                value={form.strategy}
                onChange={(value) => update("strategy", value)}
                options={data.strategies.map((strategy) => ({
                  value: strategy,
                  label: t(strategyLabelKeys[strategy]),
                }))}
              />
              <SelectField
                label={t("budgetSettingsCurrencyLabel")}
                value={form.currency}
                onChange={(value) => update("currency", value)}
                options={aiPriceCurrencies.map((currency) => ({ value: currency, label: currency }))}
              />
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                <span>{t("budgetSettingsLimitLabel")}</span>
                <input
                  className={consoleInputClass}
                  inputMode="decimal"
                  value={form.monthlyLimit}
                  onChange={(event) => update("monthlyLimit", event.target.value)}
                  placeholder={t("budgetStatusLimitNone")}
                />
                <span className="text-xs font-normal text-zinc-500">{t("budgetSettingsLimitHint")}</span>
              </label>
            </div>

            <p className="mt-3 text-xs leading-5 text-zinc-500">{t("budgetSettingsFormHint")}</p>

            {/* The rule of the tier selected above, in the server's own terms, plus what it takes for the
                tier to be in force at all. */}
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              {strategyLineText(data.strategyLines[form.strategy])} {t("budgetSettingsStrategyHint")}
            </p>

            <div className="mt-4">
              <Button onClick={() => void save()} loading={saving}>
                <Save className="size-4" aria-hidden />
                {saving ? t("budgetSaving") : t("budgetSave")}
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">{t("budgetLoading")}</p>
        )}
      </ConsoleCard>

      <ConsoleCard>
        <ConsoleSectionHeader icon={<Sparkles className="size-5" aria-hidden />} title={t("budgetEstimateTitle")} />
        <p className="mt-4 text-xs leading-5 text-zinc-500">{t("budgetEstimateHint")}</p>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {/* The dimension comes first because it decides which of the boxes below apply - and, on the
              server side, which row of the catalog the call is compared against. A preview priced from
              an image row and one priced from a chat row are answers to different questions. */}
          <SelectField
            label={t("budgetEstimateKind")}
            value={estimateForm.meteredKind}
            onChange={(value) => setEstimateForm((previous) => ({ ...previous, meteredKind: value }))}
            options={aiUsageMeteredKinds.map((kind) => ({ value: kind, label: t(usageKindLabelKeys[kind]) }))}
          />
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("budgetEstimateProvider")}</span>
            <input
              className={consoleInputClass}
              value={estimateForm.providerId}
              onChange={(event) => setEstimateForm((previous) => ({ ...previous, providerId: event.target.value }))}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("budgetEstimateModel")}</span>
            <input
              className={consoleInputClass}
              value={estimateForm.modelId}
              onChange={(event) => setEstimateForm((previous) => ({ ...previous, modelId: event.target.value }))}
            />
          </label>
          {estimateTokenMetered ? (
            <>
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                <span>{t("budgetEstimateMaxOutput")}</span>
                <input
                  className={consoleInputClass}
                  inputMode="numeric"
                  value={estimateForm.maxOutputTokens}
                  onChange={(event) =>
                    setEstimateForm((previous) => ({ ...previous, maxOutputTokens: event.target.value }))
                  }
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700 md:col-span-2 xl:col-span-4">
                <span>{t("budgetEstimateText")}</span>
                <textarea
                  className={`${consoleInputClass} min-h-24`}
                  value={estimateForm.inputText}
                  onChange={(event) =>
                    setEstimateForm((previous) => ({ ...previous, inputText: event.target.value }))
                  }
                />
                <span className="text-xs font-normal text-zinc-500">{t("budgetEstimateTextHint")}</span>
              </label>
            </>
          ) : (
            /* A per-unit dimension is priced by the unit, so the text box would only be sent to be
               discarded - and the count is what the rate is multiplied by. */
            <label className="grid gap-1.5 text-sm font-medium text-zinc-700 md:col-span-2 xl:col-span-2">
              <span>{t("budgetEstimateQuantity")}</span>
              <input
                className={consoleInputClass}
                inputMode="decimal"
                value={estimateForm.quantity}
                onChange={(event) => setEstimateForm((previous) => ({ ...previous, quantity: event.target.value }))}
              />
              <span className="text-xs font-normal text-zinc-500">{t("budgetEstimateQuantityHint")}</span>
            </label>
          )}
        </div>

        <div className="mt-4">
          <Button onClick={() => void estimate()} loading={estimating}>
            <Sparkles className="size-4" aria-hidden />
            {estimating ? t("budgetEstimateRunning") : t("budgetEstimateRun")}
          </Button>
        </div>

        {previewError ? <p className="mt-3 text-sm text-red-700">{previewError}</p> : null}

        {preview ? (
          <div className="mt-4 space-y-3 rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3">
            <p className="text-sm text-zinc-700">
              {preview.target.routeResolved
                ? t("budgetEstimateTarget", {
                    provider: preview.target.providerId || "?",
                    model: preview.target.modelId || "?",
                  })
                : t("budgetEstimateTargetUnresolved", {
                    provider: preview.target.providerId || "?",
                    model: preview.target.modelId || "?",
                  })}
            </p>

            {/* A range, an open lower bound, or the honest non-answer - never a 0 standing in for
                "we do not know". The basis under it says what the amount was multiplied on: tokens for a
                token-metered dimension, the catalog's own per-unit rate (with its unit and the price
                revision it came from) for the rest. */}
            <EstimateSummary estimate={preview.estimate} />

            <div className={`rounded-2xl border px-4 py-3 text-xs leading-5 ${budgetDecisionToneClass[preview.decision.status]}`}>
              <p className="font-semibold">
                {t(budgetDecisionLabelKeys[preview.decision.status])} · {t(certaintyLabelKeys[preview.decision.certainty])}
              </p>
              {/* Which tier reached this verdict: a refusal its own line made must not read as a crossed
                  limit, and the tier's name is the first thing that tells the two apart. */}
              <p className="mt-1">
                {t("budgetDecisionStrategy", { strategy: t(strategyLabelKeys[preview.decision.strategy]) })}
              </p>
              {/* Whether this estimate moved any total: an unstated cost is left out, not added as 0. */}
              <p className="mt-1">
                {preview.decision.estimateCounted ? t("budgetDecisionCounted") : t("budgetDecisionNotCounted")}
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {preview.decision.reasons.map((reason) => (
                  <li key={reason}>{t(reasonLabelKeys[reason])}</li>
                ))}
              </ul>
            </div>

            <p className="text-xs leading-5 text-zinc-500">{t("budgetEstimateReadOnly")}</p>
          </div>
        ) : null}
      </ConsoleCard>
    </div>
  );
}

/** One labelled figure. `note` carries what the figure cannot say by itself (a floor, or a window). */
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-zinc-900">{value}</dd>
      {note ? <dd className="mt-1 text-xs leading-5 text-zinc-500">{note}</dd> : null}
    </div>
  );
}


