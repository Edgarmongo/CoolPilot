"use client";

import Link from "next/link";
import useSWR from "swr";
import { consoleInputClass } from "@/components/ui/console-surface";
import { swrFetcher } from "@/lib/api-client";
import { brandContextSummary } from "@/lib/brands";
import { useI18n } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n-config";
import { researchMaterialHasText, researchMaterialStatusLabelKeys } from "@/lib/research";
import type { BrandRecord, ResearchMaterialRecord, TopicRecord } from "@/lib/types";

/**
 * 选题 + 品牌 for the generation entries that read them (CI-P2-03 of
 * `docs/coolpilot-capability-integration-plan.md`).
 *
 * The AI writing wizard already owns both selections in its own step (`ai-writing-step-config.tsx` for
 * the brand, `ai-writing-workspace.tsx` for the topic it was opened with). The entries that create an
 * article through `POST /api/content/generate` - the 文章 dialog and the content panel behind
 * 帖子 / 视频 / 文章 - had none, which is exactly why that route kept writing `brandId: ""`. (That panel
 * is an orphaned surface today - F-C0-7 of `docs/creator-workflow-audit.md` - so the dialog is the
 * reachable entry; both are wired here because both call the same route.) This is one component rather
 * than two copies of two selects, so "which stored objects a run reads" cannot drift between the entries
 * that ask for them.
 *
 * It reports what it selected and nothing more: the ids travel in the payload, and the *reading* -
 * `getBrand()` for the brand, `getTopic()` for the topic - stays on the server, so what reaches the
 * prompt is the stored row and not the client's summary of it. The topic row is handed back as well,
 * because the caller's own subject field is prefilled with it: what the user sees is what the topic is.
 *
 * Empty selections are a mode, not a gap: "不使用选题" means the material is what the caller typed, and
 * "不使用品牌资料" means no brand context at all - never a default brand (P2-02-05).
 *
 * CI-P3-01 adds the third selection (研究素材) to the same component, for the reason this file exists: it is
 * the *same* store the library manages and the same id the route reads, so a material chosen here and one
 * chosen from the library row cannot reach the prompt with different text. The hint under it is read from
 * the stored row - its status, and whether it has any 正文 at all - so a material whose source was never
 * read says so before the run instead of producing an article that quietly had no 研究素材 in it.
 */
export type GenerationSourcePatch = {
  topicId?: string;
  /** The row the id names, so the caller can prefill its subject; `null` for 不使用选题. */
  topic?: TopicRecord | null;
  brandId?: string;
  researchMaterialId?: string;
};

export function GenerationSourceSelects({
  topicId,
  brandId,
  researchMaterialId,
  onChange,
}: {
  topicId: string;
  brandId: string;
  /** The research material this run reads; `""` is "none selected" and reads nothing. */
  researchMaterialId: string;
  onChange: (patch: GenerationSourcePatch) => void;
}) {
  const { t, locale } = useI18n();
  const { data: topics = [] } = useSWR<TopicRecord[]>("/api/topics", swrFetcher);
  const { data: brands = [] } = useSWR<BrandRecord[]>("/api/brands", swrFetcher);
  const { data: materials = [] } = useSWR<ResearchMaterialRecord[]>("/api/research", swrFetcher);
  const selectedTopic = topics.find((topic) => topic.id === topicId) ?? null;
  const selectedBrand = brands.find((brand) => brand.id === brandId) ?? null;
  const selectedMaterial = materials.find((material) => material.id === researchMaterialId) ?? null;

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("genTopicLibrary")}</span>
          <select
            value={topicId}
            onChange={(event) => {
              const value = event.target.value;
              onChange({ topicId: value, topic: topics.find((topic) => topic.id === value) ?? null });
            }}
            className={consoleInputClass}
          >
            <option value="">{t("genTopicLibraryNone")}</option>
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.title}
              </option>
            ))}
          </select>
          {selectedTopic ? (
            <span className="text-xs font-normal text-violet-600">
              {t("tpFromTopic", { title: selectedTopic.title })}
            </span>
          ) : null}
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("awBrand")}</span>
          <select
            value={brandId}
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
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("genResearchMaterial")}</span>
          <select
            value={researchMaterialId}
            onChange={(event) => onChange({ researchMaterialId: event.target.value })}
            className={consoleInputClass}
          >
            <option value="">{t("genResearchMaterialNone")}</option>
            {materials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selectedMaterial ? (
        <p className="text-xs text-violet-600">
          {t("genResearchMaterialFrom", { title: selectedMaterial.title })} ·{" "}
          {t(researchMaterialStatusLabelKeys[selectedMaterial.status])}
          {researchMaterialHasText(selectedMaterial) ? "" : ` · ${t("genResearchMaterialNoText")}`}
        </p>
      ) : (
        <p className="text-xs text-zinc-400">
          {t("genResearchMaterialHint")}
          {materials.length ? " " : ` ${t("genResearchMaterialEmpty")} `}
          <Link href={localizedPath(locale, "/creation/research")} className="text-sky-600 hover:underline">
            {t("genResearchMaterialManage")}
          </Link>
        </p>
      )}
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
          {t("awBrandHint")}
          {brands.length ? " " : ` ${t("awBrandEmpty")} `}
          <Link href={localizedPath(locale, "/creation/brands")} className="text-sky-600 hover:underline">
            {t("awBrandManage")}
          </Link>
        </p>
      )}
      {/* CI-P3-03 says the limit out loud instead of implying it: this select is single-choice, so
          "combine several sources" is a sequence of runs - never a multi-select that silently keeps the first. */}
      <p className="text-xs text-zinc-400">{t("genResearchMaterialSingle")}</p>
    </div>
  );
}
