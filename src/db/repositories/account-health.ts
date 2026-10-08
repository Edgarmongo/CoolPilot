import {
  accountHealthSnapshotSchema,
  emptyAccountHealthSnapshot,
  type AccountHealthSnapshot,
} from "@/lib/account-risk";
import { readAppSetting, writeAppSetting } from "./settings";

const ACCOUNT_HEALTH_SETTINGS_KEY = "account-health";

/**
 * Persisted sign-in probe results.
 *
 * Stored in `app_settings` instead of a dedicated table so a backup/restore
 * round trip carries the risk state along with everything else, and so the
 * schema keeps needing no migration for a purely derived snapshot.
 */
export async function getAccountHealthSnapshot(): Promise<AccountHealthSnapshot> {
  const parsed = accountHealthSnapshotSchema.safeParse(
    await readAppSetting(ACCOUNT_HEALTH_SETTINGS_KEY),
  );
  return parsed.success ? parsed.data : { ...emptyAccountHealthSnapshot };
}

export async function saveAccountHealthSnapshot(
  snapshot: AccountHealthSnapshot,
): Promise<AccountHealthSnapshot> {
  const next = accountHealthSnapshotSchema.parse(snapshot);
  await writeAppSetting(ACCOUNT_HEALTH_SETTINGS_KEY, next);
  return next;
}
