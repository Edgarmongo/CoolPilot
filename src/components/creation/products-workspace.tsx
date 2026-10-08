"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Image as ImageIcon, Inbox, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { apiDelete, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { productImageUrl, productMatchesQuery } from "@/lib/products";
import type { ProductRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProductFormDialog } from "./product-form-dialog";

type ImageFilter = "all" | "with" | "without";

export function ProductsWorkspace() {
  const { t } = useI18n();
  const { data: products = [], mutate, isLoading } = useSWR<ProductRecord[]>("/api/products", swrFetcher);
  const [query, setQuery] = useState("");
  const [imageFilter, setImageFilter] = useState<ImageFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRecord | null>(null);

  const filtered = useMemo(
    () =>
      products.filter((product) => {
        if (!productMatchesQuery(product, query)) return false;
        if (imageFilter === "with") return Boolean(product.imagePath);
        if (imageFilter === "without") return !product.imagePath;
        return true;
      }),
    [products, query, imageFilter],
  );

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(product: ProductRecord) {
    setEditing(product);
    setDialogOpen(true);
  }

  async function handleDelete(id: string) {
    await apiDelete(`/api/products/${id}`);
    await mutate();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("pdSearchPlaceholder")}
          className={cn(consoleInputClass, "w-72")}
        />
        <select
          value={imageFilter}
          onChange={(event) => setImageFilter(event.target.value as ImageFilter)}
          className={cn(consoleInputClass, "w-32")}
        >
          <option value="all">{t("pdFilterImage")}</option>
          <option value="with">{t("pdFilterWithImage")}</option>
          <option value="without">{t("pdFilterWithoutImage")}</option>
        </select>
        <Button size="sm" className="ml-auto" onClick={openCreate}>
          <Plus size={14} />
          {t("pdNew")}
        </Button>
      </div>
      {isLoading ? (
        <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">
          {t("loading")}
        </p>
      ) : filtered.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-sky-100 bg-white px-4 py-20 text-center">
          <Inbox className="size-10 text-zinc-300" />
          <p className="text-sm text-zinc-500">{t("pdEmpty")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-sky-100 bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-sky-50/60 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">
                  <span className="inline-flex items-center gap-2">
                    <ImageIcon className="size-3.5" />
                    {t("pdColName")}
                  </span>
                </th>
                <th className="px-3 py-3 font-medium">{t("pdColBrand")}</th>
                <th className="px-3 py-3 font-medium">{t("pdColCategory")}</th>
                <th className="px-3 py-3 font-medium">{t("pdColKeywords")}</th>
                <th className="px-3 py-3 font-medium">{t("pdColLink")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("pdColActions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => (
                <tr key={product.id} className="border-t border-sky-50">
                  <td className="max-w-xs px-4 py-3">
                    <div className="flex items-center gap-3">
                      {product.imagePath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={productImageUrl(product.imagePath, product.updatedAt)}
                          alt={product.name}
                          className="size-9 shrink-0 rounded-xl border border-sky-100 object-cover"
                        />
                      ) : (
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-500">
                          <Package className="size-4" />
                        </span>
                      )}
                      <span className="truncate font-medium text-zinc-900">{product.name}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{product.brand || "-"}</td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {product.category ? (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                        {product.category}
                      </span>
                    ) : (
                      <span className="text-zinc-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {product.keywords.length ? (
                      <div className="flex flex-wrap gap-1">
                        {product.keywords.map((keyword) => (
                          <span key={keyword} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                            {keyword}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-zinc-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {product.linkUrl ? (
                      <a
                        href={product.linkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block max-w-[200px] truncate align-bottom text-sky-600 hover:underline"
                      >
                        {product.linkUrl}
                      </a>
                    ) : (
                      <span className="text-zinc-300">-</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(product)}
                        title={t("btnEdit")}
                        className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(product.id)}
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
      )}
      <ProductFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void mutate()}
        product={editing}
      />
    </div>
  );
}
