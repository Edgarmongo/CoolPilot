"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  ExternalLink,
  Globe2,
  Layers,
  LogIn,
  MonitorSmartphone,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
} from "lucide-react";
import { accountPlatforms, type AccountPlatform, type AccountRecord, type AccountStatus } from "@/lib/types";
import { apiDelete, apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n-config";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConsoleNotice, consoleInputClass } from "@/components/ui/console-surface";
import { LoginBrowserDialog } from "@/components/login-browser-dialog";
import { AddAccountDialog, type AddAccountResult } from "@/components/add-account-dialog";
import { AccountGroupManager } from "@/components/account-group-manager";
import { AccountRiskBanner, AccountRiskChip, useAccountHealth } from "@/components/account-risk-panel";
import { platformMeta } from "@/components/account-platform-meta";
import { CmsSiteDialog } from "@/components/cms-site-dialog";

const platformOptions: AccountPlatform[] = [...accountPlatforms];

// Soft display cap mirroring the reference console's account quota indicator (e.g. 5 / 50).
const ACCOUNT_LIMIT = 50;

const filterSelectClass =
  "min-h-9 rounded-xl border border-sky-100 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-sky-400 focus:ring-1 focus:ring-sky-400";

const statToneClass = {
  sky: "bg-sky-50 text-sky-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  violet: "bg-violet-50 text-violet-600",
} as const;

type PresetState = {
  tags: string;
  visibility: string;
  audience: string;
  category: string;
  description: string;
  group: string;
};

type FormState = {
  name: string;
  platform: AccountPlatform;
  url: string;
  account: string;
  memo: string;
  preset: PresetState;
};

const emptyPreset: PresetState = { tags: "", visibility: "", audience: "", category: "", description: "", group: "" };
const emptyForm: FormState = { name: "", platform: "小红书", url: "", account: "", memo: "", preset: emptyPreset };

function presetFromSite(site: AccountRecord): PresetState {
  const preset = site.preset ?? {};
  return {
    tags: String(preset.tags ?? ""),
    visibility: String(preset.visibility ?? ""),
    audience: String(preset.audience ?? ""),
    category: String(preset.category ?? ""),
    description: String(preset.description ?? ""),
    group: String(preset.group ?? ""),
  };
}

function accountGroup(site: AccountRecord) {
  return String((site.preset ?? {}).group ?? "").trim();
}

function accountHealth(site: AccountRecord) {
  let score = 0;
  if (site.status === "active") score += 45;
  else if (site.status === "paused") score += 20;
  if (site.account.trim()) score += 15;
  if (site.url.trim()) score += 15;
  if (site.profilePath.trim()) score += 10;
  if (site.memo.trim()) score += 5;
  if (accountGroup(site)) score += 5;
  if (Object.values(site.preset ?? {}).some((value) => String(value ?? "").trim())) score += 5;
  return Math.min(100, score);
}

function healthLabelKey(score: number): "accountHealthGood" | "accountHealthFair" | "accountHealthLow" {
  if (score >= 80) return "accountHealthGood";
  if (score >= 50) return "accountHealthFair";
  return "accountHealthLow";
}

function healthBarClass(score: number) {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-rose-500";
}

function statusChipClass(status: AccountStatus) {
  if (status === "active") return "bg-emerald-100 text-emerald-700";
  if (status === "paused") return "bg-amber-100 text-amber-700";
  return "bg-zinc-100 text-zinc-600";
}

function StatCard({
  icon,
  tone,
  value,
  label,
}: {
  icon: React.ReactNode;
  tone: keyof typeof statToneClass;
  value: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-4">
      <span className={`grid size-10 shrink-0 place-items-center rounded-2xl ${statToneClass[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xl font-semibold leading-tight text-zinc-900">{value}</p>
        <p className="truncate text-xs text-zinc-500">{label}</p>
      </div>
    </div>
  );
}

export default function AccountsPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { data: accounts = [], mutate } = useSWR<AccountRecord[]>("/api/accounts", swrFetcher);

  const [platformFilter, setPlatformFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [query, setQuery] = useState("");

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [busyAction, setBusyAction] = useState<"" | "sync" | "open">("");
  const [loginTarget, setLoginTarget] = useState<AccountRecord | null>(null);
  const [notice, setNotice] = useState("");
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const [batchSyncing, setBatchSyncing] = useState(false);
  const [cmsDialogOpen, setCmsDialogOpen] = useState(false);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const site of accounts) {
      const group = accountGroup(site);
      if (group) set.add(group);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [accounts]);

  const stats = useMemo(
    () => ({
      total: accounts.length,
      loggedIn: accounts.filter((site) => site.status === "active").length,
      pending: accounts.filter((site) => site.status === "needs_login").length,
      platforms: new Set(accounts.map((site) => site.platform)).size,
    }),
    [accounts],
  );

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return accounts.filter((site) => {
      if (platformFilter && site.platform !== platformFilter) return false;
      if (statusFilter && site.status !== statusFilter) return false;
      if (groupFilter && accountGroup(site) !== groupFilter) return false;
      if (keyword) {
        const haystack = `${site.name} ${site.account} ${site.platform} ${accountGroup(site)}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
  }, [accounts, platformFilter, statusFilter, groupFilter, query]);

  const risk = useAccountHealth();
  const riskById = useMemo(
    () => new Map((risk.report?.accounts ?? []).map((entry) => [entry.accountId, entry])),
    [risk.report],
  );

  function openEdit(site: AccountRecord) {
    setEditingId(site.id);
    setForm({
      name: site.name,
      platform: site.platform,
      url: site.url,
      account: site.account,
      memo: site.memo,
      preset: presetFromSite(site),
    });
    setIsOpen(true);
  }

  function statusLabel(status: AccountStatus) {
    if (status === "active") return t("siteStatusActive");
    if (status === "paused") return t("accountStatusPaused");
    return t("accountStatusNeedsLogin");
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingId) await apiPatch(`/api/accounts/${editingId}`, form);
      else await apiPost("/api/accounts", form);
      setIsOpen(false);
      await mutate();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await apiDelete(`/api/accounts/${id}`);
    await mutate();
  }

  async function handleSync(site: AccountRecord) {
    setBusyId(site.id);
    setBusyAction("sync");
    try {
      await apiPatch(`/api/accounts/${site.id}`, {
        name: site.name,
        platform: site.platform,
        url: site.url,
        account: site.account,
        memo: site.memo,
        status: site.status,
        preset: site.preset,
      });
      await mutate();
      setNotice(`${t("accountSynced")} · ${site.name}`);
    } finally {
      setBusyId("");
      setBusyAction("");
    }
  }

  async function handleOpenBackstage(site: AccountRecord) {
    setBusyId(site.id);
    setBusyAction("open");
    try {
      await apiPost(`/api/browser-profiles/${site.id}/open`, { headless: false });
      await mutate();
    } finally {
      setBusyId("");
      setBusyAction("");
    }
  }

  async function finishLogin() {
    if (!loginTarget) return;
    await apiPatch(`/api/accounts/${loginTarget.id}`, { status: "active" });
    setLoginTarget(null);
    await mutate();
  }

  async function handleAddAccountDone(result: AddAccountResult) {
    await mutate();
    if (result.status === "logged_in") {
      setNotice(t("addAccountSignedIn", { name: result.site.name }));
    } else if (result.status === "timeout") {
      setNotice(t("addAccountTimeout"));
    }
  }

  async function handleCmsSiteCreated(site: AccountRecord) {
    await mutate();
    setNotice(t("cmsConnected", { name: site.name }));
  }

  async function handleBatchSync() {
    if (accounts.length === 0) return;
    setBatchSyncing(true);
    try {
      await Promise.all(
        accounts.map((site) =>
          apiPatch(`/api/accounts/${site.id}`, {
            name: site.name,
            platform: site.platform,
            url: site.url,
            account: site.account,
            memo: site.memo,
            status: site.status,
            preset: site.preset,
          }).catch(() => undefined),
        ),
      );
      await mutate();
      setNotice(t("accountBatchSynced"));
    } finally {
      setBatchSyncing(false);
    }
  }

  return (
    <div className="space-y-5">
      {notice ? <ConsoleNotice message={notice} onDismiss={() => setNotice("")} /> : null}

      <AccountRiskBanner
        report={risk.report}
        scanning={risk.scanning}
        notice={risk.notice}
        onDismissNotice={risk.dismissNotice}
        onScan={(accountIds) => void risk.scan(accountIds)}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Users className="size-4" />} tone="sky" value={stats.total} label={t("accountStatTotal")} />
        <StatCard
          icon={<ShieldCheck className="size-4" />}
          tone="emerald"
          value={stats.loggedIn}
          label={t("accountStatLoggedIn")}
        />
        <StatCard
          icon={<TriangleAlert className="size-4" />}
          tone="amber"
          value={stats.pending}
          label={t("accountStatPending")}
        />
        <StatCard
          icon={<Globe2 className="size-4" />}
          tone="violet"
          value={stats.platforms}
          label={t("accountStatPlatforms")}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-sky-100 bg-white p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={platformFilter}
            onChange={(event) => setPlatformFilter(event.target.value)}
            className={filterSelectClass}
          >
            <option value="">{t("accountFilterPlatformAll")}</option>
            {platformOptions.map((platform) => (
              <option key={platform} value={platform}>
                {platform}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className={filterSelectClass}
          >
            <option value="">{t("accountFilterStatusAll")}</option>
            <option value="active">{t("siteStatusActive")}</option>
            <option value="paused">{t("accountStatusPaused")}</option>
            <option value="needs_login">{t("accountStatusNeedsLogin")}</option>
          </select>
          <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} className={filterSelectClass}>
            <option value="">{t("accountFilterGroupAll")}</option>
            {groups.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("accountSearchPlaceholder")}
              className={`${consoleInputClass} min-h-9 w-56 pl-9`}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
          <span className="whitespace-nowrap text-xs text-zinc-500">
            {t("accountQuotaLabel")} {stats.total} / {ACCOUNT_LIMIT}
          </span>
          <Button variant="outline" size="sm" onClick={() => setGroupManagerOpen(true)}>
            <Layers size={14} />
            {t("accountToolbarGroupManage")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(localizedPath(locale, "/account/smepost"))}
          >
            <MonitorSmartphone size={14} />
            {t("accountToolbarDesktopAgent")}
          </Button>
          <Button variant="outline" size="sm" loading={batchSyncing} onClick={() => void handleBatchSync()}>
            <RefreshCw size={14} />
            {t("accountToolbarBatchSync")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCmsDialogOpen(true)}>
            <Plus size={14} />
            {t("addSite")}
          </Button>
          <Button size="sm" onClick={() => setAddAccountOpen(true)}>
            <UserPlus size={14} />
            {t("addAccount")}
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">
          {accounts.length === 0 ? t("emptySites") : t("accountEmptyFiltered")}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((site) => {
            const score = accountHealth(site);
            const group = accountGroup(site);
            const syncing = busyId === site.id && busyAction === "sync";
            const opening = busyId === site.id && busyAction === "open";
            return (
              <div
                key={site.id}
                className="flex flex-col gap-3 rounded-2xl border border-sky-100 bg-white p-4 shadow-[0_8px_20px_rgba(37,99,235,0.05)]"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-2xl text-sm font-bold text-white shadow-sm ${
                      platformMeta[site.platform]?.colorClass ?? "bg-sky-500"
                    }`}
                  >
                    {platformMeta[site.platform]?.glyph ?? site.platform.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-zinc-900">{site.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                        {site.platform}
                      </span>
                      {group ? (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                          {group}
                        </span>
                      ) : null}
                      <AccountRiskChip entry={riskById.get(site.id)} />
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusChipClass(site.status)}`}>
                    {statusLabel(site.status)}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-500">{t("accountHealth")}</span>
                    <span className="font-semibold text-zinc-700">
                      {t(healthLabelKey(score))} {score}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div className={`h-full rounded-full ${healthBarClass(score)}`} style={{ width: `${score}%` }} />
                  </div>
                </div>

                <p className="text-xs text-zinc-400">
                  {t("accountRecentSync")} · {new Date(site.updatedAt).toLocaleString()}
                </p>

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
                  <Button variant="outline" size="sm" loading={syncing} onClick={() => void handleSync(site)}>
                    <RefreshCw size={14} />
                    {t("accountSync")}
                  </Button>
                  <Button variant="outline" size="sm" loading={opening} onClick={() => void handleOpenBackstage(site)}>
                    <ExternalLink size={14} />
                    {t("accountOpenBackstage")}
                  </Button>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setLoginTarget(site)}
                      className="rounded-lg p-1.5 text-sky-600 transition hover:bg-sky-50"
                      title={t("loginAccount")}
                    >
                      <LogIn className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(site)}
                      className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100"
                      title={t("btnEdit")}
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(site.id)}
                      className="rounded-lg p-1.5 text-rose-500 transition hover:bg-rose-50"
                      title={t("btnDelete")}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}

      <Dialog open={isOpen} onClose={() => setIsOpen(false)} title={t("btnEdit")}>
        <div className="space-y-4">
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("siteName")}</span>
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className={consoleInputClass}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("sitePlatform")}</span>
            <select
              value={form.platform}
              onChange={(event) => setForm({ ...form, platform: event.target.value as AccountPlatform })}
              className={consoleInputClass}
            >
              {platformOptions.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("siteUrl")}</span>
            <input
              value={form.url}
              onChange={(event) => setForm({ ...form, url: event.target.value })}
              className={consoleInputClass}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("siteAccount")}</span>
            <input
              value={form.account}
              onChange={(event) => setForm({ ...form, account: event.target.value })}
              className={consoleInputClass}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("siteMemo")}</span>
            <input
              value={form.memo}
              onChange={(event) => setForm({ ...form, memo: event.target.value })}
              className={consoleInputClass}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("accountGroup")}</span>
            <input
              value={form.preset.group}
              onChange={(event) => setForm({ ...form, preset: { ...form.preset, group: event.target.value } })}
              placeholder={t("accountGroupPlaceholder")}
              className={consoleInputClass}
            />
          </label>

          <div className="border-t border-zinc-100 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase text-zinc-400">{t("sitePreset")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700 sm:col-span-2">
                <span>{t("presetTags")}</span>
                <input
                  value={form.preset.tags}
                  onChange={(event) => setForm({ ...form, preset: { ...form.preset, tags: event.target.value } })}
                  placeholder={t("presetTagsHint")}
                  className={consoleInputClass}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                <span>{t("presetCategory")}</span>
                <input
                  value={form.preset.category}
                  onChange={(event) => setForm({ ...form, preset: { ...form.preset, category: event.target.value } })}
                  className={consoleInputClass}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                <span>{t("presetVisibility")}</span>
                <select
                  value={form.preset.visibility}
                  onChange={(event) => setForm({ ...form, preset: { ...form.preset, visibility: event.target.value } })}
                  className={consoleInputClass}
                >
                  <option value="">{t("presetVisibilityDefault")}</option>
                  <option value="public">{t("presetVisibilityPublic")}</option>
                  <option value="unlisted">{t("presetVisibilityUnlisted")}</option>
                  <option value="private">{t("presetVisibilityPrivate")}</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                <span>{t("presetAudience")}</span>
                <select
                  value={form.preset.audience}
                  onChange={(event) => setForm({ ...form, preset: { ...form.preset, audience: event.target.value } })}
                  className={consoleInputClass}
                >
                  <option value="">{t("presetAudienceDefault")}</option>
                  <option value="notMadeForKids">{t("presetAudienceGeneral")}</option>
                  <option value="madeForKids">{t("presetAudienceKids")}</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700 sm:col-span-2">
                <span>{t("presetDescription")}</span>
                <textarea
                  value={form.preset.description}
                  onChange={(event) => setForm({ ...form, preset: { ...form.preset, description: event.target.value } })}
                  className={`${consoleInputClass} min-h-16 resize-none`}
                />
              </label>
            </div>
          </div>

          <Button onClick={() => void handleSave()} loading={saving} disabled={!form.name.trim()}>
            {t("btnSave")}
          </Button>

        </div>
      </Dialog>

      {loginTarget ? (
        <LoginBrowserDialog site={loginTarget} onClose={() => setLoginTarget(null)} onDone={() => void finishLogin()} />
      ) : null}

      <AddAccountDialog
        open={addAccountOpen}
        accounts={accounts}
        onClose={() => setAddAccountOpen(false)}
        onDone={handleAddAccountDone}
      />

      <AccountGroupManager
        open={groupManagerOpen}
        accounts={accounts}
        onClose={() => setGroupManagerOpen(false)}
        onChanged={() => mutate()}
        onNotice={setNotice}
      />

      <CmsSiteDialog
        open={cmsDialogOpen}
        accounts={accounts}
        onClose={() => setCmsDialogOpen(false)}
        onCreated={handleCmsSiteCreated}
      />
    </div>
  );
}
