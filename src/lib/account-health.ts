import { listAccounts, listPublishRecords } from "@/db/repository";
import {
  getAccountHealthSnapshot,
  saveAccountHealthSnapshot,
} from "@/db/repositories/account-health";
import { getMetricsSettings } from "@/db/repositories/settings";
import {
  getBrowserPreviewSession,
  probeSiteLogin,
  stopBrowserPreviewSession,
} from "@/lib/browser-preview";
import {
  assessAccountRisk,
  findLoginBlock,
  summarizeAccountRisk,
  type AccountHealthReport,
  type AccountHealthScanState,
  type AccountLoginCheck,
  type AccountRiskEntry,
} from "@/lib/account-risk";
import type { AccountRecord } from "@/lib/types";

export type AccountHealthScanScope = {
  accountIds?: string[];
};

const IDLE_STATE: AccountHealthScanState = {
  state: "idle",
  total: 0,
  processed: 0,
  signedIn: 0,
  signedOut: 0,
  failed: 0,
};

// Single-user local app: one probe run at a time, tracked in a module singleton
// so the accounts page can poll progress (mirrors the metrics-sync approach).
let current: AccountHealthScanState = { ...IDLE_STATE };
let running = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getAccountHealthScanState(): AccountHealthScanState {
  return { ...current };
}

/** Merges the stored probes with publish history into the report the UI renders. */
export async function getAccountHealthReport(
  scope: AccountHealthScanScope = {},
): Promise<AccountHealthReport> {
  const [accounts, records, snapshot] = await Promise.all([
    listAccounts(),
    listPublishRecords(500),
    getAccountHealthSnapshot(),
  ]);

  const checks = new Map(snapshot.checks.map((check) => [check.accountId, check]));
  const selected = scope.accountIds?.length
    ? accounts.filter((account) => scope.accountIds?.includes(account.id))
    : accounts;

  const entries: AccountRiskEntry[] = selected.map((account) =>
    assessAccountRisk({ account, check: checks.get(account.id), records }),
  );

  return {
    scan: getAccountHealthScanState(),
    checkedAt: snapshot.checkedAt,
    accounts: entries,
    summary: summarizeAccountRisk(entries),
  };
}

/** Starts a probe run in the background; returns immediately for the UI to poll. */
export function startAccountHealthScan(scope: AccountHealthScanScope = {}): AccountHealthScanState {
  if (running) {
    return getAccountHealthScanState();
  }
  running = true;
  current = {
    state: "running",
    startedAt: Date.now(),
    total: 0,
    processed: 0,
    signedIn: 0,
    signedOut: 0,
    failed: 0,
  };
  void run(scope).finally(() => {
    running = false;
  });
  return getAccountHealthScanState();
}

async function run(scope: AccountHealthScanScope) {
  try {
    const [accounts, previous, metricsSettings] = await Promise.all([
      listAccounts(),
      getAccountHealthSnapshot(),
      getMetricsSettings(),
    ]);
    const selected = scope.accountIds?.length
      ? accounts.filter((account) => scope.accountIds?.includes(account.id))
      : accounts;
    current.total = selected.length;

    const checks = new Map(previous.checks.map((check) => [check.accountId, check]));

    for (const account of selected) {
      const check = await probeAccountLogin(account);
      checks.set(account.id, check);
      current.processed += 1;
      if (check.status === "signed_in") current.signedIn += 1;
      else if (check.status === "signed_out") current.signedOut += 1;
      else current.failed += 1;

      // Reuse the metrics throttle: browsers are heavy, so give the platform a
      // breather between accounts instead of opening every profile at once.
      if (metricsSettings.perAccountThrottleMs > 0 && current.processed < current.total) {
        await sleep(metricsSettings.perAccountThrottleMs);
      }
    }

    await saveAccountHealthSnapshot({ checkedAt: Date.now(), checks: [...checks.values()] });
    current.state = "done";
    current.finishedAt = Date.now();
  } catch (error) {
    current.state = "failed";
    current.finishedAt = Date.now();
    current.message = error instanceof Error ? error.message : String(error);
  }
}

/**
 * Probes a single account headlessly.
 *
 * A preview session the user already has open is reused and left open; a
 * session started here is always closed again, including when the probe throws.
 */
export async function probeAccountLogin(account: AccountRecord): Promise<AccountLoginCheck> {
  const checkedAt = Date.now();
  const hasOpenSession = getBrowserPreviewSession(account.id).status === "ready";

  try {
    const probe = await probeSiteLogin(account, { headless: true, bringToFront: false });
    return {
      accountId: account.id,
      status: probe.status,
      reason: probe.reason,
      url: probe.url,
      message: probe.message,
      checkedAt,
    };
  } catch (error) {
    return {
      accountId: account.id,
      status: "unknown",
      reason: "error",
      url: "",
      message: error instanceof Error ? error.message : String(error),
      checkedAt,
    };
  } finally {
    if (!hasOpenSession) {
      await stopBrowserPreviewSession(account.id).catch(() => undefined);
    }
  }
}

/**
 * Publish pre-check used by `/api/publish`: a fresh probe that landed on the
 * platform's login page means the browser launch is pointless.
 */
export async function findAccountLoginBlock(accountId: string) {
  const snapshot = await getAccountHealthSnapshot();
  return findLoginBlock(snapshot.checks, accountId);
}
