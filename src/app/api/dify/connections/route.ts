import { createDifyConnection, listDifyConnections } from "@/db/repositories/dify-connections";
import { fail, ok, parseJson } from "@/lib/api";
import { difyConnectionInputSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return ok(await listDifyConnections());
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, difyConnectionInputSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  if (!parsed.data.apiKey.trim()) return fail("INVALID_PAYLOAD", 400, "missing api key");
  return ok(await createDifyConnection(parsed.data), { status: 201 });
}
