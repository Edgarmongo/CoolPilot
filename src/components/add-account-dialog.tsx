"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import type { AccountPlatform, AccountRecord } from "@/lib/types";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { consoleInputClass } from "@/components/ui/console-surface";
import { defaultUrlForPlatform } from "@/components/accounts/shared";
import { accountPlatformOptions, platformMatchesSearch, platformMeta } from "@/components/account-platform-meta";

const LOGIN_TIMEOUT_SECONDS = 180;
const LOGIN_POLL_INTERVAL_MS = 3_000;

export type AddAccountResult = {
  site: AccountRecord;
  status: "logged_in" | "timeout" | "cancelled";
};

function nextAccountName(platform: AccountPlatform, accounts: AccountRecord[]) {
  const count = accounts.filter((site) => site.platform === platform).length;
  return count === 0 ? platform : `${platform} ${count + 1}`;
}

/**
 * "Add account" flow: pick a platform, then open a real browser window so the user can
 * scan a QR code / sign in. The account is saved automatically once the login is detected,
 * or kept as "login required" if the user cancels or the wait times out.
 */
export function AddAccountDialog({
  open,
  accounts,
  onClose,
  onDone,
}: {
  open: boolean;
  accounts: AccountRecord[];
  onClose: () => void;
  onDone: (result: AddAccountResult) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [site, setSite] = useState<AccountRecord | null>(null);
  const [query, setQuery] = useState("");
  const [launching, setLaunching] = useState<AccountPlatform | null>(null);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(LOGIN_TIMEOUT_SECONDS);
  const [finishing, setFinishing] = useState(false);
  const settledRef = useRef(false);

  const filteredPlatforms = useMemo(
    () => accountPlatformOptions.filter((platform) => platformMatchesSearch(platform, query)),
    [query],
  );

  function reset() {
    setSite(null);
    setQuery("");
    setLaunching(null);
    setError("");
    setRemaining(LOGIN_TIMEOUT_SECONDS);
    setFinishing(false);
    settledRef.current = false;
  }

  function dismiss() {
    reset();
    onClose();
  }

  async function stopBrowser(accountId: string) {
    await fetch(`/api/browser-profiles/${accountId}/preview`, { method: "DELETE" }).catch(() => undefined);
  }

  async function handlePick(platform: AccountPlatform) {
    setError("");
    setLaunching(platform);
    settledRef.current = false;
    try {
      const created = await apiPost<AccountRecord>("/api/accounts", {
        name: nextAccountName(platform, accounts),
        platform,
        url: defaultUrlForPlatform(platform),
        status: "needs_login",
      });
      await apiPost(`/api/browser-profiles/${created.id}/open`, { headless: false });
      setRemaining(LOGIN_TIMEOUT_SECONDS);
      setSite(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(null);
    }
  }

  async function finalize(target: AccountRecord, status: AddAccountResult["status"]) {
    if (settledRef.current) return;
    settledRef.current = true;
    setFinishing(true);
    try {
      const loggedIn = status === "logged_in";
      if (loggedIn) {
        await apiPatch(`/api/accounts/${target.id}`, { status: "active" }).catch(() => undefined);
      }
      await stopBrowser(target.id);
      await onDone({ site: loggedIn ? { ...target, status: "active" } : target, status });
    } finally {
      dismiss();
    }
  }

  // Countdown + login polling. Cleanup never stops the browser directly (React Strict Mode
  // re-runs effects on mount); the browser is only closed by the explicit finalize paths.
  useEffect(() => {
    if (!open || !site) return;
    const target = site;
    const startedAt = Date.now();
    let disposed = false;

    const tick = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setRemaining(Math.max(0, LOGIN_TIMEOUT_SECONDS - elapsed));
    }, 1000);

    const poll = window.setInterval(() => {
      if (disposed || settledRef.current) return;
      void apiGet<{ loggedIn: boolean }>(`/api/browser-profiles/${target.id}/login-status`)
        .then((state) => {
          if (!disposed && state.loggedIn) return finalize(target, "logged_in");
          return undefined;
        })
        .catch(() => undefined);
    }, LOGIN_POLL_INTERVAL_MS);

    const timeout = window.setTimeout(() => {
      if (!disposed && !settledRef.current) void finalize(target, "timeout");
    }, LOGIN_TIMEOUT_SECONDS * 1000);

    return () => {
      disposed = true;
      window.clearInterval(tick);
      window.clearInterval(poll);
      window.clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, site]);

  // Safety net: if the parent closes the dialog while a browser session is still running.
  useEffect(() => {
    if (open || !site) return;
    const target = site;
    void stopBrowser(target.id);
  }, [open, site]);

  if (!open) return null;

  if (!site) {
    return (
      <Dialog
        open
        onClose={dismiss}
        title={`${t("addAccount")} · ${t("addAccountPickPlatform")}`}
        maxWidth="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-500">{t("addAccountPickPlatformHint")}</p>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("addAccountSearchPlatform")}
              className={`${consoleInputClass} pl-9`}
              autoFocus
            />
          </div>

          {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p> : null}

          <div className="max-h-[380px] overflow-y-auto pr-1">
            {filteredPlatforms.length === 0 ? (
              <p className="py-10 text-center text-sm text-zinc-400">{t("addAccountNoPlatformMatch")}</p>
            ) : (
              <div className="grid grid-cols-4 gap-1 sm:grid-cols-5">
                {filteredPlatforms.map((platform) => {
                  const meta = platformMeta[platform];
                  const busy = launching === platform;
                  return (
                    <button
                      key={platform}
                      type="button"
                      disabled={Boolean(launching)}
                      onClick={() => void handlePick(platform)}
                      className="flex flex-col items-center gap-2 rounded-2xl border border-transparent px-1 py-3 text-center transition hover:border-sky-200 hover:bg-sky-50/70 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span
                        className={`grid size-11 place-items-center rounded-2xl text-sm font-bold text-white shadow-sm ${meta.colorClass}`}
                      >
                        {busy ? <Loader2 className="size-4 animate-spin" /> : meta.glyph}
                      </span>
                      <span className="w-full truncate text-xs font-medium text-zinc-600">{platform}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={() => void finalize(site, "cancelled")}
      title={t("addAccountLoginTitle", { platform: site.platform })}
      maxWidth="sm"
    >
      <div className="space-y-5 py-3 text-center">
        <div className="flex justify-center">
          <span className="relative grid size-14 place-items-center">
            <span className="absolute inset-0 rounded-full bg-sky-100/70" />
            <Loader2 className="relative size-6 animate-spin text-sky-600" />
          </span>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-700">{t("addAccountWaiting", { seconds: remaining })}</p>
          <p className="mx-auto max-w-xs text-xs leading-5 text-zinc-400">{t("addAccountBrowserHint")}</p>
        </div>
      </div>

      <div className="mt-2 flex justify-end gap-2 border-t border-zinc-100 pt-4">
        <Button variant="ghost" onClick={() => void finalize(site, "cancelled")} disabled={finishing}>
          {t("dlgCancel")}
        </Button>
        <Button onClick={() => void finalize(site, "logged_in")} loading={finishing}>
          {t("loginDone")}
        </Button>
      </div>
    </Dialog>
  );
}
