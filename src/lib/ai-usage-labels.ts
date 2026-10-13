import type { TranslationKey } from "@/lib/locale-resources";
import type { AiUsageMeteredKind, AiUsageUnitLabel } from "@/lib/types";

/**
 * The price catalog's vocabulary, named once (CI-P7-03-D2).
 *
 * A dimension and a unit are stored as codes - `image`, `second`, `character`, `call` - because that
 * is what the catalog's keys and the ledger's rows are written in, but a person reads words. The
 * catalog screen and the cost centre's previews now name the same six dimensions and the same four
 * units, so the maps live here instead of in two `.tsx` files that could drift apart.
 *
 * Both maps are exhaustive on purpose: adding a metered kind or a unit to `@/lib/types` fails the
 * build here until someone decides how it is called on screen.
 */
export const usageKindLabelKeys: Record<AiUsageMeteredKind, TranslationKey> = {
  text: "modelPriceKindText",
  image: "modelPriceKindImage",
  video: "modelPriceKindVideo",
  speech: "modelPriceKindSpeech",
  embedding: "modelPriceKindEmbedding",
  agent: "modelPriceKindAgent",
};

/**
 * The words for the units a per-unit price is quoted in.
 *
 * A bare noun, never a phrase: the sentence around it supplies the "per" (`按每{unit}计价`,
 * `Priced per {unit}`), and a table cell wants just the noun (`0.35 / 张`). Rewriting the sentence
 * instead would mean the currency, the amount and the word were assembled in three places.
 */
export const usageUnitLabelKeys: Record<AiUsageUnitLabel, TranslationKey> = {
  image: "modelPriceUnitImage",
  second: "modelPriceUnitSecond",
  character: "modelPriceUnitCharacter",
  call: "modelPriceUnitCall",
};
