"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Maximize2, Minimize2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { runTeardownNeedsConfirm, type RunLifecycleStatus } from "@/lib/publish-run-teardown";
import type { ContentItem, AccountRecord } from "@/lib/types";
import { PublishRunPanel } from "./publish-run-panel";

/** Multi-account publish dialog shared by articles, posts and videos. */
export function ContentPublishDialog({
  item,
  type,
  onClose,
  onPublished,
}: {
  item: ContentItem | null;
  type: string;
  onClose: () => void;
  onPublished?: () => void;
}) {
  const { t } = useI18n();
  const { data: accounts = [] } = useSWR<AccountRecord[]>("/api/accounts", swrFetcher);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [runAccounts, setRunAccounts] = useState<AccountRecord[] | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  /** The live run's tab statuses, reported by the panel: this is what a close would abandon (C2-1d). */
  const [runStatuses, setRunStatuses] = useState<RunLifecycleStatus[]>([]);
  /** Set when the author asked to close while a run is live - the dialog asks instead of obeying. */
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  useEffect(() => {
    if (!item) return;
    window.queueMicrotask(() => {
      setSelectedAccountIds([]);
      setRunAccounts(null);
      setFullscreen(false);
      setRunStatuses([]);
      setConfirmAbandon(false);
    });
  }, [item]);

  function toggleSite(accountId: string) {
    setSelectedAccountIds((prev) => (prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]));
  }

  function handleStart() {
    if (!item || selectedAccountIds.length === 0) return;
    const chosen = selectedAccountIds
      .map((id) => accounts.find((account) => account.id === id))
      .filter((account): account is AccountRecord => Boolean(account));
    if (chosen.length > 0) setRunAccounts(chosen);
  }

  /** Drops the dialog's own state. Both outcomes of the question end here. */
  function finishClose() {
    setRunAccounts(null);
    setFullscreen(false);
    setRunStatuses([]);
    setConfirmAbandon(false);
    onClose();
  }

  /**
   * Abandons the run: best-effort delete any draft we created, then stop the sessions.
   *
   * This is the only place that throws the author's draft away, and since C2-1d it is reached only
   * after the author has asked for it (`confirmAbandon`) or when the run was already over. Closing
   * the panel used to do this on its own, which cost anyone who closed the window meaning to come
   * back to it later the draft, the session, and any way to name either.
   */
  function abandonRun() {
    const chosen = runAccounts;
    if (chosen) {
      void (async () => {
        await Promise.all(
          chosen.map((account) => apiPost("/api/publish/discard", { accountId: account.id }).catch(() => undefined)),
        );
        await Promise.all(
          chosen.map((account) =>
            fetch(`/api/browser-profiles/${account.id}/preview`, { method: "DELETE" }).catch(() => undefined),
          ),
        );
      })();
    }
    finishClose();
  }

  /**
   * Closing, from the X, the overlay, ESC or the panel's 关闭 - the panel routes its close here
   * instead of stopping sessions itself (C2-1d). With a run that is live (preparing, in the editor, or
   * moved without a confirmation) the answer is a question; otherwise nothing is at stake and the
   * dialog just closes.
   */
  function requestClose() {
    if (runAccounts && runTeardownNeedsConfirm(runStatuses)) {
      setConfirmAbandon(true);
      return;
    }
    abandonRun();
  }

  return (
    <Dialog
      open={Boolean(item)}
      onClose={requestClose}
      title={runAccounts ? t("publishRunning") : t("publishSelectAccounts")}
      maxWidth={runAccounts ? "2xl" : "lg"}
      fullscreen={Boolean(runAccounts) && fullscreen}
      headerActions={
        runAccounts ? (
          <button
            type="button"
            onClick={() => setFullscreen((value) => !value)}
            className="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
            aria-label={fullscreen ? t("dlgExitFullscreen") : t("dlgFullscreen")}
            title={fullscreen ? t("dlgExitFullscreen") : t("dlgFullscreen")}
          >
            {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        ) : null
      }
    >
      {/*
        C2-1d: the author asked to close while a session is still theirs. Closing used to stop every
        session and delete the platform draft, so this asks first - and "keep working" just dismisses
        the question, leaving the session, the draft and the panel exactly as they were.
      */}
      {confirmAbandon ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
          <p>{t("publishCloseConfirm")}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmAbandon(false)}>
              {t("publishCloseStay")}
            </Button>
            <Button variant="danger" size="sm" onClick={abandonRun}>
              {t("publishCloseAbandon")}
            </Button>
          </div>
        </div>
      ) : null}

      {item ? (
        runAccounts ? (
          <PublishRunPanel
            item={item}
            type={type}
            accounts={runAccounts}
            fullscreen={fullscreen}
            onClose={onClose}
            onPublished={onPublished}
            onRequestClose={requestClose}
            onStatusesChange={setRunStatuses}
          />
        ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-sky-100 bg-sky-50/40 px-3 py-2">
            <p className="truncate text-sm font-medium text-zinc-900">{item.title || t("agentThreadUntitled")}</p>
          </div>
          <p className="text-xs text-zinc-500">{t("publishMultiHint")}</p>

          {accounts.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-10 text-center text-sm text-zinc-500">
              {t("publishEmptyAccounts")}
            </p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {accounts.map((site) => (
                <label
                  key={site.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition ${
                    selectedAccountIds.includes(site.id)
                      ? "border-sky-300 bg-sky-50/60"
                      : "border-sky-100 bg-white hover:bg-sky-50/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedAccountIds.includes(site.id)}
                    onChange={() => toggleSite(site.id)}
                    className="size-4"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900">{site.name}</p>
                    <p className="text-xs text-zinc-400">
                      {site.platform}
                      {site.status === "active"
                        ? ` · ${t("siteStatusActive")}`
                        : site.status === "needs_login"
                          ? ` · ${t("siteNeedsLogin")}`
                          : ""}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("dlgCancel")}
            </Button>
            <Button onClick={handleStart} disabled={selectedAccountIds.length === 0}>
              <Send size={14} />
              {t("publishConfirm")}
            </Button>
          </div>
        </div>
        )
      ) : null}
    </Dialog>
  );
}
