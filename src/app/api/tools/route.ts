import { ok } from "@/lib/api";
import { listCallableTools } from "@/lib/tools/tool-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tool discovery of CI-P1-03-02, per `docs/coolpilot-integration-contracts.md` §3.2 layer 5:
 *
 *   GET /api/tools -> 200 { ok: true, data: [{ name, description, inputSchema }] }
 *
 * `data` is the list the contract draws (the envelope is this repository's `ok()` shape, like every
 * other route), and `inputSchema` is the tool's own Zod schema as JSON Schema through `z.toJSONSchema`.
 *
 * Only the thin media registry is published (`src/lib/tools/media-tools.ts`): this entry may not
 * advertise a tool whose execution reads Agent-private state, because a caller of this entry cannot
 * supply it. A tool that cannot be listed here is not "hidden" either - it stays callable through the
 * Agent loop, which is where it belongs.
 */
export async function GET() {
  return ok(listCallableTools());
}
