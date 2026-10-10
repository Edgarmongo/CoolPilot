import { describe, expect, it } from "vitest";

/**
 * CI-P7-03: 预算与预估's read and write endpoint, over HTTP.
 *
 * The arithmetic is pinned where it lives (`@/lib/ai-budget`) and the gate in
 * `@/lib/ai-budget-guard.test.ts`. What only this file can check is what the endpoint is responsible
 * for: that the four settings survive a round trip, that "no ceiling" is a real answer rather than 0,
 * that the month it reports is the month the gate compares against, and that neither reading nor saving
 * the page writes anything about a call.
 *
 * The harness pins the temp database before anything that reads it loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
await import("@/test/route-harness");

const { GET, PUT } = await import("./route");
const { createAiUsageLedgerEntry, listAiUsageLedgerEntries } = await import("@/db/repositories/ai-usage-ledger");
const { listAiBudgetDecisions, listAiBudgetReservations } = await import("@/db/repositories/ai-budget");
const { budgetPeriodOf, roundAmount } = await import("@/lib/ai-budget");

type BudgetSettings = {
  policy: string;
  monthlyLimit: number | null;
  currency: string;
  unknownCostPolicy: string;
};

type BudgetPayload = {
  ok: boolean;
  code?: string;
  data?: {
    settings: BudgetSettings;
    enforcement: string;
    period: { key: string; start: number; end: number };
    spent: {
      currency: string;
      amount: number;
      isComplete: boolean;
      unpricedAttempts: number;
      truncated: boolean;
    };
    reserved: number;
    inFlightCount: number;
    remaining: number | null;
    policies: string[];
    unknownCostPolicies: string[];
  };
};

async function readBudget() {
  const response = await GET();
  return { status: response.status, body: (await response.json()) as BudgetPayload };
}

/** `PUT`, which the harness's `jsonRequest` does not build (that helper is a POST one). */
async function writeBudget(body: unknown) {
  const response = await PUT(
    new Request("http://localhost/api/ai-cost-center/budget", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as BudgetPayload };
}

const settingsOf = (body: BudgetPayload) => body.data?.settings;

describe("/api/ai-cost-center/budget", () => {
  it("answers a fresh install with the gate off, no ceiling, and the month it means", async () => {
    const answer = await readBudget();
    expect(answer.status).toBe(200);
    expect(answer.body.ok).toBe(true);

    // Off is the default: a budget is something a user turns on, never something a broken row turns on.
    expect(settingsOf(answer.body)).toEqual({
      policy: "off",
      monthlyLimit: null,
      currency: "CNY",
      unknownCostPolicy: "allow",
    });
    // The guarantee travels with the answer, so a page cannot describe a harder one than the code gives.
    expect(answer.body.data?.enforcement).toBe("cross-process-atomic");
    // The vocabularies travel too: the page shows the policies the code implements, not its own list.
    expect(answer.body.data?.policies).toEqual(["off", "warn", "block"]);
    expect(answer.body.data?.unknownCostPolicies).toEqual(["allow", "block"]);

    // The period is the gate's own: a natural calendar month, not the usage page's rolling window.
    expect(answer.body.data?.period).toEqual(budgetPeriodOf(Date.now()));
    expect(answer.body.data?.spent).toMatchObject({ currency: "CNY", amount: 0, isComplete: true });
    expect(answer.body.data?.reserved).toBe(0);
    expect(answer.body.data?.inFlightCount).toBe(0);
    // No ceiling stated is not "0 left".
    expect(answer.body.data?.remaining).toBeNull();
  });

  it("answers a save with the status after the write, and the next read agrees", async () => {
    const saved = await writeBudget({
      policy: "warn",
      monthlyLimit: 12.5,
      currency: "CNY",
      unknownCostPolicy: "allow",
    });

    expect(saved.status).toBe(200);
    expect(settingsOf(saved.body)).toEqual({
      policy: "warn",
      monthlyLimit: 12.5,
      currency: "CNY",
      unknownCostPolicy: "allow",
    });
    expect(saved.body.data?.remaining).toBe(12.5);

    const reread = await readBudget();
    expect(settingsOf(reread.body)).toEqual(settingsOf(saved.body));
  });

  it("stores \"no limit stated\" as an answer of its own, not as a limit of zero", async () => {
    const cleared = await writeBudget({
      policy: "block",
      monthlyLimit: null,
      currency: "CNY",
      unknownCostPolicy: "block",
    });

    expect(cleared.status).toBe(200);
    expect(settingsOf(cleared.body)).toMatchObject({ policy: "block", monthlyLimit: null });
    expect(cleared.body.data?.remaining).toBeNull();
    // And the stricter unknown-cost policy really came back, rather than being defaulted away.
    expect(cleared.body.data?.settings.unknownCostPolicy).toBe("block");
  });

  it("counts the month's stated figures, and calls a month with unstated ones a floor", async () => {
    await writeBudget({ policy: "warn", monthlyLimit: 10, currency: "CNY", unknownCostPolicy: "allow" });
    await createAiUsageLedgerEntry({
      purpose: "budget-route",
      providerId: "route-priced",
      modelId: "m",
      tokens: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
      completeness: "reported",
      costAmount: 1.5,
      costCurrency: "CNY",
      costSource: "computed",
    });
    await createAiUsageLedgerEntry({
      purpose: "budget-route",
      providerId: "route-unpriced",
      modelId: "m",
      tokens: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
      completeness: "reported",
      costAmount: null,
      costSource: "unpriced",
    });

    const answer = await readBudget();
    const spent = answer.body.data?.spent;
    expect(spent?.amount).toBe(1.5);
    // A row that states no figure makes the total a floor, and the answer says so instead of hiding it.
    expect(spent?.isComplete).toBe(false);
    expect(spent?.unpricedAttempts).toBe(1);
    expect(spent?.truncated).toBe(false);
    // The remaining figure is the same subtraction the gate would use for its own decision.
    expect(answer.body.data?.remaining).toBe(roundAmount(10 - 1.5));
  });

  it("refuses a payload it cannot store, and leaves the saved settings alone", async () => {
    const before = await readBudget();

    // A negative ceiling is not a budget, and a row with no currency is not a setting.
    const negative = await writeBudget({
      policy: "block",
      monthlyLimit: -1,
      currency: "CNY",
      unknownCostPolicy: "allow",
    });
    expect(negative.status).toBe(400);
    expect(negative.body.code).toBe("INVALID_PAYLOAD");

    const missingCurrency = await writeBudget({ policy: "block", monthlyLimit: 5, unknownCostPolicy: "allow" });
    expect(missingCurrency.status).toBe(400);
    expect(missingCurrency.body.code).toBe("INVALID_PAYLOAD");

    const after = await readBudget();
    expect(settingsOf(after.body)).toEqual(settingsOf(before.body));
  });

  it("writes nothing about a call, whether the page is read or saved", async () => {
    const rowsBefore = (await listAiUsageLedgerEntries({ limit: 5000 })).length;
    const holdsBefore = (await listAiBudgetReservations({ limit: 5000 })).length;
    const decisionsBefore = (await listAiBudgetDecisions({ limit: 5000 })).length;
    await readBudget();
    await writeBudget({ policy: "off", monthlyLimit: null, currency: "CNY", unknownCostPolicy: "allow" });

    // No prompt, no credential and no amount is added by looking at this page or saving a setting. Since
    // CI-P7-03-A that includes the budget's own records: the page reports the holds, it never takes one,
    // never reaps one and never writes a decision of its own.
    expect((await listAiUsageLedgerEntries({ limit: 5000 })).length).toBe(rowsBefore);
    expect((await listAiBudgetReservations({ limit: 5000 })).length).toBe(holdsBefore);
    expect((await listAiBudgetDecisions({ limit: 5000 })).length).toBe(decisionsBefore);
  });
});
