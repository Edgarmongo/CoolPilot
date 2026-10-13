import { describe, expect, it } from "vitest";
import { aiUsageKindIsTokenMetered, aiUsageKindUnits, aiUsageMeteredKinds } from "@/lib/types";
import {
  changeModelPriceKind,
  defaultModelPriceForm,
  defaultUnitLabelFor,
  localInputValue,
  modelPriceFormPayload,
  modelPriceUnitsFor,
  rateFromInput,
} from "./model-price-form";

/**
 * CI-P7-03-D2: the 价格目录 form's own state, and the row it posts.
 *
 * The rule worth pinning on its own is **one row declares one dimension**: a token rate on a per-image
 * row is refused by the catalog (`assertPriceShape`), so the form must not be able to produce one - and
 * a blank box must travel as "not stated" (`undefined`), never as a 0 that a real call would then be
 * multiplied by.
 */

const tokenKinds = aiUsageMeteredKinds.filter((kind) => aiUsageKindIsTokenMetered(kind));
const perUnitKinds = aiUsageMeteredKinds.filter((kind) => !aiUsageKindIsTokenMetered(kind));
const tokenKeys = ["inputPerMillion", "outputPerMillion", "cachedInputPerMillion"] as const;
const unitKeys = ["unitLabel", "unitPrice"] as const;

describe("modelPriceUnitsFor", () => {
  it("mirrors the catalog's own unit list for every dimension", () => {
    for (const kind of aiUsageMeteredKinds) {
      expect(modelPriceUnitsFor(kind)).toEqual(aiUsageKindUnits[kind]);
    }
    // An empty list is not "no units yet": it means this dimension is priced by the token columns.
    expect(tokenKinds.map((kind) => modelPriceUnitsFor(kind).length)).toEqual([0, 0]);
    for (const kind of perUnitKinds) expect(modelPriceUnitsFor(kind).length).toBeGreaterThan(0);

    expect(modelPriceUnitsFor("text")).toEqual([]);
    expect(modelPriceUnitsFor("embedding")).toEqual([]);
    expect(modelPriceUnitsFor("image")).toEqual(["image"]);
    expect(modelPriceUnitsFor("video")).toEqual(["second"]);
    expect(modelPriceUnitsFor("speech")).toEqual(["character", "second"]);
    expect(modelPriceUnitsFor("agent")).toEqual(["call"]);
  });
});

describe("defaultUnitLabelFor", () => {
  it("seats every per-unit dimension on a unit, and a token dimension on none", () => {
    expect(defaultUnitLabelFor("image")).toBe("image");
    expect(defaultUnitLabelFor("video")).toBe("second");
    expect(defaultUnitLabelFor("agent")).toBe("call");
    // `speech` is the one kind with two units, and character-billing is the common case.
    expect(defaultUnitLabelFor("speech")).toBe("character");
    for (const kind of tokenKinds) expect(defaultUnitLabelFor(kind)).toBe("");
    // Whatever it seats a dimension on has to be a unit that dimension actually accepts.
    for (const kind of perUnitKinds) {
      expect(modelPriceUnitsFor(kind)).toContain(defaultUnitLabelFor(kind));
    }
  });
});

describe("changeModelPriceKind", () => {
  it("re-seats the unit on the new dimension and keeps everything already typed", () => {
    const filled = { ...defaultModelPriceForm("openai"), modelId: "gpt-image-1", inputPerMillion: "3" };
    const asImage = changeModelPriceKind(filled, "image");
    // Keeping the previous dimension's unit would leave the form holding a row the catalog refuses.
    expect(asImage).toMatchObject({
      meteredKind: "image",
      unitLabel: "image",
      providerId: "openai",
      modelId: "gpt-image-1",
      inputPerMillion: "3",
    });
    // Back on a token dimension there is no unit at all: a token row has no unit column.
    expect(changeModelPriceKind(asImage, "text")).toMatchObject({ meteredKind: "text", unitLabel: "" });
  });

  it("re-seats the unit for every dimension the form can be moved to", () => {
    const form = defaultModelPriceForm("openai");
    for (const kind of aiUsageMeteredKinds) {
      expect(changeModelPriceKind(form, kind)).toMatchObject({
        meteredKind: kind,
        unitLabel: defaultUnitLabelFor(kind),
      });
    }
  });
});

describe("rateFromInput", () => {
  it("reads a blank box as \"not stated\" and a stated 0 as 0", () => {
    expect(rateFromInput("")).toBeUndefined();
    expect(rateFromInput("   ")).toBeUndefined();
    expect(rateFromInput(" 0 ")).toBe(0);
    expect(rateFromInput("0.35")).toBe(0.35);
    expect(rateFromInput("3")).toBe(3);
  });

  it("refuses half-typed text instead of rounding it down to a rate", () => {
    expect(rateFromInput("3x")).toBeNaN();
    expect(rateFromInput("1,5")).toBeNaN();
  });
});

describe("modelPriceFormPayload", () => {
  it("posts a token row with its three rates and no unit at all", () => {
    const body = modelPriceFormPayload({
      ...defaultModelPriceForm("openai"),
      modelId: "gpt-4o",
      inputPerMillion: "3",
      outputPerMillion: "15",
    });
    expect(body).toMatchObject({
      providerId: "openai",
      modelId: "gpt-4o",
      meteredKind: "text",
      currency: "CNY",
      source: "manual",
      declaredFree: false,
      inputPerMillion: 3,
      outputPerMillion: 15,
      // An empty cached box is a real answer: this provider does not price cached input separately.
      cachedInputPerMillion: null,
    });
    for (const key of unitKeys) expect(key in body).toBe(false);
  });

  it("posts a per-unit row with its unit and its price, and no token rate at all", () => {
    const body = modelPriceFormPayload({
      ...changeModelPriceKind(defaultModelPriceForm("openai"), "image"),
      modelId: "gpt-image-1",
      unitPrice: "0.35",
    });
    expect(body).toMatchObject({ meteredKind: "image", unitLabel: "image", unitPrice: 0.35 });
    for (const key of tokenKeys) expect(key in body).toBe(false);
  });

  it("never lets one row declare both kinds of rate, for any dimension", () => {
    for (const kind of aiUsageMeteredKinds) {
      const form = changeModelPriceKind(
        {
          ...defaultModelPriceForm("openai"),
          inputPerMillion: "3",
          outputPerMillion: "4",
          cachedInputPerMillion: "5",
          unitPrice: "0.35",
        },
        kind,
      );
      const body = modelPriceFormPayload(form);
      if (aiUsageKindIsTokenMetered(kind)) {
        for (const key of unitKeys) expect(key in body).toBe(false);
        for (const key of tokenKeys) expect(key in body).toBe(true);
      } else {
        // The dimension decides which rate fields exist, so a row can never be read two ways.
        for (const key of unitKeys) expect(key in body).toBe(true);
        for (const key of tokenKeys) expect(key in body).toBe(false);
      }
    }
  });

  it("posts a blank rate as \"not stated\", and half-typed text as a refusal", () => {
    const tokenRow = modelPriceFormPayload(defaultModelPriceForm("openai"));
    // Present but undefined, rather than a 0 a real call would be multiplied by.
    expect(tokenRow).toMatchObject({ inputPerMillion: undefined, outputPerMillion: undefined });

    const unitRow = modelPriceFormPayload({
      ...defaultModelPriceForm("openai"),
      meteredKind: "video",
      unitLabel: "second",
    });
    expect(unitRow).toMatchObject({ unitLabel: "second", unitPrice: undefined });

    // A rate nobody typed cleanly is refused by the catalog's schema rather than quietly rounded.
    expect(modelPriceFormPayload({ ...defaultModelPriceForm(), inputPerMillion: "3x" })).toMatchObject({
      inputPerMillion: Number.NaN,
    });
  });

  it("trims what a person typed and names the wildcard row when no model is given", () => {
    const body = modelPriceFormPayload({
      ...defaultModelPriceForm(),
      providerId: " openai ",
      modelId: "   ",
      notes: "  bulk rate  ",
      priceVersion: " 2026-11 ",
      effectiveFrom: "2026-10-11T09:30",
    });
    expect(body).toMatchObject({
      providerId: "openai",
      modelId: "*",
      notes: "bulk rate",
      priceVersion: "2026-11",
      // `datetime-local` speaks local time, and the row stores the instant that names.
      effectiveFrom: new Date("2026-10-11T09:30").getTime(),
    });
    // No date typed at all leaves the field out; 1970 is not "no date".
    expect(
      modelPriceFormPayload({ ...defaultModelPriceForm(), effectiveFrom: "" }).effectiveFrom,
    ).toBeUndefined();
  });
});

describe("defaultModelPriceForm", () => {
  it("opens on a token row in CNY, with every rate left unstated", () => {
    const form = defaultModelPriceForm("openai");
    expect(form).toMatchObject({
      providerId: "openai",
      modelId: "*",
      meteredKind: "text",
      currency: "CNY",
      source: "manual",
      inputPerMillion: "",
      outputPerMillion: "",
      cachedInputPerMillion: "",
      unitLabel: "",
      unitPrice: "",
      declaredFree: false,
      notes: "",
    });
    // A blank provider is how the panel opens before a provider is picked.
    expect(defaultModelPriceForm().providerId).toBe("");
    // The version names the day the row was written, so a rate can be traced back to when it was set.
    expect(form.priceVersion).toMatch(/^manual-\d{4}-\d{2}-\d{2}$/);
    expect(form.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("localInputValue", () => {
  it("renders local time the way `datetime-local` reads it", () => {
    expect(localInputValue(new Date(2026, 9, 11, 9, 30).getTime())).toBe("2026-10-11T09:30");
    // Single-digit months, days and hours are padded, or the input would refuse the value.
    expect(localInputValue(new Date(2026, 0, 1, 0, 5).getTime())).toBe("2026-01-01T00:05");
  });
});
