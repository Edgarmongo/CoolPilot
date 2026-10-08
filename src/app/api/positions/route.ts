import { createPosition, ensureDefaultPosition, listPositions } from "@/db/repositories/positions";
import { fail, ok, parseJson } from "@/lib/api";
import { positionCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDefaultPosition();
  return ok(await listPositions());
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, positionCreateSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  const created = await createPosition(parsed.data);
  return ok(created, { status: 201 });
}
