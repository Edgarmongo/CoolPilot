"use client";

import type { ReactNode } from "react";
import { Construction } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import { ConsoleCard } from "@/components/ui/console-surface";

export function ModulePlaceholder({
  icon,
  titleKey,
}: {
  icon?: ReactNode;
  titleKey: TranslationKey;
}) {
  const { t } = useI18n();
  return (
    <ConsoleCard className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <span className="grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_16px_32px_-16px_rgba(37,99,235,0.6)]">
        {icon ?? <Construction className="size-7" />}
      </span>
      <h2 className="mt-6 text-2xl font-semibold text-zinc-950">{t(titleKey)}</h2>
      <p className="mt-2 max-w-md text-sm text-zinc-500">{t("placeholderDescription")}</p>
      <span className="mt-6 inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-4 py-1.5 text-xs font-medium text-sky-700">
        <Construction className="size-4" />
        {t("placeholderComingSoon")}
      </span>
    </ConsoleCard>
  );
}
