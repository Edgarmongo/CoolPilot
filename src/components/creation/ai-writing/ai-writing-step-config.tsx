"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Info, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/form-controls";
import { consoleInputClass } from "@/components/ui/console-surface";
import { swrFetcher } from "@/lib/api-client";
import {
  aiWritingKeywordsMaxLength,
  aiWritingWordCountMax,
  aiWritingWordCountMin,
  aiWritingWordCountStep,
  articleStyleHelperKeys,
  articleStyleLabelKeys,
  articleStylePrompt,
  articleStyleTemplateKeys,
  articleStyles,
  audienceLabelKeys,
  audiences,
  imageCountLabelKeys,
  imageCounts,
  imageStrategies,
  imageStrategyLabelKeys,
  industryDomainLabelKeys,
  industryDomains,
  knowledgeModeLabelKeys,
  knowledgeModes,
  outputLanguageLabelKeys,
  outputLanguages,
  targetPlatformOptions,
  type AiWritingConfig,
} from "@/lib/ai-writing";
import { brandContextSummary } from "@/lib/brands";
import { useI18n } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n-config";
import type { BrandRecord, PositionRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NoticeBanner } from "../../smart-config/positioning-fields";

const PRESET_STORAGE_KEY = "ai-writing-presets";

type Preset = { name: string; config: AiWritingConfig };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
      <span className="flex items-center gap-1">
        {label}
        {hint ? <Info className="size-3.5 text-zinc-300" /> : null}
      </span>
      {children}
    </label>
  );
}

export function AiWritingStepConfig({
  config,
  onChange,
}: {
  config: AiWritingConfig;
  onChange: (patch: Partial<AiWritingConfig>) => void;
}) {
  const { t, locale } = useI18n();
  const { data: positions = [] } = useSWR<PositionRecord[]>("/api/positions", swrFetcher);
  const defaultPosition = positions.find((position) => position.isDefault) ?? positions[0] ?? null;
  /**
   * The brand library (CI-P2-02). Selecting one is the whole of 选择: the id travels in the config and
   * `generateArticle` reads that one record to build the prompt, so what the hint below shows is what
   * the model will be told.
   */
  const { data: brands = [] } = useSWR<BrandRecord[]>("/api/brands", swrFetcher);
  const selectedBrand = brands.find((brand) => brand.id === config.brandId) ?? null;

  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [isNaming, setIsNaming] = useState(false);
  const [presetName, setPresetName] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Preset[]) : [];
      if (Array.isArray(parsed)) window.queueMicrotask(() => setPresets(parsed));
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  function persistPresets(next: Preset[]) {
    setPresets(next);
    try {
      window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  }

  function loadPreset(name: string) {
    setSelectedPreset(name);
    const preset = presets.find((entry) => entry.name === name);
    if (preset) onChange(preset.config);
  }

  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    persistPresets([...presets.filter((entry) => entry.name !== name), { name, config }]);
    setSelectedPreset(name);
    setIsNaming(false);
    setPresetName("");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 border-b border-sky-100 pb-4">
        <select
          value={selectedPreset}
          onChange={(event) => loadPreset(event.target.value)}
          className={`${consoleInputClass} w-56`}
        >
          <option value="">{t("awPresetLoad")}</option>
          {presets.map((preset) => (
            <option key={preset.name} value={preset.name}>
              {preset.name}
            </option>
          ))}
        </select>
        {isNaming ? (
          <div className="flex items-center gap-2">
            <input
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder={t("awPresetNamePlaceholder")}
              className={`${consoleInputClass} w-44`}
            />
            <Button size="sm" onClick={savePreset} disabled={!presetName.trim()}>
              {t("btnSave")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIsNaming(false)}>
              {t("btnCancel")}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setIsNaming(true)}>
            <Save size={14} />
            {t("awPresetSave")}
          </Button>
        )}
        <span className="ml-auto text-xs text-zinc-400">{t("awPresetHint")}</span>
      </div>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-900">{t("awAgentSection")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("awKnowledgeMode")} hint={t("awKnowledgeInfo")}>
            <select
              value={config.knowledgeMode}
              onChange={(event) => onChange({ knowledgeMode: event.target.value as AiWritingConfig["knowledgeMode"] })}
              className={consoleInputClass}
            >
              {knowledgeModes.map((mode) => (
                <option key={mode} value={mode}>
                  {t(knowledgeModeLabelKeys[mode])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("awPosition")}>
            <select
              value={config.positioningId}
              onChange={(event) => onChange({ positioningId: event.target.value })}
              className={consoleInputClass}
            >
              <option value="">
                {defaultPosition ? `${defaultPosition.name}（${t("awPositionDefault")}）` : t("awPositionDefault")}
              </option>
              {positions
                .filter((position) => !position.isDefault)
                .map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={t("awBrand")} hint={t("awBrandHint")}>
            <select
              value={config.brandId}
              onChange={(event) => onChange({ brandId: event.target.value })}
              className={consoleInputClass}
            >
              <option value="">{t("awBrandNone")}</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {selectedBrand ? (
          <p className="text-xs text-zinc-400">
            {brandContextSummary(selectedBrand, {
              audience: t("awAudience"),
              tone: t("posPlatformTone"),
              keywords: t("pdFieldKeywords"),
              banned: t("posFieldBannedWords"),
            })}
          </p>
        ) : (
          <p className="text-xs text-zinc-400">
            {brands.length ? "" : `${t("awBrandEmpty")} `}
            <Link href={localizedPath(locale, "/creation/brands")} className="text-sky-600 hover:underline">
              {t("awBrandManage")}
            </Link>
          </p>
        )}
        <NoticeBanner title={t("awAgentBanner")} />
      </section>

      <section className="space-y-4 border-t border-sky-100 pt-4">
        <h3 className="text-sm font-semibold text-zinc-900">{t("awConfigSection")}</h3>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-4">
            <Field label={t("awArticleStyle")}>
              <select
                value={config.articleStyle}
                onChange={(event) => onChange({ articleStyle: event.target.value as AiWritingConfig["articleStyle"] })}
                className={consoleInputClass}
              >
                {articleStyles.map((style) => (
                  <option key={style} value={style}>
                    {t(articleStyleLabelKeys[style])}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal text-zinc-400">
                {t(articleStyleHelperKeys[config.articleStyle])}
              </span>
            </Field>
            <NoticeBanner title={articleStylePrompt[config.articleStyle].split("：")[0]}>
              {t(articleStyleTemplateKeys[config.articleStyle])}
            </NoticeBanner>
            <Field label={t("awIndustry")}>
              <select
                value={config.industry}
                onChange={(event) => onChange({ industry: event.target.value as AiWritingConfig["industry"] })}
                className={consoleInputClass}
              >
                {industryDomains.map((domain) => (
                  <option key={domain} value={domain}>
                    {t(industryDomainLabelKeys[domain])}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-2">
              <span className="text-sm font-medium text-zinc-700">
                {t("awWordCount")}：{config.wordCount} {t("awWordUnit")}
              </span>
              <input
                type="range"
                min={aiWritingWordCountMin}
                max={aiWritingWordCountMax}
                step={aiWritingWordCountStep}
                value={config.wordCount}
                onChange={(event) => onChange({ wordCount: Number(event.target.value) })}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-sky-200 to-sky-500 accent-sky-600"
              />
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>{aiWritingWordCountMin}</span>
                <span>{aiWritingWordCountMax}</span>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <Field label={t("awAudience")}>
              <select
                value={config.audience}
                onChange={(event) => onChange({ audience: event.target.value as AiWritingConfig["audience"] })}
                className={consoleInputClass}
              >
                {audiences.map((audience) => (
                  <option key={audience} value={audience}>
                    {t(audienceLabelKeys[audience])}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("awPlatform")}>
              <select
                value={config.targetPlatform}
                onChange={(event) => onChange({ targetPlatform: event.target.value })}
                className={consoleInputClass}
              >
                <option value="">{t("awPlatformGeneral")}</option>
                {targetPlatformOptions
                  .filter((option) => option.value)
                  .map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.value}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t("awCoreKeywords")}>
              <input
                value={config.coreKeywords}
                maxLength={aiWritingKeywordsMaxLength}
                onChange={(event) => onChange({ coreKeywords: event.target.value })}
                placeholder={t("awCoreKeywordsPlaceholder")}
                className={consoleInputClass}
              />
              <span className="ml-auto text-xs font-normal tabular-nums text-zinc-400">
                {config.coreKeywords.length}/{aiWritingKeywordsMaxLength}
              </span>
            </Field>
          </div>
        </div>
        <div className="grid gap-5 border-t border-sky-100 pt-4 md:grid-cols-3">
          <div className="grid gap-2">
            <span className="text-sm font-medium text-zinc-700">{t("awLanguage")}</span>
            <SegmentedControl
              value={config.language}
              options={outputLanguages.map((value) => ({ value, label: t(outputLanguageLabelKeys[value]) }))}
              onChange={(value) => onChange({ language: value })}
            />
            <span className="text-xs text-zinc-400">{t("awLanguageHint")}</span>
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium text-zinc-700">{t("awImageStrategy")}</span>
            <SegmentedControl
              value={config.imageStrategy}
              options={imageStrategies.map((value) => ({ value, label: t(imageStrategyLabelKeys[value]) }))}
              onChange={(value) => onChange({ imageStrategy: value })}
            />
            <span className="text-xs text-zinc-400">{t("awImageStrategyHint")}</span>
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium text-zinc-700">{t("awImageCount")}</span>
            <SegmentedControl
              value={config.imageCount}
              options={imageCounts.map((value) => ({ value, label: t(imageCountLabelKeys[value]) }))}
              onChange={(value) => onChange({ imageCount: value })}
            />
            <span className="text-xs text-zinc-400">{t("awImageCountHint")}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-white px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-700">{t("awDeAi")}</p>
            <p className="text-xs text-zinc-400">{t("awDeAiHint")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.deAi}
            onClick={() => onChange({ deAi: !config.deAi })}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition",
              config.deAi ? "bg-sky-500" : "bg-zinc-300",
            )}
          >
            <span
              className={cn(
                "absolute size-4 rounded-full bg-white transition-all",
                config.deAi ? "left-4" : "left-0.5",
              )}
            />
          </button>
        </div>
      </section>
    </div>
  );
}
