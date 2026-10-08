"use client";

import { useState } from "react";
import useSWR from "swr";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/form-controls";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiPost, swrFetcher } from "@/lib/api-client";
import {
  aiWritingKeywordsMaxLength,
  aiWritingWordCountMax,
  aiWritingWordCountMin,
  aiWritingWordCountStep,
  articleStyleHelperKeys,
  articleStyleLabelKeys,
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
  type ArticleStyle,
  type Audience,
  type ImageCount,
  type ImageStrategy,
  type IndustryDomain,
  type KnowledgeMode,
  type OutputLanguage,
} from "@/lib/ai-writing";
import { useI18n } from "@/lib/i18n";
import type { ContentItem, PositionRecord } from "@/lib/types";

type GenerateResponse = { item: ContentItem; images: string[]; provider?: string; model?: string };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
      <span className="flex items-center gap-1">{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal text-zinc-400">{hint}</span> : null}
    </label>
  );
}

/** AI generation dialog used by the article-creation page. */
export function ArticleAiDialog({
  open,
  onClose,
  onGenerated,
}: {
  open: boolean;
  onClose: () => void;
  onGenerated: (title: string) => void;
}) {
  const { t } = useI18n();
  const { data: positions = [] } = useSWR<PositionRecord[]>("/api/positions", swrFetcher);
  const defaultPosition = positions.find((position) => position.isDefault) ?? positions[0] ?? null;

  const [topic, setTopic] = useState("");
  const [prompt, setPrompt] = useState("");
  const [knowledgeMode, setKnowledgeMode] = useState<KnowledgeMode>("position");
  const [positioningId, setPositioningId] = useState("");
  const [articleStyle, setArticleStyle] = useState<ArticleStyle>("advertorial");
  const [industry, setIndustry] = useState<IndustryDomain>("general");
  const [audience, setAudience] = useState<Audience>("unlimited");
  const [targetPlatform, setTargetPlatform] = useState("");
  const [coreKeywords, setCoreKeywords] = useState("");
  const [wordCount, setWordCount] = useState(800);
  const [languageCode, setLanguageCode] = useState<OutputLanguage>("zh-CN");
  const [imageStrategy, setImageStrategy] = useState<ImageStrategy>("product");
  const [imageCount, setImageCount] = useState<ImageCount>("few");
  const [deAi, setDeAi] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleGenerate() {
    if (!topic.trim()) {
      setError(t("arAiNeedTopic"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await apiPost<GenerateResponse>("/api/content/generate", {
        topic: topic.trim(),
        prompt: prompt.trim(),
        type: "article",
        maxWords: wordCount,
        keywords: coreKeywords,
        languageCode,
        positioningId,
        knowledgeMode,
        articleStyle,
        industry,
        audience,
        targetPlatform,
        imageStrategy,
        imageCount,
        deAi,
      });
      setTopic("");
      setPrompt("");
      onGenerated(result.item.title);
      onClose();
    } catch {
      setError(t("awGenerateFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("arAiTitle")} maxWidth="lg">
      <div className="grid gap-4">
        <Field label={t("arAiTopic")}>
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder={t("arAiTopicPlaceholder")}
            className={consoleInputClass}
          />
        </Field>
        <Field label={t("genPrompt")}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t("arAiPromptPlaceholder")}
            className={`${consoleInputClass} min-h-20 resize-none`}
          />
        </Field>
        <div className="grid gap-4 border-t border-sky-100 pt-4">
          <h3 className="text-sm font-semibold text-zinc-900">{t("awAgentSection")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("awKnowledgeMode")} hint={t("awKnowledgeInfo")}>
              <select
                value={knowledgeMode}
                onChange={(event) => setKnowledgeMode(event.target.value as KnowledgeMode)}
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
                value={positioningId}
                onChange={(event) => setPositioningId(event.target.value)}
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
          </div>
        </div>

        <div className="grid gap-4 border-t border-sky-100 pt-4">
          <h3 className="text-sm font-semibold text-zinc-900">{t("awConfigSection")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("awArticleStyle")} hint={t(articleStyleHelperKeys[articleStyle])}>
              <select
                value={articleStyle}
                onChange={(event) => setArticleStyle(event.target.value as ArticleStyle)}
                className={consoleInputClass}
              >
                {articleStyles.map((style) => (
                  <option key={style} value={style}>
                    {t(articleStyleLabelKeys[style])}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("awIndustry")}>
              <select
                value={industry}
                onChange={(event) => setIndustry(event.target.value as IndustryDomain)}
                className={consoleInputClass}
              >
                {industryDomains.map((domain) => (
                  <option key={domain} value={domain}>
                    {t(industryDomainLabelKeys[domain])}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("awAudience")}>
              <select
                value={audience}
                onChange={(event) => setAudience(event.target.value as Audience)}
                className={consoleInputClass}
              >
                {audiences.map((entry) => (
                  <option key={entry} value={entry}>
                    {t(audienceLabelKeys[entry])}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("awPlatform")}>
              <select
                value={targetPlatform}
                onChange={(event) => setTargetPlatform(event.target.value)}
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
          </div>

          <div className="grid gap-2">
            <span className="text-sm font-medium text-zinc-700">
              {t("awWordCount")}：{wordCount} {t("awWordUnit")}
            </span>
            <input
              type="range"
              min={aiWritingWordCountMin}
              max={aiWritingWordCountMax}
              step={aiWritingWordCountStep}
              value={wordCount}
              onChange={(event) => setWordCount(Number(event.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-sky-200 to-sky-500 accent-sky-600"
            />
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>{aiWritingWordCountMin}</span>
              <span>{aiWritingWordCountMax}</span>
            </div>
          </div>

          <Field label={t("awCoreKeywords")}>
            <input
              value={coreKeywords}
              maxLength={aiWritingKeywordsMaxLength}
              onChange={(event) => setCoreKeywords(event.target.value)}
              placeholder={t("awCoreKeywordsPlaceholder")}
              className={consoleInputClass}
            />
            <span className="ml-auto text-xs font-normal tabular-nums text-zinc-400">
              {coreKeywords.length}/{aiWritingKeywordsMaxLength}
            </span>
          </Field>
        </div>
        <div className="grid gap-4 border-t border-sky-100 pt-4 md:grid-cols-3">
          <div className="grid gap-2">
            <span className="text-sm font-medium text-zinc-700">{t("awLanguage")}</span>
            <SegmentedControl
              value={languageCode}
              options={outputLanguages.map((value) => ({ value, label: t(outputLanguageLabelKeys[value]) }))}
              onChange={setLanguageCode}
            />
            <span className="text-xs text-zinc-400">{t("awLanguageHint")}</span>
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium text-zinc-700">{t("awImageStrategy")}</span>
            <SegmentedControl
              value={imageStrategy}
              options={imageStrategies.map((value) => ({ value, label: t(imageStrategyLabelKeys[value]) }))}
              onChange={setImageStrategy}
            />
            <span className="text-xs text-zinc-400">{t("awImageStrategyHint")}</span>
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium text-zinc-700">{t("awImageCount")}</span>
            <SegmentedControl
              value={imageCount}
              options={imageCounts.map((value) => ({ value, label: t(imageCountLabelKeys[value]) }))}
              onChange={setImageCount}
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
            aria-checked={deAi}
            onClick={() => setDeAi((prev) => !prev)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
              deAi ? "bg-sky-500" : "bg-zinc-300"
            }`}
          >
            <span className={`absolute size-4 rounded-full bg-white transition-all ${deAi ? "left-4" : "left-0.5"}`} />
          </button>
        </div>
        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("btnCancel")}
          </Button>
          <Button onClick={() => void handleGenerate()} loading={loading} disabled={!topic.trim()}>
            <Sparkles size={15} />
            {loading ? t("awGenerating") : t("awGenerate")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
