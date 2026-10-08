import { listAccounts, listPublishRecords } from "@/db/repository";
import { countRecordsMissingMetrics, latestAccountMetricSnapshots } from "@/db/repositories/metrics";
import { ok } from "@/lib/api";
import { summarizeMetrics } from "@/lib/metrics";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rangeDays = Number(new URL(request.url).searchParams.get("range") || 30);
  const [records, accounts, latest, pendingCount] = await Promise.all([
    listPublishRecords(1000),
    listAccounts(),
    latestAccountMetricSnapshots(),
    countRecordsMissingMetrics(),
  ]);
  const followersByAccount = new Map<string, number>();
  for (const [accountId, snapshot] of latest) {
    followersByAccount.set(accountId, snapshot.followers);
  }
  const overview = summarizeMetrics(records, accounts, followersByAccount, rangeDays);
  return ok({ ...overview, pendingCount });
}
