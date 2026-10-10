import { describe, expect, it } from "vitest";

/**
 * CI-P7-03-A: the stored holds, at the layer the gate cannot see.
 *
 * `src/lib/ai-budget-guard.test.ts` checks what a call site experiences; this file checks the
 * properties the card was asked for, each of which is a fact about rows rather than about a decision:
 *
 *  - **admission is one statement.** A hold that would cross the limit is refused *by the database*
 *    rather than by an earlier read, so a hold another process took is seen without any shared memory.
 *  - **recovery is the row and the TTL.** A hold whose TTL passed stops counting immediately, whether
 *    or not anything has reaped it; reaping marks it instead of dropping it.
 *  - **settlement is idempotent.** The first settle changes the row, every later one changes nothing
 *    and says so - which is what makes a retried `finally` harmless.
 *  - **the holds and the ledger agree, or say how they do not.** The join is the id the gate wrote onto
 *    the ledger row, and the verdicts name each way the two can disagree.
 *
 * Each case is placed in its own calendar month so the period-scoped arithmetic cannot leak between
 * them, and the temp database is pinned before anything that reads it loads (`src/test/route-harness.ts`).
 */
await import("@/test/route-harness");

const {
  listAiBudgetDecisions,
  listAiBudgetReservations,
  readAiBudgetHolds,
  readAiBudgetSpend,
  reconcileAiBudgetReservations,
  recordAiBudgetDecision,
  reserveAiBudgetHold,
  settleAiBudgetReservation,
  sweepAiBudgetReservations,
} = await import("@/db/repositories/ai-budget");
const { createAiUsageLedgerEntry, listAiUsageLedgerEntries } = await import("@/db/repositories/ai-usage-ledger");
const {
  aiBudgetRecordRetentionMs,
  aiBudgetReservationTtlMs,
  budgetPeriodOf,
  defaultAiBudgetSettings,
  evaluateAiBudget,
  summarizeBudgetSpend,
  textTokenEstimateMethod,
} = await import("@/lib/ai-budget");

/** A month of its own per case, so one case's spending cannot be another case's floor. */
const monthOf = (month: number) => budgetPeriodOf(new Date(2026, month, 15, 12, 0, 0).getTime());

interface HoldInput {
  period: { key: string; start: number; end: number };
  amount: number;
  limit?: number;
  enforce?: boolean;
  at?: number;
  ttlMs?: number;
  purpose?: string;
  runId?: string;
  nodeId?: string;
  owner?: string;
}

async function hold(input: HoldInput) {
  const at = input.at ?? Date.now();
  return reserveAiBudgetHold({
    periodKey: input.period.key,
    periodStart: input.period.start,
    periodEnd: input.period.end,
    currency: "CNY",
    amount: input.amount,
    enforce: input.enforce ?? true,
    limit: input.limit ?? 1_000,
    policy: input.enforce === false ? "warn" : "block",
    estimateKind: "estimate",
    estimateMethod: textTokenEstimateMethod,
    purpose: input.purpose ?? "budget-repository",
    meteredKind: "text",
    providerId: "repo-provider",
    modelId: "repo-model",
    routeResolved: false,
    runId: input.runId,
    nodeId: input.nodeId,
    owner: input.owner ?? "repo-test-process",
    at,
    expiresAt: at + (input.ttlMs ?? aiBudgetReservationTtlMs),
  });
}

/** One ledger row in a period, priced or blank, optionally naming the hold it ran under. */
async function ledgerRow(input: {
  at: number;
  costAmount: number | null;
  costSource?: "computed" | "provider-reported" | "unpriced" | "unknown";
  currency?: string;
  reservationId?: string;
  runId?: string;
}) {
  return createAiUsageLedgerEntry({
    purpose: "budget-repository",
    providerId: "repo-provider",
    modelId: "repo-model",
    tokens: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
    completeness: input.costAmount === null ? "unknown" : "reported",
    costAmount: input.costAmount,
    costCurrency: input.currency ?? "CNY",
    costSource: input.costSource ?? "computed",
    budgetReservationId: input.reservationId,
    runId: input.runId,
    createdAt: input.at,
  });
}

describe("the stored budget holds", () => {
  it("adds a period up by the same rule the pure summariser uses", async () => {
    const period = monthOf(0);
    for (const row of [
      { costAmount: 1.5, currency: "CNY", costSource: "computed" as const },
      { costAmount: null, currency: "", costSource: "unpriced" as const },
      { costAmount: null, currency: "", costSource: "unknown" as const },
      { costAmount: 2.25, currency: "USD", costSource: "computed" as const },
    ]) {
      await ledgerRow({ at: period.start + 1_000, ...row });
    }
    // A row stamped at exactly the next month's first instant belongs to the next month, and the
    // aggregate has to agree with the pure summariser about that boundary as well as the arithmetic.
    await ledgerRow({ at: period.end, costAmount: 99, currency: "CNY" });

    const aggregate = await readAiBudgetSpend({ start: period.start, end: period.end, currency: "CNY" });
    const entries = await listAiUsageLedgerEntries({ from: period.start, to: period.end - 1, limit: 5_000 });
    const pure = summarizeBudgetSpend(entries, "CNY", { from: period.start, to: period.end - 1 });

    expect(entries).toHaveLength(4);
    expect(aggregate.attempts).toBe(pure.attempts);
    expect(aggregate.amount).toBe(pure.amount);
    expect(aggregate.statedAttempts).toBe(pure.statedAttempts);
    expect(aggregate.unpricedAttempts).toBe(pure.unpricedAttempts);
    expect(aggregate.unmeasuredAttempts).toBe(pure.unmeasuredAttempts);
    expect(aggregate.otherCurrencyAttempts).toBe(pure.otherCurrencyAttempts);
    expect(aggregate.otherCurrencies).toEqual(pure.otherCurrencies);
    expect(aggregate.isComplete).toBe(pure.isComplete);
    expect(aggregate).toMatchObject({
      amount: 1.5,
      statedAttempts: 1,
      unpricedAttempts: 1,
      unmeasuredAttempts: 1,
      otherCurrencyAttempts: 1,
      otherCurrencies: ["USD"],
      isComplete: false,
      from: period.start,
      to: period.end - 1,
      // The pure reader can be told it hit a row ceiling; an aggregate cannot hit one. That is the one
      // field the two may differ on, and it is why the old capped read is gone.
      truncated: false,
    });
  });

  it("grants holds while the period has room and refuses the one that would cross the limit", async () => {
    // September: the boundary row of the first case belongs to *February*, so no other case may live here.
    const period = monthOf(8);

    const first = await hold({ period, amount: 4, limit: 10 });
    const second = await hold({ period, amount: 4, limit: 10 });
    const third = await hold({ period, amount: 4, limit: 10 });

    expect(first.granted).toBe(true);
    expect(second.granted).toBe(true);
    // 4 + 4 + 4 = 12 > 10: refused by the statement's own arithmetic, not by a caller's earlier read.
    expect(third.granted).toBe(false);
    expect(third.reservation).toBeNull();

    const held = await readAiBudgetHolds({ periodKey: period.key, currency: "CNY", at: Date.now() });
    expect(held).toMatchObject({ amount: 8, count: 2 });
  });

  it("counts a hold another process took, which is what an in-memory version could not do", async () => {
    const period = monthOf(2);

    // A row written by "somebody else": a different owner, and no shared memory anywhere.
    const other = await hold({ period, amount: 6, limit: 10, owner: "another-process-1234" });
    expect(other.granted).toBe(true);

    const held = await readAiBudgetHolds({ periodKey: period.key, currency: "CNY", at: Date.now() });
    expect(held).toMatchObject({ amount: 6, count: 1 });

    // The room is really gone for this process too: 6 + 5 > 10.
    const mine = await hold({ period, amount: 5, limit: 10, owner: "this-process" });
    expect(mine.granted).toBe(false);
    expect(await listAiBudgetReservations({ periodKey: period.key, status: "held" })).toHaveLength(1);
  });

  it("settles a hold exactly once, whoever asks", async () => {
    const period = monthOf(3);
    const taken = await hold({ period, amount: 3, limit: 10 });
    const id = taken.reservation?.id ?? "";
    expect(id).not.toBe("");

    const at = Date.now();
    const first = await settleAiBudgetReservation({ id, at, kind: "released" });
    expect(first.settled).toBe(true);
    expect(first.reservation).toMatchObject({ status: "settled", settleKind: "released", settledAt: at });

    // The second settle - a `finally` that ran twice, a retried request, another process - changes
    // nothing and says so, rather than moving the row a second time.
    const second = await settleAiBudgetReservation({ id, at: at + 5_000, kind: "released" });
    expect(second.settled).toBe(false);
    expect(second.reservation).toMatchObject({ status: "settled", settleKind: "released", settledAt: at });

    // A settled hold is not in flight any more, so the period's room is back.
    expect(await readAiBudgetHolds({ periodKey: period.key, currency: "CNY", at: Date.now() })).toMatchObject({
      amount: 0,
      count: 0,
    });
  });

  it("stops counting a hold the moment its TTL passes, and marks it when the sweep runs", async () => {
    const period = monthOf(4);
    const at = Date.now();
    const stale = await hold({ period, amount: 7, limit: 10, at: at - aiBudgetReservationTtlMs - 1 });
    const id = stale.reservation?.id ?? "";
    expect(stale.granted).toBe(true);

    // Nothing has reaped it yet: the row still says `held`, and it is still not counted.
    const rows = await listAiBudgetReservations({ periodKey: period.key });
    expect(rows.find((entry) => entry.id === id)?.status).toBe("held");
    expect(await readAiBudgetHolds({ periodKey: period.key, currency: "CNY", at })).toMatchObject({
      amount: 0,
      count: 0,
    });
    // And the room is genuinely free again for a live call: that is the recovery, not a report about it.
    expect((await hold({ period, amount: 9, limit: 10, at })).granted).toBe(true);

    const swept = await sweepAiBudgetReservations(at);
    expect(swept.expired).toBe(1);
    const reaped = await listAiBudgetReservations({ periodKey: period.key, status: "expired" });
    expect(reaped.map((entry) => entry.id)).toEqual([id]);
    expect(reaped[0]).toMatchObject({ settleKind: "expired", settledAt: at });
  });
});

describe("the budget audit", () => {
  it("reconciles every hold against the ledger rows that name it", async () => {
    const period = monthOf(5);
    const now = Date.now();

    /** A hold taken, used by a call, and released - the ordinary shape of one gated call. */
    async function closed(input: { amount: number; costAmount: number | null; costSource?: "computed" | "unpriced"; runId?: string }) {
      const taken = await hold({ period, amount: input.amount, runId: input.runId });
      const id = taken.reservation?.id ?? "";
      await ledgerRow({
        at: now,
        costAmount: input.costAmount,
        costSource: input.costSource,
        reservationId: id,
        runId: input.runId,
      });
      await settleAiBudgetReservation({ id, at: now, kind: "released" });
      return id;
    }

    const matched = await closed({ amount: 5, costAmount: 5 });
    const under = await closed({ amount: 5, costAmount: 3 });
    const over = await closed({ amount: 5, costAmount: 8, runId: "run-42" });
    const unpriced = await closed({ amount: 5, costAmount: null, costSource: "unpriced" });

    // Released with nothing linked: the reconciler must not read that as "spent 0".
    const missing = (await hold({ period, amount: 5 })).reservation?.id ?? "";
    await settleAiBudgetReservation({ id: missing, at: now, kind: "released" });

    // A call that ran and whose process died before settling: the money is real and the hold is not.
    const abandoned = (await hold({ period, amount: 5, at: now - aiBudgetReservationTtlMs - 1 })).reservation?.id ?? "";
    await ledgerRow({ at: now, costAmount: 5, reservationId: abandoned });

    // A hold still in flight.
    const live = (await hold({ period, amount: 5 })).reservation?.id ?? "";

    const report = await reconcileAiBudgetReservations({ periodKey: period.key, at: now });
    const verdictOf = (id: string) => report.rows.find((row) => row.reservationId === id)?.verdict;

    expect(verdictOf(matched)).toBe("matched");
    expect(verdictOf(under)).toBe("under-reserved");
    expect(verdictOf(over)).toBe("over-reserved");
    expect(verdictOf(unpriced)).toBe("ledger-unknown");
    expect(verdictOf(missing)).toBe("no-ledger");
    expect(verdictOf(abandoned)).toBe("expired-with-ledger");
    expect(verdictOf(live)).toBe("held");

    expect(report.totals.verdicts).toEqual({
      held: 1,
      "expired-unspent": 0,
      "expired-with-ledger": 1,
      "no-ledger": 1,
      "ledger-unknown": 1,
      "currency-mismatch": 0,
      "under-reserved": 1,
      "over-reserved": 1,
      matched: 1,
    });
    expect(report.totals).toMatchObject({
      reservations: 7,
      heldAmount: 5,
      settledAmount: 25,
      expiredAmount: 5,
    });
    // Only the rows that stated a figure are added up, and the unpriced one is not a 0: 5 + 3 + 8 + 5.
    expect(report.totals.ledgerStatedByCurrency).toEqual({ CNY: 21 });
    expect(report.rows.find((row) => row.reservationId === over)).toMatchObject({
      reservedAmount: 5,
      ledger: { rows: 1, statedAmount: 8, unpricedRows: 0 },
    });
    expect(report.rows.find((row) => row.reservationId === unpriced)?.ledger).toMatchObject({
      rows: 1,
      statedAmount: null,
      unpricedRows: 1,
    });

    // Per run: "what did this run hold, and how did it end" is a filter on the holds themselves.
    const runReport = await reconcileAiBudgetReservations({ runId: "run-42", at: now });
    expect(runReport.rows.map((row) => row.reservationId)).toEqual([over]);
    expect(runReport.totals.verdicts["over-reserved"]).toBe(1);
    expect(report.truncated).toBe(false);
  });

  it("stores what nobody stated as NULL, and prunes the trail without ever touching a live hold", async () => {
    const period = monthOf(7);
    const now = Date.now();

    // A decision with no ceiling and an estimate that states nothing: both amounts stay NULL rather
    // than becoming the 0 a reader would take for a figure.
    const spent = {
      currency: "CNY",
      amount: 0,
      attempts: 0,
      statedAttempts: 0,
      unpricedAttempts: 0,
      unmeasuredAttempts: 0,
      otherCurrencyAttempts: 0,
      otherCurrencies: [] as string[],
      isComplete: true,
      truncated: false,
      from: period.start,
      to: period.end - 1,
    };
    const settings = {
      ...defaultAiBudgetSettings,
      policy: "block" as const,
      monthlyLimit: null,
      currency: "CNY" as const,
      unknownCostPolicy: "block" as const,
    };
    const decision = evaluateAiBudget({
      settings,
      period,
      spent,
      reserved: 0,
      estimate: { kind: "unpriced", method: textTokenEstimateMethod, meteredKind: "text", notes: [] },
    });
    const stored = await recordAiBudgetDecision({
      gate: "node",
      at: now,
      decision,
      purpose: "run:topic_article_generator",
      runId: "run-7",
      target: null,
      reservation: null,
    });

    expect(stored).toMatchObject({
      status: "allowed",
      reasons: ["no-limit"],
      limitAmount: null,
      remainingAmount: null,
      estimateKind: "unpriced",
      estimateAmountMin: null,
      estimateAmountMax: null,
      reservationId: "",
      reservationAmount: null,
      runId: "run-7",
      providerId: "",
      routeResolved: false,
    });
    // No prompt and no credential can be part of a decision: the columns a decision is made of are the
    // reason codes, the amounts and the period, and nothing else exists to store here.
    expect(Object.keys(stored ?? {})).not.toContain("prompt");
    expect((await listAiBudgetDecisions({ periodKey: period.key, runId: "run-7" })).map((row) => row.id)).toEqual([
      stored?.id ?? "",
    ]);

    // An old settled hold and an old decision are past retention; a *live* hold is not, whatever its age.
    const old = now - aiBudgetRecordRetentionMs - 86_400_000;
    const settledOld = await hold({ period, amount: 2, at: old, ttlMs: 60_000 });
    await settleAiBudgetReservation({ id: settledOld.reservation?.id ?? "", at: old, kind: "released" });
    const liveOld = await hold({ period, amount: 3, at: old, ttlMs: aiBudgetRecordRetentionMs * 2 });
    await recordAiBudgetDecision({
      gate: "call",
      at: old,
      decision,
      purpose: "budget-repository-old",
      createdAt: old,
    });

    const swept = await sweepAiBudgetReservations(now);
    expect(swept.prunedReservations).toBe(1);
    expect(swept.prunedDecisions).toBe(1);
    expect((await listAiBudgetReservations({ periodKey: period.key })).map((row) => row.id)).toEqual([
      liveOld.reservation?.id ?? "",
    ]);
    expect((await listAiBudgetDecisions({ periodKey: period.key })).map((row) => row.purpose)).toEqual([
      "run:topic_article_generator",
    ]);
  });
});
