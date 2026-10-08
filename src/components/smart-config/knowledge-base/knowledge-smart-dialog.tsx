"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { NoticeBanner } from "../positioning-fields";

export function KnowledgeSmartDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleParse() {
    if (!content.trim()) {
      setError(t("kbSmartNeedInput"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiPost("/api/knowledge-base/ai-parse", { content: content.trim() });
      setContent("");
      onSaved();
      onClose();
    } catch {
      setError(t("kbSmartFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("kbSmartTitle")} maxWidth="lg">
      <div className="grid gap-4">
        <NoticeBanner title={t("kbSmartTitle")}>
          <p>{t("kbSmartDesc")}</p>
        </NoticeBanner>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={t("kbSmartPlaceholder")}
          className={`${consoleInputClass} min-h-44 resize-none`}
        />
        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("btnCancel")}
          </Button>
          <Button onClick={() => void handleParse()} loading={loading} disabled={!content.trim()}>
            <Sparkles size={15} />
            {loading ? t("kbSmartParsing") : t("kbSmartParse")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
