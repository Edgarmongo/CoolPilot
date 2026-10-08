import { z } from "zod";
import type { AccountRecord, AccountStatus, PublishRecord } from "@/lib/types";

/**
 * Account risk (账号健康度风控) model.
 *
 * The console already shows a "profile completeness" health bar on the accounts
 * page. This module answers a different question: *can this account still
 * publish right now?* It combines three cheap signals — the last headless
 * sign-in probe, recent publish failures, and the account record itself — into a
 * deterministic risk level so the UI (and the publish pre-check) agree.
 *
 * Everything here is pure so it can be unit tested without a browser or a DB.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Failure/record window used when scoring an account. */
export const ACCOUNT_RISK_WINDOW_DAYS = 14;
/** A sign-in probe older than this is not trusted by the publish pre-check. */
export const ACCOUNT_HEALTH_GATE_MS = 6 * 60 * 60 * 1000;

export const accountRiskLevels = ["healthy", "warning", "danger", "unknown"] as const;
export type AccountRiskLevel = (typeof accountRiskLevels)[number];

export const accountRiskReasons = [
  /** The probe landed on the platform's login wall. */
  "signed_out",
  /** The account is marked `needs_login` and no probe has confirmed otherwise. */
  "login_unverified",
  /** Recent publish failures that look like an expired session. */
  "session_expired",
  /** Recent publish failures (selectors/network/platform side). */
  "publish_failures",
  /** The account is paused, so scheduled publishing will not run. */
  "paused",
  /** No local browser profile folder is recorded, so automation cannot start. */
  "missing_profile",
  /** Nothing to judge from yet — run a health check. */
  "idle",
] as const;
export type AccountRiskReason = (typeof accountRiskReasons)[number];

export const loginCheckReasons = ["ok", "login_url", "login_text", "no_url", "error"] as const;
export type LoginCheckReason = (typeof loginCheckReasons)[number];

export const loginCheckStatuses = ["signed_in", "signed_out", "unknown"] as const;
export type LoginCheckStatus = (typeof loginCheckStatuses)[number];

export type AccountLoginCheck = {
  accountId: string;
  status: LoginCheckStatus;
  reason: LoginCheckReason;
  url: string;
  message?: string;
  checkedAt: number;
};

export type AccountRiskEntry = {
  accountId: string;
  accountName: string;
  platform: string;
  status: AccountStatus;
  level: AccountRiskLevel;
  /** 100 = no risk, 0 = cannot publish. */
  score: number;
  reasons: AccountRiskReason[];
  windowFailureCount: number;
  windowSuccessCount: number;
  lastCheckedAt: number | null;
  lastPublishedAt: number | null;
};

export type AccountRiskSummary = {
  total: number;
  healthy: number;
  warning: number;
  danger: number;
  unknown: number;
  /** Accounts needing attention, worst first. */
  attention: string[];
};

export const accountHealthScanStates = ["idle", "running", "done", "failed"] as const;
export type AccountHealthScanStateName = (typeof accountHealthScanStates)[number];

export type AccountHealthScanState = {
  state: AccountHealthScanStateName;
  startedAt?: number;
  finishedAt?: number;
  total: number;
  processed: number;
  signedIn: number;
  signedOut: number;
  failed: number;
  message?: string;
};

export type AccountHealthReport = {
  scan: AccountHealthScanState;
  /** When the stored sign-in checks were captured (`0` = never). */
  checkedAt: number;
  accounts: AccountRiskEntry[];
  summary: AccountRiskSummary;
};

/** Persisted sign-in probe results (stored in `app_settings`). */
export const accountHealthSnapshotSchema = z.object({
  checkedAt: z.number().int().min(0),
  checks: z.array(
    z.object({
      accountId: z.string().min(1),
      status: z.enum(loginCheckStatuses),
      reason: z.enum(loginCheckReasons),
      url: z.string(),
      message: z.string().optional(),
      checkedAt: z.number().int().min(0),
    }),
  ),
});

export type AccountHealthSnapshot = {
  checkedAt: number;
  checks: AccountLoginCheck[];
};

export const emptyAccountHealthSnapshot: AccountHealthSnapshot = { checkedAt: 0, checks: [] };

/**
 * Which page the sign-in probe should visit. The publish page is preferred
 * because it is the page publishing actually drives; the account URL is the
 * fallback when a platform has no built-in publish URL.
 */
export function resolveLoginCheckUrl(account: AccountRecord, publishPageUrl: string) {
  const candidate = (publishPageUrl || account.url || "").trim();
  return /^https?:\/\//i.test(candidate) ? candidate : "";
}

/** Publish failures whose message reads like an expired sign-in. */
const SESSION_FAILURE_PATTERN = /(登录|登陆|未登录|重新登录|重新登入|sign\s*in|log\s*in|login|session|expired|unauthor|授权|過期)/i;

export type AccountRiskInput = {
  account: AccountRecord;
  /** Latest stored sign-in probe for this account, if any. */
  check?: AccountLoginCheck;
  /** Publish records to score; records of other accounts are ignored. */
  records: PublishRecord[];
  now?: number;
  windowDays?: number;
};

const LEVEL_DANGER_BELOW = 40;
// Any recent failure should surface, so the warning band is wide.
const LEVEL_WARNING_BELOW = 90;

/**
 * Scores one account. The rules are intentionally explicit (no ML, no hidden
 * state) so the UI can explain every point that was deducted:
 *
 * - probe says signed out: -65 (dangerous on its own)
 * - failures that read like an expired session: -35
 * - 3+ failures in the window: -30, otherwise any failure: -12
 * - account flagged `needs_login`: -25
 * - account paused: -20
 * - missing browser profile path: -15
 */
export function assessAccountRisk({
  account,
  check,
  records,
  now = Date.now(),
  windowDays = ACCOUNT_RISK_WINDOW_DAYS,
}: AccountRiskInput): AccountRiskEntry {
  const since = now - windowDays * DAY_MS;
  const scoped = records.filter((record) => record.accountId === account.id);
  const recent = scoped.filter((record) => record.createdAt >= since);
  const failures = recent.filter((record) => record.status === "failed");
  const successes = recent.filter((record) => record.status === "published");
  const sessionFailures = failures.filter((record) => SESSION_FAILURE_PATTERN.test(record.message));

  const reasons: AccountRiskReason[] = [];
  let score = 100;

  if (check?.status === "signed_out") {
    reasons.push("signed_out");
    score -= 65;
  }
  if (sessionFailures.length > 0) {
    reasons.push("session_expired");
    score -= 35;
  }
  if (failures.length >= 3) {
    reasons.push("publish_failures");
    score -= 30;
  } else if (failures.length > 0) {
    reasons.push("publish_failures");
    score -= 12;
  }
  if (account.status === "needs_login" && check?.status !== "signed_out") {
    reasons.push("login_unverified");
    score -= 25;
  }
  if (account.status === "paused") {
    reasons.push("paused");
    score -= 20;
  }
  if (!account.profilePath.trim()) {
    reasons.push("missing_profile");
    score -= 15;
  }

  const probed = Boolean(check && check.status !== "unknown");
  // Account-record reasons (paused, no profile) already carry a verdict, so they
  // count as signals; "idle" is only reported when nothing at all is known.
  const hasSignals = probed || recent.length > 0 || reasons.length > 0;
  if (!hasSignals) {
    reasons.push("idle");
  }

  score = Math.max(0, Math.min(100, score));
  let level: AccountRiskLevel = !hasSignals
    ? "unknown"
    : score < LEVEL_DANGER_BELOW
      ? "danger"
      : score < LEVEL_WARNING_BELOW
        ? "warning"
        : "healthy";
  // A paused account or a missing profile can break scheduled publishing even
  // when nothing has failed yet, so they never report as fully healthy.
  if (level === "healthy" && (account.status === "paused" || !account.profilePath.trim())) {
    level = "warning";
  }

  const lastPublishedAt = scoped.reduce<number | null>((latest, record) => {
    if (record.status !== "published" || !record.publishedAt) return latest;
    return latest === null || record.publishedAt > latest ? record.publishedAt : latest;
  }, null);

  return {
    accountId: account.id,
    accountName: account.name,
    platform: account.platform,
    status: account.status,
    level,
    score,
    reasons,
    windowFailureCount: failures.length,
    windowSuccessCount: successes.length,
    lastCheckedAt: check?.checkedAt ?? null,
    lastPublishedAt,
  };
}

export function summarizeAccountRisk(entries: AccountRiskEntry[]): AccountRiskSummary {
  const summary: AccountRiskSummary = {
    total: entries.length,
    healthy: 0,
    warning: 0,
    danger: 0,
    unknown: 0,
    attention: [],
  };

  for (const entry of entries) {
    summary[entry.level] += 1;
  }

  summary.attention = [...entries]
    .filter((entry) => entry.level === "danger" || entry.level === "warning")
    .sort((left, right) => left.score - right.score)
    .map((entry) => entry.accountId);

  return summary;
}

/**
 * The publish pre-check: a sign-in probe that landed on the platform's login
 * page and is still fresh is strong enough evidence to skip launching a browser.
 * Text-only hits are deliberately ignored here to avoid blocking a real publish.
 */
export function findLoginBlock(checks: AccountLoginCheck[], accountId: string, now = Date.now()) {
  const check = checks.find((candidate) => candidate.accountId === accountId);
  if (!check || check.status !== "signed_out" || check.reason !== "login_url") return null;
  return now - check.checkedAt <= ACCOUNT_HEALTH_GATE_MS ? check : null;
}

