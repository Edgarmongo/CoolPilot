import { redirect } from "next/navigation";
import SettingsPageClient from "@/components/settings/settings-page-client";
import BrandPromptSettingsClient from "@/components/settings/brand-prompt-settings-client";
import BackupSettingsClient from "@/components/settings/backup-settings-client";
import { localizedPath, type Locale } from "@/lib/i18n-config";

const settingsTabs = ["runtime", "permissions", "language", "brand", "prompt", "backup"] as const;
type SettingsTab = (typeof settingsTabs)[number];

function isSettingsTab(value: string): value is SettingsTab {
  return settingsTabs.includes(value as SettingsTab);
}

export default async function SettingsTabPage({
  params,
}: {
  params: Promise<{ locale: Locale; tab: string }>;
}) {
  const { locale, tab } = await params;

  if (tab === "ai" || tab === "providers") {
    redirect(localizedPath(locale, "/settings"));
  }

  if (!isSettingsTab(tab)) {
    redirect(localizedPath(locale, "/settings"));
  }

  if (tab === "brand" || tab === "prompt") {
    return <BrandPromptSettingsClient tab={tab} />;
  }

  if (tab === "backup") {
    return <BackupSettingsClient />;
  }

  return <SettingsPageClient initialTab={tab} />;
}
