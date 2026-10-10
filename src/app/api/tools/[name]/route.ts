import { NextResponse } from "next/server";
import { z } from "zod";
import { toolCallErrorStatus, type ToolCallError } from "@/lib/tools/tool-call";
import { callTool } from "@/lib/tools/tool-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The tool call entry of CI-P1-03-02, per `docs/coolpilot-integration-contracts.md` §3.2 layer 5:
 *
 *   POST /api/tools/<name>   body { input: {...}, taskId?, approvals? }
 *     -> 200 { ok: true, data: <tool output> }
 *     -> 4xx/5xx { ok: false, error: { code, message, retryable, details? } }
 *
 * The body carries the contract's own `ToolCallContext` field names (`taskId`, `approvals`) and no
 * others: `signal` and `emit` have no JSON form, so this entry cannot fake them. `taskId` is what makes
 * a call appear in a task's log, and `approvals` is how a caller presents the grant the approval gate
 * asks for - without it, a side-effecting tool honestly stops at `APPROVAL_REQUIRED`.
 *
 * The response **is** the `ToolCallResult` envelope, so the status code and the body cannot disagree:
 * both come from `toolCallErrorStatus()`. This is the one route whose error body is an object rather
 * than `fail()`'s `error` string, because §3.2 froze that envelope for tool calls.
 */
const callBodySchema = z.object({
  input: z.unknown().optional(),
  taskId: z.string().min(1).optional(),
  approvals: z.object({ grantedToolCallId: z.string().min(1) }).optional(),
});

/** The body is not the tool's input: a malformed request is reported as such, not as a bad `input`. */
function invalidBodyError(name: string): ToolCallError {
  return {
    code: "INVALID_INPUT",
    message: `Invalid request body for tool "${name}": expected { "input": { ... } }.`,
    retryable: false,
    details: { tool: name },
  };
}

export async function POST(request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = undefined;
  }
  const body = callBodySchema.safeParse(raw);
  if (!body.success) {
    const error = invalidBodyError(name);
    return NextResponse.json({ ok: false, error }, { status: toolCallErrorStatus(error.code) });
  }

  const outcome = await callTool(name, body.data.input ?? {}, {
    taskId: body.data.taskId,
    approvals: body.data.approvals,
  });
  const status = outcome.result.ok ? 200 : toolCallErrorStatus(outcome.result.error.code);
  return NextResponse.json(outcome.result, { status });
}
