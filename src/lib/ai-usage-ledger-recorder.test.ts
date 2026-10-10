import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ModelAttempt } from "@/features/ai-runtime/contracts";

/**
 * The ledger writer (CI-P7-01-04 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Every case here is a statement about a **request**, not about a call, because that is the unit of
 * account the card settled on:
 *
 * - one row per request the runtime sent, in order (`attemptIndex`), chained (`parentUsageId`);
 * - a self-correcting re-ask is a second row, because it was a second charge - the predecessor's
 *   `outcome: "success"` next to a later row is what identifies a self-correction, which is why the
 *   table needs no `kind` column of its own (`kind` is asserted in `runtime.test.ts`, where the
 *   trail is produced);
 * - a failed request is `failed` with a NULL cost: never a `0` a total would swallow;
 * - a measured request with no price on file is `unpriced` with a NULL cost, and its tokens are
 *   still counted;
 * - the price is frozen onto the row, so editing the catalog later cannot restate what it cost;
 * - a write the ledger could not complete says so (`failed: true`) instead of reporting success,
 *   and an error that carried no trail writes nothing at all - those are different facts.
 *
 * The temp database is pinned before the writer is imported, because `@/db/client` resolves its URL
 * once per process (the same three lines as `src/db/repositories/brands.test.ts`).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-ai-ledger-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "ledger.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { recordAiUsageCall, recordAiUsageFailure } = await import("./ai-usage-ledger-recorder");
const { attachModelAttempts } = await import("@/features/ai-runtime/trail");
const { createAiModelPrice, listAiUsageLedgerEntries } = await import("@/db/repositories/ai-usage-ledger");

/** One request the runtime sent: the one that answered, unless a case says otherwise. */
function attempt(over: Partial<ModelAttempt> = {}): ModelAttempt {
  return {
    kind: "answer",
    outcome: "success",
    providerId: "qwen",
    modelId: "qwen3-max",
    endpointId: "qwen-default",
    credentialLabel: "****1234",
    error: "",
    ...over,
  };
}

describe("ai usage ledger writer", () => {
  it("writes one row per request, in the order they were sent, chained to the one before", async () => {
    const written = await recordAiUsageCall({
      purpose: "article",
      contentItemId: "content-1",
      attempts: [
        attempt({ outcome: "failed", credentialLabel: "****bad", error: "HTTP 401" }),
        attempt({ usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } }),
      ],
    });

    expect(written.failed).toBe(false);
    expect(written.reported).toBe(2);
    expect(written.rows.map((row) => row.attemptIndex)).toEqual([0, 1]);
    expect(written.rows.map((row) => row.outcome)).toEqual(["failed", "success"]);
    expect(written.rows.map((row) => row.credentialLabel)).toEqual(["****bad", "****1234"]);
    expect(written.rows[0].parentUsageId).toBe("");
    expect(written.rows[1].parentUsageId).toBe(written.rows[0].id);
    expect(written.rows[1].contentItemId).toBe("content-1");
    expect(written.rows[0].errorSummary).toBe("HTTP 401");
    expect(written.rows[1].errorSummary).toBe("");
    // The rows are the ledger, not a return value: read them back the way a summary will.
    expect(await listAiUsageLedgerEntries({ contentItemId: "content-1" })).toHaveLength(2);
  });

  it("prices nothing it did not measure, and invents no zero", async () => {
    const written = await recordAiUsageCall({
      purpose: "article",
      contentItemId: "content-unpriced",
      attempts: [attempt({ usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } })],
    });

    // No catalog row exists for qwen/qwen3-max in this database, so a measured call is `unpriced`
    // with a NULL cost - and its tokens are still counted, because that part *was* measured.
    expect(written.rows[0].completeness).toBe("reported");
    expect(written.rows[0].costSource).toBe("unpriced");
    expect(written.rows[0].costAmount).toBeNull();
    expect(written.rows[0].costCurrency).toBe("");
    expect(written.rows[0].pricing).toBeNull();
    expect(written.rows[0].tokens.totalTokens).toBe(14);
  });

  it("records a request that reported nothing as unknown rather than as zero tokens", async () => {
    const written = await recordAiUsageCall({
      purpose: "image",
      meteredKind: "image",
      quantity: { images: 1 },
      attempts: [attempt({ usage: undefined })],
    });

    expect(written.rows[0].outcome).toBe("success");
    expect(written.rows[0].completeness).toBe("unknown");
    expect(written.rows[0].costSource).toBe("unknown");
    expect(written.rows[0].costAmount).toBeNull();
    // What an image call *can* say about itself is stored: the modality and how many it produced.
    expect(written.rows[0].meteredKind).toBe("image");
    expect(JSON.parse(written.rows[0].quantityJson)).toEqual({ images: 1 });
  });

  it("charges a self-correcting re-ask as its own row", async () => {
    const written = await recordAiUsageCall({
      purpose: "content-translate",
      contentItemId: "content-2",
      attempts: [
        attempt({ usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }),
        attempt({ kind: "self-correction", usage: { inputTokens: 140, outputTokens: 30, totalTokens: 170 } }),
      ],
    });

    expect(written.rows.map((row) => row.tokens.totalTokens)).toEqual([120, 170]);
    expect(written.rows.map((row) => row.outcome)).toEqual(["success", "success"]);
    expect(written.rows[1].parentUsageId).toBe(written.rows[0].id);
  });

  it("records every request of a call that failed outright, with no cost claimed", async () => {
    const failure = attachModelAttempts(new Error("boom"), [
      attempt({ outcome: "failed", error: "HTTP 401", credentialLabel: "****bad" }),
      attempt({ outcome: "failed", error: "HTTP 503", credentialLabel: "****good" }),
    ]);

    const written = await recordAiUsageFailure({ purpose: "agent-plan", runId: "run-7", nodeId: "planner" }, failure);

    expect(written.failed).toBe(false);
    expect(written.rows.map((row) => row.outcome)).toEqual(["failed", "failed"]);
    expect(written.rows.map((row) => row.errorSummary)).toEqual(["HTTP 401", "HTTP 503"]);
    expect(written.rows.map((row) => row.completeness)).toEqual(["unknown", "unknown"]);
    expect(written.rows.map((row) => row.costAmount)).toEqual([null, null]);
    expect(written.rows.every((row) => row.costSource === "unknown")).toBe(true);
    // Both rows carry the business identity, which is what makes a failed call attributable at all.
    expect(written.rows.map((row) => row.runId)).toEqual(["run-7", "run-7"]);
    expect(written.rows.map((row) => row.nodeId)).toEqual(["planner", "planner"]);
  });

  it("writes nothing when no request was sent, which is not the same as a failed write", async () => {
    const written = await recordAiUsageFailure({ purpose: "knowledge" }, new Error("no model is configured"));

    expect(written).toEqual({ rows: [], reported: 0, failed: false });
  });
});

describe("ai usage ledger writer, price catalog", () => {
  it("applies the price in force, freezes it onto the row, and never restates it later", async () => {
    await createAiModelPrice({
      providerId: "deepseek",
      modelId: "deepseek-chat",
      currency: "CNY",
      inputPerMillion: 2,
      outputPerMillion: 8,
      priceVersion: "2026-01",
    });

    const written = await recordAiUsageCall({
      purpose: "rewrite",
      runId: "run-price",
      attempts: [
        attempt({
          providerId: "deepseek",
          modelId: "deepseek-chat",
          usage: { inputTokens: 1_000_000, outputTokens: 500_000, totalTokens: 1_500_000 },
        }),
      ],
    });

    // 1M input at 2 plus 0.5M output at 8 = 2 + 4.
    expect(written.rows[0].costSource).toBe("computed");
    expect(written.rows[0].costAmount).toBeCloseTo(6, 6);
    expect(written.rows[0].costCurrency).toBe("CNY");
    expect(written.rows[0].pricing).toMatchObject({
      currency: "CNY",
      inputPerMillion: 2,
      outputPerMillion: 8,
      priceVersion: "2026-01",
    });

    // Changing the catalog adds a *new* row, at a later instant (the key is one price per instant).
    // The copy already on this ledger row is what answers "what did that call cost", and nothing
    // re-reads the catalog to answer it again.
    await createAiModelPrice({
      providerId: "deepseek",
      modelId: "deepseek-chat",
      inputPerMillion: 100,
      outputPerMillion: 100,
      priceVersion: "2026-02",
      effectiveFrom: Date.now() + 60_000,
    });
    const stored = (await listAiUsageLedgerEntries({ from: Date.now() - 60_000 })).find(
      (row) => row.runId === "run-price",
    );
    expect(stored?.pricing?.priceVersion).toBe("2026-01");
    expect(stored?.costAmount).toBeCloseTo(6, 6);
  });

  it("reports a write it could not complete instead of claiming the call is in the ledger", async () => {
    const written = await recordAiUsageCall({
      purpose: "article",
      // A value SQLite cannot bind. What breaks here is not the point: the point is that a
      // bookkeeping write which fails is *reported* - and the caller's own work is untouched -
      // rather than coming back as an empty success. "The ledger missed this call" and "nothing was
      // recorded because nothing happened" are different facts about the same table.
      runId: { not: "bindable" } as unknown as string,
      attempts: [attempt()],
    });

    expect(written.failed).toBe(true);
    expect(written.rows).toEqual([]);
    expect(written.reported).toBe(1);
  });
});
