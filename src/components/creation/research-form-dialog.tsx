"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/form-controls";
import { apiPatch, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { researchMaterialKindLabelKeys } from "@/lib/research";
import type { ResearchMaterialKind, ResearchMaterialRecord } from "@/lib/types";
import { Field, TagInput } from "../smart-config/positioning-fields";

/** The two kinds a form may choose; `file` comes from 导入文件 and is shown, never selected (P3-01-03). */
const creatableKinds: ResearchMaterialKind[] = ["text", "url"];

type FormState = {
  title: string;
  kind: ResearchMaterialKind;
  content: string;
  sourceUrl: string;
  tags: string[];
};

const emptyForm: FormState = { title: "", kind: "text", content: "", sourceUrl: "", tags: [] };

/**
 * Create/edit one research material (CI-P3-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Same shape as `TopicFormDialog`: the dialog owns the draft, `POST /api/research` or
 * `PATCH /api/research/{id}` persists it, and the list refreshes through `onSaved`. Two things it does
 * *not* offer, because they are not the form's to decide:
 *
 * - **No status.** 待读取 / 正文就绪 / 读取失败 are what reading a source produced, so the dialog shows the
 *   current one and only `api/research/{id}/fetch` can move it.
 * - **No kind on an existing material.** The kind says how the material entered (typed, linked, imported);
 *   editing it later would relabel a stored file as a note, so it is shown as a label instead.
 *
 * The textarea is the material's own 正文 and is editable: a page that could not be read (or one behind a
 * login) can still be useful as text the user pastes in, and the hint says that reading the source
 * replaces it.
 */
export function ResearchFormDialog({
  open,
  onClose,
  onSaved,
  material,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  material: ResearchMaterialRecord | null;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const next: FormState = material
      ? {
          title: material.title,
          kind: material.kind,
          content: material.content,
          sourceUrl: material.sourceUrl,
          tags: material.tags,
        }
      : emptyForm;
    window.queueMicrotask(() => {
      setForm(next);
      setError("");
    });
  }, [open, material]);

  function patch(next: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);
    setError("");
    try {
      if (material) {
        // `kind` is not sent on an edit: the route keeps the stored one (see the component doc).
        const { title, content, sourceUrl, tags } = form;
        await apiPatch(`/api/research/${material.id}`, { title: title.trim(), content, sourceUrl, tags });
      } else {
        await apiPost("/api/research", { ...form, title: form.title.trim() });
      }
      onSaved();
      onClose();
    } catch {
      // The dialog stays open with the draft intact: re-typing a material because a request failed is the
      // one outcome worth avoiding here.
      setError(t("rsSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={material ? t("rsEditTitle") : t("rsCreateTitle")} maxWidth="lg">
      <div className="grid gap-4">
        <Field label={t("rsFieldTitle")}>
          <input
            value={form.title}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder={t("rsTitlePlaceholder")}
            className={consoleInputClass}
          />
        </Field>

        <div className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700">{t("rsFieldKind")}</span>
          {material ? (
            <span className="text-sm text-zinc-500">{t(researchMaterialKindLabelKeys[material.kind])}</span>
          ) : (
            <>
              <SegmentedControl
                value={form.kind}
                options={creatableKinds.map((value) => ({ value, label: t(researchMaterialKindLabelKeys[value]) }))}
                onChange={(kind) => patch({ kind })}
              />
              <span className="text-xs text-zinc-400">{t("rsKindCreateHint")}</span>
            </>
          )}
        </div>

        <Field label={t("rsFieldSourceUrl")}>
          <input
            value={form.sourceUrl}
            onChange={(event) => patch({ sourceUrl: event.target.value })}
            placeholder={t("rsSourceUrlPlaceholder")}
            className={consoleInputClass}
          />
        </Field>

        <Field label={t("rsFieldContent")} hint={t("rsContentKeepHint")}>
          <textarea
            value={form.content}
            onChange={(event) => patch({ content: event.target.value })}
            placeholder={t("rsContentPlaceholder")}
            className={`${consoleInputClass} min-h-40 resize-y`}
          />
        </Field>

        <div className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700">{t("rsFieldTags")}</span>
          <TagInput
            values={form.tags}
            onChange={(tags) => patch({ tags })}
            placeholder={t("rsTagsPlaceholder")}
            addLabel={t("pdAdd")}
            removeLabel={t("btnDelete")}
          />
        </div>

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
