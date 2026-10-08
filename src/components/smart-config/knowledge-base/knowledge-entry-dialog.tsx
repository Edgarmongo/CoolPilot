"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { knowledgeBaseCategoryLabelKeys, knowledgeBaseWeightLabelKeys } from "@/lib/knowledge-base";
import {
  knowledgeBaseCategories,
  knowledgeBaseWeights,
  type KnowledgeBaseCategory,
  type KnowledgeBaseRecord,
  type KnowledgeBaseWeight,
  type PositionRecord,
} from "@/lib/types";
import { Field, TagInput } from "../positioning-fields";

type FormState = {
  title: string;
  content: string;
  category: KnowledgeBaseCategory;
  weight: KnowledgeBaseWeight;
  tags: string[];
  positionId: string;
};

const emptyForm: FormState = {
  title: "",
  content: "",
  category: "other",
  weight: "medium",
  tags: [],
  positionId: "",
};

export function KnowledgeEntryDialog({
  open,
  onClose,
  onSaved,
  entry,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  entry: KnowledgeBaseRecord | null;
}) {
  const { t } = useI18n();
  const { data: positions = [] } = useSWR<PositionRecord[]>("/api/positions", swrFetcher);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next: FormState = entry
      ? {
          title: entry.title,
          content: entry.content,
          category: entry.category,
          weight: entry.weight,
          tags: entry.tags,
          positionId: entry.positionId,
        }
      : emptyForm;
    window.queueMicrotask(() => setForm(next));
  }, [open, entry]);

  function patch(next: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = { ...form, title: form.title.trim() };
      if (entry) await apiPatch(`/api/knowledge-base/${entry.id}`, payload);
      else await apiPost("/api/knowledge-base", payload);
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={entry ? t("btnEdit") : t("kbAdd")} maxWidth="lg">
      <div className="grid gap-4">
        <Field label={t("kbFieldName")} hint={t("kbRequired")}>
          <input
            value={form.title}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder={t("kbFieldNamePlaceholder")}
            className={consoleInputClass}
          />
        </Field>

        <Field label={t("kbFieldContent")} hint={t("kbRequired")}>
          <textarea
            value={form.content}
            onChange={(event) => patch({ content: event.target.value })}
            placeholder={t("kbFieldContentPlaceholder")}
            className={`${consoleInputClass} min-h-40 resize-none`}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("kbFieldCategory")}>
            <select
              value={form.category}
              onChange={(event) => patch({ category: event.target.value as KnowledgeBaseCategory })}
              className={consoleInputClass}
            >
              {knowledgeBaseCategories.map((category) => (
                <option key={category} value={category}>
                  {t(knowledgeBaseCategoryLabelKeys[category])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("kbFieldWeight")}>
            <select
              value={form.weight}
              onChange={(event) => patch({ weight: event.target.value as KnowledgeBaseWeight })}
              className={consoleInputClass}
            >
              {knowledgeBaseWeights.map((weight) => (
                <option key={weight} value={weight}>
                  {t(knowledgeBaseWeightLabelKeys[weight])}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700">{t("kbFieldTags")}</span>
          <TagInput
            values={form.tags}
            onChange={(tags) => patch({ tags })}
            placeholder={t("kbFieldTagsPlaceholder")}
            addLabel={t("kbAdd")}
            removeLabel={t("btnDelete")}
          />
        </div>

        <Field label={t("kbFieldPosition")}>
          <select
            value={form.positionId}
            onChange={(event) => patch({ positionId: event.target.value })}
            className={consoleInputClass}
          >
            <option value="">{t("kbPositionGlobal")}</option>
            {positions.map((position) => (
              <option key={position.id} value={position.id}>
                {position.name}
              </option>
            ))}
          </select>
        </Field>

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
