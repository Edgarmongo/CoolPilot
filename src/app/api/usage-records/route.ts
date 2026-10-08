import { summarizeUsage } from "@/db/repository";
import { ok } from "@/lib/api";
import { normalizeUsageRange } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const range = normalizeUsageRange(new URL(request.url).searchParams.get("range") ?? undefined);
  return ok(await summarizeUsage(range));
}
