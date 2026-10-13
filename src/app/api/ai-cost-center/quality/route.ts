import { listAiUsageLedgerEntries } from "@/db/repositories/ai-usage-ledger";
import {
  countContentItemsByStatus,
  listAdoptedContentItemIds,
  listContentItemMetadataInRange,
  qualityContentScanLimit,
} from "@/db/repositories/quality-cost";
import { updateAiBudgetSettings } from "@/db/repositories/settings";
import { aiBudgetStrategyLines } from "@/lib/ai-budget";
import { getAiBudgetStatus } from "@/lib/ai-budget-guard";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import {
  buildQualitySuggestions,
  qualityAdoptedOutputLimit,
  qualityLedgerReadLimit,
  summarizeCallQuality,
  summarizeContentAdoption,
  summarizeHumanEdits,
  summarizeQualityObjective,
  type AiQualityPayload,
} from "@/lib/quality-cost";
import type { UsageRangeDays } from "@/lib/types";
import { normalizeUsageRange, usageRangeStart } from "@/lib/usage";
import { aiQualitySuggestionRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 质量与优化 (CI-P7-04) over HTTP: the metrics, the objective and the suggestions - and the one write
 * this tab may make.
 *
 *   GET  /api/ai-cost-center/quality?range=7   -> 200 one window of measurements + the suggestions
 *   POST /api/ai-cost-center/quality?range=7   -> 200 the same window after applying the suggestion,
 *                                                      with `applied: { from, to, at, suggestionId }`
 *                                              -> 409 { applied: false, reason: "suggestion-not-applicable" }
 *                                              -> 400 when the body is not a known suggestion id
 *
 * What this endpoint is careful about:
 *
 *  - **The read is read-only.** Opening the tab writes nothing: no setting, no ledger row, no decision.
 *    The window is the same calendar rule the 成本总览 and 调用明细 tabs use (`normalizeUsageRange`), so
 *    the three tabs cannot describe different days.
 *  - **The write is a suggestion, not a setting.** The body names a suggestion id, never a strategy: the
 *    tier is re-derived from the metrics *at the moment of the request*, so a page cannot write a tier
 *    the recommendation logic would not have chosen, and a suggestion whose basis disappeared between
 *    the read and the click is refused with `409` rather than applied on a stale reading.
 *  - **The rule lives in `@/lib/quality-cost`**, and the tier table the page describes arrives from the
 *    server's own `aiBudgetStrategyLines`, so nothing here paraphrases what the gate does.
 *  - **No figure is invented.** `null` stays `null` (a window with no adopted output has no unit cost),
 *    an unread row is counted rather than dropped, and a capped read is reported
 *    (`truncated` / `objective.attributionPartial` / `humanEdits.truncated`).
 */

/** The window rule the three tabs share: `range` days, local calendar, today included. */
function readRange(request: Request) {
  return normalizeUsageRange(new URL(request.url).searchParams.get("range") ?? undefined);
}

async function readQualityPayload(range: UsageRangeDays): Promise<AiQualityPayload> {
  const from = usageRangeStart(range);
  const to = Date.now();
  const [entries, byStatus, adoptedIds, touched, budget] = await Promise.all([
    listAiUsageLedgerEntries({ from, to, limit: qualityLedgerReadLimit }),
    countContentItemsByStatus({ from, to }),
    listAdoptedContentItemIds({ from, to, limit: qualityAdoptedOutputLimit }),
    // The scan is narrowed by the item-level write stamp; what was actually written is read off the
    // versions' own `updatedAt` inside `summarizeHumanEdits`.
    listContentItemMetadataInRange({ from, to, limit: qualityContentScanLimit }),
    getAiBudgetStatus(to),
  ]);

  const content = summarizeContentAdoption(byStatus);
  const calls = summarizeCallQuality(entries);
  // A capped scan is a floor, and the flag travels with the answer instead of being rounded away.
  const humanEdits = summarizeHumanEdits(touched, { from, to }, {
    truncated: touched.length >= qualityContentScanLimit,
  });
  const objective = summarizeQualityObjective({
    entries,
    adoptedContentItemIds: adoptedIds,
    // The denominator is the counted status, never the capped id list: a short id read must not shrink
    // the number of outputs the money is divided by - it makes the attribution partial, and says so.
    adoptedOutputs: content.adopted,
    attributionPartial: adoptedIds.length < content.adopted,
  });

  return {
    range,
    from,
    to,
    truncated: entries.length >= qualityLedgerReadLimit,
    calls,
    content,
    humanEdits,
    objective,
    suggestions: buildQualitySuggestions({
      objective,
      calls,
      content,
      // Only the five fields the rules are allowed to read are handed over - not the whole status
      // object, so a rule cannot start reading `reserved` or `inFlightCount` by accident.
      budget: {
        policy: budget.settings.policy,
        strategy: budget.settings.strategy,
        monthlyLimit: budget.settings.monthlyLimit,
        currency: budget.settings.currency,
        spent: budget.spent,
      },
    }),
    budget: {
      settings: budget.settings,
      period: budget.period,
      spent: budget.spent,
      remaining: budget.remaining,
      strategyLines: aiBudgetStrategyLines,
    },
  };
}

export async function GET(request: Request) {
  try {
    return ok(await readQualityPayload(readRange(request)));
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, aiQualitySuggestionRequestSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  try {
    const range = readRange(request);
    const suggestionId = parsed.data.suggestionId;
    // Recomputed here rather than trusted from the read: this is what makes the refusal below a real
    // answer instead of a formality.
    const before = await readQualityPayload(range);
    const suggestion = before.suggestions.find((entry) => entry.id === suggestionId);

    if (!suggestion || suggestion.action.kind !== "strategy") {
      return fail("This suggestion cannot be applied here, or its basis no longer holds.", 409, {
        applied: false,
        reason: "suggestion-not-applicable",
        suggestionId,
      });
    }

    const previousStrategy = before.budget.settings.strategy;
    await updateAiBudgetSettings({ strategy: suggestion.action.strategy });

    // The answer is the window *after* the write, measured the same way, so the page never has to guess
    // what it just changed - and the next suggestion list already reflects it.
    const after = await readQualityPayload(range);
    return ok({
      ...after,
      applied: {
        suggestionId,
        from: previousStrategy,
        to: after.budget.settings.strategy,
        at: Date.now(),
      },
    } satisfies AiQualityPayload);
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}

