"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { NoticeBanner } from "./positioning-fields";
import type { PositionDraft } from "@/lib/types";

type GenerateResponse = {
  draft: PositionDraft;
  source: "ai" | "fallback";
  provider?: string;
  model?: string;
};

export function PositioningAiDialog({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (draft: PositionDraft) => void;
}) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const samples = [t("posAiSample1"), t("posAiSample2"), t("posAiSample3"), t("posAiSample4")];

  async function handleGenerate() {
    if (!prompt.trim()) {
      setError(t("posAiNeedInput"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await apiPost<GenerateResponse>("/api/positions/generate", { prompt: prompt.trim() });
      onApply(result.draft);
      setPrompt("");
      onClose();
    } catch {
      setError(t("posAiFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("posAiTitle")} maxWidth="lg">
      <div className="grid gap-4">
        <NoticeBanner title={t("posAiBannerTitle")}>
          <p>{t("posAiBannerDesc")}</p>
          <p className="mt-1">{t("posAiBannerNote")}</p>
        </NoticeBanner>

        <div className="grid gap-1.5">
          <textarea
            value={prompt}
            maxLength={300}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t("posAiPlaceholder")}
            className={`${consoleInputClass} min-h-24 resize-none`}
          />
          <span className="ml-auto text-xs tabular-nums text-zinc-400">{prompt.length}/300</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-400">{t("posAiTrySample")}</span>
          {samples.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => setPrompt(sample)}
              className="rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 transition hover:bg-sky-100"
            >
              {sample}
            </button>
          ))}
        </div>

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}

        <Button onClick={handleGenerate} loading={loading} className="w-full">
          <Sparkles size={16} />
          {loading ? t("posAiGenerating") : t("posAiGenerate")}
        </Button>
      </div>
    </Dialog>
  );
}
