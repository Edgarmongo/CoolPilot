import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AppError } from "@/lib/app-errors";

/**
 * The ledger and price catalog as the database sees them (CI-P7-01-04 of
 * `docs/coolpilot-capability-integration-plan.md`).
 *
 * `src/lib/ai-usage-ledger.test.ts` already pins the arithmetic and
 * `src/lib/ai-usage-ledger-recorder.test.ts` pins what a call turns into. What is left for this file
 * is the boundary those two sit on, because it is where a wrong answer would be invisible rather
 * than loud:
 *
 * - the price catalog is append-only (a new price is a new row), which is what makes "what did that
 *   call cost in March" answerable at all;
 * - an exact model row beats the provider's `*` fallback whatever their dates are, and the fallback
 *   never leaks across providers - the two ways a wrong price could be applied silently;
 * - a price that is not in force yet is not used (`null`), and `null` is what makes a ledger row
 *   `unpriced` instead of a zero the user would read as "free";
 * - a windowed summary states a total over the rows it could cost and reports the rows it could not,
 *   rather than presenting a partial figure as the whole bill.
 *
 * The temp database is pinned before the repository is imported, because `@/db/client` resolves its
 * URL once per process (the same three lines as `src/db/repositories/brands.test.ts`).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-ai-ledger-repo-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "ledger.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { createAiUsageLedgerEntry, createAiModelPrice, listAiModelPrices, listAiUsageLedgerEntries, resolveModelPrice, summarizeAiUsageLedgerRange } =
  await import("./ai-usage-ledger");

const dayMs = 86_400_000;

describe("ai model price catalog", () => {
  it("returns no price when the catalog has nothing to say", async () => {
    expect(await resolveModelPrice("provider-with-no-prices", "any-model")).toBeNull();
  });

  it("keeps every row, so a price change is a new version rather than an edit", async () => {
    const base = Date.now() - 3 * dayMs;
    await createAiModelPrice({
      providerId: "history-provider",
      modelId: "m",
      inputPerMillion: 1,
      outputPerMillion: 0,
      priceVersion: "v1",
      effectiveFrom: base,
    });
    await createAiModelPrice({
      providerId: "history-provider",
      modelId: "m",
      inputPerMillion: 2,
      outputPerMillion: 0,
      priceVersion: "v2",
      effectiveFrom: base + 1,
    });

    const rows = await listAiModelPrices({ providerId: "history-provider" });
    expect(rows.map((row) => row.priceVersion).sort()).toEqual(["v1", "v2"]);
  });

  it("prefers the exact model row over the provider fallback, whatever their dates are", async () => {
    await createAiModelPrice({ providerId: "exact-provider", modelId: "*", inputPerMillion: 9, outputPerMillion: 9, priceVersion: "fallback" });
    await createAiModelPrice({ providerId: "exact-provider", modelId: "exact-model", inputPerMillion: 1, outputPerMillion: 2, priceVersion: "exact" });

    const exact = await resolveModelPrice("exact-provider", "exact-model");
    expect(exact?.priceVersion).toBe("exact");
    expect(exact?.inputPerMillion).toBe(1);

    // A model with no row of its own is the reason the fallback exists at all.
    expect((await resolveModelPrice("exact-provider", "other-model"))?.priceVersion).toBe("fallback");
  });

  it("keeps a provider's fallback inside that provider", async () => {
    await createAiModelPrice({ providerId: "scoped-provider", modelId: "*", inputPerMillion: 1, outputPerMillion: 1 });

    expect(await resolveModelPrice("scoped-provider", "anything")).not.toBeNull();
    expect(await resolveModelPrice("another-provider", "anything")).toBeNull();
  });

  it("does not price with a row that is not in force yet", async () => {
    const from = Date.now() + dayMs;
    await createAiModelPrice({ providerId: "future-provider", modelId: "*", inputPerMillion: 1, outputPerMillion: 1, effectiveFrom: from, priceVersion: "tomorrow" });

    expect(await resolveModelPrice("future-provider", "m")).toBeNull();
    expect((await resolveModelPrice("future-provider", "m", from + 1000))?.priceVersion).toBe("tomorrow");
  });
});

/**
 * CI-P7-01-05: the dimension is part of the key, part of the lookup, and part of what a refusal
 * has to say.
 */
describe("ai model price catalog, by dimension", () => {
  it("does not price a call whose dimension has no row of its own", async () => {
    await createAiModelPrice({
      providerId: "kind-scoped",
      modelId: "*",
      inputPerMillion: 2,
      outputPerMillion: 2,
      priceVersion: "text-only",
    });
    const at = Date.now() + dayMs;

    // The text price is in force, but an image is not a text call: the answer is "no price on
    // file", never the text rate applied to an image.
    expect((await resolveModelPrice("kind-scoped", "anything", at, "text"))?.priceVersion).toBe("text-only");
    expect(await resolveModelPrice("kind-scoped", "anything", at, "image")).toBeNull();
    expect(await resolveModelPrice("kind-scoped", "anything", at, "video")).toBeNull();
  });

  it("lets a text price and an image price coexist for one model at one instant", async () => {
    const at = Date.now() + dayMs;
    await createAiModelPrice({
      providerId: "two-kinds",
      modelId: "m",
      inputPerMillion: 1,
      outputPerMillion: 1,
      effectiveFrom: at,
      priceVersion: "text-v1",
    });
    await createAiModelPrice({
      providerId: "two-kinds",
      modelId: "m",
      meteredKind: "image",
      currency: "USD",
      unitPrice: 0.04,
      unitLabel: "image",
      effectiveFrom: at,
      priceVersion: "image-v1",
    });

    const text = await resolveModelPrice("two-kinds", "m", at, "text");
    const image = await resolveModelPrice("two-kinds", "m", at, "image");
    expect(text?.inputPerMillion).toBe(1);
    expect(image?.unitPrice).toBe(0.04);
    expect(image?.unitLabel).toBe("image");
  });

  it("prefers a dimension's exact model row over that dimension's fallback", async () => {
    const at = Date.now() + dayMs;
    await createAiModelPrice({
      providerId: "kind-tiers",
      modelId: "*",
      meteredKind: "image",
      unitPrice: 0.09,
      unitLabel: "image",
      effectiveFrom: at,
    });
    await createAiModelPrice({
      providerId: "kind-tiers",
      modelId: "exact",
      meteredKind: "image",
      unitPrice: 0.02,
      unitLabel: "image",
      effectiveFrom: at,
    });

    expect((await resolveModelPrice("kind-tiers", "exact", at, "image"))?.unitPrice).toBe(0.02);
    expect((await resolveModelPrice("kind-tiers", "other", at, "image"))?.unitPrice).toBe(0.09);
    // A text call has no text row at all, whatever the image rows say.
    expect(await resolveModelPrice("kind-tiers", "exact", at, "text")).toBeNull();
  });

  it("says the key collision in business terms instead of leaking the SQLite message", async () => {
    const at = Date.now() + dayMs;
    await createAiModelPrice({
      providerId: "dup-provider",
      modelId: "m",
      inputPerMillion: 1,
      outputPerMillion: 1,
      effectiveFrom: at,
      priceVersion: "v1",
    });

    const failure = await createAiModelPrice({
      providerId: "dup-provider",
      modelId: "m",
      inputPerMillion: 2,
      outputPerMillion: 2,
      effectiveFrom: at,
      priceVersion: "v2",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).code).toBe("AI_PRICE_CONFLICT");
    expect((failure as AppError).status).toBe(409);
    expect((failure as AppError).message).not.toMatch(/UNIQUE constraint/i);
    expect((failure as AppError).details).toMatchObject({
      providerId: "dup-provider",
      meteredKind: "text",
      effectiveFrom: at,
    });
  });

  it("refuses a row that does not describe a priceable dimension", async () => {
    // A token row with no output rate: the default this replaced turned exactly this into a free
    // output side without anyone saying so.
    await expect(
      createAiModelPrice({ providerId: "shape", modelId: "m", inputPerMillion: 1, priceVersion: "v1" }),
    ).rejects.toMatchObject({ code: "AI_PRICE_INVALID", status: 400 });

    // Genuinely all zero and not declared: refused rather than stored as free.
    await expect(
      createAiModelPrice({
        providerId: "shape",
        modelId: "m",
        inputPerMillion: 0,
        outputPerMillion: 0,
        priceVersion: "v1",
      }),
    ).rejects.toMatchObject({ code: "AI_PRICE_INVALID" });

    // The same all-zero row, declared, is a real answer.
    const free = await createAiModelPrice({
      providerId: "shape-free",
      modelId: "m",
      inputPerMillion: 0,
      outputPerMillion: 0,
      declaredFree: true,
      priceVersion: "v1",
    });
    expect(free?.declaredFree).toBe(true);

    // A token row may not carry a per-unit rate, and a per-unit row has to name its unit.
    await expect(
      createAiModelPrice({
        providerId: "shape",
        modelId: "m",
        inputPerMillion: 1,
        outputPerMillion: 1,
        unitPrice: 0.5,
        priceVersion: "v1",
      }),
    ).rejects.toMatchObject({ code: "AI_PRICE_INVALID" });
    await expect(
      createAiModelPrice({
        providerId: "shape",
        modelId: "m",
        meteredKind: "image",
        unitPrice: 0.5,
        priceVersion: "v1",
      }),
    ).rejects.toMatchObject({ code: "AI_PRICE_INVALID" });
    await expect(
      createAiModelPrice({
        providerId: "shape",
        modelId: "m",
        meteredKind: "speech",
        unitPrice: 0.5,
        unitLabel: "second",
        priceVersion: "v1",
      }),
    ).resolves.toMatchObject({ meteredKind: "speech", unitLabel: "second" });
  });
});

describe("ai usage ledger reads", () => {
  it("filters by the window it was given instead of returning everything", async () => {
    const old = await createAiUsageLedgerEntry({
      purpose: "window-old",
      providerId: "window-provider",
      modelId: "m",
      createdAt: Date.now() - 10 * dayMs,
    });

    const recent = await listAiUsageLedgerEntries({ from: Date.now() - 3 * dayMs });
    const all = await listAiUsageLedgerEntries({});

    expect(all.map((row) => row.id)).toContain(old?.id);
    expect(recent.map((row) => row.id)).not.toContain(old?.id);
  });

  it("states a total over the rows it could cost and reports the ones it could not", async () => {
    const priced = await createAiUsageLedgerEntry({
      purpose: "summary-purpose",
      providerId: "summary-priced",
      modelId: "m1",
      tokens: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 },
      completeness: "reported",
      costAmount: 3,
      costCurrency: "CNY",
      costSource: "computed",
      pricing: {
        meteredKind: "text",
        currency: "CNY",
        inputPerMillion: 3,
        outputPerMillion: 0,
        priceVersion: "v1",
        source: "manual",
      },
    });
    await createAiUsageLedgerEntry({
      purpose: "summary-purpose",
      providerId: "summary-unpriced",
      modelId: "m2",
      tokens: { inputTokens: 500, outputTokens: 0, totalTokens: 500 },
      completeness: "reported",
      costAmount: null,
      costSource: "unpriced",
    });

    const summary = await summarizeAiUsageLedgerRange(7);

    // The two rows this case wrote are the only recent ones in this database.
    expect(summary.totals.attempts).toBe(2);
    expect(summary.totals.successes).toBe(2);
    expect(summary.totals.costAmount).toBe(3);
    expect(summary.totals.totalTokens).toBe(1_000_500);
    // One row could not be costed, so the headline figure is *part of* the bill - and says so.
    expect(summary.totals.unpricedAttempts).toBe(1);
    expect(summary.totals.unmeasuredAttempts).toBe(0);
    expect(summary.totals.costIsComplete).toBe(false);
    expect(summary.byModel.find((group) => group.key === "summary-priced::m1")?.costAmount).toBe(3);
    expect(summary.byModel.find((group) => group.key === "summary-unpriced::m2")?.hasUnpricedAttempts).toBe(true);
    expect(priced?.costSource).toBe("computed");
  });
});
