import { describe, expect, it } from "vitest";
import type { AppError } from "@/lib/app-errors";

/**
 * CI-P7-03: the gate itself - the user's settings, the price catalog, the month's ledger, and the
 * in-process holds. The pure arithmetic is pinned in `./ai-budget.test.ts`; what only this file can
 * check is the part that touches the database and the process:
 *
 *  - a hold is the call's **ceiling**, it is released exactly once, and it counts against the next call
 *    (this is the overlap the card asked to settle before shipping);
 *  - a refusal is a refusal *before* anything was sent, so it writes no ledger row and takes no hold -
 *    the two mistakes that would turn "we did not spend" into "we spent something";
 *  - a call nothing can price holds **nothing**, and is refused only when the user asked for that;
 *  - the figures the status page reads are the same subtraction the decision was based on.
 *
 * The harness pins the temp database before anything that reads it loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
await import("@/test/route-harness");

const {
  beginAiBudgetCall,
  beginAiBudgetNode,
  getAiBudgetStatus,
  inFlightAiBudgetReservations,
  isAiBudgetRefusal,
  previewAiBudgetCall,
  reservedAiBudgetAmount,
} = await import("@/lib/ai-budget-guard");
const { roundAmount } = await import("@/lib/ai-budget");
const { updateAiBudgetSettings } = await import("@/db/repositories/settings");
const { createAiModelPrice, createAiUsageLedgerEntry, listAiUsageLedgerEntries } = await import(
  "@/db/repositories/ai-usage-ledger"
);

/**
 * One CNY per token, in and out: `perMillion` is the rate per *million* tokens, so 1_000_000 prices a
 * token at 1 and every amount in this file reads as the token count it came from.
 */
const pricePerToken = 1_000_000;
const priceSince = 1_700_000_000_000;

async function pricedModel(providerId: string, modelId: string) {
  await createAiModelPrice({
    providerId,
    modelId,
    currency: "CNY",
    inputPerMillion: pricePerToken,
    outputPerMillion: pricePerToken,
    priceVersion: "2026-10",
    effectiveFrom: priceSince,
  });
}

/** The month's spending as the gate reads it, so a limit can be stated relative to what is already there. */
async function spentNow() {
  return (await getAiBudgetStatus()).spent.amount;
}

const holdCount = async () => (await inFlightAiBudgetReservations()).length;

/** Runs the gate without letting its refusal fail the test that wants to look at it. */
const refusalFrom = (promise: Promise<unknown>) => promise.catch((error: unknown) => error);

describe("the CI-P7-03 budget gate", () => {
  it("holds a call's ceiling and gives it back, once, on release", async () => {
    await pricedModel("guard-hold", "m");
    await updateAiBudgetSettings({
      policy: "warn",
      monthlyLimit: (await spentNow()) + 1_000,
      currency: "CNY",
      unknownCostPolicy: "allow",
    });
    const holdsBefore = await holdCount();

    const handle = await beginAiBudgetCall({
      purpose: "guard-hold",
      providerId: "guard-hold",
      modelId: "m",
      inputTokens: 3,
      maxOutputTokens: 2,
    });

    expect(handle.decision.status).toBe("allowed");
    expect(handle.estimate).toMatchObject({ kind: "estimate", amountMin: 3, amountMax: 5 });
    // The hold is the **ceiling**: an upper bound on what this call may spend, not its likely figure.
    expect(await reservedAiBudgetAmount(handle.decision.period.key, "CNY")).toBe(5);
    expect(await holdCount()).toBe(holdsBefore + 1);

    await handle.release();
    expect(await reservedAiBudgetAmount(handle.decision.period.key, "CNY")).toBe(0);
    expect(await holdCount()).toBe(holdsBefore);

    // A `finally` can run twice; the second call must not give somebody else's hold back.
    await handle.release();
    expect(await holdCount()).toBe(holdsBefore);
  });

  it("refuses the next call because of a hold still in flight, and lets the same call through once it is released", async () => {
    await pricedModel("guard-atomic", "m");
    // Five tokens of headroom in the month, and the first call holds two of them.
    await updateAiBudgetSettings({
      policy: "block",
      monthlyLimit: (await spentNow()) + 5,
      currency: "CNY",
      unknownCostPolicy: "allow",
    });
    const holdsBefore = await holdCount();

    const first = await beginAiBudgetCall({
      purpose: "guard-atomic",
      providerId: "guard-atomic",
      modelId: "m",
      inputTokens: 1,
      maxOutputTokens: 1,
    });
    expect(first.estimate).toMatchObject({ amountMin: 1, amountMax: 2 });

    // The second call's ceiling cannot fit in the five with two already held: 3..5 tokens on top of a
    // hold of 2 is 5..7 against 5 remaining.
    const refused = await refusalFrom(
      beginAiBudgetCall({
        purpose: "guard-atomic",
        providerId: "guard-atomic",
        modelId: "m",
        inputTokens: 3,
        maxOutputTokens: 2,
      }),
    );
    expect(isAiBudgetRefusal(refused)).toBe(true);
    expect((refused as AppError).status).toBe(402);
    // The refusal names the hold, so a user can see why two small calls did not both fit.
    expect((refused as AppError).message).toContain("held by calls in flight");
    // A refused call takes no hold of its own.
    expect(await holdCount()).toBe(holdsBefore + 1);

    await first.release();
    // The very same call now fits: what refused it was the hold, not the month's spending.
    const second = await beginAiBudgetCall({
      purpose: "guard-atomic",
      providerId: "guard-atomic",
      modelId: "m",
      inputTokens: 3,
      maxOutputTokens: 2,
    });
    expect(second.decision.status).toBe("allowed");
    await second.release();
    expect(await holdCount()).toBe(holdsBefore);
  });

  it("writes nothing at all when it refuses, because nothing was sent", async () => {
    await pricedModel("guard-refuse", "m");
    await updateAiBudgetSettings({ policy: "block", monthlyLimit: 0.5, currency: "CNY", unknownCostPolicy: "allow" });
    const holdsBefore = await holdCount();
    const rowsBefore = (await listAiUsageLedgerEntries({ limit: 5000 })).length;

    const refused = await refusalFrom(
      beginAiBudgetCall({ purpose: "guard-refuse", providerId: "guard-refuse", modelId: "m", inputTokens: 3 }),
    );

    expect((refused as AppError).code).toBe("AI_BUDGET_EXCEEDED");
    // A refusal is not a failed call: no request left this process, so there is nothing to account for.
    expect((await listAiUsageLedgerEntries({ limit: 5000 })).length).toBe(rowsBefore);
    expect(await holdCount()).toBe(holdsBefore);
  });

  it("calls a month with rows that state no figure a floor instead of adding them as zero", async () => {
    const before = await getAiBudgetStatus();
    await createAiUsageLedgerEntry({
      purpose: "guard-floor",
      providerId: "guard-floor",
      modelId: "m",
      tokens: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
      completeness: "reported",
      costAmount: null,
      costSource: "unpriced",
    });

    const after = await getAiBudgetStatus();
    // The row moved the total by nothing, and the answer says so rather than presenting a short total
    // as if it were the bill.
    expect(after.spent.amount).toBe(before.spent.amount);
    expect(after.spent.isComplete).toBe(false);
    expect(after.spent.unpricedAttempts).toBe(before.spent.unpricedAttempts + 1);
    expect(after.spent.truncated).toBe(false);
  });

  it("holds nothing for a call nothing can price, and refuses it only when the user asked for that", async () => {
    await updateAiBudgetSettings({
      policy: "warn",
      monthlyLimit: (await spentNow()) + 1_000,
      currency: "CNY",
      unknownCostPolicy: "allow",
    });
    const holdsBefore = await holdCount();

    const unpriced = await beginAiBudgetCall({
      purpose: "guard-unpriced",
      providerId: "guard-no-price",
      modelId: "nowhere",
      inputTokens: 10,
    });
    expect(unpriced.estimate.kind).toBe("unpriced");
    expect(unpriced.estimate.notes).toContain("price-not-on-file");
    expect(unpriced.decision.estimateCounted).toBe(false);
    expect(unpriced.decision.reasons).toContain("unknown-cost-not-counted");
    // No honest figure exists to hold, and 0 would be a figure the user reads as "free".
    expect(await holdCount()).toBe(holdsBefore);
    await unpriced.release();

    await updateAiBudgetSettings({ unknownCostPolicy: "block" });
    const refused = await refusalFrom(
      beginAiBudgetCall({ purpose: "guard-unpriced", providerId: "guard-no-price", modelId: "nowhere", inputTokens: 10 }),
    );
    expect(isAiBudgetRefusal(refused)).toBe(true);
    expect((refused as AppError).message).toContain("unknown-cost-refused");
  });

  it("never subtracts a price in another currency from a limit in this one", async () => {
    await createAiModelPrice({
      providerId: "guard-usd",
      modelId: "m",
      currency: "USD",
      inputPerMillion: pricePerToken,
      outputPerMillion: pricePerToken,
      priceVersion: "2026-10",
      effectiveFrom: priceSince,
    });
    await updateAiBudgetSettings({
      policy: "block",
      monthlyLimit: (await spentNow()) + 1_000,
      currency: "CNY",
      unknownCostPolicy: "allow",
    });

    const preview = await previewAiBudgetCall({
      purpose: "guard-usd",
      providerId: "guard-usd",
      modelId: "m",
      inputTokens: 5,
      maxOutputTokens: 1,
    });
    expect(preview.estimate).toMatchObject({ kind: "estimate", currency: "USD" });
    // There is no exchange rate in this database, and inventing one here would be inventing a number in
    // the one place a user is deciding whether to spend money.
    expect(preview.decision.status).toBe("allowed");
    expect(preview.decision.reasons).toContain("currency-not-compared");
    expect(preview.decision.estimateCounted).toBe(false);
    expect(preview.decision.projectedMax).toBeNull();

    await updateAiBudgetSettings({ unknownCostPolicy: "block" });
    const strict = await previewAiBudgetCall({
      purpose: "guard-usd",
      providerId: "guard-usd",
      modelId: "m",
      inputTokens: 5,
      maxOutputTokens: 1,
    });
    expect(strict.decision.status).toBe("blocked");
    expect(strict.decision.reasons).toContain("unknown-cost-refused");
  });

  it("answers a preview without taking a hold, so asking what a call would cost costs nothing", async () => {
    await pricedModel("guard-preview", "m");
    await updateAiBudgetSettings({
      policy: "block",
      monthlyLimit: (await spentNow()) + 1_000,
      currency: "CNY",
      unknownCostPolicy: "allow",
    });
    const holdsBefore = await holdCount();

    const preview = await previewAiBudgetCall({
      purpose: "estimate-preview",
      providerId: "guard-preview",
      modelId: "m",
      inputTokens: 2,
      maxOutputTokens: 2,
    });

    expect(preview.decision.status).toBe("allowed");
    expect(await holdCount()).toBe(holdsBefore);
    expect((await inFlightAiBudgetReservations()).some((hold) => hold.amount === 4)).toBe(false);
  });

  it("reports the same subtraction the decision used, and no ceiling it was never given", async () => {
    await pricedModel("guard-status", "m");
    await updateAiBudgetSettings({ policy: "off", monthlyLimit: null, currency: "CNY", unknownCostPolicy: "allow" });

    const unlimited = await getAiBudgetStatus();
    expect(unlimited.enforcement).toBe("cross-process-atomic");
    expect(unlimited.settings.monthlyLimit).toBeNull();
    // "No ceiling stated" is not "0 left".
    expect(unlimited.remaining).toBeNull();

    const limit = roundAmount((await spentNow()) + 10);
    await updateAiBudgetSettings({ policy: "warn", monthlyLimit: limit, currency: "CNY", unknownCostPolicy: "allow" });
    const before = await getAiBudgetStatus();
    expect(before.remaining).toBe(roundAmount(limit - before.spent.amount));

    const handle = await beginAiBudgetCall({
      purpose: "guard-status",
      providerId: "guard-status",
      modelId: "m",
      inputTokens: 2,
      maxOutputTokens: 2,
    });
    const after = await getAiBudgetStatus();
    expect(after.reserved).toBe(4);
    expect(after.inFlightCount).toBe(1);

    const remainingBefore = before.remaining ?? 0;
    const remainingAfter = after.remaining ?? 0;
    // Exactly the hold came off the figure the page shows: the page and the gate cannot disagree.
    expect(roundAmount(remainingBefore - remainingAfter)).toBe(4);

    await handle.release();
    const released = await getAiBudgetStatus();
    expect(released.reserved).toBe(0);
    expect(released.remaining).toBe(remainingBefore);
  });
});

/**
 * The gate at a *step* boundary (CI-P7-03's run/node gate, used by `worker/runner.ts`): a playbook is
 * about to start a step whose request has not been written yet, so there is nothing to measure and
 * nothing to hold - the only honest question is whether the period still has budget at all.
 *
 * What a case can check here and nowhere else is that this gate is *read-only*: it neither holds budget
 * nor writes anything, and that only `block` stops a step. A `warn` policy has to pass, because a run
 * refused under a policy that promises not to refuse would be this gate inventing a rule.
 */
describe("the CI-P7-03 step gate", () => {
  it("passes under warn while over the limit, says why, and holds nothing", async () => {
    await updateAiBudgetSettings({ policy: "warn", monthlyLimit: 0, currency: "CNY", unknownCostPolicy: "allow" });
    const holdsBefore = await holdCount();

    const decision = await beginAiBudgetNode({ purpose: "run:topic_article_generator" });

    expect(decision.status).toBe("allowed");
    expect(decision.reasons).toContain("over-limit-warning");
    expect(decision.remaining).toBe(0);
    // No call was measured, so the decision points at no figure: `unknown`, counted nowhere.
    expect(decision.estimate.kind).toBe("unknown");
    expect(decision.estimateCounted).toBe(false);
    expect(await holdCount()).toBe(holdsBefore);
  });

  it("refuses the step under block with the call gate's own code and status, still holding nothing", async () => {
    await updateAiBudgetSettings({ policy: "block", monthlyLimit: 0, currency: "CNY", unknownCostPolicy: "allow" });
    const holdsBefore = await holdCount();

    const refusal = (await refusalFrom(
      beginAiBudgetNode({ purpose: "run:topic_article_generator" }),
    )) as AppError;

    // One code, one status, one wording for both gates: a step refusal is what the worker's `catch`
    // records as the run's own failure, and a call site can recognise it without knowing which spoke.
    expect(isAiBudgetRefusal(refusal)).toBe(true);
    expect(refusal.status).toBe(402);
    expect(refusal.message).toContain("over-limit");
    expect(refusal.details).toMatchObject({ purpose: "run:topic_article_generator", status: "blocked" });
    expect(await holdCount()).toBe(holdsBefore);
  });
});

/**
 * CI-P7-03-A, at the gate: what this card added to the behaviour a call site sees.
 *
 * The stored holds are pinned in `src/db/repositories/ai-budget.test.ts` and the cross-process claims in
 * `./ai-budget-guard.process.test.ts`. What only this file can check is the gate's own wiring:
 *
 *  - every verdict is **recorded**, refusals included, so "why did this run stop" outlives the response;
 *  - a granted call receives a hold id it can put on its ledger rows, which is what makes the two records
 *    of one call comparable at all;
 *  - giving a hold back is idempotent at the handle, and a failed call's hold is genuinely free for the retry.
 */
const { recordAiUsageCall } = await import("@/lib/ai-usage-ledger-recorder");
const { listAiBudgetDecisions, listAiBudgetReservations, reconcileAiBudgetReservations } = await import(
  "@/db/repositories/ai-budget"
);
const { aiBudgetReservationTtlMs } = await import("@/lib/ai-budget");

describe("the budget records the gate writes", () => {
  it("names the refused call and its arithmetic, and stores the granted one with its hold", async () => {
    await pricedModel("guard-audit", "m");
    await updateAiBudgetSettings({ policy: "block", monthlyLimit: 0, currency: "CNY", unknownCostPolicy: "allow" });

    const refusal = (await refusalFrom(
      beginAiBudgetCall({
        purpose: "guard-audit-refused",
        providerId: "guard-audit",
        modelId: "m",
        inputTokens: 1,
        maxOutputTokens: 1,
      }),
    )) as AppError;
    expect(isAiBudgetRefusal(refusal)).toBe(true);

    const periodKey = (await getAiBudgetStatus()).period.key;
    const refusedRow = (await listAiBudgetDecisions({ periodKey, limit: 50 })).find(
      (row) => row.purpose === "guard-audit-refused",
    );
    // A refused call holds nothing, and the record says so: no reservation id, and no amount that could
    // be read as money.
    expect(refusedRow).toMatchObject({
      gate: "call",
      status: "blocked",
      limitAmount: 0,
      estimateKind: "estimate",
      estimateAmountMin: 1,
      reservationId: "",
      reservationAmount: null,
      providerId: "guard-audit",
      modelId: "m",
    });
    // The reason is the refusal itself; `spend-incomplete` may also be there when an earlier case left a
    // row that states no figure in this same month, and that is a fact about the month rather than a
    // different verdict.
    expect(refusedRow?.reasons).toContain("over-limit");

    // Now a call with room: it is recorded as allowed *and* it names the hold it took.
    await updateAiBudgetSettings({
      policy: "block",
      monthlyLimit: (await spentNow()) + 10,
      currency: "CNY",
      unknownCostPolicy: "allow",
    });
    const handle = await beginAiBudgetCall({
      purpose: "guard-audit-allowed",
      providerId: "guard-audit",
      modelId: "m",
      inputTokens: 2,
      maxOutputTokens: 0,
    });
    expect(handle.reservationId).not.toBeNull();

    const allowedRow = (await listAiBudgetDecisions({ limit: 50 })).find(
      (row) => row.purpose === "guard-audit-allowed",
    );
    expect(allowedRow).toMatchObject({
      status: "allowed",
      reservationId: handle.reservationId,
      reservationAmount: 2,
      reservationCurrency: "CNY",
      estimateAmountMin: 2,
    });

    await handle.release();
  });

  it("reconciles one call's hold against the ledger row that names it", async () => {
    await pricedModel("guard-reconcile", "m");
    await updateAiBudgetSettings({
      policy: "block",
      monthlyLimit: (await spentNow()) + 10,
      currency: "CNY",
      unknownCostPolicy: "allow",
    });

    const handle = await beginAiBudgetCall({
      purpose: "guard-reconcile",
      providerId: "guard-reconcile",
      modelId: "m",
      inputTokens: 3,
      maxOutputTokens: 0,
      identity: { runId: "run-reconcile", nodeId: "node-reconcile" },
    });
    const reservationId = handle.reservationId ?? "";
    expect(reservationId).not.toBe("");

    // The row this call would write on success: less than the ceiling it held, which is the ordinary
    // shape of a real call - a hold is a ceiling, not a prediction.
    await recordAiUsageCall({
      purpose: "guard-reconcile",
      runId: "run-reconcile",
      nodeId: "node-reconcile",
      budgetReservationId: reservationId,
      attempts: [
        {
          kind: "answer",
          providerId: "guard-reconcile",
          modelId: "m",
          endpointId: "ep",
          credentialLabel: "****1234",
          outcome: "success",
          error: "",
          usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
        },
      ],
    });
    await handle.release();

    const report = await reconcileAiBudgetReservations({ runId: "run-reconcile" });
    expect(report.rows.map((row) => row.reservationId)).toEqual([reservationId]);
    expect(report.rows[0]).toMatchObject({
      reservedAmount: 3,
      nodeId: "node-reconcile",
      status: "settled",
      settleKind: "released",
      // 1 CNY of tokens against a hold of 3: the ceiling held, and the report says by how much.
      verdict: "under-reserved",
      ledger: { rows: 1, statedAmount: 1, unpricedRows: 0, unmeasuredRows: 0 },
    });
    expect(report.totals.ledgerStatedByCurrency).toEqual({ CNY: 1 });
  });

  it("frees the room when a failed call's hold is given back, so its retry is admitted", async () => {
    await pricedModel("guard-retry", "m");
    await updateAiBudgetSettings({
      policy: "block",
      monthlyLimit: (await spentNow()) + 2,
      currency: "CNY",
      unknownCostPolicy: "allow",
    });
    const holdsBefore = await holdCount();

    // A call that took the whole room and then failed: every call site gives the hold back in a `finally`.
    const first = await beginAiBudgetCall({
      purpose: "guard-retry",
      providerId: "guard-retry",
      modelId: "m",
      inputTokens: 2,
      maxOutputTokens: 0,
    });
    expect(await first.release()).toMatchObject({ settled: true, alreadySettled: false, failed: false });

    // The retry is admitted on the room the failure gave back rather than refused.
    const retry = await beginAiBudgetCall({
      purpose: "guard-retry",
      providerId: "guard-retry",
      modelId: "m",
      inputTokens: 2,
      maxOutputTokens: 0,
    });
    expect(retry.decision.status).toBe("allowed");
    expect(retry.reservationId).not.toBe(first.reservationId);

    // A same hold released twice - a double `finally`, a retry path - is told so instead of giving
    // somebody else's hold back.
    expect(await first.release()).toMatchObject({ settled: false, alreadySettled: true, failed: false });
    expect(await holdCount()).toBe(holdsBefore + 1);
    await retry.release();
  });

  it("does not count a hold whose TTL passed, and reaps it on the next gated call", async () => {
    await pricedModel("guard-ttl", "m");
    const now = Date.now();
    await updateAiBudgetSettings({
      policy: "block",
      monthlyLimit: (await spentNow()) + 10,
      currency: "CNY",
      unknownCostPolicy: "allow",
    });

    const abandoned = await beginAiBudgetCall({
      purpose: "guard-ttl",
      providerId: "guard-ttl",
      modelId: "m",
      inputTokens: 1,
      maxOutputTokens: 0,
      at: now - aiBudgetReservationTtlMs - 1,
    });
    const abandonedId = abandoned.reservationId ?? "";
    expect(abandonedId).not.toBe("");

    // Its TTL passed, so it counts for nothing - and it is not in flight either, whether or not a sweep
    // has marked its row yet.
    expect(await reservedAiBudgetAmount(abandoned.decision.period.key, "CNY", now)).toBe(0);
    expect((await inFlightAiBudgetReservations(now)).some((hold) => hold.id === abandonedId)).toBe(false);
    // The row is still there, which is what keeps "what happened to that hold" answerable.
    expect((await listAiBudgetReservations({ limit: 5000 })).some((hold) => hold.id === abandonedId)).toBe(true);

    // The next gated call reaps it: marked `expired`, never deleted.
    await beginAiBudgetCall({
      purpose: "guard-ttl-next",
      providerId: "guard-ttl",
      modelId: "m",
      inputTokens: 1,
      maxOutputTokens: 0,
    });
    expect((await listAiBudgetReservations({ limit: 5000 })).find((hold) => hold.id === abandonedId)).toMatchObject({
      status: "expired",
      settleKind: "expired",
    });
  });
});
