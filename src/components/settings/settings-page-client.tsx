"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { ShieldCheck } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useI18n, type Locale } from "@/lib/i18n";
import { ApiClientError, apiPost, swrFetcher } from "@/lib/api-client";
import { localeLabel, locales, localizedPath, stripLocale } from "@/lib/i18n-config";
import { Button } from "@/components/ui/button";
import { ConsoleNotice } from "@/components/ui/console-surface";
import { SegmentedControl, SelectField } from "@/components/ui/form-controls";
import type { AgentPermissionMode, LocalAgentSettings } from "@/lib/types";
import ModelConfigPanel from "@/components/system/model-config-panel";
import { SettingsTabs, settingsTabs, type SettingsTab } from "./settings-tabs";
type SettingsResponse = LocalAgentSettings & {
  geminiKey: string;
  groqKey: string;
  openAIKey: string;
  openRouterKey: string;
  openAIImageKey: string;
  geminiImageKey: string;
};

type SettingsPageClientProps = {
  initialTab?: SettingsTab;
};

export function isSettingsTab(value: string | undefined): value is SettingsTab {
  return settingsTabs.includes(value as SettingsTab);
}

export default function SettingsPageClient({ initialTab = "runtime" }: SettingsPageClientProps) {
  const { t, locale } = useI18n();
  const pathname = usePathname() || "/settings";
  const router = useRouter();
  const activeTab = initialTab;
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState<"success" | "error">("success");
  const [form, setForm] = useState<SettingsResponse | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: initialData, mutate: reloadSettings } = useSWR<SettingsResponse>(
    "/api/settings/ai",
    swrFetcher,
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    if (initialData) {
      window.queueMicrotask(() => setForm(initialData));
    }
  }, [initialData]);

  function showNotice(msg: string, type: "success" | "error" = "success") {
    setNotice(msg);
    setNoticeType(type);
  }

  function errorNotice(error: unknown) {
    if (error instanceof ApiClientError && error.code) {
      const key = `error_${error.code}` as Parameters<typeof t>[0];
      return t(key);
    }
    return error instanceof Error ? error.message : t("unknownError");
  }

  function updatePermission(key: keyof LocalAgentSettings["agentPermissions"], value: AgentPermissionMode) {
    setForm((current) => current ? {
      ...current,
      agentPermissions: { ...current.agentPermissions, [key]: value },
    } : current);
  }

  async function handleSaveSettings() {
    if (!form) return;
    setSaving(true);
    try {
      await apiPost("/api/settings/ai", form);
      showNotice(t("settingsSaved"));
      await reloadSettings();
    } catch (err) {
      showNotice(errorNotice(err), "error");
    } finally {
      setSaving(false);
    }
  }

  const permissionRows: Array<{ key: keyof LocalAgentSettings["agentPermissions"]; label: string }> = [
    { key: "browserStep", label: t("permissionBrowserStep") },
    { key: "browserPostContent", label: t("permissionBrowserPostContent") },
    { key: "generateImage", label: t("permissionGenerateImage") },
    { key: "generatePostContent", label: t("permissionGeneratePostContent") },
    { key: "schedulePost", label: t("permissionSchedulePost") },
  ];

  return (
    <div className="space-y-6">
      {notice ? <ConsoleNotice message={notice} tone={noticeType} onDismiss={() => setNotice("")} /> : null}

      <SettingsTabs activeTab={activeTab} />

      {activeTab === "runtime" ? <ModelConfigPanel showCatalogLink /> : null}
      {activeTab !== "runtime" && form ? (
        <>
          {activeTab === "permissions" ? (
            <section className="w-full space-y-5">
              <p className="text-sm leading-6 text-zinc-500">{t("permissionHint")}</p>
              <div className="grid gap-3">
                {permissionRows.map((row) => (
                  <div key={row.key} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3">
                    <span className="text-sm font-semibold text-zinc-700">{row.label}</span>
                    <SegmentedControl<AgentPermissionMode>
                      value={form.agentPermissions[row.key]}
                      options={[
                        { value: "confirm", label: t("permissionConfirm") },
                        { value: "auto", label: t("permissionAuto") },
                      ]}
                      onChange={(value) => updatePermission(row.key, value)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {activeTab === "language" ? (
            <section className="w-full space-y-5">
              <SelectField<Locale>
                label={t("langSelect")}
                value={locale}
                options={locales.map((loc) => ({ value: loc, label: localeLabel(loc) }))}
                onChange={(nextLocale) => router.push(localizedPath(nextLocale, stripLocale(pathname)))}
              />
            </section>
          ) : null}

          <div className="flex w-full flex-wrap gap-2">
            <Button onClick={handleSaveSettings} loading={saving}>
              <ShieldCheck size={16} />
              {t("btnSaveSettings")}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
