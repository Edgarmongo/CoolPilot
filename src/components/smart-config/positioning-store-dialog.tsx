"use client";

import { useEffect, useState } from "react";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { appStoreCategoryLabelKeys, positionFieldLimits } from "@/lib/positions";
import { appStoreCategories, type AppStoreCategory, type PositionRecord } from "@/lib/types";
import { NoticeBanner } from "./positioning-fields";

type PublishResponse = {
  position: PositionRecord;
  evaluation: { score: number; passed: boolean; missing: string[] };
  submitted: boolean;
};

export function PositioningStoreDialog({
  open,
  onClose,
  position,
  onUpdated,
}: {
  open: boolean;
  onClose: () => void;
  position: PositionRecord | null;
  onUpdated: (position: PositionRecord) => void;
}) {
  const { t } = useI18n();
  const [emoji, setEmoji] = useState("🐑");
  const [category, setCategory] = useState<AppStoreCategory>(appStoreCategories[0]);
  const [tagline, setTagline] = useState("");
  const [sampleQuestion, setSampleQuestion] = useState("");
  const [busy, setBusy] = useState<"test" | "submit" | null>(null);
  const [message, setMessage] = useState("");
  const [evaluation, setEvaluation] = useState<{ score: number; passed: boolean } | null>(null);

  useEffect(() => {
    if (!open || !position) return;
    const { store } = position;
    window.queueMicrotask(() => {
      setEmoji(store.emoji || "🐑");
      setCategory(store.category);
      setTagline(store.tagline);
      setSampleQuestion(store.sampleQuestion);
      setEvaluation(
        store.testScore ? { score: store.testScore, passed: store.status === "published" } : null,
      );
      setMessage("");
    });
  }, [open, position]);

  async function callPublish(runTest: boolean) {
    if (!position) return;
    setBusy(runTest ? "submit" : "test");
    setMessage("");
    try {
      const result = await apiPost<PublishResponse>(`/api/positions/${position.id}/publish`, {
        emoji,
        category,
        tagline,
        sampleQuestion,
        runTest,
      });
      setEvaluation(result.evaluation);
      if (runTest) {
        onUpdated(result.position);
        setMessage(result.submitted ? t("posStoreSubmitted") : t("posStoreTestFail"));
      } else {
        setMessage(t("posStoreTestScore", { score: result.evaluation.score }));
      }
    } catch {
      setMessage(t("posStoreError"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("posStoreTitle")} maxWidth="lg">
      <div className="grid gap-4">
        <NoticeBanner title={t("posStoreBannerTitle", { name: position?.name ?? "" })}>
          <p>{t("posStoreBannerDesc")}</p>
        </NoticeBanner>

        <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-zinc-700">{t("posStoreEmoji")}</span>
            <input
              value={emoji}
              maxLength={4}
              onChange={(event) => setEmoji(event.target.value)}
              className={`${consoleInputClass} text-center text-xl`}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-zinc-700">{t("posStoreCategory")}</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as AppStoreCategory)}
              className={consoleInputClass}
            >
              {appStoreCategories.map((value) => (
                <option key={value} value={value}>
                  {t(appStoreCategoryLabelKeys[value])}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-zinc-700">
            <span className="text-rose-500">*</span> {t("posStoreTagline")}
          </span>
          <input
            value={tagline}
            maxLength={positionFieldLimits.tagline}
            onChange={(event) => setTagline(event.target.value)}
            placeholder={t("posStoreTaglinePlaceholder")}
            className={consoleInputClass}
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-zinc-700">
            <span className="text-rose-500">*</span> {t("posStoreSample")}
          </span>
          <input
            value={sampleQuestion}
            maxLength={positionFieldLimits.sampleQuestion}
            onChange={(event) => setSampleQuestion(event.target.value)}
            placeholder={t("posStoreSamplePlaceholder")}
            className={consoleInputClass}
          />
        </label>

        {evaluation ? (
          <p className={evaluation.passed ? "text-sm text-emerald-600" : "text-sm text-amber-600"}>
            {t("posStoreTestScore", { score: evaluation.score })} · {evaluation.passed ? t("posStorePassed") : t("posStoreFailed")}
          </p>
        ) : null}
        {message ? <p className="text-sm text-zinc-500">{message}</p> : null}

        <Button variant="outline" onClick={() => callPublish(false)} loading={busy === "test"} className="w-full">
          {t("posStoreRunTest")}
        </Button>
        <Button onClick={() => callPublish(true)} loading={busy === "submit"} className="w-full">
          <UploadCloud size={16} />
          {t("posStoreSubmit")}
        </Button>
      </div>
    </Dialog>
  );
}
