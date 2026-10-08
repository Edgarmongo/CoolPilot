"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiDelete, apiPatch, apiPost, type ApiResponse } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { productImageFileName, productImageUrl } from "@/lib/products";
import type { ProductRecord } from "@/lib/types";
import { Field, TagInput } from "../smart-config/positioning-fields";

type FormState = {
  name: string;
  brand: string;
  category: string;
  keywords: string[];
  linkUrl: string;
  description: string;
  imagePath: string;
};

const emptyForm: FormState = {
  name: "",
  brand: "",
  category: "",
  keywords: [],
  linkUrl: "",
  description: "",
  imagePath: "",
};

async function uploadImage(file: File) {
  const formData = new FormData();
  formData.set("file", file);
  const response = await fetch("/api/products/image", { method: "POST", body: formData });
  const json = (await response.json()) as ApiResponse<{ imagePath: string; imageUrl: string }>;
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

export function ProductFormDialog({
  open,
  onClose,
  onSaved,
  product,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  product: ProductRecord | null;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const next: FormState = product
      ? {
          name: product.name,
          brand: product.brand,
          category: product.category,
          keywords: product.keywords,
          linkUrl: product.linkUrl,
          description: product.description,
          imagePath: product.imagePath,
        }
      : emptyForm;
    const preview = product?.imagePath ? productImageUrl(product.imagePath, product.updatedAt) : "";
    window.queueMicrotask(() => {
      setForm(next);
      setPreviewUrl(preview);
      setError("");
    });
  }, [open, product]);

  function patch(next: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  async function handlePick(file?: File) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const result = await uploadImage(file);
      patch({ imagePath: result.imagePath });
      setPreviewUrl(`${result.imageUrl}&v=${Date.now()}`);
    } catch {
      setError(t("pdUploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  function removeImage() {
    patch({ imagePath: "" });
    setPreviewUrl("");
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, name: form.name.trim() };
      if (product) await apiPatch(`/api/products/${product.id}`, payload);
      else await apiPost("/api/products", payload);
      // Clean up the previous file when the image was replaced or removed.
      if (product?.imagePath && product.imagePath !== form.imagePath) {
        await apiDelete(`/api/products/image?file=${encodeURIComponent(productImageFileName(product.imagePath))}`).catch(
          () => undefined,
        );
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={product ? t("btnEdit") : t("pdNew")} maxWidth="md">
      <div className="grid gap-4">
        <Field label={t("pdFieldName")} hint={t("pdRequired")}>
          <input
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder={t("pdNamePlaceholder")}
            className={consoleInputClass}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("pdFieldBrand")}>
            <input
              value={form.brand}
              onChange={(event) => patch({ brand: event.target.value })}
              placeholder={t("pdBrandPlaceholder")}
              className={consoleInputClass}
            />
          </Field>
          <Field label={t("pdFieldCategory")}>
            <input
              value={form.category}
              onChange={(event) => patch({ category: event.target.value })}
              placeholder={t("pdCategoryPlaceholder")}
              className={consoleInputClass}
            />
          </Field>
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700">{t("pdFieldKeywords")}</span>
          <TagInput
            values={form.keywords}
            onChange={(keywords) => patch({ keywords })}
            placeholder={t("pdKeywordsPlaceholder")}
            addLabel={t("pdAdd")}
            removeLabel={t("btnDelete")}
          />
        </div>

        <Field label={t("pdFieldLink")}>
          <input
            value={form.linkUrl}
            onChange={(event) => patch({ linkUrl: event.target.value })}
            placeholder={t("pdLinkPlaceholder")}
            className={consoleInputClass}
          />
        </Field>

        <Field label={t("pdFieldDescription")}>
          <textarea
            value={form.description}
            onChange={(event) => patch({ description: event.target.value })}
            placeholder={t("pdDescriptionPlaceholder")}
            className={`${consoleInputClass} min-h-24 resize-none`}
          />
        </Field>

        <div className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700">{t("pdFieldImage")}</span>
          <div className="flex items-center gap-3">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={t("pdFieldImage")} className="size-24 rounded-2xl border border-sky-100 object-cover" />
            ) : null}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="grid size-24 place-items-center gap-1 rounded-2xl border border-dashed border-sky-200 bg-sky-50/40 text-sky-600 transition hover:bg-sky-50"
            >
              {uploading ? (
                <span className="text-xs">{t("pdUploading")}</span>
              ) : (
                <>
                  <Plus className="size-5" />
                  <span className="text-xs font-medium">{t("pdUpload")}</span>
                </>
              )}
            </button>
            {previewUrl ? (
              <button
                type="button"
                onClick={removeImage}
                className="grid size-8 place-items-center rounded-full border border-rose-100 bg-rose-50 text-rose-500 transition hover:bg-rose-100"
                aria-label={t("pdRemoveImage")}
              >
                <X className="size-4" />
              </button>
            ) : (
              <ImagePlus className="size-4 text-zinc-300" aria-hidden />
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(event) => void handlePick(event.target.files?.[0])}
            />
          </div>
          <span className="text-xs text-zinc-400">{t("pdImageHint")}</span>
        </div>

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            {t("btnCancel")}
          </Button>
          <Button onClick={() => void handleSave()} loading={saving} disabled={!form.name.trim() || uploading}>
            {t("btnSave")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
