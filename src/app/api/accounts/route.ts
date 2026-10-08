import { createAccount, listAccounts } from "@/db/repository";
import { fail, ok, parseJson } from "@/lib/api";
import { siteInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  return ok(await listAccounts());
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, siteInputSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }
  const site = await createAccount(parsed.data);
  return ok(site, { status: 201 });
}
