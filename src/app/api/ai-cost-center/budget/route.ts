import { getAiBudgetStatus } from "@/lib/ai-budget-guard";
import { updateAiBudgetSettings } from "@/db/repositories/settings";
import {
  aiBudgetPolicies,
  aiBudgetStrategies,
  aiBudgetStrategyLines,
  aiBudgetUnknownCostPolicies,
} from "@/lib/ai-budget";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { aiBudgetSettingsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The AI budget (CI-P7-03), read and written from 成本中心 → 预算与预估.
 *
 * What this endpoint is careful about:
 *
 *  - **It reports, it does not round.** `spent` is the period's ledger rows in the limit's currency,
 *    with `isComplete: false` whenever some row states no figure - so a limit is never compared with a
 *    total that was quietly short. `reserved` is what the live holds add up to in **every** process
 *    (CI-P7-03-A), and `enforcement: "cross-process-atomic"` travels with every answer so the page can
 *    say exactly what was promised (the check and its hold are one statement against the shared
 *    database - not a hard cap, because a hold stops counting after its TTL).
 *  - **`monthlyLimit: null` means "no limit stated"**, which is allowed, not an error and not 0.
 *  - **Nothing here writes anything about a call**: no prompt, no credential, no amount is added by
 *    opening or saving this page. The only state is the user's five settings.
 */
export async function GET() {
  try {
    const status = await getAiBudgetStatus();
    return ok({
      ...status,
      // The vocabularies travel with the answer so the page cannot show a policy the code does not
      // implement, or miss one it added later.
      policies: aiBudgetPolicies,
      unknownCostPolicies: aiBudgetUnknownCostPolicies,
      // CI-P7-03-C1: the tiers and what each one does at each boundary, for the same reason. The page
      // builds its description of a tier's stop from this table rather than from its own copy of the
      // rules, so a tier cannot be shown as stopping somewhere it does not.
      strategies: aiBudgetStrategies,
      strategyLines: aiBudgetStrategyLines,
    });
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}

export async function PUT(request: Request) {
  const parsed = await parseJson(request, aiBudgetSettingsSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  try {
    await updateAiBudgetSettings(parsed.data);
    // The answer is the status after the write, so the page never has to guess what it just saved.
    const status = await getAiBudgetStatus();
    return ok({
      ...status,
      policies: aiBudgetPolicies,
      unknownCostPolicies: aiBudgetUnknownCostPolicies,
      strategies: aiBudgetStrategies,
      strategyLines: aiBudgetStrategyLines,
    });
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}
