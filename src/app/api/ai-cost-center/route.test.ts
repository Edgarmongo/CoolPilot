import { describe, expect, it } from "vitest";

/**
 * CI-P7-02: the AI 成本与质量优化中心's first page over HTTP.
 *
 * The arithmetic is pinned where it lives (`summarizeAiUsageLedger` and the helpers beside it).
 * What only this file can check is what the route is responsible for: that one answer carries both
 * readings of *the same* window, that the money figure never claims more than the ledger can state,
 * and that the catalog names the dimensions it cannot price instead of calling them free.
 *
 * The harness pins the temp database before anything that reads it loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
await import("@/test/route-harness");

const { GET } = await import("./route");
const { createAiUsageLedgerEntry, createAiModelPrice } = await import("@/db/repositories/ai-usage-ledger");
const { usageRangeStart } = await import("@/lib/usage");

type CostCenterPayload = {
  ok: boolean;
  code?: string;
  data?: {
    range: number;
    ledger: {
      from: number;
      to: number;
      totals: {
        attempts: number;
        costAmount: number;
        unpricedAttempts: number;
        unmeasuredAttempts: number;
        costIsComplete: boolean;
      };
      byCostSource: Array<{ source: string; attempts: number; costAmount: number | null }>;
      costByCurrency: Array<{ currency: string; amount: number; attempts: number }>;
      byDay: Array<{ dayStart: number; attempts: number; costAmount: number; unpricedAttempts: number }>;
    };
    usage: { rangeDays: number; totals: { articles: number } };
    catalog: {
      meteredKinds: string[];
      pricedKinds: string[];
      metering: Array<{
        kind: string;
        attempts: number;
        measuredAttempts: number;
        unpricedAttempts: number;
        unmeasuredAttempts: number;
        reasons: string[];
        priced: boolean;
        gap: string;
      }>;
    };
  };
};

async function getCostCenter(query = "") {
  const response = await GET(new Request(`http://localhost/api/ai-cost-center${query}`));
  return { status: response.status, body: (await response.json()) as CostCenterPayload };
}

const sourceOf = (body: CostCenterPayload, source: string) =>
  body.data?.ledger.byCostSource.find((entry) => entry.source === source);

describe("/api/ai-cost-center", () => {
  it("answers one window with the ledger's money view and the delivered-output view", async () => {
    await createAiModelPrice({
      providerId: "cc-priced",
      currency: "CNY",
      inputPerMillion: 3,
      outputPerMillion: 0,
      priceVersion: "2026-10",
      effectiveFrom: 1_700_000_000_000,
    });
    await createAiUsageLedgerEntry({
      purpose: "article",
      providerId: "cc-priced",
      modelId: "m1",
      tokens: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 },
      completeness: "reported",
      costAmount: 0.5,
      costCurrency: "CNY",
      costSource: "computed",
    });
    await createAiUsageLedgerEntry({
      purpose: "extraction",
      providerId: "cc-unpriced",
      modelId: "m2",
      tokens: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
      completeness: "reported",
      costAmount: null,
      costSource: "unpriced",
    });

    const answer = await getCostCenter();
    expect(answer.status).toBe(200);
    expect(answer.body.ok).toBe(true);

    // The rows this file wrote are the only recent ones in this database.
    expect(answer.body.data?.ledger.totals.attempts).toBe(2);
    expect(answer.body.data?.ledger.totals.costAmount).toBe(0.5);
    expect(answer.body.data?.ledger.totals.unpricedAttempts).toBe(1);
    // A partial figure is never presented as the bill.
    expect(answer.body.data?.ledger.totals.costIsComplete).toBe(false);

    // Where the money came from, said out loud: one estimated charge, and the sources that stated
    // nothing keep `null` - 0 there would read as "these calls were free".
    expect(sourceOf(answer.body, "computed")).toEqual({ source: "computed", attempts: 1, costAmount: 0.5 });
    expect(sourceOf(answer.body, "provider-reported")).toEqual({
      source: "provider-reported",
      attempts: 0,
      costAmount: null,
    });
    expect(sourceOf(answer.body, "unpriced")).toEqual({ source: "unpriced", attempts: 1, costAmount: null });
    expect(sourceOf(answer.body, "unknown")).toEqual({ source: "unknown", attempts: 0, costAmount: null });

    // The currency travels with the amount rather than being assumed.
    expect(answer.body.data?.ledger.costByCurrency).toEqual([{ currency: "CNY", amount: 0.5, attempts: 1 }]);

    // One local day, carrying its unstated call beside its stated one.
    const days = answer.body.data?.ledger.byDay ?? [];
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ attempts: 2, costAmount: 0.5, unpricedAttempts: 1 });

    // The other half of the same window: what was actually delivered (0 here - nothing was
    // delivered in this database), read through the same 7-day default.
    expect(answer.body.data?.usage.rangeDays).toBe(7);
    expect(answer.body.data?.usage.totals.articles).toBe(0);

    // Only `text` has a price in force; the other dimensions are named rather than called free.
    expect(answer.body.data?.catalog.pricedKinds).toEqual(["text"]);
    expect(answer.body.data?.catalog.meteredKinds).toEqual(
      expect.arrayContaining(["text", "image", "video", "speech", "embedding", "agent"]),
    );
  });

  it("reads the window the 用量统计 page reads, and answers an unknown one with the default", async () => {
    const explicit = await getCostCenter("?range=30");
    expect(explicit.body.data?.range).toBe(30);
    expect(explicit.body.data?.ledger.from).toBe(usageRangeStart(30));
    expect(explicit.body.data?.usage.rangeDays).toBe(30);

    // A range the product does not offer is not an error to shout about - it is the default, and it
    // is the same default the other page falls back to.
    const nonsense = await getCostCenter("?range=999");
    expect(nonsense.status).toBe(200);
    expect(nonsense.body.data?.range).toBe(7);
    expect(nonsense.body.data?.ledger.from).toBe(usageRangeStart(7));
  });

  it("never lets a call it could not cost move the money figure", async () => {
    const before = await getCostCenter();
    await createAiUsageLedgerEntry({
      purpose: "article",
      providerId: "cc-unknown",
      modelId: "m3",
      outcome: "failed",
      costAmount: null,
      costSource: "computed",
    });
    const after = await getCostCenter();

    // The write asked for `computed` with no amount, which the writer refuses to store: a row with
    // no figure says so (`unknown`), so the summary counts it as unmeasured instead of pricing it.
    expect(after.body.data?.ledger.totals.costAmount).toBe(before.body.data?.ledger.totals.costAmount);
    expect(after.body.data?.ledger.totals.unmeasuredAttempts).toBe(
      (before.body.data?.ledger.totals.unmeasuredAttempts ?? 0) + 1,
    );
    expect(sourceOf(after.body, "unknown")?.costAmount).toBeNull();
  });

  it("counts a dimension as priced only when its price is already in force", async () => {
    // A declared-free model is priced: "free" is a stated price, not a missing one.
    await createAiModelPrice({
      providerId: "cc-free",
      meteredKind: "image",
      currency: "USD",
      unitLabel: "image",
      unitPrice: 0,
      declaredFree: true,
      priceVersion: "2026-10",
      effectiveFrom: 1_700_000_000_000,
    });
    // A price that starts tomorrow is not a price today.
    await createAiModelPrice({
      providerId: "cc-future",
      meteredKind: "speech",
      currency: "USD",
      unitLabel: "second",
      unitPrice: 1,
      priceVersion: "2026-10",
      effectiveFrom: Date.now() + 86_400_000,
    });

    const answer = await getCostCenter();
    expect(answer.body.data?.catalog.pricedKinds).toEqual(expect.arrayContaining(["text", "image"]));
    expect(answer.body.data?.catalog.pricedKinds).not.toContain("speech");
  });

  it("names every dimension, including the ones this runtime cannot meter (CI-P7-05-04)", async () => {
    const answer = await getCostCenter();
    const data = answer.body.data;
    const metering = data?.catalog.metering ?? [];

    // Every dimension the ledger knows, in the vocabulary's own order, whether or not it was called.
    expect(metering.map((entry) => entry.kind)).toEqual([
      "text",
      "image",
      "video",
      "speech",
      "embedding",
      "agent",
    ]);

    // 无法准确计量 is *stated* rather than being a dimension that never appears: this runtime still has no
    // call path for video, and agent money is metered as the text rows of its nodes rather than as rows of its
    // own. `embedding` is no longer in that list (CI-EMB-01): the knowledge index writes its own rows.
    expect(metering.find((entry) => entry.kind === "video")).toMatchObject({
      attempts: 0,
      gap: "no-runtime-path",
    });
    expect(metering.find((entry) => entry.kind === "embedding")).toMatchObject({ gap: "" });
    expect(metering.find((entry) => entry.kind === "agent")).toMatchObject({ gap: "metered-through-text" });

    // The window's own rows, with the same counts the headline is built from - and the reason the
    // unpriced rows cannot state a figure, read off those rows rather than assumed from the catalog.
    const text = metering.find((entry) => entry.kind === "text");
    expect(text?.unpricedAttempts).toBe(data?.ledger.totals.unpricedAttempts);
    expect(text?.reasons).toContain("no-price-for-dimension");
    // An image dimension with rows this file never wrote: nothing to read, and no gap either.
    expect(metering.find((entry) => entry.kind === "image")).toMatchObject({ attempts: 0, gap: "" });
  });
});
