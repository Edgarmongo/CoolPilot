"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Layers, PenSquare, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsoleCard } from "@/components/ui/console-surface";
import { apiGet } from "@/lib/api-client";
import {
  aiWritingStepIds,
  aiWritingStepLabelKeys,
  defaultAiWritingConfig,
  type AiWritingConfig,
  type AiWritingStepId,
} from "@/lib/ai-writing";
import { useI18n } from "@/lib/i18n";
import { readTopicWritingTarget, topicMaterialText } from "@/lib/topics";
import type { TopicRecord } from "@/lib/types";
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
  const searchParams = useSearchParams();
  const topicTarget = readTopicWritingTarget(searchParams);
  const [stepIndex, setStepIndex] = useState(0);
  const [config, setConfig] = useState<AiWritingConfig>(defaultAiWritingConfig);
  const [topics, setTopics] = useState<HotTopicItem[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [topicId, setTopicId] = useState("");
  const [topicTitle, setTopicTitle] = useState("");
  const [topicNotice, setTopicNotice] = useState("");
  /** The topic id already carried into the form, so a re-render never overwrites what the user typed. */
  const seededTopic = useRef("");

  /**
   * "Write about it" from the topic list (P2-01-04): the topic arrives as an id, is read once, and
   * becomes the wizard's own free-text material, which is exactly what the user then sees and can edit.
   * A topic that is gone says so instead of silently producing an empty wizard.
   */
  useEffect(() => {
    if (!topicTarget || seededTopic.current === topicTarget) return;
    let cancelled = false;
    void (async () => {
      try {
        const topic = await apiGet<TopicRecord>(`/api/topics/${encodeURIComponent(topicTarget)}`);
        if (cancelled) return;
        seededTopic.current = topicTarget;
        setTopicId(topic.id);
        setTopicTitle(topic.title);
        setFreeText(topicMaterialText(topic));
        setConfig((previous) => ({ ...previous, materialSource: "free" }));
      } catch {
        if (cancelled) return;
        seededTopic.current = topicTarget;
        setTopicNotice(t("tpWritingMissing"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [topicTarget, t]);

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

        {topicTitle || topicNotice ? (
          <p className={cn("mt-3 text-xs", topicTitle ? "text-violet-600" : "text-amber-600")}>
            {topicTitle ? t("tpFromTopic", { title: topicTitle }) : topicNotice}
          </p>
        ) : null}
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
            topicId={topicId}
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
