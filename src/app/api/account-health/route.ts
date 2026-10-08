import { fail, ok, parseJson } from "@/lib/api";
import { getAccountHealthReport, startAccountHealthScan } from "@/lib/account-health";
import { accountHealthScanSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Account risk state (账号健康度风控) for the accounts page.
 *
 * `GET` merges the last sign-in probes with publish history; `POST` starts a
 * background probe run (headless, one account at a time) that the UI polls by
 * re-fetching this endpoint.
 */
export async function GET(request: Request) {
  const accountId = new URL(request.url).searchParams.get("accountId")?.trim();
  return ok(await getAccountHealthReport(accountId ? { accountIds: [accountId] } : {}));
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, accountHealthScanSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }
  return ok(startAccountHealthScan(parsed.data));
}
