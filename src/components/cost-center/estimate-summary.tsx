"use client";

import { useMemo } from "react";
import type { AiCostEstimate } from "@/lib/ai-budget";
import { useI18n } from "@/lib/i18n";
import {
  estimateAmountText,
  estimateNoteLabelKeys,
  estimateTokenBasisText,
  estimateUnitBasisText,
} from "./estimate-view";

/**
 * One estimate, read out (CI-P7-03-D2).
 *
 * Every screen that previews what a call would cost prints it *this* way: the amount, then whichever
 * basis produced it, then the caveats the server attached to it. Two screens hand-writing these lines is
 * how one of them ends up showing "0.04" without saying per what, or dropping `price-not-on-file` and
 * making an unpriced model look priced.
 *
 * It renders the estimate and nothing else. The verdict, the read-only reminder and the resolved route
 * belong to whichever screen asked, because the 预算与预估 tab and the image page say different things
 * around the same numbers.
 */
export function EstimateSummary({ estimate }: { estimate: AiCostEstimate }) {
  const { t, locale } = useI18n();
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }),
    [locale],
  );
  const formatAmount = (value: number) => numberFormat.format(value);

  const unitBasis = estimateUnitBasisText(t, formatAmount, estimate);
  const tokenBasis = estimateTokenBasisText(t, formatAmount, estimate);

  return (
    <div className="space-y-2">
      {/* A range, an open lower bound, or the honest non-answer - never a 0 for "we cannot say". */}
      <p className="text-base font-semibold text-zinc-900">{estimateAmountText(t, formatAmount, estimate)}</p>
      {unitBasis ? <p className="text-xs leading-5 text-zinc-600">{unitBasis}</p> : null}
      {tokenBasis ? <p className="text-xs leading-5 text-zinc-600">{tokenBasis}</p> : null}
      {estimate.notes.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-zinc-600">
          {estimate.notes.map((note) => (
            <li key={note}>{t(estimateNoteLabelKeys[note])}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
