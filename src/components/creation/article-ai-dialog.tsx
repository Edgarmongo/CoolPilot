"use client";

import { useEffect, useRef, useState } from "react";
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
import type { ContentItem, PositionRecord, ResearchMaterialRecord } from "@/lib/types";
import { GenerationSourceSelects } from "./generation-source-selects";

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

/**
 * AI generation dialog used by the article-creation page.
 *
 * It hands the *stored* item back rather than its title (P5-C1): the caller opens the editor on what
 * was just generated, which is what closes F-C0-4 of `docs/creator-workflow-audit.md`.
 */
export function ArticleAiDialog({
  open,
  onClose,
  onGenerated,
  initialResearchMaterialId = "",
  initialIncludeExtraction = false,
}: {
  open: boolean;
  onClose: () => void;
  onGenerated: (item: ContentItem) => void;
  /** The material a library row handed over in the URL (CI-P3-01); `""` for a plain open. */
  initialResearchMaterialId?: string;
  /** Whether that same URL asked for the material's stored 研究提炼 too (CI-P3-03). */
  initialIncludeExtraction?: boolean;
}) {
  const { t } = useI18n();
  const { data: positions = [] } = useSWR<PositionRecord[]>("/api/positions", swrFetcher);
  const defaultPosition = positions.find((position) => position.isDefault) ?? positions[0] ?? null;

  const [topic, setTopic] = useState("");
  const [prompt, setPrompt] = useState("");
  /**
   * What this run reads besides the positioning (CI-P2-03): a topic from the topic library and/or a
   * brand profile. Both travel as ids; the route reads the rows, so the prompt carries the stored text.
   */
  const [topicId, setTopicId] = useState("");
  const [brandId, setBrandId] = useState("");
  /**
   * The research material this run reads (CI-P3-01). It arrives either from the select below or from a
   * library row that linked here (`?researchMaterialId=`), which is why the opening value is a prop: the
   * workspace opens this dialog on that material instead of making the user pick it a second time. Only
   * the id travels - the route reads the stored row, so the prompt carries the material's own text.
   */
  const [researchMaterialId, setResearchMaterialId] = useState("");
  /**
   * Whether this run also reads that material's stored 研究提炼 (CI-P3-03).
   *
   * It is only ever *sent* as `true` when the selected material really carries a result, and the checkbox
   * that sets it only exists then - so a flag left over from a link cannot ask the server for a
   * distillation that is not there. The seed arrives with the material (`?includeExtraction=1`).
   */
  const [includeExtraction, setIncludeExtraction] = useState(false);
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

  // A hand-off from the material library is applied when this dialog opens, and it is remembered: the URL
  // keeps its parameter until the workspace drops it, so an effect that re-read it would re-apply a choice
  // the user has since changed.
  const appliedSeedRef = useRef("");
  useEffect(() => {
    if (!open || !initialResearchMaterialId) return;
    if (appliedSeedRef.current === initialResearchMaterialId) return;
    appliedSeedRef.current = initialResearchMaterialId;
    window.queueMicrotask(() => {
      setResearchMaterialId(initialResearchMaterialId);
      // The link that carried the material also carried the request to use its distillation (CI-P3-03).
      setIncludeExtraction(initialIncludeExtraction);
    });
  }, [open, initialResearchMaterialId, initialIncludeExtraction]);

  // Read from the same SWR key `GenerationSourceSelects` uses, so this is the list already in the cache -
  // not a second read. What the checkbox shows is the *stored* row: which version exists.
  const { data: materials = [] } = useSWR<ResearchMaterialRecord[]>("/api/research", swrFetcher);
  const selectedMaterial = materials.find((entry) => entry.id === researchMaterialId) ?? null;
  const materialExtraction = selectedMaterial?.extraction ?? null;

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
        brandId,
        topicId,
        researchMaterialId,
        // Only ever true when the selected material really carries a distillation: the flag is a request to
        // use a stored result, never a claim that one exists (CI-P3-03-06).
        includeResearchExtraction: materialExtraction ? includeExtraction : false,
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
      // The topic selection goes with the subject it prefilled; the brand stays, because generating a
      // second article for the same brand is the normal thing to do next.
      setTopicId("");
      onGenerated(result.item);
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
        {/* 选题 / 品牌 first, so the subject field below shows what the selection prefilled (CI-P2-03). */}
        <GenerationSourceSelects
          topicId={topicId}
          brandId={brandId}
          researchMaterialId={researchMaterialId}
          onChange={(patch) => {
            if (patch.topicId !== undefined) {
              setTopicId(patch.topicId);
              // The topic's own title becomes the visible subject, editable like any typed one; the rest
              // of the row reaches the prompt on the server.
              if (patch.topic) setTopic(patch.topic.title);
            }
            if (patch.brandId !== undefined) setBrandId(patch.brandId);
            // The material stays selected after a run, like the brand: writing a second article from the
            // same material is the normal thing to do next.
            if (patch.researchMaterialId !== undefined) setResearchMaterialId(patch.researchMaterialId);
          }}
        />
        {/* Offered only for a material that really has a distillation, and it says which version would be
            used - so "带入提炼结果" can never be a checkbox that does nothing. */}
        {materialExtraction ? (
          <label className="flex items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50/40 px-4 py-3">
            <input
              type="checkbox"
              checked={includeExtraction}
              onChange={(event) => setIncludeExtraction(event.target.checked)}
              className="mt-1 size-4 shrink-0"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-zinc-700">
                {t("rxUseExtraction", { version: materialExtraction.revision })}
              </span>
              <span className="mt-0.5 block text-xs text-zinc-400">{t("rxUseExtractionHint")}</span>
            </span>
          </label>
        ) : null}
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
