import { describe, expect, it } from "vitest";
import { modelCapabilities } from "@/features/ai-runtime/contracts";
import { aiCostEstimateNotes, textTokenEstimateMethod, type AiCostEstimate } from "@/lib/ai-budget";
import { aiUsageKindIsTokenMetered, aiUsageMeteredKinds, type AiUsagePricingBasis } from "@/lib/types";
import { aiCostEstimateRequestSchema } from "@/lib/validation";
import {
  budgetDecisionLabelKeys,
  budgetDecisionToneClass,
  estimateAmountText,
  estimateCapabilityForKind,
  estimateNoteLabelKeys,
  estimateRequestFor,
  estimateTokenBasisText,
  estimateUnitBasisText,
  numberFromInput,
  type EstimateAmountFormat,
  type EstimateTranslator,
} from "./estimate-view";

/**
 * CI-P7-03-D2: how a cost estimate is asked for, and how its answer is read out.
 *
 * The 预算与预估 tab and the image generation entry ask the same endpoint and have to read its answer
 * the same way, so this file pins the two rules that a second implementation living in a page would get
 * subtly wrong: **which** dimension's capability a request states (an image estimate priced against
 * whichever chat model comes first is an authoritative figure about a different model), and that
 * **neither** way of refusing to state an amount - `unpriced` and `unknown` - is ever rendered as a
 * figure, let alone as 0.
 */

/** A translator that answers with the key it was handed, so every assertion reads as the key used. */
const t: EstimateTranslator = (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key);

/** Amount formatting as a screen does it, recording every figure it was asked to format. */
function formatter() {
  const seen: number[] = [];
  const format: EstimateAmountFormat = (value) => {
    seen.push(value);
    return String(value);
  };
  return { format, seen };
}

/** 1 CNY per million in, 2 out - the readable token rate `ai-budget.test.ts` also uses. */
const textBasis: AiUsagePricingBasis = {
  meteredKind: "text",
  currency: "CNY",
  inputPerMillion: 1,
  outputPerMillion: 2,
  priceVersion: "2026-10",
  source: "manual",
};

/** An image at 0.35 USD, in the shape a per-unit row has. */
const imageBasis: AiUsagePricingBasis = {
  meteredKind: "image",
  currency: "USD",
  inputPerMillion: 0,
  outputPerMillion: 0,
  unitPrice: 0.35,
  unitLabel: "image",
  priceVersion: "2026-10",
  source: "manual",
};

const textEstimate: AiCostEstimate = {
  kind: "estimate",
  method: textTokenEstimateMethod,
  meteredKind: "text",
  currency: "CNY",
  amountMin: 1,
  amountMax: 1.001,
  inputTokensMin: 1_000_000,
  outputTokensMax: 500,
  basis: textBasis,
  notes: [],
};

const imageEstimate: AiCostEstimate = {
  kind: "estimate",
  method: textTokenEstimateMethod,
  meteredKind: "image",
  currency: "USD",
  amountMin: 0.35,
  amountMax: 0.35,
  inputTokensMin: 0,
  outputTokensMax: null,
  basis: imageBasis,
  notes: [],
};

const unpriced: AiCostEstimate = {
  kind: "unpriced",
  method: textTokenEstimateMethod,
  meteredKind: "image",
  notes: ["price-not-on-file"],
};

const unknown: AiCostEstimate = {
  kind: "unknown",
  method: textTokenEstimateMethod,
  meteredKind: "image",
  notes: ["usage-basis-unknown"],
};


describe("estimateRequestFor", () => {
  it("asks about one image as an image, not as a chat call", () => {
    // The image generation entry's own request: one image, no prompt (`POST /api/images` hard-codes
    // `quantity: 1`), and the capability of the dimension it is asking about.
    expect(estimateRequestFor({ meteredKind: "image", quantity: "1" })).toEqual({
      providerId: "",
      modelId: "",
      capability: "image_generation",
      meteredKind: "image",
      inputText: "",
      maxOutputTokens: null,
      quantity: 1,
    });
  });

  it("states the capability of the dimension it asks about, for every dimension", () => {
    for (const kind of aiUsageMeteredKinds) {
      const request = estimateRequestFor({
        meteredKind: kind,
        inputText: "hello",
        maxOutputTokens: "64",
        quantity: "2",
      });
      expect(request.capability).toBe(estimateCapabilityForKind[kind]);
      if (aiUsageKindIsTokenMetered(kind)) {
        expect(request).toMatchObject({ inputText: "hello", maxOutputTokens: 64, quantity: null });
      } else {
        // A per-unit price multiplied by a token count is not arithmetic: the count travels, the text
        // does not, and the server is left able to answer `usage-basis-unknown` instead.
        expect(request).toMatchObject({ inputText: "", maxOutputTokens: null, quantity: 2 });
      }
    }
  });

  it("leaves an unstated count unstated, so the server answers `unknown` instead of pricing zero", () => {
    expect(estimateRequestFor({ meteredKind: "image" }).quantity).toBeNull();
    expect(estimateRequestFor({ meteredKind: "image", quantity: "   " }).quantity).toBeNull();
    expect(estimateRequestFor({ meteredKind: "text" }).maxOutputTokens).toBeNull();
  });

  it("keeps a half-typed number half-typed rather than rounding it down to a figure", () => {
    // `NaN` is what the endpoint's schema refuses; a 0 here would be a smaller estimate nobody asked for.
    expect(estimateRequestFor({ meteredKind: "image", quantity: "1.5.2" }).quantity).toBeNaN();
    expect(estimateRequestFor({ meteredKind: "text", maxOutputTokens: "six" }).maxOutputTokens).toBeNaN();
  });

  it("trims the provider and the model, and leaves them blank when nobody named one", () => {
    expect(
      estimateRequestFor({ meteredKind: "image", providerId: " openai ", modelId: " gpt-image-1 " }),
    ).toMatchObject({ providerId: "openai", modelId: "gpt-image-1" });
    // Blank is what makes the server resolve the route itself, so it is kept blank rather than guessed.
    expect(estimateRequestFor({ meteredKind: "image" })).toMatchObject({ providerId: "", modelId: "" });
  });
});

describe("numberFromInput", () => {
  it("reads a blank box as \"not stated\" and a stated 0 as 0", () => {
    expect(numberFromInput("")).toBeNull();
    expect(numberFromInput("   ")).toBeNull();
    expect(numberFromInput(undefined)).toBeNull();
    expect(numberFromInput(null)).toBeNull();
    expect(numberFromInput("12")).toBe(12);
    expect(numberFromInput(" 0 ")).toBe(0);
  });

  it("refuses half-typed text instead of rounding it down to a figure", () => {
    expect(numberFromInput("1.5.2")).toBeNaN();
    expect(numberFromInput("six")).toBeNaN();
  });
});

describe("estimateCapabilityForKind", () => {
  it("maps each dimension to a capability the runtime actually has", () => {
    for (const kind of aiUsageMeteredKinds) {
      expect(modelCapabilities).toContain(estimateCapabilityForKind[kind]);
    }
    expect(estimateCapabilityForKind.image).toBe("image_generation");
    expect(estimateCapabilityForKind.video).toBe("video_generation");
    // Transcription is the speech path in this database that spends, so it asks for that capability.
    expect(estimateCapabilityForKind.speech).toBe("speech_to_text");
    expect(estimateCapabilityForKind.text).toBe("chat");
    // An agent run is a chat call; nothing about it is priced differently.
    expect(estimateCapabilityForKind.agent).toBe("chat");
    expect(estimateCapabilityForKind.embedding).toBe("embedding");
    // The one thing that must never happen: an image priced by the chat route.
    expect(estimateCapabilityForKind.image).not.toBe(estimateCapabilityForKind.text);
  });
});

describe("the body a page builds, against the endpoint's own schema", () => {
  it("accepts every dimension's request with its capability intact", () => {
    for (const kind of aiUsageMeteredKinds) {
      const parsed = aiCostEstimateRequestSchema.parse(
        estimateRequestFor({ meteredKind: kind, inputText: "hello", maxOutputTokens: "64", quantity: "2" }),
      );
      // The field has to *survive* the boundary: the endpoint cannot forward a capability it dropped,
      // and without one an image estimate is priced against whichever chat model comes first.
      expect(parsed.capability).toBe(estimateCapabilityForKind[kind]);
      expect(parsed.meteredKind).toBe(kind);
      expect(parsed.quantity).toBe(aiUsageKindIsTokenMetered(kind) ? null : 2);
    }
  });

  it("keeps the old answer for a caller that states no capability", () => {
    // Optional on purpose: a client that does not know about capabilities keeps the behaviour it had
    // (`chat` inside the guard), so adding the field changed no existing answer.
    expect(aiCostEstimateRequestSchema.parse({ meteredKind: "image", quantity: 1 }).capability).toBeUndefined();
  });

  it("refuses a half-typed count instead of letting it through as a smaller figure", () => {
    expect(() =>
      aiCostEstimateRequestSchema.parse(estimateRequestFor({ meteredKind: "image", quantity: "1.5.2" })),
    ).toThrow();
  });
});

describe("estimateAmountText", () => {
  it("reads the two refusals as two different sentences, and never as an amount", () => {
    const amounts = formatter();

    // "the catalog does not price this" and "nobody can say what this will be metered on" are two
    // different facts, and a 0 would flatten both of them into "free".
    expect(estimateAmountText(t, amounts.format, unpriced)).toBe("budgetEstimateUnpriced");
    expect(estimateAmountText(t, amounts.format, unknown)).toBe("budgetEstimateUnknown");
    expect(amounts.seen).toEqual([]);
  });

  it("shows a priced call as a range, an unstated ceiling as an open one, and a per-unit call as one figure", () => {
    const { format } = formatter();

    expect(estimateAmountText(t, format, textEstimate)).toBe(
      'budgetEstimateRange:{"currency":"CNY","min":"1","max":"1.001"}',
    );
    // Nobody stated the reply ceiling, so the upper bound stays unknown instead of becoming the lower one.
    expect(estimateAmountText(t, format, { ...textEstimate, amountMax: null })).toBe(
      'budgetEstimateRangeOpen:{"currency":"CNY","min":"1"}',
    );
    // One image at 0.35 is 0.35 on both bounds, not a range.
    expect(estimateAmountText(t, format, imageEstimate)).toBe(
      'budgetEstimateRange:{"currency":"USD","min":"0.35","max":"0.35"}',
    );
  });
});

describe("estimateTokenBasisText", () => {
  it("says what a token estimate was multiplied on, including a ceiling nobody stated", () => {
    const { format } = formatter();

    expect(estimateTokenBasisText(t, format, textEstimate)).toBe(
      'budgetEstimateTokens:{"input":"1000000","output":"500"}',
    );
    expect(estimateTokenBasisText(t, format, { ...textEstimate, outputTokensMax: null })).toBe(
      'budgetEstimateTokens:{"input":"1000000","output":"budgetEstimateOutputUnknown"}',
    );
  });

  it("says nothing about tokens for a per-unit estimate or a refusal", () => {
    const { format } = formatter();

    expect(estimateTokenBasisText(t, format, imageEstimate)).toBeNull();
    expect(estimateTokenBasisText(t, format, unpriced)).toBeNull();
    expect(estimateTokenBasisText(t, format, unknown)).toBeNull();
  });
});

describe("estimateUnitBasisText", () => {
  it("never shows a per-unit rate without its unit, its currency and the revision it came from", () => {
    const { format } = formatter();

    expect(estimateUnitBasisText(t, format, imageEstimate)).toBe(
      'budgetEstimateUnitBasis:{"unit":"modelPriceUnitImage","currency":"USD","amount":"0.35","version":"2026-10"}',
    );
  });

  it("says nothing for a token estimate, and nothing for a row that names no unit", () => {
    const { format } = formatter();

    expect(estimateUnitBasisText(t, format, textEstimate)).toBeNull();
    // A per-unit price with no unit named is a hand-written row that says nothing worth saying.
    const degenerate: AiCostEstimate = { ...imageEstimate, basis: { ...imageBasis, unitLabel: undefined } };
    expect(estimateUnitBasisText(t, format, degenerate)).toBeNull();
    expect(estimateUnitBasisText(t, format, unpriced)).toBeNull();
  });
});

describe("the vocabulary the screens share", () => {
  it("names every caveat the server can send, with one wording each", () => {
    // Exhaustive over the server's own list: a note the endpoint starts sending cannot reach a screen
    // untranslated, and two caveats cannot be shown as one sentence.
    expect(Object.keys(estimateNoteLabelKeys).sort()).toEqual([...aiCostEstimateNotes].sort());
    const words = Object.values(estimateNoteLabelKeys);
    expect(new Set(words).size).toBe(words.length);
  });

  it("paints the three verdicts three different ways, with `off` the quietest", () => {
    const statuses = ["off", "allowed", "blocked"] as const;
    expect(Object.keys(budgetDecisionLabelKeys).sort()).toEqual([...statuses].sort());

    const tones = statuses.map((status) => budgetDecisionToneClass[status]);
    for (const tone of tones) expect(tone.trim().length).toBeGreaterThan(0);
    expect(new Set(tones).size).toBe(statuses.length);
    // With budget control off nothing was refused, so it must not be painted like a pass.
    expect(budgetDecisionToneClass.off).not.toBe(budgetDecisionToneClass.allowed);
    expect(budgetDecisionToneClass.off).not.toBe(budgetDecisionToneClass.blocked);
  });
});
