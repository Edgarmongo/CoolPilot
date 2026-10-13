import {
  aiUsageMeteredKinds,
  aiUsageKindIsTokenMetered,
  aiUsageKindUnits,
  type AiUsageLedgerEntry,
  type AiUsageMeteredKind,
  type AiUsageMeteringCoverage,
  type AiUsageMeteringGap,
  type AiUsageMeteringReason,
} from "@/lib/types";
import { aiUsageCostSourceIsReal, measuredUnitQuantity, parseLedgerQuantity } from "./ai-usage-ledger";

/**
 * 「无法准确计量的服务必须显式标记，而不是漏记」 (CI-P7-05-04).
 *
 * The ledger already stores *that* a figure is missing (`cost_source`) and *how much* of the real
 * usage was seen (`completeness`). What it never said - and what this module states - is **why** the
 * figure is missing, because that is the part a user can act on: a missing catalog price is fixed by
 * recording one, a vendor that reports no usage is fixed by nothing, and a quantity written under a
 * key its dimension does not price is a wiring mistake worth seeing.
 *
 * Two rules are kept here and nowhere else:
 *
 *  1. **The reason is derived from the row's own stored evidence.** `meteringReasonFor()` reads the
 *     row exactly like `computeUsageCost()` read it when it decided, and never looks at the purpose,
 *     the model name, the page or the extension id. When that evidence does not support an answer the
 *     result is `not-recorded`, never a plausible guess - which is also what a row written before
 *     this vocabulary existed honestly gets. Nothing is backfilled and no usage is invented.
 *  2. **A dimension with no rows is still named.** `summarizeLedgerMeteringCoverage()` returns every
 *     metered dimension in the vocabulary's own order, so a dimension this runtime cannot produce a
 *     single row for (video) is *declared unmeterable* on the screen instead of quietly
 *     disappearing from a list that only iterates over data.
 */

/**
 * Which dimensions this runtime can really write rows for, declared once beside the code that writes
 * them - the declaration `P7-01-06` asks every AI capability to make.
 *
 * `producers` names the files, so the claim can be checked by opening them; it is documentation the
 * reading carries rather than something it infers. It is deliberately *not* what decides the
 * displayed state: the window's rows do. A declaration that went stale (rows of a kind declared
 * absent) would show up as a dimension with rows and `gap: "no-runtime-path"` - visibly wrong, which
 * is how a stale declaration should look rather than being silently preferred over the ledger.
 */
export interface AiMeteredKindDeclaration {
  /** The files that record rows of this dimension; empty when nothing in this runtime can. */
  producers: string[];
  /** Why the dimension has no reading of its own, `''` when it does. */
  gap: AiUsageMeteringGap | "";
}

/** The text-writing call sites are the ones §附录 B-11 §4 lists as `P7-01-04` 的接入点. */
const textRowProducers = [
  "src/lib/article-generation.ts",
  "src/lib/scraper.ts",
  "src/lib/research-extraction/extraction-task.ts",
  "src/lib/agent/langgraph-engine.ts",
  "src/lib/agent/local-tools.ts",
  "src/lib/agent/chat-thread-title.ts",
  "src/app/api/content/[id]/rewrite/route.ts",
  "src/app/api/content/[id]/translate/route.ts",
  "src/app/api/content/mindmap/route.ts",
  "src/app/api/knowledge-base/ai-parse/route.ts",
  "src/app/api/metrics/insights/route.ts",
  "src/app/api/positions/generate/route.ts",
  // A capability probe is a real text call on the user's own key (CI-P7-01-04), so the route that gates
  // and records it belongs in this list - the declaration is documentation beside the writers, and one
  // that went stale would show up as a dimension with rows and no producer.
  "src/app/api/ai/models/probe/route.ts",
];

export const aiMeteredKindProducers: Record<AiUsageMeteredKind, AiMeteredKindDeclaration> = {
  text: { producers: textRowProducers, gap: "" },
  image: { producers: ["src/lib/agent/image-generation.ts"], gap: "" },
  speech: { producers: ["src/lib/transcription/providers.ts"], gap: "" },
  video: { producers: [], gap: "no-runtime-path" },
  // CI-EMB-01: both sides of the knowledge index write `embedding` rows of their own - the query call the
  // semantic recall makes for an article, and the batch task that fills the index - each with its own gate and
  // its own ledger context (`meteredKind: "embedding"`, never the `text` default).
  embedding: {
    producers: ["src/lib/knowledge-embedding/recall.ts", "src/lib/knowledge-embedding/embedding-task.ts"],
    gap: "",
  },
  // Agent / Workflow money is real and *is* metered - as the `text` rows of its node calls
  // (CI-P7-05-02). The `agent` dimension has no rows of its own, so it is explained, not marked missing.
  agent: { producers: [], gap: "metered-through-text" },
};

/**
 * Which non-token dimension's amount was missing, and in which way - or `''` when the units are not
 * the reason at all.
 *
 * The three answers are the three ways `measuredUnitQuantity()` can return `null` for a non-token
 * kind, kept apart because they send a reader to three different places: nothing was written at all,
 * the amount was written under another unit's name (the shape a call site really gets wrong), or the
 * value under the right name is not a usable number.
 *
 * `''` is a real answer too: the dimension's own amount *is* on the row and usable, so a missing figure
 * cannot be blamed on the units. A row written before `CI-P7-05-01` can look exactly like that - an
 * image call carrying `{"image":1}` and stored `unknown` because the token rule asked the wrong
 * question about it - and the caller turns this answer into `not-recorded` rather than naming a cause
 * the row does not support.
 */
function quantityReasonFor(
  kind: AiUsageMeteredKind,
  quantity: Record<string, unknown>,
): AiUsageMeteringReason | "" {
  if (measuredUnitQuantity(kind, quantity) !== null) return "";
  const pricedUnits = aiUsageKindUnits[kind];
  // The dimension's own unit is present, so the key is not the problem - the value is.
  if (pricedUnits.some((unit) => unit in quantity)) return "quantity-unusable";
  return Object.keys(quantity).length > 0 ? "quantity-unit-mismatch" : "quantity-not-recorded";
}

/**
 * Why this row cannot state a figure, or `''` when it did.
 *
 * The branches mirror `computeUsageCost()`'s own four "no" answers (CI-P7-01-05) one for one, plus
 * the two the token rule cannot see:
 *
 * - a price that is missing, written for another dimension, or states no rate -> the three `unpriced`
 *   answers, each named;
 * - a token row with nothing reported, a failed attempt, an interrupted call -> the three `unknown`
 *   answers;
 * - a non-token row whose amount was not usable -> the three quantity answers above.
 *
 * A row whose evidence this vocabulary cannot name (usage reported, a matching price, and yet no
 * figure) is `not-recorded`: something outside this reading wrote that row, and saying why would be a
 * guess. So is every row written before this vocabulary existed - the ledger keeps the evidence, and
 * nothing is backfilled.
 */
export function meteringReasonFor(entry: AiUsageLedgerEntry): AiUsageMeteringReason | "" {
  // A stated figure needs no excuse: `computed` and `provider-reported` are the two sources that carry
  // one (`aiUsageCostSourceIsReal`), and the amount is the statement.
  if (aiUsageCostSourceIsReal(entry.costSource) && entry.costAmount !== null) return "";

  if (entry.outcome === "interrupted" || entry.completeness === "partial") return "call-interrupted";
  if (entry.outcome !== "success") return "attempt-failed";

  if (entry.completeness === "reported") {
    if (!entry.pricing) return "no-price-for-dimension";
    if (entry.pricing.meteredKind !== entry.meteredKind) return "price-kind-mismatch";
    if (!aiUsageKindIsTokenMetered(entry.meteredKind)) {
      if (!entry.pricing.unitLabel || entry.pricing.unitPrice === undefined) return "price-unit-unspecified";
      // The rate is on file and the amount it multiplies is not: the same three quantity answers. This
      // is unreachable through the recorder (it only reports `reported` when the amount *is* a number)
      // and stays here because a row can be written by any caller of the repository.
      return quantityReasonFor(entry.meteredKind, parseLedgerQuantity(entry.quantityJson)) || "not-recorded";
    }
    // A token row with reported usage and a matching price is costed above; reaching here means the
    // row's own fields disagree, which is evidence this reading may not explain away.
    return "not-recorded";
  }

  // Nothing was measured, on a call that succeeded. `|| "not-recorded"` covers the one shape the units
  // cannot explain: a non-token row whose amount *is* usable yet was stored unmeasured (see above).
  if (aiUsageKindIsTokenMetered(entry.meteredKind)) return "usage-not-reported";
  return quantityReasonFor(entry.meteredKind, parseLedgerQuantity(entry.quantityJson)) || "not-recorded";
}

/**
 * 计量覆盖 (CI-P7-05-04): every metered dimension, once, over one window of ledger rows.
 *
 * The list is built from the *vocabulary*, not from the data, so a dimension the window never mentions
 * still appears - with `attempts: 0` and, when this runtime has no path for it, its declared `gap`.
 * That is the whole point of the card: an unmeasurable service must be visible *as* an unmeasurable
 * service, not as a missing entry in a list.
 *
 * The counts are the window's own rows under the vocabulary that already exists: `measured` is the two
 * real sources, and `unpriced` / `unmeasured` keep their own columns rather than being summed into one
 * "unaccounted" figure that would hide which of the two it is.
 */
export function summarizeLedgerMeteringCoverage(input: {
  entries: AiUsageLedgerEntry[];
  /** The dimensions with a price in force right now, from `markInForceModelPrices`. */
  pricedKinds: readonly AiUsageMeteredKind[];
}): AiUsageMeteringCoverage[] {
  const coverageByKind = new Map<AiUsageMeteredKind, AiUsageMeteringCoverage>();
  for (const kind of aiUsageMeteredKinds) {
    coverageByKind.set(kind, {
      kind,
      attempts: 0,
      measuredAttempts: 0,
      unpricedAttempts: 0,
      unmeasuredAttempts: 0,
      reasons: [],
      priced: input.pricedKinds.includes(kind),
      gap: aiMeteredKindProducers[kind].gap,
    });
  }

  const reasonsByKind = new Map<AiUsageMeteredKind, Set<AiUsageMeteringReason>>();
  for (const entry of input.entries) {
    const coverage = coverageByKind.get(entry.meteredKind);
    // A kind outside the vocabulary cannot be *written* (the column is typed and the mapper casts),
    // but a row read back from a hand-edited database must not break a reader that only reports.
    if (!coverage) continue;
    coverage.attempts += 1;
    if (aiUsageCostSourceIsReal(entry.costSource) && entry.costAmount !== null) coverage.measuredAttempts += 1;
    else if (entry.costSource === "unpriced") coverage.unpricedAttempts += 1;
    else coverage.unmeasuredAttempts += 1;

    const reason = meteringReasonFor(entry);
    if (!reason) continue;
    const set = reasonsByKind.get(entry.meteredKind) ?? new Set<AiUsageMeteringReason>();
    set.add(reason);
    reasonsByKind.set(entry.meteredKind, set);
  }

  return aiUsageMeteredKinds.map((kind) => {
    const coverage = coverageByKind.get(kind) as AiUsageMeteringCoverage;
    return { ...coverage, reasons: [...(reasonsByKind.get(kind) ?? [])].sort() };
  });
}
