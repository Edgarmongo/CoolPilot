import { describe, expect, it } from "vitest";

/**
 * CI-P7-01-05: the price catalog over HTTP.
 *
 * The catalog's own rules are pinned where they live (`createAiModelPrice`,
 * `aiModelPriceInputSchema`, `@/lib/ai-usage-ledger`). What only this file can check is the part
 * the route is responsible for: that a refusal arrives as a code a page can translate and a status
 * it can act on, that the answer carries the vocabulary the page renders, and that nothing a
 * caller sends can end up in the catalog that was not meant to be there.
 *
 * The harness pins the temp database before anything that reads it loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
await import("@/test/route-harness");

const { GET, POST } = await import("./route");

const textPrice = (overrides: Record<string, unknown> = {}) => ({
  providerId: "route-provider",
  currency: "CNY",
  inputPerMillion: 2,
  outputPerMillion: 8,
  priceVersion: "2026-10",
  effectiveFrom: 1_700_000_000_000,
  ...overrides,
});

async function postPrice(body: unknown) {
  const response = await POST(
    new Request("http://localhost/api/models/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

type PricesPayload = {
  ok: boolean;
  code?: string;
  data?: { prices: Array<Record<string, unknown>>; meteredKinds: string[] };
};

async function getPrices(query = "") {
  const response = await GET(new Request(`http://localhost/api/models/prices${query}`));
  return { status: response.status, body: (await response.json()) as PricesPayload };
}

describe("/api/models/prices", () => {
  it("adds a price and answers with the catalog the page renders", async () => {
    const created = await postPrice(textPrice({ providerId: "route-add" }));
    expect(created.status).toBe(200);
    expect(created.body.ok).toBe(true);

    const listed = await getPrices("?providerId=route-add");
    expect(listed.status).toBe(200);
    expect(listed.body.data?.prices[0]).toMatchObject({
      providerId: "route-add",
      meteredKind: "text",
      inputPerMillion: 2,
      outputPerMillion: 8,
      currency: "CNY",
      declaredFree: false,
      // The row is in the past, so it is the one the server would cost the next call with - marked
      // here rather than left for the page to work out with its own clock.
      inForce: true,
    });
    // The vocabulary travels with the answer, so the page can list the dimensions it cannot price
    // yet without keeping its own copy of the list.
    expect(listed.body.data?.meteredKinds).toEqual(
      expect.arrayContaining(["text", "image", "video", "speech", "embedding", "agent"]),
    );
  });

  it("answers a duplicate instant with a conflict a page can explain, not a driver message", async () => {
    await postPrice(textPrice({ providerId: "route-duplicate" }));

    const duplicate = await postPrice(textPrice({ providerId: "route-duplicate", inputPerMillion: 3 }));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("AI_PRICE_CONFLICT");
    expect(String(duplicate.body.error)).not.toMatch(/UNIQUE constraint/i);
    expect(String(duplicate.body.error)).toMatch(/already in force/i);
  });

  it("names the field when the payload or the row cannot be used", async () => {
    // Format: caught by the schema, which reports which field it was.
    const badCurrency = await postPrice(textPrice({ providerId: "route-invalid", currency: "BTC" }));
    expect(badCurrency.status).toBe(400);
    expect(badCurrency.body.code).toBe("INVALID_PAYLOAD");
    expect(JSON.stringify(badCurrency.body)).toContain("currency");

    // Meaning: no rates at all is not a free model, and the catalog is what says so.
    const noRates = await postPrice({
      providerId: "route-invalid",
      currency: "CNY",
      priceVersion: "2026-10",
    });
    expect(noRates.status).toBe(400);
    expect(noRates.body.code).toBe("AI_PRICE_INVALID");

    // A dimension that does not exist is not a dimension.
    expect((await getPrices("?meteredKind=textual")).status).toBe(400);
  });

  it("keeps a dimension's price out of another dimension's list", async () => {
    const effectiveFrom = 1_700_000_500_000;
    await postPrice(textPrice({ providerId: "route-filter", modelId: "m", effectiveFrom }));
    await postPrice({
      providerId: "route-filter",
      modelId: "m",
      meteredKind: "image",
      currency: "USD",
      unitLabel: "image",
      unitPrice: 0.04,
      priceVersion: "2026-10",
      effectiveFrom,
    });

    const textOnly = await getPrices("?providerId=route-filter&meteredKind=text");
    expect(textOnly.body.data?.prices).toHaveLength(1);
    expect(textOnly.body.data?.prices[0].meteredKind).toBe("text");

    // Both rows exist for one model at one instant - which the key allows precisely because it
    // carries the dimension.
    const both = await getPrices("?providerId=route-filter");
    expect(both.body.data?.prices.map((price) => price.meteredKind).sort()).toEqual(["image", "text"]);
  });

  it("stores nothing a caller was not meant to put in the catalog", async () => {
    const smuggled = await postPrice(
      textPrice({
        providerId: "route-secret",
        apiKey: "sk-do-not-store",
        geminiKey: "AIza-do-not-store",
      }),
    );
    expect(smuggled.status).toBe(200);

    // A price is a number and the model it belongs to. A key smuggled alongside it is dropped at
    // the boundary rather than written, echoed back, or logged.
    const listed = await getPrices("?providerId=route-secret");
    expect(JSON.stringify(smuggled.body)).not.toContain("do-not-store");
    expect(JSON.stringify(listed.body)).not.toContain("do-not-store");
    expect(listed.body.data?.prices[0]).not.toHaveProperty("apiKey");
    expect(listed.body.data?.prices[0]).not.toHaveProperty("geminiKey");
  });
});