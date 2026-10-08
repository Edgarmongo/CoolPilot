import { getPosition, updatePosition } from "@/db/repositories/positions";
import { fail, ok, parseJson } from "@/lib/api";
import { evaluateStoreListing } from "@/lib/positions";
import { positionPublishSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const position = await getPosition(id);
  if (!position) return fail("NOT_FOUND", 404);

  const parsed = await parseJson(request, positionPublishSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const { runTest, ...fields } = parsed.data;
  const listing = { ...position.store, ...fields };
  const evaluation = evaluateStoreListing(listing, position);

  if (!runTest) {
    return ok({ position, listing, evaluation, submitted: false });
  }

  const updated = await updatePosition(id, {
    store: {
      ...listing,
      status: evaluation.passed ? "published" : "testing",
      testScore: evaluation.score,
      ...(evaluation.passed ? { publishedAt: Date.now() } : {}),
    },
  });
  return ok({ position: updated, listing, evaluation, submitted: evaluation.passed });
}
