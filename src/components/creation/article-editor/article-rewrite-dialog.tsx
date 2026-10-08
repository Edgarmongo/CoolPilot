"use client";

import { useState } from "react";
import { Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { consoleInputClass } from "@/components/ui/console-surface";
import { apiPatch, apiPost } from "@/lib/api-client";
import { industryDomainLabelKeys, industryDomains, type IndustryDomain } from "@/lib/ai-writing";
import { plainTextToHtml } from "@/lib/article-themes";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import type { ContentItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ArticleRewriteMode, ArticleRewriteStrength } from "@/lib/validation";
import { ArticleDiffReview } from "./article-diff-review";

const rewriteModes: { value: ArticleRewriteMode; labelKey: TranslationKey; hintKey: TranslationKey }[] = [
  { value: "polish", labelKey: "rwModePolish", hintKey: "rwModePolishHint" },
  { value: "platform", labelKey: "rwModePlatform", hintKey: "rwModePlatformHint" },
  { value: "risk", labelKey: "rwModeRisk", hintKey: "rwModeRiskHint" },
  { value: "tone", labelKey: "rwModeTone", hintKey: "rwModeToneHint" },
];

const strengths: ArticleRewriteStrength[] = ["light", "medium", "heavy"];
const strengthLabelKeys: Record<ArticleRewriteStrength, TranslationKey> = {
  light: "rwStrengthLight",
  medium: "rwStrengthMedium",
  heavy: "rwStrengthHeavy",
};

/** Banned-word presets applied to every rewrite (22 entries). */
export const articleBuiltinBannedWords = [
  "首先",
  "其次",
  "再次",
  "最后",
  "总之",
  "综上所述",
  "总而言之",
  "值得一提的是",
  "众所周知",
  "不难发现",
  "显而易见",
  "毋庸置疑",
  "在当今社会",
  "随着时代的发展",
  "让我们",
  "让我们一起来",
  "深入探讨",
  "赋能",
  "抓手",
  "闭环",
  "打造",
  "助力",
];

export function ArticleRewriteDialog({
  open,
  onClose,
  itemId,
  originalText,
  onRewritten,
}: {
  open: boolean;
  onClose: () => void;
  itemId: string;
  /** Current editor body — the left pane of the comparison. */
  originalText: string;
  onRewritten: (item: ContentItem) => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<"form" | "compare">("form");
  const [resultText, setResultText] = useState("");
  const [applying, setApplying] = useState(false);
  const [mode, setMode] = useState<ArticleRewriteMode>("polish");
  const [industry, setIndustry] = useState<IndustryDomain>("general");
  const [strength, setStrength] = useState<ArticleRewriteStrength>("medium");
  const [styleFeatures, setStyleFeatures] = useState("");
  const [requiredTitle, setRequiredTitle] = useState("");
  const [customRequirements, setCustomRequirements] = useState("");
  const [customBanned, setCustomBanned] = useState<string[]>([]);
  const [bannedInput, setBannedInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activeMode = rewriteModes.find((entry) => entry.value === mode) ?? rewriteModes[0];

  function addBannedWord() {
    const word = bannedInput.trim();
    if (!word || customBanned.includes(word) || customBanned.length >= 50) return;
    setCustomBanned((prev) => [...prev, word]);
    setBannedInput("");
  }

  function close() {
    setStep("form");
    setResultText("");
    setError("");
    onClose();
  }

  /** Runs the rewrite; the article is untouched until the user confirms. */
  async function handleSubmit() {
    setLoading(true);
    setError("");
    try {
      const data = await apiPost<{ text: string }>(`/api/content/${itemId}/rewrite`, {
        mode,
        industry,
        strength,
        styleFeatures,
        requiredTitle,
        customRequirements,
        bannedWords: [...articleBuiltinBannedWords, ...customBanned],
      });
      setResultText(data.text);
      setStep("compare");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  /** Persists the reviewed rewrite into the article body. */
  async function applyResult() {
    setApplying(true);
    setError("");
    try {
      const updated = await apiPatch<ContentItem>(`/api/content/${itemId}`, {
        body: plainTextToHtml(resultText),
        postReadyText: resultText,
      });
      onRewritten(updated);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title={t("rwTitle")} maxWidth={step === "compare" ? "2xl" : "lg"}>
      {step === "compare" ? (
        <div className="space-y-4">
          <ArticleDiffReview before={originalText} after={resultText} />
          {error ? <p className="text-sm text-rose-500">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              {t("aiDiscard")}
            </Button>
            <Button onClick={() => void applyResult()} loading={applying}>
              {t("aiReplace")}
            </Button>
          </div>
        </div>
      ) : (
      <div className="space-y-4">
        <p className="text-sm text-zinc-500">{t("rwDescription")}</p>

        <div className="space-y-2">
          <span className="text-sm font-medium text-zinc-700">{t("rwMode")}</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {rewriteModes.map((entry) => (
              <button
                key={entry.value}
                type="button"
                onClick={() => setMode(entry.value)}
                className={cn(
                  "rounded-xl border px-2 py-2 text-sm font-medium transition",
                  mode === entry.value
                    ? "border-sky-400 bg-sky-50 text-sky-700"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-sky-200",
                )}
              >
                {t(entry.labelKey)}
              </button>
            ))}
          </div>
          <p className="text-xs text-sky-600">{t(activeMode.hintKey)}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("rwIndustry")}</span>
            <select
              value={industry}
              onChange={(event) => setIndustry(event.target.value as IndustryDomain)}
              className={consoleInputClass}
            >
              {industryDomains.map((value) => (
                <option key={value} value={value}>
                  {t(industryDomainLabelKeys[value])}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-2">
            <span className="text-sm font-medium text-zinc-700">{t("rwStrength")}</span>
            <input
              type="range"
              min={0}
              max={2}
              step={1}
              value={strengths.indexOf(strength)}
              onChange={(event) => setStrength(strengths[Number(event.target.value)] ?? "medium")}
              className="w-full accent-sky-500"
            />
            <div className="flex items-center justify-between text-xs text-zinc-400">
              {strengths.map((value) => (
                <span key={value} className={cn(value === strength && "font-semibold text-sky-600")}>
                  {t(strengthLabelKeys[value])}
                </span>
              ))}
            </div>
          </div>
        </div>

        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("rwStyleFeatures")}</span>
          <textarea
            value={styleFeatures}
            onChange={(event) => setStyleFeatures(event.target.value)}
            placeholder={t("rwStyleFeaturesPlaceholder")}
            className={`${consoleInputClass} min-h-20 resize-none`}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("rwTitleMust")}</span>
            <input
              value={requiredTitle}
              onChange={(event) => setRequiredTitle(event.target.value)}
              placeholder={t("rwTitleMustPlaceholder")}
              className={consoleInputClass}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("rwCustomRequirements")}</span>
            <textarea
              value={customRequirements}
              maxLength={500}
              onChange={(event) => setCustomRequirements(event.target.value)}
              placeholder={t("rwCustomRequirementsPlaceholder")}
              className={`${consoleInputClass} min-h-20 resize-none`}
            />
            <span className="ml-auto text-xs font-normal tabular-nums text-zinc-400">
              {customRequirements.length}/500
            </span>
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
            <span className="font-medium text-zinc-700">{t("rwBannedWords")}</span>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs">
              {t("rwBannedBuiltin", { count: articleBuiltinBannedWords.length })}
            </span>
            <span className="text-xs text-zinc-400">{t("rwBannedInclude")}</span>
            <input
              value={bannedInput}
              onChange={(event) => setBannedInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addBannedWord();
                }
              }}
              placeholder={t("rwBannedPlaceholder")}
              className={`${consoleInputClass} h-9 max-w-52 flex-1`}
            />
            <Button type="button" size="sm" variant="outline" onClick={addBannedWord} disabled={!bannedInput.trim()}>
              <Plus size={14} />
              {t("rwBannedAdd")}
            </Button>
          </div>
          {customBanned.length ? (
            <div className="flex flex-wrap gap-2">
              {customBanned.map((word) => (
                <button
                  key={word}
                  type="button"
                  onClick={() => setCustomBanned((prev) => prev.filter((entry) => entry !== word))}
                  className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs text-sky-700 transition hover:bg-sky-100"
                >
                  {word}
                  <X className="size-3" />
                </button>
              ))}
            </div>
          ) : null}
          <p className="text-xs text-zinc-400">{t("rwRetention")}</p>
        </div>

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            {t("rwClose")}
          </Button>
          <Button onClick={() => void handleSubmit()} loading={loading}>
            <Sparkles size={15} />
            {loading ? t("rwRunning") : t("rwStart")}
          </Button>
        </div>
      </div>
      )}
    </Dialog>
  );
}
