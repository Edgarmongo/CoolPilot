"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiPatch, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { BrandRecord } from "@/lib/types";
import { Field, TagInput } from "../smart-config/positioning-fields";

type FormState = {
  name: string;
  description: string;
  targetAudience: string;
  tone: string;
  keywords: string[];
  bannedWords: string[];
};

const emptyForm: FormState = {
  name: "",
  description: "",
  targetAudience: "",
  tone: "",
  keywords: [],
  bannedWords: [],
};

/**
 * Create/edit one brand profile (CI-P2-02 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Same shape as `TopicFormDialog`: the dialog owns the draft, `POST /api/brands` or
 * `PATCH /api/brands/{id}` persists it, and the list refreshes through `onSaved`. The two list fields
 * are the card's 关键词 and 禁用表达, and they are the two that reach the model: the first as something
 * to say, the second as something not to.
 */
export function BrandFormDialog({
  open,
  onClose,
  onSaved,
  brand,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  brand: BrandRecord | null;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const next: FormState = brand
      ? {
          name: brand.name,
          description: brand.description,
          targetAudience: brand.targetAudience,
          tone: brand.tone,
          keywords: brand.keywords,
          bannedWords: brand.bannedWords,
        }
      : emptyForm;
    window.queueMicrotask(() => {
      setForm(next);
      setError("");
    });
  }, [open, brand]);

  function patch(next: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, name: form.name.trim() };
      if (brand) await apiPatch(`/api/brands/${brand.id}`, payload);
      else await apiPost("/api/brands", payload);
      onSaved();
      onClose();
    } catch {
      // The dialog stays open with the draft intact: re-typing a brand because a request failed is
      // the one outcome worth avoiding here.
      setError(t("bdSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={brand ? t("bdEditTitle") : t("bdCreateTitle")} maxWidth="md">
      <div className="grid gap-4">
        <Field label={t("bdFieldName")}>
          <input
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder={t("bdNamePlaceholder")}
            className={consoleInputClass}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("bdColumnAudience")}>
            <input
              value={form.targetAudience}
              onChange={(event) => patch({ targetAudience: event.target.value })}
              placeholder={t("bdAudiencePlaceholder")}
              className={consoleInputClass}
            />
          </Field>
          <Field label={t("bdColumnTone")}>
            <input
              value={form.tone}
              onChange={(event) => patch({ tone: event.target.value })}
              placeholder={t("bdTonePlaceholder")}
              className={consoleInputClass}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <span className="text-sm font-medium text-zinc-700">{t("bdColumnKeywords")}</span>
            <TagInput
              values={form.keywords}
              onChange={(keywords) => patch({ keywords })}
              placeholder={t("bdKeywordsPlaceholder")}
              addLabel={t("pdAdd")}
              removeLabel={t("btnDelete")}
            />
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium text-zinc-700">{t("bdColumnBanned")}</span>
            <TagInput
              values={form.bannedWords}
              onChange={(bannedWords) => patch({ bannedWords })}
              placeholder={t("bdBannedPlaceholder")}
              addLabel={t("pdAdd")}
              removeLabel={t("btnDelete")}
            />
            <span className="text-xs text-zinc-400">{t("bdBannedHint")}</span>
          </div>
        </div>

        <Field label={t("bdFieldDescription")}>
          <textarea
            value={form.description}
            onChange={(event) => patch({ description: event.target.value })}
            placeholder={t("bdDescriptionPlaceholder")}
            className={`${consoleInputClass} min-h-28 resize-none`}
          />
        </Field>

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            {t("btnCancel")}
          </Button>
          <Button onClick={() => void handleSave()} loading={saving} disabled={!form.name.trim()}>
            {t("btnSave")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
