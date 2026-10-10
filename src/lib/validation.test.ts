import { describe, expect, it } from "vitest";
import {
  aiModelPriceInputSchema,
  importUrlSchema,
  runInputSchema,
  scheduleInputSchema,
  scheduleTimeSchema,
} from "./validation";

describe("validation", () => {
  it("rejects non-http URL imports", () => {
    expect(importUrlSchema.safeParse({ url: "not-a-url" }).success).toBe(false);
  });

  it("accepts a Threads run payload", () => {
    const parsed = runInputSchema.parse({
      playbookId: "threads_auto_post",
      accountId: "site_1",
      params: { contentFolder: "C:/tmp/posts", confirmLivePost: false },
    });
    expect(parsed.playbookId).toBe("threads_auto_post");
  });
});

describe("schedule input", () => {
  it("accepts every recurrence rule the calendar can create", () => {
    const parsed = scheduleInputSchema.parse({
      playbookId: "threads_compose_post",
      scheduleTimes: [
        { type: "weekly", time: "09:30", weekdays: [1, 3, 5] },
        { type: "monthly", time: "20:00", days: [1, 15, 31] },
        { type: "interval", everyMinutes: 90 },
      ],
    });
    expect(parsed.scheduleTimes).toHaveLength(3);
    expect(parsed.enabled).toBe(true);
  });

  it("rejects malformed recurrence rules", () => {
    expect(scheduleTimeSchema.safeParse({ type: "weekly", time: "09:30", weekdays: [] }).success).toBe(false);
    expect(scheduleTimeSchema.safeParse({ type: "weekly", time: "09:30", weekdays: [7] }).success).toBe(false);
    expect(scheduleTimeSchema.safeParse({ type: "monthly", time: "20:00", days: [0] }).success).toBe(false);
    expect(scheduleTimeSchema.safeParse({ type: "interval", everyMinutes: 1 }).success).toBe(false);
    expect(scheduleTimeSchema.safeParse({ type: "daily", time: "9:30" }).success).toBe(false);
  });
});

/**
 * CI-P7-01-05: the price catalog refuses at the boundary, so the field a user got wrong is named
 * before anything is written. What a row has to *mean* is asserted by `createAiModelPrice`; this
 * schema owns format.
 */
describe("ai model price input", () => {
  const tokenPrice = {
    providerId: "deepseek",
    currency: "CNY",
    inputPerMillion: 2,
    outputPerMillion: 8,
    priceVersion: "2026-10",
  };

  it("accepts a token price and fills in the parts that have an obvious default", () => {
    expect(aiModelPriceInputSchema.parse(tokenPrice)).toMatchObject({
      meteredKind: "text",
      modelId: "*",
      source: "manual",
      declaredFree: false,
      unitLabel: "",
    });
  });

  it("leaves a rate that was not stated unstated, so the catalog can refuse it", () => {
    const { outputPerMillion, ...withoutOutput } = tokenPrice;
    expect(outputPerMillion).toBe(8);

    // The default this replaced turned exactly this payload into "output is free". The schema must
    // not invent the 0 that would have made that claim, or the written row would be a lie.
    const parsed = aiModelPriceInputSchema.parse(withoutOutput);
    expect(parsed.outputPerMillion).toBeUndefined();
    expect(parsed.outputPerMillion).not.toBe(0);
  });

  it("rejects a currency it cannot copy onto a ledger row", () => {
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, currency: "BTC" }).success).toBe(false);
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, currency: "cny" }).success).toBe(false);
    // Required, not defaulted: the currency lands on every row this price costs.
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, currency: undefined }).success).toBe(false);
  });

  it("rejects a price that is not a finite, non-negative, sane number", () => {
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, inputPerMillion: -1 }).success).toBe(false);
    expect(
      aiModelPriceInputSchema.safeParse({ ...tokenPrice, inputPerMillion: Number.POSITIVE_INFINITY }).success,
    ).toBe(false);
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, inputPerMillion: 2_000_000 }).success).toBe(false);
  });

  it("requires a version and a well-formed provider id", () => {
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, priceVersion: "   " }).success).toBe(false);
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, priceVersion: undefined }).success).toBe(false);
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, providerId: "deep seek" }).success).toBe(false);
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, providerId: "" }).success).toBe(false);
  });

  it("rejects an effective time that cannot mean what it says", () => {
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, effectiveFrom: -1 }).success).toBe(false);
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, effectiveFrom: 1_700_000_000.5 }).success).toBe(false);
    // Seconds where milliseconds belong: a timestamp a provider's own clock would not reach.
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, effectiveFrom: Date.now() * 1000 }).success).toBe(
      false,
    );
    expect(
      aiModelPriceInputSchema.safeParse({ ...tokenPrice, effectiveFrom: Date.now() + 20 * 365 * 86_400_000 })
        .success,
    ).toBe(false);

    // A scheduled change is a real use...
    expect(
      aiModelPriceInputSchema.safeParse({ ...tokenPrice, effectiveFrom: Date.now() + 86_400_000 }).success,
    ).toBe(true);
    // ...and so is backfilling a price that has been in force for years. An old instant is not a
    // typo, it is history - and nothing is costed retroactively, because a ledger row keeps its own
    // frozen snapshot.
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, effectiveFrom: 1_500_000_000_000 }).success).toBe(
      true,
    );
  });

  it("rejects a dimension or a unit that does not exist", () => {
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, meteredKind: "textual" }).success).toBe(false);
    expect(aiModelPriceInputSchema.safeParse({ ...tokenPrice, unitLabel: "token" }).success).toBe(false);
    expect(
      aiModelPriceInputSchema.safeParse({
        providerId: "openai",
        currency: "USD",
        meteredKind: "image",
        unitLabel: "image",
        unitPrice: 0.04,
        priceVersion: "2026-10",
      }).success,
    ).toBe(true);
  });
});
