import {
  aiUsageKindIsTokenMetered,
  aiUsageKindUnits,
  type AiPriceCurrency,
  type AiPriceSource,
  type AiUsageMeteredKind,
  type AiUsageUnitLabel,
} from "@/lib/types";

/**
 * The 价格目录 form's own state and the body it posts (CI-P7-03-D2).
 *
 * Where the panel used to record token prices only, this module is what makes the *other* dimensions
 * enterable - the ones the catalog and the ledger have always understood (`aiUsageKindUnits`): an
 * image price per image, a video price per second, a speech price per character or second, a price per
 * call. It is a plain module rather than part of the `.tsx` because the rule it carries is worth
 * pinning on its own: **a row states the dimension it is billed in, and never both kinds of rate**.
 * A token rate on a per-image row is refused by the catalog (`assertPriceShape`), so the form must not
 * be able to produce one - and a per-unit price on a text row is refused in the same way.
 *
 * Nothing here invents a price or a unit. A blank box is `undefined` (the catalog refuses it as
 * "not stated"), never a 0 that a real call would then be multiplied by.
 */

export type ModelPriceForm = {
  providerId: string;
  modelId: string;
  /** The dimension this row prices (CI-P7-03-D2: no longer always `text`). */
  meteredKind: AiUsageMeteredKind;
  currency: AiPriceCurrency;
  inputPerMillion: string;
  outputPerMillion: string;
  cachedInputPerMillion: string;
  /** The unit a per-unit dimension is quoted in. Empty for a token-metered dimension. */
  unitLabel: AiUsageUnitLabel | "";
  unitPrice: string;
  priceVersion: string;
  source: AiPriceSource;
  effectiveFrom: string;
  declaredFree: boolean;
  notes: string;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** `datetime-local` speaks local time as `YYYY-MM-DDTHH:mm`, which is what a person recognises. */
export function localInputValue(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** The units a dimension may be quoted in: `[]` means it is priced by the token columns instead. */
export function modelPriceUnitsFor(kind: AiUsageMeteredKind): readonly AiUsageUnitLabel[] {
  return aiUsageKindUnits[kind];
}

/**
 * The unit a dimension is seated on. A kind that accepts one unit has no choice to make; `speech` is
 * the one kind with two, and character-billing is the common case at the vendors that do it.
 */
export function defaultUnitLabelFor(kind: AiUsageMeteredKind) {
  return aiUsageKindUnits[kind][0] ?? "";
}

export function defaultModelPriceForm(providerId = ""): ModelPriceForm {
  return {
    providerId,
    modelId: "*",
    meteredKind: "text",
    currency: "CNY",
    inputPerMillion: "",
    outputPerMillion: "",
    cachedInputPerMillion: "",
    unitLabel: "",
    unitPrice: "",
    priceVersion: `manual-${new Date().toISOString().slice(0, 10)}`,
    source: "manual",
    effectiveFrom: localInputValue(Date.now()),
    declaredFree: false,
    notes: "",
  };
}

/**
 * Moving the dimension re-seats the unit, because a kind only accepts the units it is actually billed
 * in (`image` -> image, `video` -> second, `speech` -> character or second, `agent` -> call). Keeping
 * the previous kind's unit would leave the form holding a row the catalog would refuse.
 */
export function changeModelPriceKind(form: ModelPriceForm, kind: AiUsageMeteredKind): ModelPriceForm {
  return { ...form, meteredKind: kind, unitLabel: defaultUnitLabelFor(kind) };
}

/**
 * An empty box means "not stated" and becomes `undefined`, never 0: a rate nobody typed is refused
 * by the catalog instead of being stored as a free model.
 */
export function rateFromInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * One row of the catalog, as `POST /api/models/prices` takes it.
 *
 * The dimension decides which rate fields exist: a token-metered row carries `<x>PerMillion` and no
 * unit, a per-unit row carries `unitLabel` + `unitPrice` and no token rate. Sending both would be a
 * request the catalog refuses - and, worse, a row nobody could read unambiguously afterwards.
 */
export function modelPriceFormPayload(form: ModelPriceForm) {
  const body = {
    providerId: form.providerId.trim(),
    modelId: form.modelId.trim() || "*",
    meteredKind: form.meteredKind,
    currency: form.currency,
    declaredFree: form.declaredFree,
    priceVersion: form.priceVersion.trim(),
    source: form.source,
    effectiveFrom: form.effectiveFrom ? new Date(form.effectiveFrom).getTime() : undefined,
    notes: form.notes.trim(),
  };

  if (aiUsageKindIsTokenMetered(form.meteredKind)) {
    return {
      ...body,
      inputPerMillion: rateFromInput(form.inputPerMillion),
      outputPerMillion: rateFromInput(form.outputPerMillion),
      // An empty cached box is a real answer: this provider does not price it separately.
      cachedInputPerMillion: form.cachedInputPerMillion.trim()
        ? rateFromInput(form.cachedInputPerMillion)
        : null,
    };
  }

  return {
    ...body,
    unitLabel: form.unitLabel,
    unitPrice: rateFromInput(form.unitPrice),
  };
}
