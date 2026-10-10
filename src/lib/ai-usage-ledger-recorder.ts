import { createAiUsageLedgerEntry, resolveModelPrice } from "@/db/repositories/ai-usage-ledger";
import type { ModelAttempt } from "@/features/ai-runtime/contracts";
import { modelAttemptsFrom } from "@/features/ai-runtime/trail";
import type {
  AiUsageLedgerEntry,
  AiUsageMeteredKind,
  AiUsageOutcome,
  AiUsagePricingBasis,
} from "@/lib/types";
import {
  computeUsageCost,
  normalizeUsageTokens,
  pricingBasisFromRow,
  usageCompleteness,
} from "./ai-usage-ledger";

/**
 * Writes the AI usage ledger (CI-P7-01-04).
 *
 * This is the single place a business call turns into ledger rows, so the rules the pure module
 * decided are applied once instead of at each call site. The unit of account is **one request**,
 * which is the runtime's own `ModelAttempt`: a call hands over the trail the runtime reported
 * (`ChatResponse.attempts`) and gets back one row per entry, in the same order.
 *
 * That single decision is what makes the ledger's hardest questions answerable:
 *
 * - **A retry is not free.** The attempts a call made before it succeeded - a rotated key, a failed
 *   model - are rows of their own, so the call's real shape is stored instead of living in memory
 *   for the length of one function call.
 * - **A self-correction is a second charge.** A structured call that re-asked reports two
 *   successful requests; the merged usage the response shows for display cannot say that, and a
 *   ledger that stored the merged figure would under-report the bill by half.
 * - **A failure is not zero.** A failed attempt carries no usage, so it is written `unknown` with a
 *   NULL cost - never a `0` a total would silently swallow. An unpriced model is the same kind of
 *   honest blank: `unpriced`, NULL, and counted in the summary's caveat.
 * - **The price is frozen onto the row** at write time, so editing the catalog later cannot restate
 *   what the call cost.
 *
 * Bookkeeping must not take the user's work down with it: a write that fails is swallowed, and the
 * result says so (`failed: true`) instead of pretending the call never happened. The two failures
 * are deliberately kept apart - a call that failed *and* a ledger that failed are different
 * statements about the same request, and only the caller can report the second one.
 */

/** The business half of a ledger row: which task in the product this call belonged to. */
export interface AiUsageCallContext {
  /** `article` / `knowledge` / `profile` / `extraction` / `agent` / `chat-title` … */
  purpose: string;
  taskId?: string;
  runId?: string;
  nodeId?: string;
  outputAssetId?: string;
  contentItemId?: string;
  meteredKind?: AiUsageMeteredKind;
  /** Modality-specific units, for the kinds that are not token-metered. */
  quantity?: Record<string, unknown>;
  /**
   * The budget hold this call was admitted under (CI-P7-03-A), when the gate took one.
   *
   * It travels from the gate's handle onto every row of the call, which is what lets the holds and the
   * ledger be *joined* later instead of correlated by purpose and timestamp. Absent means "not gated",
   * which is the truth for a call the gate held nothing for.
   */
  budgetReservationId?: string;
  /** When the call started; the ledger's `created_at` and the price snapshot's clock. */
  startedAt?: number;
}

export interface RecordAiUsageCallInput extends AiUsageCallContext {
  /**
   * Every request the call sent, in the order it sent them - the runtime's own trail, passed on as
   * it arrived (`ChatResponse.attempts`, `StructuredChatResponse.attempts`,
   * `ImageGenerationResponse.attempts`). An empty trail is a real answer too: nothing was sent, so
   * there is nothing to account for.
   */
  attempts: ModelAttempt[];
}

/**
 * What the ledger did with a call.
 *
 * `reported` and `rows.length` differ only when something went wrong, and the two ways that happens
 * are worth telling apart: `failed` means the write threw (the requests happened, the ledger missed
 * them), while `rows.length < reported` without `failed` means a row could not be read back after
 * it was inserted. A caller that ignores this loses the distinction; one that reads it can stay
 * honest instead of claiming the ledger covers everything.
 */
export interface AiUsageLedgerWrite {
  /** The rows stored, oldest request first. */
  rows: AiUsageLedgerEntry[];
  /** How many requests the call reported. */
  reported: number;
  /** True when the write threw. The call is not in the ledger. */
  failed: boolean;
}

/**
 * The price to cost one provider+model+dimension with, cached for the length of a call: a trail
 * that crossed the same model three times must not read the catalog three times, and a trail that
 * crossed two models must not cost the second one with the first one's price.
 *
 * The dimension is part of the cache key as well as of the lookup (CI-P7-01-05): a text price and
 * an image price for the same model are two different answers, and caching them under one key would
 * hand whichever was read first to both.
 */
async function pricingFor(
  cache: Map<string, AiUsagePricingBasis | null>,
  providerId: string,
  modelId: string,
  at: number,
  meteredKind: AiUsageMeteredKind,
) {
  const key = `${providerId}::${modelId}::${meteredKind}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  // The catalog answers `null` when it has nothing to say, and that null is what makes this row
  // `unpriced` - the state that says "this call happened and we cannot state its cost".
  const row = await resolveModelPrice(providerId, modelId, at, meteredKind);
  const pricing = row ? pricingBasisFromRow(row) : null;
  cache.set(key, pricing);
  return pricing;
}

/** The row one request becomes. Everything here comes from that request; nothing is inferred. */
async function writeAttemptRow(input: {
  context: AiUsageCallContext;
  attempt: ModelAttempt;
  attemptIndex: number;
  parentUsageId: string;
  createdAt: number;
  pricingCache: Map<string, AiUsagePricingBasis | null>;
}) {
  const { attempt } = input;
  // An attempt that reports an error did not succeed, whatever else the trail says: the repository
  // defaults an absent outcome to `success`, and a failure recorded as a success is the one lie
  // this table exists to prevent.
  const outcome: AiUsageOutcome = attempt.error ? "failed" : attempt.outcome;
  const usage = attempt.usage ?? undefined;
  const completeness = usageCompleteness(outcome, usage);
  const tokens = normalizeUsageTokens(usage);
  const meteredKind = input.context.meteredKind ?? "text";
  // A row that may not state a cost is not worth a catalog read: the lookup would only be spent on
  // an answer `computeUsageCost` is required to ignore.
  const pricing =
    completeness === "reported"
      ? await pricingFor(input.pricingCache, attempt.providerId, attempt.modelId, input.createdAt, meteredKind)
      : null;
  const cost = computeUsageCost(tokens, completeness, pricing, {
    kind: meteredKind,
    quantity: input.context.quantity,
  });

  return createAiUsageLedgerEntry({
    purpose: input.context.purpose,
    outcome,
    providerId: attempt.providerId,
    modelId: attempt.modelId,
    endpointId: attempt.endpointId,
    credentialLabel: attempt.credentialLabel,
    // The position in the trail, which is what makes the order of a call readable afterwards.
    attemptIndex: input.attemptIndex,
    taskId: input.context.taskId,
    runId: input.context.runId,
    nodeId: input.context.nodeId,
    // CI-P7-03-A: the hold this call was admitted under, carried onto every row of the call. It is the
    // link the reconciliation joins on, so "what was held" and "what was spent" are compared by id.
    budgetReservationId: input.context.budgetReservationId,
    // The attempt immediately before this one in the same call: the chain that says "these rows are
    // one call", including a self-correction, whose predecessor succeeded but was unusable.
    parentUsageId: input.parentUsageId,
    outputAssetId: input.context.outputAssetId,
    contentItemId: input.context.contentItemId,
    meteredKind,
    tokens,
    completeness,
    quantity: input.context.quantity,
    costAmount: cost.costAmount,
    costCurrency: cost.costCurrency,
    costSource: cost.costSource,
    pricing,
    // Not measured yet: the runtime does not time individual requests, and 0 is this column's
    // "not measured" rather than a claim that the request was instant.
    durationMs: 0,
    errorSummary: attempt.error,
    createdAt: input.createdAt,
  });
}

/**
 * Records one business AI call: one ledger row per request it sent, in the order it sent them.
 *
 * The result says what the ledger did, including when it did nothing. An empty `attempts` array (the
 * runtime never reached a provider, so no request was sent) and a swallowed write failure are both
 * reported rather than collapsed into "no rows".
 */
export async function recordAiUsageCall(input: RecordAiUsageCallInput): Promise<AiUsageLedgerWrite> {
  // A mocked runtime, or a response from before this card, can hand over no trail at all. That is
  // "nothing to record", not a reason for a bookkeeping helper to throw - so the shape is checked
  // here and everything else stays inside the `try`.
  const attempts = Array.isArray(input.attempts) ? input.attempts : [];
  const reported = attempts.length;
  const rows: AiUsageLedgerEntry[] = [];
  try {
    const createdAt = input.startedAt ?? Date.now();
    const pricingCache = new Map<string, AiUsagePricingBasis | null>();
    let parentUsageId = "";

    for (let index = 0; index < reported; index += 1) {
      const row = await writeAttemptRow({
        context: input,
        attempt: attempts[index],
        attemptIndex: index,
        parentUsageId,
        createdAt,
        pricingCache,
      });
      // A row that could not be read back is missing from `rows` but was inserted, so it is still
      // counted by `reported`: that difference is the caller's signal, not a silent loss.
      if (row) {
        rows.push(row);
        parentUsageId = row.id;
      }
    }
  } catch {
    // Deliberately swallowed: the ledger observes the work, it does not own it. The caller is told
    // through `failed` instead of an exception it would have to remember to catch.
    return { rows, reported, failed: true };
  }
  return { rows, reported, failed: false };
}

/**
 * Records a call that threw.
 *
 * The requests it made travel on the error (`attachModelAttempts` in the runtime), so a failure is
 * recorded from the same trail a success is - which is what makes "the call failed and the provider
 * may still have billed for it" visible instead of invisible. An error that carries no trail means
 * no request was sent (nothing was configured), and writes no row at all: that is the honest
 * answer, not a gap in the ledger.
 *
 * Nothing here changes how the caller reports the failure: this never throws, so the catch block
 * it sits in keeps its own error handling.
 */
export async function recordAiUsageFailure(
  context: AiUsageCallContext,
  error: unknown,
): Promise<AiUsageLedgerWrite> {
  return recordAiUsageCall({ ...context, attempts: modelAttemptsFrom(error) });
}
