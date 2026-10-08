"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Check, ChevronDown } from "lucide-react";
import type { PublishRecord, AccountPlatform, AccountRecord } from "@/lib/types";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { consoleInputClass } from "@/components/ui/console-surface";
import {
  CMS_DAILY_WRITE_QUOTA,
  cmsPlatformOptions,
  isCmsPlatform,
  platformMeta,
} from "@/components/account-platform-meta";

function normalizeSiteUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (!parsed.hostname) return null;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function cmsSiteName(url: string, platform: AccountPlatform, accounts: AccountRecord[]) {
  let host = "";
  try {
    host = new URL(url).host.replace(/^www\./i, "");
  } catch {
    host = "";
  }
  const base = host || platform;
  const taken = new Set(accounts.map((site) => site.name));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

/**
 * "Connect CMS site" dialog: pick a CMS platform, enter the site URL, and create the
 * connected website account. Mirrors the reference console layout (URL / daily-write
 * counters, pairing + quota rules, cancel / connect actions).
 */
export function CmsSiteDialog({
  open,
  accounts,
  onClose,
  onCreated,
}: {
  open: boolean;
  accounts: AccountRecord[];
  onClose: () => void;
  onCreated: (site: AccountRecord) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [platform, setPlatform] = useState<AccountPlatform>(cmsPlatformOptions[0]);
  const [url, setUrl] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const { data: records = [] } = useSWR<PublishRecord[]>(
    open ? "/api/publish-records?limit=200" : null,
    swrFetcher,
  );

  const todayWrites = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const from = start.getTime();
    return records.filter(
      (record) =>
        record.createdAt >= from
        && isCmsPlatform(record.platform)
        && (record.status === "published" || record.status === "drafted"),
    ).length;
  }, [records]);

  useEffect(() => {
    if (!listOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) {
        setListOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [listOpen]);

  function reset() {
    setPlatform(cmsPlatformOptions[0]);
    setUrl("");
    setListOpen(false);
    setError("");
    setSaving(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleConnect() {
    const normalized = normalizeSiteUrl(url);
    if (!normalized) {
      setError(url.trim() ? t("cmsUrlInvalid") : t("cmsUrlRequired"));
      return;
    }

    setError("");
    setSaving(true);
    try {
      const created = await apiPost<AccountRecord>("/api/accounts", {
        name: cmsSiteName(normalized, platform, accounts),
        platform,
        url: normalized,
        status: "active",
      });
      reset();
      onClose();
      await onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog open onClose={handleClose} title={t("cmsConnectTitle")} maxWidth="md">
      <div className="space-y-4">
        <div className="flex items-center justify-end gap-1.5 text-xs text-zinc-400">
          <span>{t("cmsUrlQuota", { count: url.trim() ? 1 : 0 })}</span>
          <span aria-hidden>·</span>
          <span>{t("cmsWriteQuota", { count: Math.min(todayWrites, CMS_DAILY_WRITE_QUOTA) })}</span>
        </div>

        <div className="grid gap-1.5">
          <span className="text-sm font-medium text-zinc-700">{t("cmsPlatformLabel")}</span>
          <div ref={boxRef} className="relative">
            <button
              type="button"
              onClick={() => setListOpen((prev) => !prev)}
              className="flex min-h-10 w-full items-center justify-between rounded-2xl border border-sky-100 bg-white px-3 py-2 text-left text-sm text-zinc-700 outline-none transition focus:border-sky-400 focus:ring-1 focus:ring-sky-400"
            >
              <span className="flex items-center gap-2">
                <span
                  className={`grid size-6 place-items-center rounded-lg text-[10px] font-bold text-white ${platformMeta[platform].colorClass}`}
                >
                  {platformMeta[platform].glyph}
                </span>
                {platform}
              </span>
              <ChevronDown className={`size-4 text-zinc-400 transition ${listOpen ? "rotate-180" : ""}`} />
            </button>

            {listOpen ? (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-2xl border border-sky-100 bg-white py-1 shadow-lg">
                {cmsPlatformOptions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setPlatform(item);
                      setListOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-sky-50 ${
                      item === platform ? "bg-sky-100 font-medium text-sky-700" : "text-zinc-700"
                    }`}
                  >
                    <span
                      className={`grid size-6 place-items-center rounded-lg text-[10px] font-bold text-white ${platformMeta[item].colorClass}`}
                    >
                      {platformMeta[item].glyph}
                    </span>
                    {item}
                    {item === platform ? <Check className="ml-auto size-4" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-zinc-700">{t("cmsSiteUrlLabel")}</span>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleConnect();
              }
            }}
            placeholder={t("cmsSiteUrlPlaceholder")}
            className={consoleInputClass}
          />
        </label>

        <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
          <p className="text-sm font-semibold text-zinc-800">{t("cmsPairingTitle")}</p>
          <p className="mt-2 text-xs leading-5 text-zinc-500">{t("cmsPairingBody")}</p>
        </div>

        {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p> : null}

        <div className="flex justify-end gap-2 border-t border-zinc-100 pt-3">
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            {t("dlgCancel")}
          </Button>
          <Button onClick={() => void handleConnect()} loading={saving}>
            {t("cmsConnectButton")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

