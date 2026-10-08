"use client";

import { useMemo, useState } from "react";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { apiPatch, apiPost } from "@/lib/api-client";
import { htmlToPlainText } from "@/lib/article-themes";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import {
  composeTranslationLayout,
  translationLayouts,
  type TranslationLayout,
} from "@/lib/translation-layouts";
import type { ContentItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ArticleDiffReview } from "./article-diff-review";

/** Bilingual layouts offered once a translation finishes. */
const layoutLabelKeys: Record<TranslationLayout, TranslationKey> = {
  stacked: "trLayoutStacked",
  interleaved: "trLayoutInterleaved",
  replace: "trLayoutReplace",
};

type TranslationResult = {
  title: string;
  paragraphs: string[];
  sourceTitle: string;
  sourceParagraphs: string[];
};

/** Target languages offered by the “翻译” dialog, mirroring the screenshots. */
export const translationTargets = [
  { code: "zh-TW", label: "繁体中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本语" },
  { code: "ko", label: "한국어" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "ru", label: "Русский" },
  { code: "pt", label: "Português" },
] as const;

export function ArticleTranslateDialog({
  open,
  onClose,
  itemId,
  originalText,
  originalTitle,
  onTranslated,
}: {
  open: boolean;
  onClose: () => void;
  itemId: string;
  /** Current editor body — the left pane of the comparison. */
  originalText: string;
  /** Current editor title, so the translated title matches what is on screen. */
  originalTitle: string;
  onTranslated: (item: ContentItem) => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<"form" | "compare">("form");
  const [layout, setLayout] = useState<TranslationLayout>("stacked");
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [target, setTarget] = useState<string>("en");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activeTarget = translationTargets.find((entry) => entry.code === target) ?? translationTargets[1];

  /** The article as it would look with the currently selected layout. */
  const composed = useMemo(
    () =>
      result
        ? composeTranslationLayout(layout, {
            sourceTitle: result.sourceTitle,
            sourceParagraphs: result.sourceParagraphs,
            targetTitle: result.title,
            targetParagraphs: result.paragraphs,
          })
        : null,
    [layout, result],
  );

  function close() {
    setStep("form");
    setResult(null);
    setError("");
    onClose();
  }

  /** Runs the translation; the article is untouched until the user confirms. */
  async function handleSubmit() {
    setLoading(true);
    setError("");
    try {
      const data = await apiPost<TranslationResult>(`/api/content/${itemId}/translate`, {
        targetLanguage: activeTarget.label,
        title: originalTitle,
        text: originalText.slice(0, 20000),
      });
      setResult(data);
      setStep("compare");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  /** Persists the reviewed translation, laid out with the chosen style. */
  async function applyResult() {
    if (!composed) return;
    setApplying(true);
    setError("");
    try {
      const updated = await apiPatch<ContentItem>(`/api/content/${itemId}`, {
        title: composed.title,
        body: composed.html,
        postReadyText: htmlToPlainText(composed.html),
      });
      onTranslated(updated);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title={t("trTitle")} maxWidth={step === "compare" ? "2xl" : "md"}>
      {step === "compare" ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <span className="text-sm font-medium text-zinc-700">{t("trLayout")}</span>
            <div className="flex flex-wrap gap-2">
              {translationLayouts.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLayout(value)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                    layout === value
                      ? "border-sky-400 bg-sky-50 text-sky-700"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-sky-200",
                  )}
                >
                  {t(layoutLabelKeys[value])}
                </button>
              ))}
            </div>
          </div>
          <ArticleDiffReview before={originalText} after={composed ? htmlToPlainText(composed.html) : ""} />
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
        <p className="text-sm text-zinc-500">{t("trSource")}</p>
        <div className="space-y-2">
          <span className="text-sm font-medium text-zinc-700">{t("trTarget")}</span>
          <div className="flex flex-wrap gap-2">
            {translationTargets.map((entry) => (
              <button
                key={entry.code}
                type="button"
                onClick={() => setTarget(entry.code)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                  target === entry.code
                    ? "border-sky-400 bg-sky-50 text-sky-700"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-sky-200",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            {t("rwClose")}
          </Button>
          <Button onClick={() => void handleSubmit()} loading={loading}>
            <Languages size={15} />
            {loading ? t("trTranslating") : t("trTranslateTo", { lang: activeTarget.label })}
          </Button>
        </div>
      </div>
      )}
    </Dialog>
  );
}
