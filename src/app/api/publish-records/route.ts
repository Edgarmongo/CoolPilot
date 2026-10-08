import { listPublishRecords } from "@/db/repository";
import { ok } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rawLimit = Number(new URL(request.url).searchParams.get("limit") || 200);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 500) : 200;
  return ok(await listPublishRecords(limit));
}
