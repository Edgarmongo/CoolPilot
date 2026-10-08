"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Maximize2, Minimize2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
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

  useEffect(() => {
    if (!item) return;
    window.queueMicrotask(() => {
      setSelectedAccountIds([]);
      setRunAccounts(null);
      setFullscreen(false);
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

  return (
    <Dialog
      open={Boolean(item)}
      onClose={() => {
        if (runAccounts) {
          const accounts = runAccounts;
          void (async () => {
            // Abandoning: best-effort delete any draft we created, then stop sessions.
            await Promise.all(
              accounts.map((account) => apiPost("/api/publish/discard", { accountId: account.id }).catch(() => undefined)),
            );
            await Promise.all(
              accounts.map((account) =>
                fetch(`/api/browser-profiles/${account.id}/preview`, { method: "DELETE" }).catch(() => undefined),
              ),
            );
          })();
        }
        setRunAccounts(null);
        setFullscreen(false);
        onClose();
      }}
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
      {item ? (
        runAccounts ? (
          <PublishRunPanel
            item={item}
            type={type}
            accounts={runAccounts}
            fullscreen={fullscreen}
            onClose={onClose}
            onPublished={onPublished}
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
