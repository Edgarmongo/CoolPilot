"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Trash2 } from "lucide-react";
import type { AccountRecord } from "@/lib/types";
import { apiPatch } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { consoleInputClass } from "@/components/ui/console-surface";

export function accountGroupOf(site: AccountRecord) {
  return String((site.preset ?? {}).group ?? "").trim();
}

/**
 * Lightweight group manager: rename or delete the account groups that are derived from
 * each account's `preset.group` value.
 */
export function AccountGroupManager({
  open,
  accounts,
  onClose,
  onChanged,
  onNotice,
}: {
  open: boolean;
  accounts: AccountRecord[];
  onClose: () => void;
  onChanged: () => void | Promise<unknown>;
  onNotice: (message: string) => void;
}) {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const site of accounts) {
      const group = accountGroupOf(site);
      if (group) counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts]);

  async function applyGroup(from: string, to: string, message: string) {
    setBusy(from);
    try {
      const members = accounts.filter((site) => accountGroupOf(site) === from);
      await Promise.all(
        members.map((site) =>
          apiPatch(`/api/accounts/${site.id}`, { preset: { ...site.preset, group: to } }).catch(() => undefined),
        ),
      );
      onNotice(message);
      await onChanged();
    } finally {
      setBusy("");
    }
  }

  function handleRename(from: string) {
    const next = (drafts[from] ?? from).trim();
    if (!next || next === from) return;
    void applyGroup(from, next, `${t("accountGroupUpdated")} · ${next}`);
  }

  function handleDelete(from: string) {
    void applyGroup(from, "", `${t("accountGroupRemoved")} · ${from}`);
  }

  if (!open) return null;

  return (
    <Dialog open onClose={onClose} title={t("accountGroupManageTitle")} maxWidth="md">
      <div className="space-y-4">
        <p className="text-sm text-zinc-500">{t("accountGroupManageHint")}</p>

        {groups.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-10 text-center text-sm text-zinc-400">
            {t("accountGroupEmpty")}
          </p>
        ) : (
          <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
            {groups.map((group) => {
              const working = busy === group.name;
              return (
                <div key={group.name} className="flex items-center gap-2 rounded-2xl border border-sky-100 p-2">
                  <input
                    value={drafts[group.name] ?? group.name}
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [group.name]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleRename(group.name);
                      }
                    }}
                    placeholder={t("accountGroupDraftPlaceholder")}
                    className={`${consoleInputClass} min-h-9 flex-1`}
                  />
                  <span className="shrink-0 whitespace-nowrap text-xs text-zinc-400">
                    {t("accountGroupMemberCount", { count: group.count })}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRename(group.name)}
                    disabled={working}
                    title={t("btnSave")}
                    aria-label={t("btnSave")}
                    className="rounded-lg p-1.5 text-sky-600 transition hover:bg-sky-50 disabled:opacity-50"
                  >
                    {working ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(group.name)}
                    disabled={working}
                    title={t("accountGroupDelete")}
                    aria-label={t("accountGroupDelete")}
                    className="rounded-lg p-1.5 text-rose-500 transition hover:bg-rose-50 disabled:opacity-50"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end border-t border-zinc-100 pt-3">
          <Button variant="ghost" onClick={onClose}>
            {t("closeNotice")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
