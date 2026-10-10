"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiPatch, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { topicStatusLabelKeys, topicStatuses } from "@/lib/topics";
import type { TopicRecord, TopicStatus } from "@/lib/types";
import { Field, TagInput } from "../smart-config/positioning-fields";

type FormState = {
  title: string;
  description: string;
  keywords: string[];
  source: string;
  sourceUrl: string;
  status: TopicStatus;
};

const emptyForm: FormState = {
  title: "",
  description: "",
  keywords: [],
  source: "",
  sourceUrl: "",
  status: "active",
};

/**
 * Create/edit one topic (CI-P2-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Same shape as `ProductFormDialog`: the dialog owns the draft, `POST /api/topics` or
 * `PATCH /api/topics/{id}` persists it, and the list refreshes through `onSaved`. Archive is a status
 * the form can set, because a topic the user wants to retire is not a topic they want to lose.
 */
export function TopicFormDialog({
  open,
  onClose,
  onSaved,
  topic,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  topic: TopicRecord | null;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const next: FormState = topic
      ? {
          title: topic.title,
          description: topic.description,
          keywords: topic.keywords,
          source: topic.source,
          sourceUrl: topic.sourceUrl,
          status: topic.status,
        }
      : emptyForm;
    window.queueMicrotask(() => {
      setForm(next);
      setError("");
    });
  }, [open, topic]);

  function patch(next: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, title: form.title.trim() };
      if (topic) await apiPatch(`/api/topics/${topic.id}`, payload);
      else await apiPost("/api/topics", payload);
      onSaved();
      onClose();
    } catch {
      // The dialog stays open with the draft intact: re-typing a topic because a request failed is
      // the one outcome worth avoiding here.
      setError(t("tpSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={topic ? t("tpEditTitle") : t("tpCreateTitle")} maxWidth="md">
      <div className="grid gap-4">
        <Field label={t("tpFieldTitle")}>
          <input
            value={form.title}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder={t("tpTitlePlaceholder")}
            className={consoleInputClass}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("tpFieldSource")}>
            <input
              value={form.source}
              onChange={(event) => patch({ source: event.target.value })}
              placeholder={t("tpSourcePlaceholder")}
              className={consoleInputClass}
            />
          </Field>
          <Field label={t("tpFieldSourceUrl")}>
            <input
              value={form.sourceUrl}
              onChange={(event) => patch({ sourceUrl: event.target.value })}
              placeholder={t("tpSourceUrlPlaceholder")}
              className={consoleInputClass}
            />
          </Field>
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700">{t("tpFieldKeywords")}</span>
          <TagInput
            values={form.keywords}
            onChange={(keywords) => patch({ keywords })}
            placeholder={t("tpKeywordsPlaceholder")}
            addLabel={t("pdAdd")}
            removeLabel={t("btnDelete")}
          />
        </div>

        <Field label={t("tpFieldDescription")}>
          <textarea
            value={form.description}
            onChange={(event) => patch({ description: event.target.value })}
            placeholder={t("tpDescriptionPlaceholder")}
            className={`${consoleInputClass} min-h-28 resize-none`}
          />
        </Field>

        <Field label={t("tpFieldStatus")}>
          <select
            value={form.status}
            onChange={(event) => patch({ status: event.target.value as TopicStatus })}
            className={consoleInputClass}
          >
            {topicStatuses.map((value) => (
              <option key={value} value={value}>
                {t(topicStatusLabelKeys[value])}
              </option>
            ))}
          </select>
        </Field>

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            {t("btnCancel")}
          </Button>
          <Button onClick={() => void handleSave()} loading={saving} disabled={!form.title.trim()}>
            {t("btnSave")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
