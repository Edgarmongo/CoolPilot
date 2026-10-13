import { fail, failFromError, ok, parseJson } from "@/lib/api";
import {
  probeModelCapability,
  type ModelProbeMetering,
  type ModelProbeTarget,
} from "@/features/ai-runtime/probe";
import { beginAiBudgetCall } from "@/lib/ai-budget-guard";
import { recordAiUsageCall, type AiUsageCallContext } from "@/lib/ai-usage-ledger-recorder";
import { aiModelProbeSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The ledger `purpose` of a capability probe: it belongs to no run, task, article or listing. */
const probePurpose = "model-probe";

/**
 * How this route meters the probe it asks for (CI-P7-03 + CI-P7-01-04).
 *
 * A probe is a real request on the user's own key, so it is gated and recorded the way every other call
 * site in the product is - the same `beginAiBudgetCall` and `recordAiUsageCall`, no accounting of its
 * own. Only the *place* differs: the probe owns the request, so it hands this port the target it
 * resolved (before anything is sent) and the trail it sent (afterwards), and this file turns those into
 * the gate's request and the ledger's rows.
 *
 * The estimate is the probe's own request: its real text, its real ceiling, and the model the user
 * picked - not a route the resolver might have chosen instead, which would compare the month's remaining
 * budget against the price of a model this probe is never going to call.
 *
 * `identity` is left absent on purpose. A probe is not part of a run, a task, an article or a listing,
 * and the model it checked is already on every row (`provider_id` / `model_id`); inventing a business id
 * here would make "which model did the user spend this on" look answered by something else.
 */
function meteredProbe(): ModelProbeMetering {
  const usageCall: AiUsageCallContext = { purpose: probePurpose, meteredKind: "text" };
  return {
    async begin(target: ModelProbeTarget) {
      const budget = await beginAiBudgetCall({
        identity: usageCall,
        purpose: usageCall.purpose,
        capability: target.capability,
        meteredKind: "text",
        providerId: target.providerId,
        modelId: target.modelId,
        inputText: target.inputText,
        maxOutputTokens: target.maxOutputTokens,
      });
      // CI-P7-03-A: the hold's id travels onto this probe's ledger rows, so what was held and what was
      // spent are compared by an id instead of correlated by purpose and time.
      usageCall.budgetReservationId = budget.reservationId ?? undefined;
      return {
        record: async (attempts) => {
          await recordAiUsageCall({ ...usageCall, attempts });
        },
        release: async () => {
          await budget.release();
        },
      };
    },
  };
}

/**
 * Layer 3 capability detection: sends one real request and records the outcome as a
 * `PROBE_TEST` capability row, which outranks the vendor metadata and the name rules.
 *
 * The request it sends is a paid call, so it is metered. The gate stands before it (a refusal is thrown
 * by `meteredProbe()` before the provider is asked, and `failFromError` answers with the gate's own 402
 * and `AI_BUDGET_EXCEEDED`), and every request that *was* sent gets a ledger row. Nothing else about the
 * answer changes: a probe that reached a provider still answers 200 with `status: "failed"` on the
 * record, because "the model did not answer" is a result of the check rather than an HTTP error.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, aiModelProbeSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }

  try {
    return ok(await probeModelCapability({ ...parsed.data, metering: meteredProbe() }));
  } catch (error) {
    return failFromError(error, "MODEL_PROBE_FAILED", 502);
  }
}
