import { summarizeUsage } from "@/db/repository";
import { listAiModelPrices, listAiUsageLedgerEntries } from "@/db/repositories/ai-usage-ledger";
import { summarizeLedgerMeteringCoverage } from "@/lib/ai-metering";
import { markInForceModelPrices, summarizeAiUsageLedger } from "@/lib/ai-usage-ledger";
import { failFromError, ok } from "@/lib/api";
import { aiUsageMeteredKinds, type AiCostCenterPayload } from "@/lib/types";
import { normalizeUsageRange, usageRangeStart } from "@/lib/usage";

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
 *              that do not instead of letting their calls read as free - and, since CI-P7-05-04, the
 *              计量覆盖 reading beside it: for every dimension, what the window's rows of it could
 *              state and why not when they could not.
 *
 * Read-only. Nothing here reads, writes or logs a credential, a prompt or a response body.
 */

/** The window read's ceiling, matching the repository's own maximum and the 调用明细 tab's scan. */
const overviewLedgerReadLimit = 5000;

export async function GET(request: Request) {
  try {
    const range = normalizeUsageRange(new URL(request.url).searchParams.get("range") ?? undefined);
    const from = usageRangeStart(range);
    const [entries, usage, prices] = await Promise.all([
      // The same read the 调用明细 tab makes, with the same ceiling: the coverage reading below is
      // built from these rows, so it cannot describe a different window than the totals do. (This is
      // what `summarizeAiUsageLedgerRange()` did for the totals alone; the rows are kept in hand
      // because the 计量覆盖 reading needs the individual rows, not only their sums.)
      listAiUsageLedgerEntries({ from, limit: overviewLedgerReadLimit }),
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
      ledger: summarizeAiUsageLedger(entries, { from, to: Date.now() }),
      usage,
      catalog: {
        meteredKinds: [...aiUsageMeteredKinds],
        pricedKinds,
        // CI-P7-05-04: every dimension, including the ones this runtime cannot produce a row for.
        metering: summarizeLedgerMeteringCoverage({ entries, pricedKinds }),
      },
    };
    return ok(payload);
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}
