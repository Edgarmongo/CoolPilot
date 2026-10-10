"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { BadgeDollarSign, Coins, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ConsoleCard,
  ConsoleNotice,
  ConsoleSectionHeader,
  consoleInputClass,
} from "@/components/ui/console-surface";
import { SelectField } from "@/components/ui/form-controls";
import { ApiClientError, apiErrorTranslationKey, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import {
  aiPriceCurrencies,
  aiPriceSources,
  aiUsageMeteredKinds,
  type AiModelPrice,
  type AiModelPriceView,
  type AiPriceCurrency,
  type AiPriceSource,
  type AiUsageMeteredKind,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 价格目录 (CI-P7-01-05): what a request costs, and since when.
 *
 * Two things this screen refuses to do, because both would make the ledger's money figures look
 * more certain than they are:
 *
 * - it never lets a price be edited or deleted. A price change is an appended row with a later
 *   effective time, so a call recorded last month keeps the figure it was costed with;
 * - it never presents a computed figure as a charge. Everything entered here produces "our
 *   arithmetic on your usage" (`computed`), which the notice above the form says out loud.
 *
 * The dimensions the catalog can hold but this screen cannot yet fill are listed as they are -
 * unpriced - rather than given a placeholder price that real usage would then be multiplied by.
 */

type PricesResponse = { prices: AiModelPriceView[]; meteredKinds: AiUsageMeteredKind[] };

type PriceForm = {
  providerId: string;
  modelId: string;
  currency: AiPriceCurrency;
  inputPerMillion: string;
  outputPerMillion: string;
  cachedInputPerMillion: string;
  priceVersion: string;
  source: AiPriceSource;
  effectiveFrom: string;
  declaredFree: boolean;
  notes: string;
};

const meteredKindLabelKeys: Record<AiUsageMeteredKind, TranslationKey> = {
  text: "modelPriceKindText",
  image: "modelPriceKindImage",
  video: "modelPriceKindVideo",
  speech: "modelPriceKindSpeech",
  embedding: "modelPriceKindEmbedding",
  agent: "modelPriceKindAgent",
};

const sourceLabelKeys: Record<AiPriceSource, TranslationKey> = {
  manual: "modelPriceSourceManual",
  "provider-doc": "modelPriceSourceProviderDoc",
  imported: "modelPriceSourceImported",
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** `datetime-local` speaks local time as `YYYY-MM-DDTHH:mm`, which is what a person recognises. */
function localInputValue(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * An empty box means "not stated" and becomes `undefined`, never 0: a rate nobody typed is refused
 * by the catalog instead of being stored as a free model.
 */
function rateFromInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function defaultForm(providerId = ""): PriceForm {
  return {
    providerId,
    modelId: "*",
    currency: "CNY",
    inputPerMillion: "",
    outputPerMillion: "",
    cachedInputPerMillion: "",
    priceVersion: `manual-${new Date().toISOString().slice(0, 10)}`,
    source: "manual",
    effectiveFrom: localInputValue(Date.now()),
    declaredFree: false,
    notes: "",
  };
}

/** The first field-level complaint a zod refusal carries, when it carries one. */
function firstIssue(details: unknown) {
  const issues = (details as { issues?: Array<{ path?: unknown[]; message?: string }> } | null)?.issues;
  const issue = Array.isArray(issues) ? issues[0] : undefined;
  if (!issue) return "";
  const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
  return [path, issue.message].filter(Boolean).join(": ");
}

export default function ModelPricePanel() {
  const { t, locale } = useI18n();
  const [form, setForm] = useState<PriceForm>(() => defaultForm());
  const [providerFilter, setProviderFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<AiUsageMeteredKind | "">("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  const query = new URLSearchParams();
  if (providerFilter.trim()) query.set("providerId", providerFilter.trim());
  if (kindFilter) query.set("meteredKind", kindFilter);
  const pricesKey = query.toString() ? `/api/models/prices?${query.toString()}` : "/api/models/prices";

  const { data, mutate } = useSWR<PricesResponse>(pricesKey, swrFetcher, { revalidateOnFocus: false });
  // Stable identity: an inline `?? []` would be a new array on every render and would make the
  // memo below useless (and the lint rule that noticed it right).
  const prices = useMemo(() => data?.prices ?? [], [data]);
  const meteredKinds: AiUsageMeteredKind[] = data?.meteredKinds ?? [...aiUsageMeteredKinds];

  const numberFormat = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }),
    [locale],
  );
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  // "In force" arrives on the row (`markInForceModelPrices` in `@/lib/ai-usage-ledger`), marked by
  // the server: that is the side which would pick a price for the next call, so the page must not
  // answer the question with its own clock.

  /** Dimensions with no price at all - the honest "we cannot state this" list. */
  const unpricedKinds = meteredKinds.filter((kind) => !prices.some((price) => price.meteredKind === kind));

  function update<Key extends keyof PriceForm>(key: Key, value: PriceForm[Key]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function submit() {
    setSaving(true);
    setNotice(null);
    try {
      await apiPost("/api/models/prices", {
        providerId: form.providerId.trim(),
        modelId: form.modelId.trim() || "*",
        meteredKind: "text",
        currency: form.currency,
        inputPerMillion: rateFromInput(form.inputPerMillion),
        outputPerMillion: rateFromInput(form.outputPerMillion),
        // An empty cached box is a real answer: this provider does not price it separately.
        cachedInputPerMillion: form.cachedInputPerMillion.trim()
          ? rateFromInput(form.cachedInputPerMillion)
          : null,
        unitLabel: "",
        declaredFree: form.declaredFree,
        priceVersion: form.priceVersion.trim(),
        source: form.source,
        effectiveFrom: form.effectiveFrom ? new Date(form.effectiveFrom).getTime() : undefined,
        notes: form.notes.trim(),
      });
      // The provider stays put: adding a second model for the same vendor is the common case.
      setForm((previous) => ({ ...defaultForm(previous.providerId), currency: previous.currency }));
      setNotice({ tone: "success", message: t("modelPriceSaved") });
      await mutate();
    } catch (error) {
      const issue = firstIssue((error as ApiClientError | undefined)?.details);
      setNotice({
        tone: "error",
        message: issue || t(apiErrorTranslationKey(error, "modelPriceSaveFailed")),
      });
    } finally {
      setSaving(false);
    }
  }

  /** A row's price as a sentence: token rates for token kinds, a per-unit rate for the others. */
  function rateText(price: AiModelPrice) {
    if (price.unitPrice !== undefined) {
      return `${numberFormat.format(price.unitPrice)} / ${price.unitLabel || "?"}`;
    }
    return t("modelPriceRatesPerMillion", {
      input: numberFormat.format(price.inputPerMillion),
      output: numberFormat.format(price.outputPerMillion),
    });
  }

  return (
    <div className="space-y-6">
      {notice ? (
        <ConsoleNotice message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}

      <ConsoleCard>
        <ConsoleSectionHeader
          icon={<BadgeDollarSign className="size-5" aria-hidden />}
          title={t("modelPriceTitle")}
        />
        <p className="mt-4 text-xs leading-5 text-zinc-500">{t("modelPriceDescription")}</p>
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          {t("modelPriceEstimateNotice")}
        </div>

        <h3 className="mt-6 text-sm font-semibold text-zinc-900">{t("modelPriceFormTitle")}</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("modelPriceProvider")}</span>
            <input
              className={consoleInputClass}
              value={form.providerId}
              onChange={(event) => update("providerId", event.target.value)}
              placeholder="gemini"
            />
            <span className="text-xs font-normal text-zinc-500">{t("modelPriceProviderHint")}</span>
          </label>

          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("modelPriceModel")}</span>
            <input
              className={consoleInputClass}
              value={form.modelId}
              onChange={(event) => update("modelId", event.target.value)}
              placeholder="*"
            />
            <span className="text-xs font-normal text-zinc-500">{t("modelPriceModelHint")}</span>
          </label>

          <SelectField
            label={t("modelPriceCurrency")}
            value={form.currency}
            onChange={(value) => update("currency", value)}
            options={aiPriceCurrencies.map((currency) => ({ value: currency, label: currency }))}
          />

          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("modelPriceInputRate")}</span>
            <input
              className={consoleInputClass}
              inputMode="decimal"
              value={form.inputPerMillion}
              onChange={(event) => update("inputPerMillion", event.target.value)}
              placeholder="0"
            />
          </label>

          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("modelPriceOutputRate")}</span>
            <input
              className={consoleInputClass}
              inputMode="decimal"
              value={form.outputPerMillion}
              onChange={(event) => update("outputPerMillion", event.target.value)}
              placeholder="0"
            />
          </label>

          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("modelPriceCachedRate")}</span>
            <input
              className={consoleInputClass}
              inputMode="decimal"
              value={form.cachedInputPerMillion}
              onChange={(event) => update("cachedInputPerMillion", event.target.value)}
            />
            <span className="text-xs font-normal text-zinc-500">{t("modelPriceCachedHint")}</span>
          </label>

          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("modelPriceVersion")}</span>
            <input
              className={consoleInputClass}
              value={form.priceVersion}
              onChange={(event) => update("priceVersion", event.target.value)}
            />
            <span className="text-xs font-normal text-zinc-500">{t("modelPriceVersionHint")}</span>
          </label>

          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("modelPriceEffectiveFrom")}</span>
            <input
              className={consoleInputClass}
              type="datetime-local"
              value={form.effectiveFrom}
              onChange={(event) => update("effectiveFrom", event.target.value)}
            />
            <span className="text-xs font-normal text-zinc-500">{t("modelPriceEffectiveHint")}</span>
          </label>

          <SelectField
            label={t("modelPriceSource")}
            value={form.source}
            onChange={(value) => update("source", value)}
            options={aiPriceSources.map((source) => ({ value: source, label: t(sourceLabelKeys[source]) }))}
          />

          <label className="grid gap-1.5 text-sm font-medium text-zinc-700 md:col-span-2 xl:col-span-3">
            <span>{t("modelPriceNotes")}</span>
            <input
              className={consoleInputClass}
              value={form.notes}
              onChange={(event) => update("notes", event.target.value)}
            />
          </label>
        </div>

        <label className="mt-4 flex items-start gap-3 rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={form.declaredFree}
            onChange={(event) => update("declaredFree", event.target.checked)}
          />
          <span className="text-xs leading-5 text-zinc-600">
            <span className="font-medium text-zinc-900">{t("modelPriceDeclaredFree")}</span>
            <span className="mt-1 block">{t("modelPriceDeclaredFreeHint")}</span>
          </span>
        </label>

        <p className="mt-3 text-xs leading-5 text-zinc-500">{t("modelPriceFormHint")}</p>

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => void submit()} loading={saving} disabled={!form.providerId.trim()}>
            <Plus className="size-4" aria-hidden />
            {saving ? t("modelPriceSaving") : t("modelPriceSubmit")}
          </Button>
        </div>
      </ConsoleCard>

      <ConsoleCard>
        <ConsoleSectionHeader
          icon={<Coins className="size-5" aria-hidden />}
          title={t("modelPriceHistoryTitle")}
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("modelPriceProvider")}</span>
            <input
              className={consoleInputClass}
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
            />
          </label>
          <SelectField
            label={t("modelPriceColumnMeter")}
            value={kindFilter}
            onChange={(value) => setKindFilter(value)}
            options={[
              { value: "", label: "*" },
              ...meteredKinds.map((kind) => ({ value: kind, label: t(meteredKindLabelKeys[kind]) })),
            ]}
          />
        </div>

        {prices.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-sky-100 px-4 py-6 text-center text-xs text-zinc-500">
            {t("modelPriceHistoryEmpty")}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-sky-100 text-zinc-500">
                  <th className="py-2 pr-4 font-medium">{t("modelPriceProvider")}</th>
                  <th className="py-2 pr-4 font-medium">{t("modelPriceModel")}</th>
                  <th className="py-2 pr-4 font-medium">{t("modelPriceColumnMeter")}</th>
                  <th className="py-2 pr-4 font-medium">{t("modelPriceColumnRate")}</th>
                  <th className="py-2 pr-4 font-medium">{t("modelPriceVersion")}</th>
                  <th className="py-2 pr-4 font-medium">{t("modelPriceEffectiveFrom")}</th>
                  <th className="py-2 font-medium">{t("modelPriceNotes")}</th>
                </tr>
              </thead>
              <tbody>
                {prices.map((price) => {
                  const inForce = price.inForce;
                  return (
                    <tr key={price.id} className="border-b border-sky-50 align-top">
                      <td className="py-2 pr-4 font-medium text-zinc-900">{price.providerId}</td>
                      <td className="py-2 pr-4 text-zinc-700">{price.modelId}</td>
                      <td className="py-2 pr-4">
                        <span className="rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-zinc-600">
                          {t(meteredKindLabelKeys[price.meteredKind])}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-zinc-700">
                        <span>{rateText(price)}</span>
                        <span className="ml-2 text-zinc-400">{price.currency}</span>
                        {price.cachedInputPerMillion === undefined ? null : (
                          <span className="ml-2 rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-sky-700">
                            {t("modelPriceCachedRateTag", {
                              rate: numberFormat.format(price.cachedInputPerMillion),
                            })}
                          </span>
                        )}
                        {price.declaredFree ? (
                          <span className="ml-2 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                            {t("modelPriceFreeDeclared")}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4 text-zinc-700">
                        <span>{price.priceVersion || "—"}</span>
                        <span className="mt-1 block text-zinc-400">
                          {t(sourceLabelKeys[price.source as AiPriceSource] ?? "modelPriceSourceManual")}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-zinc-700">
                        <span>{dateFormat.format(new Date(price.effectiveFrom))}</span>
                        <span className={cn("mt-1 block", inForce ? "text-emerald-700" : "text-amber-700")}>
                          {inForce ? t("modelPriceCurrentInForce") : t("modelPriceNotYetInForce")}
                        </span>
                      </td>
                      <td className="py-2 text-zinc-500">{price.notes || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ConsoleCard>

      {unpricedKinds.length > 0 ? (
        <ConsoleCard>
          <ConsoleSectionHeader
            icon={<Coins className="size-5" aria-hidden />}
            title={t("modelPriceUnpricedTitle")}
          />
          <p className="mt-4 text-xs leading-5 text-zinc-500">{t("modelPriceUnpricedHint")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {unpricedKinds.map((kind) => (
              <span
                key={kind}
                className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-600"
              >
                {t(meteredKindLabelKeys[kind])}
              </span>
            ))}
          </div>
        </ConsoleCard>
      ) : null}
    </div>
  );
}



