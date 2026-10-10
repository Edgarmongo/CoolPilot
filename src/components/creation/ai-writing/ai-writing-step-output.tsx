"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { CheckCircle2, PenLine, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { resolveArtifactImageSrc } from "@/lib/artifact-image-url";
import { articleEditorHref } from "@/lib/editor-link";
import {
  audienceLabelKeys,
  articleStyleLabelKeys,
  imageCountLabelKeys,
  imageStrategyLabelKeys,
  industryDomainLabelKeys,
  outputLanguageLabelKeys,
  type AiWritingConfig,
} from "@/lib/ai-writing";
import { useI18n } from "@/lib/i18n";
import { localizedPath, type Locale } from "@/lib/i18n-config";
import type { BrandRecord } from "@/lib/types";
import type { HotTopicItem } from "./ai-writing-step-material";

export type AiWritingResult = {
  item: { id: string; title: string; body: string; postReadyText: string; imagePath?: string };
  images: string[];
  provider?: string;
  model?: string;
};

export function AiWritingStepOutput({
  config,
  topics,
  productIds,
  freeText,
  topicId,
  locale,
  onGenerated,
}: {
  config: AiWritingConfig;
  topics: HotTopicItem[];
  productIds: string[];
  freeText: string;
  /** The topic this run was opened from, when it was (CI-P2-01); recorded as provenance. */
  topicId?: string;
  locale: Locale;
  onGenerated?: () => void;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AiWritingResult | null>(null);
  /** The selected brand's name, so the summary the user reviews before generating names it (CI-P2-02). */
  const { data: brands = [] } = useSWR<BrandRecord[]>("/api/brands", swrFetcher);
  const selectedBrand = brands.find((brand) => brand.id === config.brandId) ?? null;

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const data = await apiPost<AiWritingResult>("/api/ai-writing/generate", {
        config,
        topics: topics.map((topic) => ({ title: topic.title, source: topic.source, url: topic.url })),
        productIds,
        freeText,
        // Provenance only: the topic's text already travelled as `freeText`, and this is what lets the
        // stored article and the topic list point at each other afterwards (CI-P2-01).
        topicId: topicId ?? "",
      });
      setResult(data);
      onGenerated?.();
    } catch {
      setError(t("awGenerateFailed"));
    } finally {
      setLoading(false);
    }
  }

  const chips = [
    t(articleStyleLabelKeys[config.articleStyle]),
    t(audienceLabelKeys[config.audience]),
    `${config.wordCount} ${t("awWordUnit")}`,
    t(outputLanguageLabelKeys[config.language]),
    t(imageStrategyLabelKeys[config.imageStrategy]),
    t(imageCountLabelKeys[config.imageCount]),
  ];
  if (config.industry !== "general") chips.push(t(industryDomainLabelKeys[config.industry]));
  if (config.targetPlatform) chips.push(config.targetPlatform);
  if (config.coreKeywords) chips.push(`#${config.coreKeywords}`);
  // The brand is a generation input, not decoration: it is shown in the summary that precedes the
  // "generate" button, next to everything else the run will send (P2-02-03).
  if (selectedBrand) chips.push(selectedBrand.name);

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-2xl border border-sky-100 bg-sky-50/40 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-900">{t("awOutputSummary")}</h3>
          <span className="rounded-full bg-white px-2 py-0.5 text-xs text-sky-700 ring-1 ring-sky-100">
            {t("awMaterialCounts", { topics: topics.length, products: productIds.length })}
            {freeText.trim() ? ` · ${t("awFreeShort")}` : ""}
          </span>
          {config.deAi ? (
            <span className="rounded-full bg-white px-2 py-0.5 text-xs text-violet-700 ring-1 ring-violet-100">
              {t("awDeAi")}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span key={chip} className="rounded-full bg-white px-2.5 py-0.5 text-xs text-zinc-600 ring-1 ring-sky-100">
              {chip}
            </span>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void generate()} loading={loading} disabled={loading}>
          <Sparkles size={16} />
          {loading ? t("awGenerating") : result ? t("awRegenerate") : t("awGenerate")}
        </Button>
        {result ? (
          <>
            <Link
              href={articleEditorHref(locale, result.item.id)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 transition hover:text-sky-900 hover:underline"
            >
              <PenLine className="size-4" />
              {t("awOpenEditor")}
            </Link>
            <Link
              href={localizedPath(locale, "/content/library")}
              className="text-sm font-medium text-sky-600 hover:underline"
            >
              {t("awOpenLibrary")}
            </Link>
          </>
        ) : null}
      </div>

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}
      {loading ? (
        <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-14 text-center text-sm text-zinc-500">
          {t("awGenerating")}
        </p>
      ) : null}
      {result ? (
        <article className="space-y-4 rounded-2xl border border-sky-100 bg-white p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="size-3.5" />
              {t("awSavedBadge")}
            </span>
            {result.provider ? (
              <span className="text-xs text-zinc-400">
                {result.provider}
                {result.model ? ` / ${result.model}` : ""}
              </span>
            ) : null}
            {result.images.length ? (
              <span className="text-xs text-zinc-400">{t("awImagesCount", { count: result.images.length })}</span>
            ) : null}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void generate()} loading={loading}>
              <RefreshCw size={14} />
              {t("awRegenerate")}
            </Button>
          </div>

          <h2 className="text-xl font-semibold text-zinc-900">{result.item.title}</h2>

          {result.images.length ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {result.images.map((image) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={image}
                  src={resolveArtifactImageSrc(image)}
                  alt=""
                  className="aspect-square w-full rounded-xl border border-sky-100 object-cover"
                />
              ))}
            </div>
          ) : null}

          <div className="whitespace-pre-wrap text-sm leading-7 text-zinc-700">{result.item.body}</div>
        </article>
      ) : null}
    </div>
  );
}
