import { deleteTopic, getTopic, updateTopic } from "@/db/repositories/topics";
import { fail, ok, parseJson } from "@/lib/api";
import { topicPatchSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * One topic (CI-P2-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * `GET` exists because the writing wizard reads a topic by id when it was opened from the topic list
 * (`/creation/ai-writing?topicId=...`): the id has to arrive as data, and a topic that is gone answers
 * 404 so the wizard can say so instead of writing about nothing.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const topic = await getTopic(id);
  if (!topic) return fail("NOT_FOUND", 404);
  return ok(topic);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = await parseJson(request, topicPatchSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const existing = await getTopic(id);
  if (!existing) return fail("NOT_FOUND", 404);
  return ok(await updateTopic(id, parsed.data));
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const existing = await getTopic(id);
  if (!existing) return fail("NOT_FOUND", 404);
  await deleteTopic(id);
  return ok({ deleted: true });
}
