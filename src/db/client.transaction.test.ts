import { describe, expect, it } from "vitest";

/**
 * CI-P7-03-A 侦察证据：这个文件只回答一个问题——**这个数据库真的会做事务吗**。
 *
 * 为什么必须先问：整个仓库此前**没有一处** `db.transaction(...)`（实测 `grep` 零命中），预算预留要
 * 跨进程原子地「读已花 + 写预留」，如果底层不支持事务，那么任何「先读后写」的写法在第二个进程面前
 * 都是假的。驱动是 `@libsql/client` + `drizzle-orm/libsql` 的**本地文件库**（不是远程 HTTP），
 * 这一点必须实测而不是照文档推断。
 *
 * 结论用行为固定下来，而不是写进注释里：
 *
 *  - 抛错能**回滚**（半条账本行都不留）；
 *  - 不抛错能**提交**；
 *  - 不带事务的**单条语句**本身就带参数绑定与 `rowsAffected`（条件 INSERT 的基础）。
 *
 * 夹具口径与 `src/test/route-harness.ts` 一致：临时库必须在这条链上第一个 `await` 之前钉死。
 */
await import("@/test/route-harness");

const { db, sqlite, ensureDatabase } = await import("@/db/client");
const { aiUsageLedger } = await import("@/db/schema");
const { listAiUsageLedgerEntries } = await import("@/db/repositories/ai-usage-ledger");

const ledgerRow = (id: string, at: number) => ({
  id,
  purpose: "client-transaction-probe",
  outcome: "success" as const,
  providerId: "",
  modelId: "",
  endpointId: "",
  credentialLabel: "",
  attemptIndex: 0,
  taskId: "",
  runId: "",
  nodeId: "",
  parentUsageId: "",
  outputAssetId: "",
  contentItemId: "",
  meteredKind: "text" as const,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  completeness: "unknown" as const,
  quantityJson: "{}",
  costAmount: null,
  costCurrency: "",
  costSource: "unknown" as const,
  pricingJson: "null",
  durationMs: 0,
  errorSummary: "",
  createdAt: at,
});

describe("the database's transactional ability", () => {
  it("rolls a drizzle transaction back when the body throws", async () => {
    await ensureDatabase();
    const before = (await listAiUsageLedgerEntries({ limit: 5000 })).length;

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(aiUsageLedger).values(ledgerRow("tx-rollback", Date.now()));
        // Both rows are written before the throw: a rollback that only undid the last statement
        // would leave the first one behind and pass a weaker test than this one.
        await tx.insert(aiUsageLedger).values(ledgerRow("tx-rollback-2", Date.now()));
        throw new Error("probe-rollback");
      }),
    ).rejects.toThrow("probe-rollback");

    expect((await listAiUsageLedgerEntries({ limit: 5000 })).length).toBe(before);
  });

  it("commits a drizzle transaction that returns normally", async () => {
    await ensureDatabase();
    const before = (await listAiUsageLedgerEntries({ limit: 5000 })).length;

    await db.transaction(async (tx) => {
      await tx.insert(aiUsageLedger).values(ledgerRow("tx-commit", Date.now()));
    });

    expect((await listAiUsageLedgerEntries({ limit: 5000 })).length).toBe(before + 1);
  });

  it("binds arguments and reports rows affected on a single statement, without a transaction", async () => {
    await ensureDatabase();

    // This is the primitive the reservation hold is built on: one statement that both reads the
    // state it compares against and writes the row, so nothing can slip between the two.
    const answer = await sqlite.execute({
      sql: `INSERT INTO ai_usage_ledger (id, purpose, created_at)
            SELECT ?, ?, ?
            WHERE (SELECT COUNT(*) FROM ai_usage_ledger WHERE id IN (?, ?)) = 1`,
      args: ["tx-conditional", "client-transaction-probe-conditional", Date.now(), "tx-commit", "tx-rollback"],
    });
    expect(answer.rowsAffected).toBe(1);

    const refused = await sqlite.execute({
      sql: `INSERT INTO ai_usage_ledger (id, purpose, created_at)
            SELECT ?, ?, ?
            WHERE (SELECT COUNT(*) FROM ai_usage_ledger WHERE id = ?) = 1`,
      args: ["tx-conditional-2", "client-transaction-probe-conditional", Date.now(), "no-such-row"],
    });
    // A condition that is not met inserts **nothing** - it does not throw, and it does not write a
    // partial row. `rowsAffected` is what tells the caller which of the two happened.
    expect(refused.rowsAffected).toBe(0);
    expect((await listAiUsageLedgerEntries({ limit: 5000 })).some((row) => row.id === "tx-conditional-2")).toBe(
      false,
    );
  });
});
