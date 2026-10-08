"use client";

import { useState } from "react";
import { Layers, PenSquare, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsoleCard } from "@/components/ui/console-surface";
import {
  aiWritingStepIds,
  aiWritingStepLabelKeys,
  defaultAiWritingConfig,
  type AiWritingConfig,
  type AiWritingStepId,
} from "@/lib/ai-writing";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AiWritingStepConfig } from "./ai-writing-step-config";
import { AiWritingStepMaterial, type HotTopicItem } from "./ai-writing-step-material";
import { AiWritingStepOutput } from "./ai-writing-step-output";

const stepIcons: Record<AiWritingStepId, React.ReactNode> = {
  material: <Layers className="size-5" />,
  config: <PenSquare className="size-5" />,
  output: <Sparkles className="size-5" />,
};

export function AiWritingWorkspace() {
  const { t, locale } = useI18n();
  const [stepIndex, setStepIndex] = useState(0);
  const [config, setConfig] = useState<AiWritingConfig>(defaultAiWritingConfig);
  const [topics, setTopics] = useState<HotTopicItem[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");

  const materialCount = topics.length + productIds.length + (freeText.trim() ? 1 : 0);
  const step = aiWritingStepIds[stepIndex];
  const canAdvance = stepIndex !== 0 || materialCount > 0;

  function patchConfig(patch: Partial<AiWritingConfig>) {
    setConfig((prev) => ({ ...prev, ...patch }));
  }

  return (
    <div className="space-y-4">
      <ConsoleCard className="relative">
        {materialCount > 0 ? (
          <span className="absolute right-6 top-6 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
            {t("awMaterialBadge", { count: materialCount })}
          </span>
        ) : null}

        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-[0_10px_24px_-12px_rgba(79,70,229,0.6)]">
              <Sparkles className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-zinc-950">{t("awTitle")}</h2>
              <p className="text-xs text-zinc-400">{t("awSubtitle")}</p>
            </div>
          </div>

          <ol className="ml-auto flex flex-wrap items-center gap-4 sm:gap-8">
            {aiWritingStepIds.map((id, index) => (
              <li key={id} className="flex items-center gap-4 sm:gap-8">
                <div
                  className={cn(
                    "flex items-center gap-2",
                    index === stepIndex ? "text-sky-700" : index < stepIndex ? "text-zinc-500" : "text-zinc-300",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-9 place-items-center rounded-xl border transition",
                      index === stepIndex
                        ? "border-sky-200 bg-sky-50"
                        : "border-transparent bg-zinc-50",
                    )}
                  >
                    {stepIcons[id]}
                  </span>
                  <span className="text-sm font-medium">{t(aiWritingStepLabelKeys[id])}</span>
                </div>
                {index < aiWritingStepIds.length - 1 ? (
                  <span className={cn("hidden h-px w-10 sm:block", index < stepIndex ? "bg-sky-300" : "bg-zinc-200")} />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </ConsoleCard>

      <ConsoleCard>
        {step === "material" ? (
          <AiWritingStepMaterial
            source={config.materialSource}
            onSourceChange={(materialSource) => patchConfig({ materialSource })}
            topics={topics}
            onTopicsChange={setTopics}
            productIds={productIds}
            onProductIdsChange={setProductIds}
            freeText={freeText}
            onFreeTextChange={setFreeText}
          />
        ) : null}
        {step === "config" ? <AiWritingStepConfig config={config} onChange={patchConfig} /> : null}
        {step === "output" ? (
          <AiWritingStepOutput
            config={config}
            topics={topics}
            productIds={productIds}
            freeText={freeText}
            locale={locale}
          />
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-sky-100 pt-4">
          <Button
            variant="outline"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
          >
            {t("awPrev")}
          </Button>
          <span className="text-xs text-zinc-400">
            {t("awStepProgress", { current: stepIndex + 1, total: aiWritingStepIds.length })}
          </span>
          {stepIndex < aiWritingStepIds.length - 1 ? (
            <Button disabled={!canAdvance} onClick={() => setStepIndex((index) => Math.min(aiWritingStepIds.length - 1, index + 1))}>
              {t("awNext")}
            </Button>
          ) : (
            <span className="w-[76px]" aria-hidden />
          )}
        </div>
      </ConsoleCard>
    </div>
  );
}
