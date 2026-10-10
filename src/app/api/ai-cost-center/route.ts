import { summarizeUsage } from "@/db/repository";
import { listAiModelPrices, summarizeAiUsageLedgerRange } from "@/db/repositories/ai-usage-ledger";
import { markInForceModelPrices } from "@/lib/ai-usage-ledger";
import { failFromError, ok } from "@/lib/api";
import { aiUsageMeteredKinds, type AiCostCenterPayload } from "@/lib/types";
import { normalizeUsageRange } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The first page of 「AI 成本与质量优化中心」 (CI-P7-02).
 *
 * Three readings of one window, in one answer, because the page compares them:
 *
 *  - `ledger`  the ledger view - one row per request the runtime actually sent, with where each
 *              money figure came from (`byCostSource`), in which currency (`costByCurrency`) and on
 *              which local day (`byDay`). A figure that nobody could state stays `null` / counted,
 *              never 0.
 *  - `usage`   the 用量统计 view of what was actually delivered. Kept, not replaced: the same
 *              window, the same calendar rule (`normalizeUsageRange`), so the two halves of the
 *              page cannot describe different days.
 *  - `catalog` which dimensions have a price **in force** right now, so the page can name the ones
 *              that do not instead of letting their calls read as free.
 *
 * Read-only. Nothing here reads, writes or logs a credential, a prompt or a response body.
 */
export async function GET(request: Request) {
  try {
    const range = normalizeUsageRange(new URL(request.url).searchParams.get("range") ?? undefined);
    const [ledger, usage, prices] = await Promise.all([
      summarizeAiUsageLedgerRange(range),
      summarizeUsage(range),
      listAiModelPrices({}),
    ]);

    // "In force" is decided here, on the server, by the same function the recorder picks a price
    // with - a row that takes effect tomorrow is not a priceable dimension today.
    const inForce = markInForceModelPrices(prices, Date.now()).filter((price) => price.inForce);
    const pricedKinds = aiUsageMeteredKinds.filter((kind) =>
      inForce.some((price) => price.meteredKind === kind),
    );

    const payload: AiCostCenterPayload = {
      range,
      ledger,
      usage,
      catalog: { meteredKinds: [...aiUsageMeteredKinds], pricedKinds },
    };
    return ok(payload);
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}
