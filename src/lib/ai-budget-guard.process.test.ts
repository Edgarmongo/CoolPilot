import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CI-P7-03-A: the gate across **real processes**, which is the only way to state what this card claims.
 *
 * The parent test is one process and every `probe` call is another: its own memory, its own modules, its
 * own database client, sharing nothing but one SQLite file. That is the situation the card is about, and
 * it is not reachable from a mock - an in-memory `Map` looks exactly like a row until a second process
 * asks. What is checked here, in order of how easy it is to get wrong without this file:
 *
 *  - **cross-process admission.** Eight processes race for a limit with room for four; exactly four get
 *    in, and the four that do not are refused with the gate's own code (not with a database error).
 *  - **recovery after a restart.** A hold whose process died is still counted by the next process - and
 *    one whose TTL passed is not, even though nothing has marked its row yet.
 *  - **settlement is idempotent across processes.** Two processes settle the same hold at once: one
 *    changes the row, the other is told it was already done.
 *
 * The children run the real guard through `tsx` (`src/test/ai-budget-probe.ts`), and the temp database
 * is the harness's own, pinned before anything that reads it loads.
 */
await import("@/test/route-harness");

const { routeTestDataDir } = await import("@/test/route-harness");
const { updateAiBudgetSettings } = await import("@/db/repositories/settings");
const { createAiModelPrice } = await import("@/db/repositories/ai-usage-ledger");
const { getAiBudgetReservation, listAiBudgetReservations, readAiBudgetHolds } = await import(
  "@/db/repositories/ai-budget"
);
const { beginAiBudgetCall, isAiBudgetRefusal } = await import("@/lib/ai-budget-guard");
const { aiBudgetReservationTtlMs, budgetPeriodOf } = await import("@/lib/ai-budget");

/**
 * One CNY per token: `perMillion` is the rate per *million* tokens, so a single input token prices at
 * 1 and every amount below reads as the number of tokens it came from.
 */
await createAiModelPrice({
  providerId: "probe-provider",
  modelId: "probe-model",
  currency: "CNY",
  inputPerMillion: 1_000_000,
  outputPerMillion: 1_000_000,
  priceVersion: "probe",
  effectiveFrom: 1_000,
});

const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const probeScript = path.join(process.cwd(), "src", "test", "ai-budget-probe.ts");

/**
 * Runs the probe in a process of its own and returns the single JSON line it printed. A child that
 * prints nothing is a failure of the *probe*, not a budget answer, so it rejects instead of resolving
 * something the assertions could mistake for a refusal.
 */
function probe<T>(command: string, args: string[] = [], timeoutMs = 60_000) {
  return new Promise<T>((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, probeScript, command, "--dir", routeTestDataDir, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`the ${command} probe timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("close", (code) => {
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).find((entry) => entry.trim().startsWith("{"));
      if (!line) {
        reject(new Error(`the ${command} probe printed no answer (exit ${code}): ${stderr.slice(-400)}`));
        return;
      }
      resolve(JSON.parse(line) as T);
    });
  });
}

/** A month of its own per test, so one test's holds cannot be another test's room. */
const marchAt = new Date(2026, 3, 15, 12, 0, 0).getTime();
const aprilAt = new Date(2026, 4, 15, 12, 0, 0).getTime();
const mayAt = new Date(2026, 5, 15, 12, 0, 0).getTime();

const reserve = (at: number) => probe<{ ok: boolean; code?: string; reservationId?: string }>("reserve", ["--at", String(at)]);
const settle = (id: string, at: number) =>
  probe<{ settled: boolean; status: string }>("settle", ["--id", id, "--at", String(at)]);
const count = (at: number) => probe<{ amount: number; count: number; periodKey: string }>("count", ["--at", String(at)]);

describe("the budget gate across processes", () => {
  it(
    "admits exactly as many processes as the limit has room for, and refuses the rest",
    async () => {
      // Room for four holds of 1, and no spending at all in this month.
      await updateAiBudgetSettings({ policy: "block", monthlyLimit: 4, currency: "CNY", unknownCostPolicy: "block" });

      const answers = await Promise.all(Array.from({ length: 8 }, () => reserve(marchAt)));

      expect(answers.filter((answer) => answer.ok)).toHaveLength(4);
      // The ones that lost are refused *by the budget*, not by a lock or a broken statement: the code is
      // the gate's own, which is what makes a 402 out of this rather than a 500.
      expect(answers.filter((answer) => !answer.ok).map((answer) => answer.code)).toEqual([
        "AI_BUDGET_EXCEEDED",
        "AI_BUDGET_EXCEEDED",
        "AI_BUDGET_EXCEEDED",
        "AI_BUDGET_EXCEEDED",
      ]);

      // Four rows, not eight: the statement that admitted them is one statement, so the table is the
      // serialization point and no process can insert past it.
      const period = budgetPeriodOf(marchAt);
      expect(await readAiBudgetHolds({ periodKey: period.key, currency: "CNY", at: marchAt })).toMatchObject({
        amount: 4,
        count: 4,
      });
      expect(await listAiBudgetReservations({ periodKey: period.key, status: "held" })).toHaveLength(4);

      // And this process - the "app", which never took any of those holds - sees them, so it refuses too.
      const refusal = await beginAiBudgetCall({
        purpose: "budget-probe",
        providerId: "probe-provider",
        modelId: "probe-model",
        inputTokens: 1,
        at: marchAt,
      }).catch((error: unknown) => error);
      expect(isAiBudgetRefusal(refusal)).toBe(true);
    },
    120_000,
  );

  it(
    "settles one hold exactly once when two processes ask at the same time",
    async () => {
      await updateAiBudgetSettings({ policy: "block", monthlyLimit: 4, currency: "CNY", unknownCostPolicy: "block" });
      const period = budgetPeriodOf(aprilAt);

      const mine = await beginAiBudgetCall({
        purpose: "budget-probe",
        providerId: "probe-provider",
        modelId: "probe-model",
        inputTokens: 1,
        at: aprilAt,
      });
      const id = mine.reservationId ?? "";
      expect(id).not.toBe("");

      const answers = await Promise.all([settle(id, aprilAt), settle(id, aprilAt)]);

      // Exactly one of them changed the row; the other was told it had already been done. A retried
      // `finally` in another process is therefore harmless rather than a second release.
      expect(answers.filter((answer) => answer.settled)).toHaveLength(1);
      expect(answers.map((answer) => answer.status)).toEqual(["settled", "settled"]);
      expect((await getAiBudgetReservation(id))?.status).toBe("settled");
      expect(await readAiBudgetHolds({ periodKey: period.key, currency: "CNY", at: aprilAt })).toMatchObject({
        amount: 0,
        count: 0,
      });

      // The room is back: a hold that was given back does not hold budget any more.
      expect((await reserve(aprilAt)).ok).toBe(true);
    },
    120_000,
  );

  it(
    "counts a hold a dead process left behind, and stops counting it when its TTL passes",
    async () => {
      await updateAiBudgetSettings({ policy: "block", monthlyLimit: 4, currency: "CNY", unknownCostPolicy: "block" });
      const period = budgetPeriodOf(mayAt);

      // A process takes a hold and dies without releasing it: exactly the crash this has to survive.
      const stale = await reserve(mayAt - aiBudgetReservationTtlMs - 1);
      expect(stale.ok).toBe(true);
      expect(await listAiBudgetReservations({ periodKey: period.key })).toHaveLength(1);

      // A fresh process (this one, and then another real one) sees the row and does not count it: its TTL
      // passed, and every read filters on that rather than on the sweep having run.
      expect(await readAiBudgetHolds({ periodKey: period.key, currency: "CNY", at: mayAt })).toMatchObject({
        amount: 0,
        count: 0,
      });
      expect(await count(mayAt)).toMatchObject({ amount: 0, count: 0, periodKey: period.key });

      // A live hold from a dead process *is* counted, by both the parent and a fresh process.
      const live = await reserve(mayAt);
      expect(live.ok).toBe(true);
      expect(await readAiBudgetHolds({ periodKey: period.key, currency: "CNY", at: mayAt })).toMatchObject({
        amount: 1,
        count: 1,
      });
      expect(await count(mayAt)).toMatchObject({ amount: 1, count: 1 });

      // And the next gated call reaps the abandoned row: marked `expired`, never silently dropped.
      const reaped = await listAiBudgetReservations({ periodKey: period.key, status: "expired" });
      expect(reaped).toHaveLength(1);
      expect(reaped[0]).toMatchObject({ settleKind: "expired", owner: expect.any(String) });
      expect(reaped[0].settledAt).toBeGreaterThanOrEqual(mayAt);
    },
    120_000,
  );
});
