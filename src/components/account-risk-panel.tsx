"use client";

import { useState } from "react";
import useSWR from "swr";
import { Activity, ShieldAlert, ShieldCheck } from "lucide-react";
import { ApiClientError, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import {
  type AccountHealthReport,
  type AccountRiskEntry,
  type AccountRiskLevel,
  type AccountRiskReason,
} from "@/lib/account-risk";
import { Button } from "@/components/ui/button";

/**
 * Account risk (账号健康度风控) state for the accounts page.
 *
 * The hook owns the polling: while a probe run is in flight the endpoint is
 * re-fetched every couple of seconds so the banner shows live progress.
 */
export function useAccountHealth() {
  const { t } = useI18n();
  const [notice, setNotice] = useState("");
  const [starting, setStarting] = useState(false);
  const { data, error, mutate } = useSWR<AccountHealthReport>("/api/account-health", swrFetcher, {
    refreshInterval: (latest) => (latest?.scan.state === "running" ? 2500 : 0),
  });

  const running = data?.scan.state === "running";

  async function scan(accountIds?: string[]) {
    setStarting(true);
    setNotice("");
    try {
      await apiPost("/api/account-health", accountIds?.length ? { accountIds } : {});
      await mutate();
    } catch (scanError) {
      if (scanError instanceof ApiClientError && scanError.code) {
        setNotice(t(`error_${scanError.code}` as Parameters<typeof t>[0]));
      } else {
        setNotice(scanError instanceof Error ? scanError.message : t("unknownError"));
      }
    } finally {
      setStarting(false);
    }
  }

  return {
    report: data,
    loadError: error instanceof Error ? error.message : "",
    notice,
    dismissNotice: () => setNotice(""),
    running,
    scanning: starting || running,
    scan,
    reload: mutate,
  };
}

const levelChipClass: Record<AccountRiskLevel, string> = {
  healthy: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-rose-100 text-rose-700",
  unknown: "bg-zinc-100 text-zinc-600",
};

const levelDotClass: Record<AccountRiskLevel, string> = {
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  unknown: "bg-zinc-400",
};

export function riskLevelLabelKey(level: AccountRiskLevel) {
  if (level === "healthy") return "riskLevelHealthy" as const;
  if (level === "warning") return "riskLevelWarning" as const;
  if (level === "danger") return "riskLevelDanger" as const;
  return "riskLevelUnknown" as const;
}

export function riskReasonLabelKey(reason: AccountRiskReason) {
  const keys = {
    signed_out: "riskReasonSignedOut",
    login_unverified: "riskReasonLoginUnverified",
    session_expired: "riskReasonSessionExpired",
    publish_failures: "riskReasonPublishFailures",
    paused: "riskReasonPaused",
    missing_profile: "riskReasonMissingProfile",
    idle: "riskReasonIdle",
  } as const;
  return keys[reason];
}

/** Small per-account chip showing the risk level; hover reveals the reasons. */
export function AccountRiskChip({ entry }: { entry?: AccountRiskEntry }) {
  const { t } = useI18n();
  if (!entry) return null;

  const reasons = entry.reasons.map((reason) => t(riskReasonLabelKey(reason))).join(" / ");

  return (
    <span
      title={`${t("riskLevel")}: ${t(riskLevelLabelKey(entry.level))} · ${t("riskScore")} ${entry.score}${
        reasons ? `\n${reasons}` : ""
      }`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        levelChipClass[entry.level]
      }`}
    >
      <span className={`size-1.5 rounded-full ${levelDotClass[entry.level]}`} />
      {t("riskLevel")} {t(riskLevelLabelKey(entry.level))}
    </span>
  );
}


type AccountRiskBannerProps = {
  report?: AccountHealthReport;
  scanning: boolean;
  notice: string;
  onDismissNotice: () => void;
  onScan: (accountIds?: string[]) => void;
};

/**
 * Risk summary above the account grid: one button runs a headless sign-in probe
 * for every account, and the accounts that need attention are listed with the
 * reason they were flagged.
 */
export function AccountRiskBanner({
  report,
  scanning,
  notice,
  onDismissNotice,
  onScan,
}: AccountRiskBannerProps) {
  const { t } = useI18n();
  const summary = report?.summary;
  const scan = report?.scan;
  const attention = [...(report?.accounts ?? [])]
    .filter((entry) => entry.level === "danger" || entry.level === "warning")
    .sort((left, right) => left.score - right.score)
    .slice(0, 6);
  const hasDanger = (summary?.danger ?? 0) > 0;

  return (
    <section className="space-y-3 rounded-2xl border border-sky-100 bg-white p-4">
      {notice ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {notice}
          <button type="button" onClick={onDismissNotice} className="ml-3 font-bold opacity-70">
            ×
          </button>
        </p>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-2xl ${
              hasDanger ? "bg-rose-50 text-rose-600" : "bg-sky-50 text-sky-600"
            }`}
          >
            {hasDanger ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900">{t("riskTitle")}</p>
            <p className="text-xs leading-5 text-zinc-500">{t("riskHint")}</p>
            <p className="text-xs text-zinc-400">
              {report?.checkedAt
                ? `${t("riskLastChecked")} ${new Date(report.checkedAt).toLocaleString()}`
                : t("riskNoScanYet")}
              {scan?.state === "running"
                ? ` · ${t("riskScanProgress", {
                    processed: String(scan.processed),
                    total: String(scan.total),
                  })}`
                : ""}
            </p>
          </div>
        </div>

        <Button variant="outline" size="sm" loading={scanning} onClick={() => onScan()}>
          <Activity size={14} />
          {scanning ? t("riskScanning") : t("riskScan")}
        </Button>
      </div>

      {summary ? (
        <div className="flex flex-wrap gap-2">
          {(["healthy", "warning", "danger", "unknown"] as const).map((level) => (
            <span
              key={level}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${levelChipClass[level]}`}
            >
              {t(riskLevelLabelKey(level))} · {summary[level]}
            </span>
          ))}
        </div>
      ) : null}

      {scan?.state === "failed" && scan.message ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {scan.message}
        </p>
      ) : null}

      {report && !report.checkedAt ? (
        <p className="text-xs text-zinc-500">{t("riskEmptyHint")}</p>
      ) : attention.length === 0 ? (
        <p className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-700">
          {t("riskAllHealthy")}
        </p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {attention.map((entry) => (
            <li
              key={entry.accountId}
              className="flex items-center justify-between gap-3 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-zinc-800">
                  {entry.accountName} · {entry.platform}
                </p>
                <p className="truncate text-[11px] text-zinc-500">
                  {entry.reasons.map((reason) => t(riskReasonLabelKey(reason))).join(" / ")}
                </p>
              </div>
              <Button variant="ghost" size="sm" loading={scanning} onClick={() => onScan([entry.accountId])}>
                {t("riskCheckAccount")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
