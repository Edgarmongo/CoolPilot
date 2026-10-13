import { resolveModelPrice } from "@/db/repositories/ai-usage-ledger";
import {
  listAiBudgetReservations,
  readAiBudgetHolds,
  readAiBudgetPeriodState,
  recordAiBudgetDecision,
  reserveAiBudgetHold,
  settleAiBudgetReservation,
  sweepAiBudgetReservations,
} from "@/db/repositories/ai-budget";
import { getAiBudgetSettings } from "@/db/repositories/settings";
import { resolveRoute, type ModelCapability, type ModelRequirement } from "@/features/ai-runtime";
import {
  aiBudgetEnforcement,
  aiBudgetRemaining,
  aiBudgetReservationAmount,
  aiBudgetReservationTtlMs,
  budgetPeriodOf,
  estimateAiCallCost,
  evaluateAiBudget,
  evaluateAiBudgetHeadroom,
  priceBasisFor,
  type AiBudgetDecision,
  type AiBudgetPeriod,
  type AiBudgetSettings,
  type AiBudgetSpend,
  type AiCostEstimate,
  type AiCostEstimateNote,
} from "@/lib/ai-budget";
import { AppError } from "@/lib/app-errors";
import type { AiUsageMeteredKind, AiUsagePricingBasis } from "@/lib/types";

/**
 * The budget gate (CI-P7-03, made real in CI-P7-03-A): the one place a call site asks "may I send
 * this, and what will it cost".
 *
 * Layering, so the pieces stay testable and the frozen surfaces stay untouched:
 *
 *   `@/lib/ai-budget`      the arithmetic and the vocabulary (no IO)
 *   `@/db/repositories`    the stored holds: one atomic admission, one idempotent settlement, the
 *                          decision log and the reconciliation (CI-P7-03-A)
 *   this file              settings + price catalog + route resolution, and the gate's own flow
 *   the call sites         `beginAiBudgetCall(...)` around the model call, nothing else
 *
 * It reads the runtime - `resolveRoute` and `resolveModelPrice` are both public - and never writes to
 * it. No credential, prompt or response body is read, stored or put in a decision: the estimate
 * measures the input's *length* and forgets the text.
 *
 * CI-P7-03-A changed what the gate's word is worth. A hold used to be a `Map` entry in one process,
 * so a worker beside the app (or the app restarted) kept its own and two of them could each pass the
 * same free budget. The hold is a row now, and taking it is **one statement** whose condition and
 * write are evaluated together - so the admission is decided by the database every process shares.
 * What that still does not promise is spelled out on {@link aiBudgetEnforcement} and printed by the
 * budget page; nothing here softens it.
 */

export interface AiBudgetCallRequest {
  /** The ledger `purpose` this call will be recorded under - what the decision is logged against. */
  purpose: string;
  meteredKind?: AiUsageMeteredKind;
  /**
   * The capability the call needs, which is also what the pre-resolved route must provide. Defaults to
   * `chat`; an image call states `image_generation` so the estimate is the price of an *image* model
   * rather than of whatever chat model happens to be first in the provider order (CI-P7-03).
   */
  capability?: ModelCapability;
  /** The model the caller already knows it will use, when it knows. */
  providerId?: string;
  modelId?: string;
  /** The capabilities the call needs, used to pre-resolve the route when no model is named. */
  capabilities?: ModelCapability[];
  /** The input text, measured and dropped. */
  inputText?: string;
  inputTokens?: number;
  /** The reply ceiling the call will send. `null`/absent = nobody stated one. */
  maxOutputTokens?: number | null;
  quantity?: number | null;
  at?: number;
  /**
   * The business identity this call's ledger rows will carry, copied onto the hold (CI-P7-03-A).
   *
   * It is what makes "what did this run / this step hold" answerable from the holds alone, instead of
   * only through the ledger rows that link back to them. Optional, and an absent identity is left
   * absent rather than invented: a call site that declares none holds none.
   */
  identity?: AiBudgetIdentity;
}

/** The business half of a call, as the ledger records it (`AiUsageCallContext` fits this shape). */
export interface AiBudgetIdentity {
  runId?: string;
  nodeId?: string;
  taskId?: string;
  contentItemId?: string;
}

export interface AiBudgetCallTarget {
  providerId: string;
  modelId: string;
  meteredKind: AiUsageMeteredKind;
  /** True when provider and model came from `resolveRoute`, not from the caller. */
  routeResolved: boolean;
}

export interface AiBudgetPreview {
  decision: AiBudgetDecision;
  estimate: AiCostEstimate;
  target: AiBudgetCallTarget;
  period: AiBudgetPeriod;
  /** The ledger `purpose` the call will be recorded under. */
  purpose: string;
}

/** What a release did, so a caller (or a test) never has to guess why nothing changed. */
export interface AiBudgetReleaseResult {
  /** True when this call was the one that gave the hold back. */
  settled: boolean;
  /** True when there was nothing left to give back: a second `finally`, a retry, another process. */
  alreadySettled: boolean;
  /** True when the settlement could not be written; the hold keeps counting until its TTL. */
  failed: boolean;
}

export interface AiBudgetCallHandle {
  /** The verdict this handle was granted for. */
  decision: AiBudgetDecision;
  estimate: AiCostEstimate;
  /**
   * The hold this verdict took, or `null` when it took none - an unknown cost holds nothing, because
   * there is no honest amount to hold.
   *
   * It is what the caller puts on its ledger rows (`budgetReservationId`), which is how "what was
   * held" and "what was spent" are compared later: by an id, not by a guess.
   */
  reservationId: string | null;
  /**
   * Gives the hold back. Call it in a `finally`, whatever happened to the call: the ledger row the
   * call writes is what takes over the accounting once the request is over.
   *
   * It **never throws**. A `finally` that replaced the call's own error with a bookkeeping one would
   * be the worst trade available, so a settlement that could not be written is reported on the result
   * instead - and the hold then keeps counting until its TTL, which is the direction that
   * over-reserves rather than the one that overspends.
   */
  release: () => Promise<AiBudgetReleaseResult>;
}

/**
 * Which process instance took a hold.
 *
 * It is recorded on the row and deliberately used for **nothing else**: a restart cannot know whether
 * another process is dead, so recovery is the TTL and the shared row rather than a guess about
 * liveness. The id exists so a human reading the log can tell "the worker took this" from "the app
 * took this".
 */
const budgetGuardOwner = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The process instance taking holds right now. Stable for the life of the process. */
export function aiBudgetGuardOwnerId() {
  return budgetGuardOwner;
}

/**
 * Gives a hold back, by its id, from anywhere - including a process that did not take it.
 *
 * Idempotent by construction: the row is only changed while it is `held`, so a second caller (a
 * `finally` that ran twice, a retried request, another process) is told `settled: false` instead of
 * changing anything.
 */
export async function releaseAiBudgetReservation(id: string) {
  return settleAiBudgetReservation({ id, at: Date.now(), kind: "released" });
}

/**
 * What the **live** holds add up to for one period and currency - every process, not this one.
 *
 * `at` decides which holds count: the ones whose TTL already passed are out, whether or not a sweep
 * has marked them yet, so an abandoned hold can never outlive its TTL even if nothing reaps it.
 */
export async function reservedAiBudgetAmount(periodKey: string, currency: string, at = Date.now()) {
  const { amount } = await readAiBudgetHolds({ periodKey, currency, at });
  return amount;
}

/** Appends notes without repeating one, and leaves the estimate untouched when there is nothing to add. */
function withEstimateNotes(estimate: AiCostEstimate, notes: AiCostEstimateNote[]): AiCostEstimate {
  if (notes.length === 0) return estimate;
  return { ...estimate, notes: [...new Set([...estimate.notes, ...notes])] };
}

/**
 * Routes and prices one call without sending anything.
 *
 * When the caller already knows its model (the runtime resolved it a moment ago) that pair is priced.
 * When it does not - the agent node picks its model later - the route is resolved here with the same
 * public `resolveRoute` the runtime uses, and the answer is marked `route-may-differ`: the runtime may
 * still fall back to another model, so this is the price of the *likely* model, not a promise.
 */
async function resolveCallTarget(request: AiBudgetCallRequest, meteredKind: AiUsageMeteredKind, at: number) {
  let providerId = request.providerId?.trim() ?? "";
  let modelId = request.modelId?.trim() ?? "";
  const named = Boolean(providerId && modelId);
  let routeResolved = false;

  if (!named) {
    const capability = request.capability ?? "chat";
    const requirement: ModelRequirement = { capabilities: request.capabilities ?? [capability], capability };
    const resolution = await resolveRoute(requirement);
    if (!providerId) providerId = resolution.candidate?.provider.providerId ?? "";
    if (!modelId) modelId = resolution.candidate?.model.modelId ?? "";
    routeResolved = Boolean(resolution.candidate);
  }

  const price = providerId ? await resolveModelPrice(providerId, modelId, at, meteredKind) : null;
  const target: AiBudgetCallTarget = { providerId, modelId, meteredKind, routeResolved };
  const pricing: AiUsagePricingBasis | null = price ? priceBasisFor(price) : null;
  return { target, pricing, named };
}

/**
 * The period's spending and the holds **every process** is holding, in one read.
 *
 * One reader for both, on purpose. CI-P7-03 could reach the same subtraction two ways (a capped row
 * read for a decision, a sum for the page); this card removed that difference, so the number a
 * refusal was based on and the number on screen cannot come from differently-capped reads. `spent` is
 * the database's own aggregate, which also means a month cannot be reported as a floor merely because
 * it grew past a row ceiling.
 */
async function readBudgetState(period: AiBudgetPeriod, currency: string, at: number) {
  return readAiBudgetPeriodState({
    periodKey: period.key,
    periodStart: period.start,
    periodEnd: period.end,
    currency,
    at,
  });
}

/**
 * What one not-yet-sent call is expected to cost and whether the budget lets it through. **Read-only**:
 * it takes no hold, so a page (or the estimate endpoint) can ask without consuming budget.
 */
export async function previewAiBudgetCall(request: AiBudgetCallRequest): Promise<AiBudgetPreview> {
  const at = request.at ?? Date.now();
  const period = budgetPeriodOf(at);
  const settings = await getAiBudgetSettings();
  const meteredKind = request.meteredKind ?? "text";
  const { target, pricing, named } = await resolveCallTarget(request, meteredKind, at);

  const routeNotes: AiCostEstimateNote[] = target.routeResolved
    ? ["route-may-differ"]
    : named
      ? []
      : ["route-unresolved"];
  let estimate = estimateAiCallCost({
    pricing,
    meteredKind,
    inputText: request.inputText,
    inputTokens: request.inputTokens,
    maxOutputTokens: request.maxOutputTokens ?? null,
    quantity: request.quantity ?? null,
    notes: routeNotes,
  });

  // The period's spending and the holds of **every** process, in one read (CI-P7-03-A). It is
  // read-only and it reaps nothing: a page or the estimate endpoint can ask without consuming - or
  // writing - anything, and the holds whose TTL passed are already excluded by the read itself.
  const state = await readBudgetState(period, settings.currency, at);
  const spent = state.spent;
  const spendNotes: AiCostEstimateNote[] = [];
  if (!spent.isComplete) spendNotes.push("spend-incomplete");
  if (spent.truncated) spendNotes.push("spend-truncated");
  if (estimate.kind === "estimate" && estimate.currency !== settings.currency) spendNotes.push("currency-mismatch");
  estimate = withEstimateNotes(estimate, spendNotes);

  const decision = evaluateAiBudget({
    settings,
    period,
    spent,
    reserved: state.reserved,
    estimate,
  });
  return { decision, estimate, target, period, purpose: request.purpose };
}

/**
 * The refusal, with the arithmetic that produced it attached. Nothing here is a credential or a prompt
 * - only counts, amounts and reason codes the page translates.
 */
export function aiBudgetBlockedError(preview: AiBudgetPreview) {
  return aiBudgetRefusalError(preview.decision, aiBudgetDecisionDetails(preview));
}

/**
 * One refusal, one code, one wording - whichever gate produced it. Both gates answer
 * `AI_BUDGET_EXCEEDED` with a 402 and the same arithmetic attached, so a call site that handles
 * `isAiBudgetRefusal` handles both without knowing which one spoke.
 */
function aiBudgetRefusalError(decision: AiBudgetDecision, details: Record<string, unknown>) {
  const reason = decision.reasons[0] ?? "over-limit";
  const limit = decision.limit === null ? "" : `Limit ${decision.limit} ${decision.currency} for ${decision.period.key}`;
  const spent = `spent ${decision.spent.amount}${decision.spent.isComplete ? "" : " (a floor, not a total)"}`;
  const held = decision.reserved > 0 ? `, ${decision.reserved} held by calls in flight` : "";
  return new AppError("AI_BUDGET_EXCEEDED", {
    status: 402,
    message: [
      `The AI budget refused this call before it was sent (${reason}).`,
      [limit, spent + held].filter(Boolean).join(", ") + ".",
    ].join(" "),
    details,
  });
}

/**
 * True when an error is this gate's own refusal - the one answer a call site has to handle differently
 * from every other failure, because a refused call was never sent: no request to the provider, so no
 * ledger row and no "provider failed" wording anywhere in the answer.
 *
 * Defined here so the three call sites and `tryAiBudgetCall` cannot drift into three spellings of the
 * same check.
 */
export function isAiBudgetRefusal(error: unknown): error is AppError {
  return error instanceof AppError && error.code === "AI_BUDGET_EXCEEDED";
}

/**
 * The gate at a *step* boundary (CI-P7-03's run/node gate): a playbook is about to start a step whose
 * request is not written yet, so there is nothing to estimate and the only honest question is whether
 * this period still has budget at all.
 *
 * It takes no hold - the calls inside the step take their own - and reads nothing but settings, the
 * period's own ledger rows and the holds **every process** is holding (CI-P7-03-A). A refusal is the
 * very same `AI_BUDGET_EXCEEDED`/402 the call gate throws, so the worker's `catch` reports it the way
 * it reports any other refused step; `warn` passes and the reason travels on the returned decision.
 *
 * The verdict is stored (CI-P7-03-A) even though nothing was held: "this run stopped because the
 * budget said no" has to outlive the response that reported it.
 */
export async function beginAiBudgetNode(request: {
  purpose: string;
  at?: number;
  identity?: AiBudgetIdentity;
}): Promise<AiBudgetDecision> {
  const at = request.at ?? Date.now();
  const period = budgetPeriodOf(at);
  const settings = await getAiBudgetSettings();
  const state = await readBudgetState(period, settings.currency, at);
  const decision = evaluateAiBudgetHeadroom({
    settings,
    period,
    spent: state.spent,
    reserved: state.reserved,
  });
  // The step gate prices nothing, so the stored decision names no model - `null`, rather than a
  // target invented to fill the field.
  const stored = { decision, target: null as AiBudgetCallTarget | null };
  await persistBudgetDecision({
    gate: "node",
    at,
    preview: stored,
    purpose: request.purpose,
    identity: request.identity,
    reservation: null,
  });
  if (decision.status === "blocked") {
    // The step gate routes nothing, so there is no target to name - and `aiBudgetDecisionDetails`
    // takes `null` for exactly this case rather than a made-up model.
    throw aiBudgetRefusalError(
      decision,
      aiBudgetDecisionDetails({ decision, estimate: decision.estimate, target: null, purpose: request.purpose }),
    );
  }
  return decision;
}

/**
 * The decision as a plain, log-safe object: no prompt, no response, no credential.
 *
 * `target` is `null` for the step gate, which routes nothing (no call is being made yet) - the field is
 * kept rather than dropped so one decision always has one shape.
 */
export function aiBudgetDecisionDetails(preview: {
  decision: AiBudgetDecision;
  estimate: AiCostEstimate;
  target: AiBudgetCallTarget | null;
  purpose: string;
}) {
  const { decision, estimate, target, purpose } = preview;
  return {
    purpose,
    status: decision.status,
    reasons: decision.reasons,
    policy: decision.policy,
    unknownCostPolicy: decision.unknownCostPolicy,
    strategy: decision.strategy,
    enforcement: decision.enforcement,
    period: decision.period,
    currency: decision.currency,
    limit: decision.limit,
    spentAmount: decision.spent.amount,
    spentIsComplete: decision.spent.isComplete,
    spentTruncated: decision.spent.truncated,
    reserved: decision.reserved,
    remaining: decision.remaining,
    projectedMin: decision.projectedMin,
    projectedMax: decision.projectedMax,
    certainty: decision.certainty,
    estimateKind: estimate.kind,
    estimateMethod: estimate.method,
    estimateNotes: estimate.notes,
    estimateAmountMin: estimate.kind === "estimate" ? estimate.amountMin : null,
    estimateAmountMax: estimate.kind === "estimate" ? estimate.amountMax : null,
    target,
  };
}

/**
 * The gate a call site uses: it refuses (by throwing) before anything is sent, and on a pass it hands
 * back a handle whose `release()` gives the hold back.
 *
 * The admission is **one statement in the database** (CI-P7-03-A), not a `Map` write: it compares this
 * call's ceiling with the period's spending *and* every live hold - this process's and every other
 * process's - while it holds the write lock. "Two overlapping checks cannot both pass" is therefore a
 * property of the store rather than of one process, which is exactly what the in-memory version could
 * never say.
 *
 * The sequence is: decide (pure arithmetic, read-only) → refuse if the arithmetic says no → take the
 * hold (the database has the last word) → refuse if it did not grant it. A refused hold is reported in
 * the same 402 shape as an arithmetic refusal, with `hold-lost-to-concurrent-call` naming the single
 * difference between them: the estimate said yes, and the room was gone by the time it was taken.
 */
export async function beginAiBudgetCall(request: AiBudgetCallRequest): Promise<AiBudgetCallHandle> {
  const at = request.at ?? Date.now();
  const preview = await previewAiBudgetCall({ ...request, at });
  if (preview.decision.status === "blocked") {
    await persistBudgetDecision({
      gate: "call",
      at,
      preview,
      purpose: request.purpose,
      identity: request.identity,
      reservation: null,
    });
    throw aiBudgetBlockedError(preview);
  }

  // A call whose cost cannot be stated holds nothing: there is no honest figure to hold, and holding a
  // made-up one would be the "unknown written as 0" mistake with a different sign. `estimateCounted`
  // is false for exactly those calls - an unpriced model, an unstated reply ceiling, another currency -
  // so no row is written, and "calls holding budget" can never name a hold that does not exist.
  const amount = preview.decision.estimateCounted ? aiBudgetReservationAmount(preview.estimate) : 0;
  if (amount <= 0) {
    await persistBudgetDecision({
      gate: "call",
      at,
      preview,
      purpose: request.purpose,
      identity: request.identity,
      reservation: null,
    });
    return budgetCallHandle(preview, null);
  }

  // Reap first: the holds a dead process left behind already stopped counting (every read filters on
  // `expires_at`), and marking them is what keeps the audit honest. This is the one moment guaranteed
  // to run before a hold is written here.
  await sweepAiBudgetReservations(at);

  const hold = await reserveAiBudgetHold({
    periodKey: preview.decision.period.key,
    periodStart: preview.decision.period.start,
    periodEnd: preview.decision.period.end,
    currency: preview.decision.currency,
    amount,
    // Only `block` may refuse. Under `warn` a refusal is impossible by definition, so the hold is
    // taken unconditionally - the figure the page shows still has to be true.
    enforce: preview.decision.policy === "block",
    // The statement's own comparison is only reached under `enforce`; a limit of 0 is never used then
    // because `limit === null` means no ceiling at all and no hold is taken in that case.
    limit: preview.decision.limit ?? 0,
    policy: preview.decision.policy,
    estimateKind: preview.estimate.kind,
    estimateMethod: preview.estimate.method,
    purpose: request.purpose,
    meteredKind: preview.target.meteredKind,
    providerId: preview.target.providerId,
    modelId: preview.target.modelId,
    routeResolved: preview.target.routeResolved,
    runId: request.identity?.runId,
    nodeId: request.identity?.nodeId,
    taskId: request.identity?.taskId,
    contentItemId: request.identity?.contentItemId,
    owner: budgetGuardOwner,
    at,
    expiresAt: at + aiBudgetReservationTtlMs,
  });
  if (hold.granted && hold.reservation) {
    await persistBudgetDecision({
      gate: "call",
      at,
      preview,
      purpose: request.purpose,
      identity: request.identity,
      reservation: { id: hold.reservation.id, amount: hold.reservation.amount, currency: hold.reservation.currency },
    });
    return budgetCallHandle(preview, hold.reservation.id);
  }

  // The estimate said yes and the hold did not: another call - in this process or in another one -
  // took the room between the two. The state is read again so the refusal reports what is true *now*,
  // and the added reason says why this differs from the preview instead of pretending the arithmetic
  // had always said no.
  const fresh = await previewAiBudgetCall({ ...request, at });
  const lost: AiBudgetPreview = {
    ...fresh,
    decision: {
      ...fresh.decision,
      status: "blocked",
      reasons: ["hold-lost-to-concurrent-call", ...fresh.decision.reasons],
    },
  };
  await persistBudgetDecision({
    gate: "call",
    at,
    preview: lost,
    purpose: request.purpose,
    identity: request.identity,
    reservation: null,
  });
  throw aiBudgetBlockedError(lost);
}

/**
 * The handle a call site gets: the verdict, the estimate, and the hold's id for its ledger rows.
 *
 * `release` settles that one hold, at most once - the row is only changed while it is `held`, so a
 * second `finally`, a retried request or another process is told `settled: false` rather than
 * changing anything.
 */
function budgetCallHandle(preview: AiBudgetPreview, reservationId: string | null): AiBudgetCallHandle {
  return {
    decision: preview.decision,
    estimate: preview.estimate,
    reservationId,
    release: () => settleBudgetHold(reservationId),
  };
}

/**
 * Gives one hold back, and **never throws**.
 *
 * A `finally` that replaced the call's own error with a bookkeeping one would be the worst trade
 * available, so a failure here is reported on the result and logged - the hold then keeps counting
 * until its TTL, which over-reserves rather than overspends, and the reconciliation shows it as
 * `expired-with-ledger` if the call really did run.
 */
async function settleBudgetHold(reservationId: string | null): Promise<AiBudgetReleaseResult> {
  if (!reservationId) {
    // Nothing was held, so there is nothing to give back - and saying "already settled" would imply a
    // hold existed and was settled by somebody else.
    return { settled: false, alreadySettled: false, failed: false };
  }
  try {
    const result = await settleAiBudgetReservation({ id: reservationId, at: Date.now(), kind: "released" });
    return { settled: result.settled, alreadySettled: !result.settled, failed: false };
  } catch (error) {
    console.warn("[ai-budget] the hold could not be released:", error instanceof Error ? error.message : error);
    return { settled: false, alreadySettled: false, failed: true };
  }
}

/**
 * Writes the decision, and **never lets that write decide anything**.
 *
 * The hold governs the budget; this row records why. So a failure here is logged and swallowed: taking
 * a user's call down because an audit insert failed would be the tail wagging the dog. Nothing that
 * follows depends on it - a refusal is still thrown, a granted call still runs.
 */
async function persistBudgetDecision(input: {
  gate: "call" | "node";
  at: number;
  /** The verdict to store. `AiBudgetPreview` satisfies this, and so does the step gate's own shape. */
  preview: { decision: AiBudgetDecision; target: AiBudgetCallTarget | null };
  purpose: string;
  identity?: AiBudgetIdentity;
  reservation: { id: string; amount: number; currency: string } | null;
}) {
  try {
    await recordAiBudgetDecision({
      gate: input.gate,
      at: input.at,
      decision: input.preview.decision,
      purpose: input.purpose,
      runId: input.identity?.runId,
      nodeId: input.identity?.nodeId,
      taskId: input.identity?.taskId,
      contentItemId: input.identity?.contentItemId,
      target: input.preview.target,
      reservation: input.reservation,
    });
  } catch (error) {
    console.warn(
      "[ai-budget] the decision could not be recorded:",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Bracket one model call with the budget gate, for a call site that would rather report "the run
 * stopped because of the budget" than fail the whole request.
 *
 * The hold is given back in a `finally` whatever the call does: the ledger row the runtime writes is
 * what accounts for the money once the request is over, and a hold that outlived it would count the
 * same money twice.
 */
export async function tryAiBudgetCall<T>(
  request: AiBudgetCallRequest,
  run: (handle: AiBudgetCallHandle) => Promise<T>,
): Promise<{ ok: true; value: T; handle: AiBudgetCallHandle } | { ok: false; error: AppError }> {
  let handle: AiBudgetCallHandle;
  try {
    handle = await beginAiBudgetCall(request);
  } catch (error) {
    if (isAiBudgetRefusal(error)) return { ok: false, error };
    throw error;
  }
  try {
    return { ok: true, value: await run(handle), handle };
  } finally {
    // Settled, not forgotten: the hold is a row now, so a process that dies before this runs leaves it
    // to its TTL rather than leaving the budget wrong for ever.
    await handle.release();
  }
}

/**
 * The holds that are live right now, in **every** process - for the budget page and for tests, never
 * for a decision.
 *
 * The predicate is the one every read uses (`expires_at > at`): a hold whose TTL passed is not listed
 * even if nothing has marked its row yet, so this can never report budget as held that no reader is
 * holding.
 */
export async function inFlightAiBudgetReservations(at = Date.now()) {
  const held = await listAiBudgetReservations({ status: "held", limit: 5000 });
  return held.filter((reservation) => reservation.expiresAt > at);
}

export interface AiBudgetStatus {
  settings: AiBudgetSettings;
  enforcement: typeof aiBudgetEnforcement;
  period: AiBudgetPeriod;
  /** The period's own spending, in the currency the limit is quoted in. */
  spent: AiBudgetSpend;
  /** What the live holds add up to - every process's, not only this one's (CI-P7-03-A). */
  reserved: number;
  /** How many holds are live in this period right now, in every process. */
  inFlightCount: number;
  /** `limit - spent - reserved`, or `null` when no limit is stated. Negative means already over. */
  remaining: number | null;
}

/**
 * The budget as it stands right now, for the 预算与预估 tab. Read-only, and it takes no hold, so
 * opening the page never consumes anything.
 *
 * `spent` is the month's ledger rows in the limit's currency - a floor when a row states no figure,
 * which the payload says rather than hides. The wording of `enforcement` ships with the answer so the
 * page cannot describe a softer guarantee than the code gives.
 */
export async function getAiBudgetStatus(at = Date.now()): Promise<AiBudgetStatus> {
  const settings = await getAiBudgetSettings();
  const period = budgetPeriodOf(at);
  // One read for the spending and the holds, from the database every process shares, so the figure on
  // this page and the figure a refusal was based on cannot come from two differently-capped reads.
  const state = await readBudgetState(period, settings.currency, at);
  return {
    settings,
    enforcement: aiBudgetEnforcement,
    period,
    spent: state.spent,
    reserved: state.reserved,
    inFlightCount: state.heldCount,
    // The same subtraction a decision uses, so the page and the gate never disagree about it.
    remaining: aiBudgetRemaining(settings.monthlyLimit, state.spent.amount, state.reserved),
  };
}
