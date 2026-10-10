import { createBrand, listBrands } from "@/db/repositories/brands";
import { fail, ok, parseJson } from "@/lib/api";
import { brandInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Brand profiles (品牌资料, CI-P2-02 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * `GET` answers every brand, newest edit first: the workspace owns the search it offers over that
 * list, exactly as the topic and product libraries do, so the route stays one table read.
 */
export async function GET() {
  return ok(await listBrands());
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, brandInputSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  return ok(await createBrand(parsed.data), { status: 201 });
}
