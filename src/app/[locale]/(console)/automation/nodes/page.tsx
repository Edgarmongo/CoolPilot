"use client";

import { Globe2, Monitor, Server } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ConsoleCard } from "@/components/ui/console-surface";
import type { TranslationKey } from "@/lib/locale-resources";

const executionModes: Array<{
  id: string;
  icon: typeof Globe2;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  available: boolean;
}> = [
  { id: "web", icon: Globe2, titleKey: "executorWeb", descKey: "executorWebDesc", available: true },
  { id: "desktop", icon: Monitor, titleKey: "executorDesktop", descKey: "executorDesktopDesc", available: false },
  { id: "edge", icon: Server, titleKey: "executorEdge", descKey: "executorEdgeDesc", available: false },
];

export default function CloudNodesPage() {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500">{t("dataCenterSubtitle")}</p>
      <div className="grid gap-4 md:grid-cols-3">
        {executionModes.map((mode) => {
          const Icon = mode.icon;
          return (
            <ConsoleCard key={mode.id}>
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="font-semibold text-zinc-900">{t(mode.titleKey)}</h3>
              </div>
              <p className="mt-3 text-sm text-zinc-600">{t(mode.descKey)}</p>
              <div className="mt-4">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${mode.available ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
                  {mode.available ? t("executorAvailable") : t("executorUnavailable")}
                </span>
              </div>
            </ConsoleCard>
          );
        })}
      </div>
    </div>
  );
}
