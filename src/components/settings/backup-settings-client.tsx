"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { DatabaseBackup, Download, HardDrive, Upload } from "lucide-react";
import { apiPost, swrFetcher, ApiClientError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import {
  BACKUP_MAX_RESTORE_BYTES,
  parseBackupDocument,
  summarizeBackupTables,
  type BackupRestoreMode,
  type BackupRestoreReport,
  type BackupSnapshot,
  type BackupTableSummary,
} from "@/lib/backup";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConsoleCard, ConsoleNotice, ConsoleSectionHeader } from "@/components/ui/console-surface";
import { SegmentedControl } from "@/components/ui/form-controls";
import { SettingsTabs } from "./settings-tabs";

type BackupOverview = {
  format: string;
  version: number;
  dataDir: string;
  tables: BackupTableSummary[];
  tableCount: number;
  totalRows: number;
};

type PendingRestore = {
  fileName: string;
  snapshot: BackupSnapshot;
};

export default function BackupSettingsClient() {
  const { t } = useI18n();
  const { data: overview, mutate: reloadOverview } = useSWR<BackupOverview>("/api/backup", swrFetcher, {
    revalidateOnFocus: false,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "error">("success");
  const [mode, setMode] = useState<BackupRestoreMode>("replace");
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [report, setReport] = useState<BackupRestoreReport | null>(null);

  function showNotice(message: string, tone: "success" | "error" = "success") {
    setNotice(message);
    setNoticeTone(tone);
  }

  function errorNotice(error: unknown) {
    if (error instanceof ApiClientError && error.code) {
      return t(`error_${error.code}` as Parameters<typeof t>[0]);
    }
    return error instanceof Error ? error.message : t("unknownError");
  }

  function parseFailureNotice(reason: "invalid_json" | "invalid_document" | "unsupported_version") {
    if (reason === "invalid_json") return t("backupErrorInvalidJson");
    if (reason === "invalid_document") return t("backupErrorInvalidDocument");
    return t("backupErrorUnsupportedVersion");
  }

  function handleExport() {
    // The route answers with Content-Disposition: attachment, so navigating keeps
    // the console open and lets the browser save the file.
    window.location.assign("/api/backup/export");
  }

  async function handleFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset first so picking the same file twice still fires a change event.
    event.target.value = "";
    if (!file) return;

    if (file.size > BACKUP_MAX_RESTORE_BYTES) {
      showNotice(t("backupErrorTooLarge"), "error");
      return;
    }

    const parsed = parseBackupDocument(await file.text());
    if (!parsed.ok) {
      showNotice(parseFailureNotice(parsed.reason), "error");
      return;
    }

    setPending({ fileName: file.name, snapshot: parsed.snapshot });
  }

  async function handleRestore() {
    if (!pending) return;
    setRestoring(true);
    try {
      const result = await apiPost<BackupRestoreReport>("/api/backup/restore", {
        mode,
        snapshot: pending.snapshot,
      });
      setReport(result);
      setPending(null);
      showNotice(
        t("backupRestoreDone", {
          rows: String(result.totalRows),
          tables: String(Object.keys(result.tables).length),
        }),
      );
      await reloadOverview();
    } catch (error) {
      showNotice(errorNotice(error), "error");
    } finally {
      setRestoring(false);
    }
  }

  const pendingRows = pending ? summarizeBackupTables(pending.snapshot.tables) : [];
  const restoredTables = report
    ? Object.entries(report.tables)
        .map(([name, table]) => ({ name, rows: table.inserted }))
        .sort((left, right) => right.rows - left.rows || left.name.localeCompare(right.name))
    : [];

  return (
    <div className="space-y-6">
      {notice ? <ConsoleNotice message={notice} tone={noticeTone} onDismiss={() => setNotice("")} /> : null}

      <SettingsTabs activeTab="backup" />

      <ConsoleCard className="space-y-5">
        <ConsoleSectionHeader
          icon={<DatabaseBackup size={18} />}
          title={t("backupExportTitle")}
          action={
            <Button size="sm" onClick={handleExport}>
              <Download size={14} />
              {t("backupExport")}
            </Button>
          }
        />
        <p className="text-sm leading-6 text-zinc-500">{t("backupExportHint")}</p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-3">
            <p className="text-lg font-semibold text-zinc-900">{overview?.tableCount ?? "-"}</p>
            <p className="text-xs text-zinc-500">{t("backupTables")}</p>
          </div>
          <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-3">
            <p className="text-lg font-semibold text-zinc-900">{overview?.totalRows ?? "-"}</p>
            <p className="text-xs text-zinc-500">{t("backupTotalRows")}</p>
          </div>
          <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
              <HardDrive size={14} />
              {t("backupDataDir")}
            </p>
            <p className="mt-1 break-all text-xs text-zinc-500">{overview?.dataDir ?? "-"}</p>
          </div>
        </div>

        {overview?.tables.length ? (
          <div className="flex flex-wrap gap-2">
            {overview.tables.map((table) => (
              <span
                key={table.name}
                className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600"
              >
                {table.name} · {table.rows}
              </span>
            ))}
          </div>
        ) : null}

        <p className="text-xs leading-5 text-zinc-400">{t("backupMediaHint")}</p>
      </ConsoleCard>

      <ConsoleCard className="space-y-5">
        <ConsoleSectionHeader icon={<Upload size={18} />} title={t("backupRestoreTitle")} />
        <p className="text-sm leading-6 text-zinc-500">{t("backupRestoreHint")}</p>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => void handleFilePicked(event)}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload size={16} />
            {t("backupRestorePickFile")}
          </Button>
          <span className="text-xs text-zinc-400">{t("backupRestorePickHint")}</span>
        </div>

        {restoredTables.length > 0 ? (
          <div className="space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
            <p className="text-sm font-semibold text-emerald-800">{t("backupRestoreReportTitle")}</p>
            <div className="flex flex-wrap gap-2">
              {restoredTables.map((table) => (
                <span
                  key={table.name}
                  className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                >
                  {table.name} · {table.rows}
                </span>
              ))}
            </div>
            {report?.unknownTables.length ? (
              <p className="text-xs text-amber-700">
                {t("backupRestoreUnknownTables", { tables: report.unknownTables.join(", ") })}
              </p>
            ) : null}
          </div>
        ) : null}
      </ConsoleCard>

      <Dialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title={t("backupRestoreConfirmTitle")}
        maxWidth="lg"
      >
        <div className="space-y-4">
          <p className="text-sm font-medium text-zinc-700">{pending?.fileName}</p>

          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-zinc-700">{t("backupRestoreMode")}</span>
            <SegmentedControl<BackupRestoreMode>
              value={mode}
              options={[
                { value: "replace", label: t("backupRestoreModeReplace") },
                { value: "merge", label: t("backupRestoreModeMerge") },
              ]}
              onChange={setMode}
            />
            <span className="text-xs text-zinc-400">
              {mode === "replace" ? t("backupRestoreModeReplaceHint") : t("backupRestoreModeMergeHint")}
            </span>
          </div>

          <div className="space-y-2 rounded-2xl border border-amber-100 bg-amber-50/60 p-3">
            <p className="text-xs font-semibold text-amber-800">{t("backupRestoreWarning")}</p>
            <p className="text-xs text-amber-700">
              {t("backupRestorePendingRows", {
                rows: String(pendingRows.reduce((total, table) => total + table.rows, 0)),
              })}
            </p>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t("btnCancel")}
            </Button>
            <Button variant="danger" loading={restoring} onClick={() => void handleRestore()}>
              <Upload size={16} />
              {t("backupRestoreConfirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
