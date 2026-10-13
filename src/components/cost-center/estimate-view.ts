import type { ModelCapability } from "@/features/ai-runtime/contracts";
import type { AiBudgetDecision, AiCostEstimate, AiCostEstimateNote } from "@/lib/ai-budget";
import { usageUnitLabelKeys } from "@/lib/ai-usage-labels";
import type { TranslationKey } from "@/lib/locale-resources";
import { aiUsageKindIsTokenMetered, type AiUsageMeteredKind } from "@/lib/types";

/**
 * How a cost estimate is asked for and read out (CI-P7-03-D2).
 *
 * The 预算与预估 tab and the image/video entry points ask the *same* endpoint
 * (`POST /api/ai-cost-center/estimate`) and must therefore read its answer the same way: the amount,
 * the basis it was multiplied on and the caveats have to say the same thing on both screens, or the two
 * would disagree about one server answer. This module is that reading, and the request that produces
 * it, as plain functions - so what the screens display is pinnable by a test without rendering either.
 *
 * Two rules it exists to keep, both of which a second implementation would get subtly wrong:
 *
 * - a dimension that is *not* token-metered needs a quantity, so the token boxes are not sent with it
 *   and a `null` ceiling is never read as "no ceiling" on a per-image price;
 * - a capability is stated per dimension, because without one the route is resolved as `chat` and an
 *   image estimate would be priced with whatever chat model happens to be first - an authoritative
 *   looking number about a different model.
 */

export type EstimateTranslator = (
  key: TranslationKey,
  values?: Record<string, string | number>,
) => string;

/** `Intl.NumberFormat.format`, passed in so this module holds no locale state of its own. */
export type EstimateAmountFormat = (value: number) => string;

/**
 * The capability each dimension's call will ask the runtime for. It is what `resolveRoute` pre-resolves
 * when the caller names no model, so it decides *which* model's price an estimate is compared against.
 *
 * `speech` is `speech_to_text`: transcription is the speech path in this database that spends, and it
 * resolves the route the transcription call itself resolves (CI-P7-03).
 */
export const estimateCapabilityForKind: Record<AiUsageMeteredKind, ModelCapability> = {
  text: "chat",
  image: "image_generation",
  video: "video_generation",
  speech: "speech_to_text",
  embedding: "embedding",
  agent: "chat",
};

/**
 * The caveats an answer can carry, in words. Exhaustive over `AiCostEstimateNote`, so a note the server
 * starts sending cannot reach a screen untranslated without failing the build.
 */
export const estimateNoteLabelKeys: Record<AiCostEstimateNote, TranslationKey> = {
  "output-ceiling-unknown": "budgetNoteOutputCeilingUnknown",
  "route-may-differ": "budgetNoteRouteMayDiffer",
  "route-unresolved": "budgetNoteRouteUnresolved",
  "usage-basis-unknown": "budgetNoteUsageBasisUnknown",
  "price-not-on-file": "budgetNotePriceNotOnFile",
  "dimension-mismatch": "budgetNoteDimensionMismatch",
  "currency-mismatch": "budgetNoteCurrencyMismatch",
  "spend-incomplete": "budgetNoteSpendIncomplete",
  "spend-truncated": "budgetNoteSpendTruncated",
};

/** The verdict of the read-only gate, one word each. */
export const budgetDecisionLabelKeys: Record<AiBudgetDecision["status"], TranslationKey> = {
  off: "budgetDecisionOff",
  allowed: "budgetDecisionAllowed",
  blocked: "budgetDecisionBlocked",
};

/**
 * How a verdict is painted - shared, so the 预算与预估 tab and the image page cannot colour the same
 * server verdict differently. `off` is deliberately the quietest of the three: with budget control off
 * nothing is refused, and a reassuring green box would overstate what was actually checked.
 */
export const budgetDecisionToneClass: Record<AiBudgetDecision["status"], string> = {
  off: "border-sky-100 bg-sky-50/60 text-zinc-600",
  allowed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  blocked: "border-red-200 bg-red-50 text-red-800",
};

/**
 * What `POST /api/ai-cost-center/estimate` answers with, as both of its callers read it.
 *
 * Declared once because the endpoint is one endpoint: the 预算与预估 tab and the image page see the same
 * five fields, and a page that declared its own version could quietly start depending on a field the
 * server stopped sending. `period` is optional here - the tab draws the month's window from
 * `/budget` (`/estimate` repeats it, but nothing on either screen reads it from the estimate answer).
 */
export type EstimatePreviewAnswer = {
  purpose: string;
  decision: AiBudgetDecision;
  estimate: AiCostEstimate;
  target: {
    providerId: string;
    modelId: string;
    meteredKind: AiUsageMeteredKind;
    routeResolved: boolean;
  };
  period?: { key: string; start: number; end: number };
};

/** What a screen has on hand for the call it is about to make. Numbers are still raw input text. */
export type EstimateFormMeasurement = {
  meteredKind: AiUsageMeteredKind;
  providerId?: string;
  modelId?: string;
  inputText?: string;
  maxOutputTokens?: string;
  quantity?: string;
};

/**
 * A number box's contents as a number. An empty box is `null` ("not stated", which the server answers
 * as *unknown*) and unparseable text is `NaN`, which `aiCostEstimateRequestSchema` refuses - so a
 * half-typed figure never turns into a smaller estimate.
 */
export function numberFromInput(value: string | undefined | null): number | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * The body for `POST /api/ai-cost-center/estimate`.
 *
 * The dimension decides *which* half of the request is filled in. A token-metered dimension sends the
 * text (measured server-side and dropped) and its reply ceiling; a per-unit dimension sends how many
 * units the call will consume and no text at all, because a per-image price multiplied by a token count
 * is not arithmetic anyone can do - the server answers `usage-basis-unknown` instead, and this
 * deliberately leaves it able to say exactly that.
 */
export function estimateRequestFor(measurement: EstimateFormMeasurement) {
  const tokenMetered = aiUsageKindIsTokenMetered(measurement.meteredKind);
  return {
    providerId: measurement.providerId?.trim() ?? "",
    modelId: measurement.modelId?.trim() ?? "",
    capability: estimateCapabilityForKind[measurement.meteredKind],
    meteredKind: measurement.meteredKind,
    inputText: tokenMetered ? measurement.inputText ?? "" : "",
    maxOutputTokens: tokenMetered ? numberFromInput(measurement.maxOutputTokens) : null,
    quantity: tokenMetered ? null : numberFromInput(measurement.quantity),
  };
}

/**
 * The headline: a range when the call's ceiling is known, an open lower bound when it is not, and the
 * server's own words when it refused to state an amount at all.
 *
 * `unpriced` and `unknown` are read as two different sentences because they are two different facts
 * ("the catalog does not price this" vs "nobody can say what this will be metered on"). Neither is
 * rendered as 0.
 */
export function estimateAmountText(
  t: EstimateTranslator,
  formatAmount: EstimateAmountFormat,
  estimate: AiCostEstimate,
) {
  // `AiCostEstimate` declares *one* member for "no amount", and its `kind` is itself a union of the two
  // non-answers - so peeling them off one literal at a time narrows nothing. The negative check is what
  // narrows to the priced member; the two sentences are told apart inside it.
  if (estimate.kind !== "estimate") {
    return estimate.kind === "unpriced" ? t("budgetEstimateUnpriced") : t("budgetEstimateUnknown");
  }
  const min = formatAmount(estimate.amountMin);
  if (estimate.amountMax === null) {
    return t("budgetEstimateRangeOpen", { currency: estimate.currency, min });
  }
  return t("budgetEstimateRange", {
    currency: estimate.currency,
    min,
    max: formatAmount(estimate.amountMax),
  });
}

/**
 * What the amount was multiplied on for a token-metered dimension: the input count and the reply
 * ceiling. `null` for anything else, so a per-unit estimate is never described in tokens.
 */
export function estimateTokenBasisText(
  t: EstimateTranslator,
  formatAmount: EstimateAmountFormat,
  estimate: AiCostEstimate,
) {
  if (estimate.kind !== "estimate" || !aiUsageKindIsTokenMetered(estimate.meteredKind)) return null;
  return t("budgetEstimateTokens", {
    input: formatAmount(estimate.inputTokensMin),
    output:
      estimate.outputTokensMax === null
        ? t("budgetEstimateOutputUnknown")
        : formatAmount(estimate.outputTokensMax),
  });
}

/**
 * What the amount was multiplied on for a per-unit dimension: the catalog's own rate, its unit and the
 * version of the price that rate came from - so "0.35" is never shown without saying 0.35 *of what*, and
 * as of *which revision of the catalog*. `null` for a token-metered estimate, and for the degenerate
 * basis a hand-written row could carry (a per-unit price with no unit named says nothing worth saying).
 */
export function estimateUnitBasisText(
  t: EstimateTranslator,
  formatAmount: EstimateAmountFormat,
  estimate: AiCostEstimate,
) {
  if (estimate.kind !== "estimate" || aiUsageKindIsTokenMetered(estimate.meteredKind)) return null;
  const { unitPrice, unitLabel, priceVersion } = estimate.basis;
  if (unitPrice === undefined || unitPrice === null || !unitLabel) return null;
  return t("budgetEstimateUnitBasis", {
    unit: t(usageUnitLabelKeys[unitLabel]),
    currency: estimate.currency,
    amount: formatAmount(unitPrice),
    version: priceVersion,
  });
}
