"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiPatch } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { researchMaterialWritingHref } from "@/lib/research";
import {
  formatTranscriptTimestamp,
  isTranscriptionProviderId,
  transcriptLines,
  transcriptionProviderLabelKeys,
} from "@/lib/transcription/transcription";
import type { ResearchMaterialRecord } from "@/lib/types";

/**
 * One material's transcript (CI-P3-02-04/06 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Three things are shown and kept apart, which is the whole point of the card:
 *
 * - **原始转写** is `transcriptJson.segments`, the engine's own output, in the order it produced it. It is
 *   never edited here. A segment whose engine reported no position is drawn without a mark (`transcriptLines`
 *   composes the view; nothing invents a time), and a transcript whose engine reported no positions at all
 *   says so rather than printing `00:00` down the page.
 * - **正文** is the material's `content` - the text the user owns, which a generation reads. Saving patches
 *   `content` only, so rewriting a sentence never rewrites what the engine said: the two live in different
 *   columns and neither write path touches the other's.
 * - **Where it came from** is the metadata: the file in the workspace, the engine and its model, the
 *   language, the media's own length and the task id. That is what keeps a transcript traceable to its
 *   source after the task's log is gone.
 *
 * A material with no transcript never opens this dialog - `ResearchWorkspace` only offers it for a row that
 * carries one - so "no timestamps" can never be confused with "this is not a transcript".
 */
export function ResearchTranscriptDialog({
  open,
  onClose,
  material,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  material: ResearchMaterialRecord | null;
  onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const next = material?.content ?? "";
    // Deferred like `ResearchFormDialog` does: a dialog that opens with its draft is a dialog that cannot
    // render one frame of someone else's text.
    window.queueMicrotask(() => {
      setContent(next);
      setError("");
    });
  }, [open, material]);

  const transcript = material?.transcript ?? null;
  const lines = transcript ? transcriptLines("", transcript.segments) : [];
  const hasMarks = transcript ? transcript.segments.some((segment) => segment.startMs !== null) : false;
  const duration = transcript?.durationMs;

  async function handleSave() {
    if (!material) return;
    setSaving(true);
    setError("");
    try {
      await apiPatch(`/api/research/${material.id}`, { content });
      onSaved();
      onClose();
    } catch {
      setError(t("rsSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("trTranscriptTitle")} maxWidth="lg">
      <div className="grid gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-sky-50/60 px-4 py-3 text-xs">
          <Meta label={t("trSourceFile")} value={transcript?.sourceFileName ?? ""} />
          <Meta
            label={t("trEngine")}
            value={
              transcript
                ? isTranscriptionProviderId(transcript.providerId)
                  ? t(transcriptionProviderLabelKeys[transcript.providerId])
                  : transcript.providerId
                : ""
            }
          />
          <Meta label={t("trModel")} value={transcript?.model ?? ""} />
          <Meta label={t("trLanguageLabel")} value={transcript?.language || t("trLanguageUnknown")} />
          <Meta
            label={t("trDuration")}
            value={typeof duration === "number" ? formatTranscriptTimestamp(duration) : t("trDurationUnknown")}
          />
          <Meta label={t("trResponseFormat")} value={transcript?.responseFormat ?? ""} />
          <Meta label={t("trTask")} value={transcript?.taskId ?? ""} />
        </dl>

        <div className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700">{t("trRawSegments")}</span>
          {lines.length === 0 ? (
            <span className="text-xs text-zinc-400">{t("trRawEmpty")}</span>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-xl border border-sky-100 bg-white px-3 py-2">
              {lines.map((line, index) => (
                <p key={index} className="flex gap-2 py-0.5 text-sm text-zinc-700">
                  {line.at ? (
                    <span className="w-12 shrink-0 font-mono text-xs leading-5 text-sky-600">{line.at}</span>
                  ) : (
                    <span className="w-12 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">{line.text}</span>
                </p>
              ))}
            </div>
          )}
          {!hasMarks && lines.length > 0 ? <span className="text-xs text-zinc-400">{t("trNoTimestamps")}</span> : null}
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700">{t("trBodyLabel")}</span>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className={`${consoleInputClass} min-h-40 resize-y`}
          />
          <span className="text-xs text-zinc-400">{t("trBodyHint")}</span>
        </div>

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}

        <div className="flex items-center justify-between gap-2 pt-2">
          <Link
            href={material ? researchMaterialWritingHref(locale, material.id) : "#"}
            className="text-sm text-violet-600 hover:underline"
          >
            {t("rsWrite")}
          </Link>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("btnCancel")}
            </Button>
            <Button onClick={() => void handleSave()} loading={saving}>
              {t("btnSave")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** One stored fact about the transcript; a field the record does not carry renders as `-`, never as a guess. */
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-zinc-400">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-zinc-600" title={value}>
        {value || "-"}
      </dd>
    </div>
  );
}

