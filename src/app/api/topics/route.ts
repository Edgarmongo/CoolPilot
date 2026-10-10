import { createTopic, listTopics } from "@/db/repositories/topics";
import { fail, ok, parseJson } from "@/lib/api";
import { topicInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Topics (选题, CI-P2-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * `GET` answers every topic, newest edit first: the workspace owns the two filters it offers (search
 * and status) over that list, exactly as the product library does, so the route stays one table read.
 */
export async function GET() {
  return ok(await listTopics());
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, topicInputSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  return ok(await createTopic(parsed.data), { status: 201 });
}
