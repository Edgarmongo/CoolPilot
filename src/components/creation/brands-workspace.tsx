"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Inbox, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiDelete, swrFetcher } from "@/lib/api-client";
import { brandMatchesQuery } from "@/lib/brands";
import { useI18n } from "@/lib/i18n";
import { localizedPath, type Locale } from "@/lib/i18n-config";
import type { BrandRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BrandFormDialog } from "./brand-form-dialog";

/**
 * 品牌资料管理 (CI-P2-02 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The workspace is the brand library: create, edit, search and delete, which is P2-02-02's 新增/编辑/
 * 查询; 选择 happens one screen over, in the AI writing wizard's config step, because that is where a
 * brand becomes an explicit generation input (P2-02-03). It follows `TopicsWorkspace`'s shape,
 * including the client-side search over the list the API answers: brands are small, the filter belongs
 * to the screen, and the route stays one table read.
 *
 * This table is not the console's single `app_settings["brand"]` (logo, colors, agent prompt): that
 * one is one record for the whole app, while P2-02-05 needs several selectable ones that must not be
 * mixed up. See appendix B-6 in the integration plan.
 */

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/** A cell that lists several short values, or says "none" without pretending they are there. */
function ChipList({ values }: { values: string[] }) {
  if (!values.length) return <span className="text-zinc-300">-</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((value) => (
        <span key={value} className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700 ring-1 ring-sky-100">
          {value}
        </span>
      ))}
    </span>
  );
}

/**
 * The list itself, split out so the workspace below reads as state and the row markup lives in one
 * place. Every action a brand offers is one of the two the card asks for - edit and delete - plus the
 * link into the wizard, where a brand is selected for a generation.
 */
function BrandsTable({
  brands,
  locale,
  onEdit,
  onDelete,
}: {
  brands: BrandRecord[];
  locale: Locale;
  onEdit: (brand: BrandRecord) => void;
  onDelete: (brand: BrandRecord) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="overflow-x-auto rounded-2xl border border-sky-100 bg-white">
      <table className="w-full min-w-[1040px] text-left text-sm">
        <thead className="bg-sky-50/60 text-xs text-zinc-500">
          <tr>
            <th className="px-4 py-3 font-medium">{t("bdColumnBrand")}</th>
            <th className="px-3 py-3 font-medium">{t("bdColumnAudience")}</th>
            <th className="px-3 py-3 font-medium">{t("bdColumnTone")}</th>
            <th className="px-3 py-3 font-medium">{t("bdColumnKeywords")}</th>
            <th className="px-3 py-3 font-medium">{t("bdColumnBanned")}</th>
            <th className="px-3 py-3 font-medium">{t("bdColumnUpdated")}</th>
            <th className="px-3 py-3 text-right font-medium">{t("bdColumnActions")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sky-50">
          {brands.map((brand) => (
            <tr key={brand.id} className="align-top transition hover:bg-sky-50/40">
              <td className="max-w-[260px] px-4 py-3">
                <span className="block font-medium text-zinc-900">{brand.name}</span>
                {brand.description ? (
                  <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-400">{brand.description}</span>
                ) : null}
              </td>
              <td className="max-w-[220px] px-3 py-3 text-zinc-600">
                {brand.targetAudience || <span className="text-zinc-300">-</span>}
              </td>
              <td className="max-w-[220px] px-3 py-3 text-zinc-600">
                {brand.tone || <span className="text-zinc-300">-</span>}
              </td>
              <td className="max-w-[220px] px-3 py-3">
                <ChipList values={brand.keywords} />
              </td>
              <td className="max-w-[220px] px-3 py-3">
                <ChipList values={brand.bannedWords} />
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-400">{formatDateTime(brand.updatedAt)}</td>
              <td className="whitespace-nowrap px-3 py-3">
                <div className="flex items-center justify-end gap-1">
                  <Link
                    href={localizedPath(locale, "/creation/ai-writing")}
                    title={t("awBrandManage")}
                    className="rounded-lg p-1.5 text-violet-600 transition hover:bg-violet-50"
                  >
                    <Sparkles className="size-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => onEdit(brand)}
                    title={t("btnEdit")}
                    className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(brand)}
                    title={t("btnDelete")}
                    className="rounded-lg p-1.5 text-rose-500 transition hover:bg-rose-50"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 品牌资料 workspace: the list, its filter and the two dialogs (form + delete confirmation). The
 * wizard reads the same collection through `GET /api/brands`, so a brand created here is selectable
 * there without a second registration step.
 */
export function BrandsWorkspace() {
  const { t, locale } = useI18n();
  const { data: brands = [], mutate, isLoading } = useSWR<BrandRecord[]>("/api/brands", swrFetcher);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BrandRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrandRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => brands.filter((brand) => brandMatchesQuery(brand, query)), [brands, query]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(brand: BrandRecord) {
    setEditing(brand);
    setDialogOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/brands/${deleteTarget.id}`);
      setDeleteTarget(null);
      await mutate();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("bdSearchPlaceholder")}
          className={cn(consoleInputClass, "w-72")}
        />
        <Button size="sm" className="ml-auto" onClick={openCreate}>
          <Plus size={14} />
          {t("bdNew")}
        </Button>
      </div>

      <p className="text-xs text-zinc-400">
        {t("awBrandHint")}{" "}
        <Link href={localizedPath(locale, "/creation/ai-writing")} className="text-sky-600 hover:underline">
          {t("navAiWriting")}
        </Link>
      </p>

      {isLoading ? (
        <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">
          {t("loading")}
        </p>
      ) : filtered.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-sky-100 bg-white px-4 py-20 text-center">
          <Inbox className="size-10 text-zinc-300" />
          <p className="text-sm text-zinc-500">{t("bdEmpty")}</p>
        </div>
      ) : (
        <BrandsTable brands={filtered} locale={locale} onEdit={openEdit} onDelete={setDeleteTarget} />
      )}

      <span className="block text-xs text-zinc-400">{t("kbTotal", { count: filtered.length })}</span>

      <BrandFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void mutate()}
        brand={editing}
      />

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t("bdColumnBrand")}
        maxWidth="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">{t("bdDeleteConfirm", { name: deleteTarget?.name ?? "" })}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("btnCancel")}
            </Button>
            <Button variant="danger" onClick={() => void handleDelete()} loading={deleting}>
              {t("btnDelete")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

