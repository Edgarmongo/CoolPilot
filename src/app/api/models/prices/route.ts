import { createAiModelPrice, listAiModelPrices } from "@/db/repositories/ai-usage-ledger";
import { ok, fail, failFromError } from "@/lib/api";
import { markInForceModelPrices } from "@/lib/ai-usage-ledger";
import { aiUsageMeteredKinds, type AiUsageMeteredKind } from "@/lib/types";
import { aiModelPriceInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * The price catalog (CI-P7-01-05), read and appended from 系统 → 模型管理 → 价格目录.
 *
 * There is no PATCH and no DELETE on purpose. A price that changed is a **new row** with a later
 * `effective_from`, which is what keeps "what did that call cost in March" answerable from the
 * ledger's own frozen snapshots - an edit would silently restate every cost the old row ever
 * priced, and a delete would leave the snapshots citing a revision that no longer exists.
 *
 * Nothing here reads, writes or logs a credential. A price is a number a user typed plus the
 * provider and model it belongs to; no key material is involved at any point.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const providerId = url.searchParams.get("providerId")?.trim() ?? "";
    const meteredKind = url.searchParams.get("meteredKind");
    if (meteredKind && !aiUsageMeteredKinds.includes(meteredKind as AiUsageMeteredKind)) {
      return fail("INVALID_PAYLOAD", 400, { meteredKind });
    }

    const prices = await listAiModelPrices({
      providerId: providerId || undefined,
      meteredKind: (meteredKind as AiUsageMeteredKind | null) || undefined,
    });

    // Which row would cost a call made right now is the server's answer, not the page's: the
    // recorder is the side that picks a price (`markInForceModelPrices`).
    return ok({
      prices: markInForceModelPrices(prices, Date.now()),
      // The vocabulary travels with the answer so the page can show the dimensions that are *not*
      // priced yet without keeping its own copy of the list.
      meteredKinds: aiUsageMeteredKinds,
    });
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = aiModelPriceInputSchema.safeParse(body);
    if (!parsed.success) {
      return fail("INVALID_PAYLOAD", 400, parsed.error);
    }

    const price = await createAiModelPrice(parsed.data);
    return ok({ price });
  } catch (error) {
    // A refusal from the catalog keeps its own code and status (`AI_PRICE_INVALID` 400 for a row
    // that does not describe a priceable dimension, `AI_PRICE_CONFLICT` 409 for a duplicate key);
    // anything else is the generic failure this route would have reported anyway.
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}
