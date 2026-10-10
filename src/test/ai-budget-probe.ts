import path from "node:path";

/**
 * The child process of `src/lib/ai-budget-guard.process.test.ts` (CI-P7-03-A).
 *
 * It exists so "another process" is a **real other process**: an OS process with its own memory, its
 * own module instances and its own client, sharing nothing with the test but one database file. Every
 * property this card claims is about that situation, and an in-process mock cannot state any of them -
 * a `Map` in one process looks exactly like a row in a database until a second process is involved.
 *
 * The contract is one JSON line on stdout, so the parent asserts on facts rather than on log text:
 *
 *   reserve  --dir D --at MS             `{"ok":true,"reservationId":"…"}` or `{"ok":false,"code":"…"}`
 *   settle   --dir D --id ID --at MS     `{"settled":true|false,"status":"…"}`
 *   count    --dir D --at MS             `{"amount":N,"count":N,"periodKey":"…"}`
 *
 * `reserve` deliberately **does not** release its hold: the process is about to die, which is the
 * crash a hold has to survive on its own.
 */
function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? "") : "";
}

async function main() {
  const command = process.argv[2] ?? "";
  const dir = arg("dir");
  if (dir) {
    // Pinned before anything reads it, exactly as `src/test/route-harness.ts` does - a module body runs
    // after its imports, so the database URL has to be in the environment first.
    process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dir, "routes.db").replace(/\\/g, "/")}`;
    process.env.SOCIAL_AUTO_POST_DATA_DIR = dir;
  }
  const at = Number(arg("at") || Date.now());

  const guard = await import("@/lib/ai-budget-guard");
  const budget = await import("@/db/repositories/ai-budget");
  const { budgetPeriodOf } = await import("@/lib/ai-budget");

  if (command === "reserve") {
    try {
      const handle = await guard.beginAiBudgetCall({
        purpose: "budget-probe",
        providerId: "probe-provider",
        modelId: "probe-model",
        capabilities: ["chat"],
        inputTokens: 1,
        at,
      });
      process.stdout.write(`${JSON.stringify({ ok: true, reservationId: handle.reservationId })}\n`);
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({
          ok: false,
          code: guard.isAiBudgetRefusal(error) ? "AI_BUDGET_EXCEEDED" : "OTHER",
          message: error instanceof Error ? error.message : String(error),
        })}\n`,
      );
    }
    return;
  }

  if (command === "settle") {
    const result = await budget.settleAiBudgetReservation({ id: arg("id"), at, kind: "released" });
    process.stdout.write(
      `${JSON.stringify({ settled: result.settled, status: result.reservation?.status ?? "" })}\n`,
    );
    return;
  }

  if (command === "count") {
    const period = budgetPeriodOf(at);
    const holds = await budget.readAiBudgetHolds({ periodKey: period.key, currency: "CNY", at });
    process.stdout.write(`${JSON.stringify({ ...holds, periodKey: period.key })}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify({ ok: false, code: "UNKNOWN_COMMAND", message: command })}\n`);
}

void main();
