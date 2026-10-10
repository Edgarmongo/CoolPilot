import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { previewAiBudgetCall } from "@/lib/ai-budget-guard";
import { aiCostEstimateRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "What would this call cost, and does the budget allow it?" (CI-P7-03).
 *
 * The 预算与预估 tab asks here so the answer comes from the **server's** price catalog, budget
 * settings and this month's ledger - the same three the gate itself uses - instead of a second
 * implementation in the page that could disagree with the one that actually refuses calls.
 *
 * Read-only by design: it takes no budget hold and writes no ledger row, so asking twenty times costs
 * nothing and cannot influence anyone's remaining budget. The verdict it returns is therefore the
 * verdict *now*: between this answer and the real call the period's spending can grow, and only the
 * call site's own gate is what will actually decide.
 *
 * `inputText`, when sent, is measured and dropped. It is never stored, never logged and never echoed
 * back - the answer carries token counts and amounts, not the text.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, aiCostEstimateRequestSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  try {
    const preview = await previewAiBudgetCall({ ...parsed.data, purpose: "estimate-preview" });
    return ok(preview);
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}
