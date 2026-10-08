import { createKnowledgeBase, listKnowledgeBase } from "@/db/repositories/knowledge-base";
import { fail, ok, parseJson } from "@/lib/api";
import { knowledgeBaseInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  return ok(await listKnowledgeBase());
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, knowledgeBaseInputSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);
  return ok(await createKnowledgeBase(parsed.data), { status: 201 });
}
