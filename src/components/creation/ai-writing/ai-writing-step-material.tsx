"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Check, Flame, Package, Pencil, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { apiGet, swrFetcher } from "@/lib/api-client";
import { HOT_TOPICS_ALL, hotTopicPlatforms } from "@/lib/hot-topic-platforms";
import { materialSourceLabelKeys, materialSources, type MaterialSource } from "@/lib/ai-writing";
import { useI18n } from "@/lib/i18n";
import type { ProductRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

export type HotTopicItem = { id: string; title: string; source: string; url: string; hot?: number };

const sourceIcons: Record<MaterialSource, React.ReactNode> = {
  hot: <Flame className="size-3.5" />,
  product: <Package className="size-3.5" />,
  free: <Pencil className="size-3.5" />,
};

function HotNewsPanel({
  selected,
  onChange,
}: {
  selected: HotTopicItem[];
  onChange: (next: HotTopicItem[]) => void;
}) {
  const { t } = useI18n();
  const [platform, setPlatform] = useState<string>(HOT_TOPICS_ALL);
  const [query, setQuery] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  const { data, isValidating, mutate } = useSWR<{ items: HotTopicItem[] }>(
    ["/api/hot-topics", platform, refreshToken],
    () => apiGet<{ items: HotTopicItem[] }>(`/api/hot-topics?platform=${encodeURIComponent(platform)}`),
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const filtered = useMemo(() => {
    const list = data?.items ?? [];
    const keyword = query.trim().toLowerCase();
    return keyword ? list.filter((item) => item.title.toLowerCase().includes(keyword)) : list;
  }, [data, query]);

  const selectedIds = new Set(selected.map((item) => item.id));
  const activePlatform = hotTopicPlatforms.find((entry) => entry.id === platform);

  function toggle(item: HotTopicItem) {
    onChange(selectedIds.has(item.id) ? selected.filter((entry) => entry.id !== item.id) : [...selected, item]);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setPlatform(HOT_TOPICS_ALL)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition",
            platform === HOT_TOPICS_ALL
              ? "border-sky-300 bg-sky-50 text-sky-700"
              : "border-sky-100 bg-white text-zinc-500 hover:bg-sky-50",
          )}
        >
          {t("awAllSources")}
        </button>
        {hotTopicPlatforms.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setPlatform(entry.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              platform === entry.id
                ? "border-sky-300 bg-sky-50 text-sky-700"
                : "border-sky-100 bg-white text-zinc-500 hover:bg-sky-50",
              !entry.available && "opacity-50",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-sky-100 bg-sky-50/40 p-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Search className="size-4 shrink-0 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("awSearchHint")}
            className={cn(consoleInputClass, "h-9 min-h-9 border-transparent bg-white")}
          />
        </div>
        <span className="shrink-0 text-xs text-zinc-400">{t("awSelectedCount", { count: selected.length })}</span>
        {selected.length ? (
          <button type="button" onClick={() => onChange([])} className="shrink-0 text-xs text-sky-600 hover:underline">
            {t("awClearSelection")}
          </button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setRefreshToken((token) => token + 1);
            void mutate();
          }}
          loading={isValidating}
        >
          <RefreshCw size={14} />
          {t("awRefresh")}
        </Button>
      </div>
      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-14 text-center text-sm text-zinc-500">
          {activePlatform && !activePlatform.available ? t("awPlatformUnavailable") : t("awHotEmpty")}
        </p>
      ) : (
        <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1 md:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => {
            const isSelected = selectedIds.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggle(item)}
                className={cn(
                  "flex items-start gap-2 rounded-xl border px-3 py-2 text-left text-sm transition",
                  isSelected ? "border-sky-300 bg-sky-50/70" : "border-sky-100 bg-white hover:bg-sky-50/40",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-4 shrink-0 place-items-center rounded border",
                    isSelected ? "border-sky-500 bg-sky-500 text-white" : "border-zinc-300 bg-white",
                  )}
                >
                  {isSelected ? <Check className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 leading-5 text-zinc-700">{item.title}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-zinc-400">{item.source}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProductPanel({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useI18n();
  const { data: products = [], isLoading } = useSWR<ProductRecord[]>("/api/products", swrFetcher);
  const chosen = new Set(selectedIds);

  if (isLoading) {
    return <p className="px-4 py-10 text-center text-sm text-zinc-500">{t("loading")}</p>;
  }
  if (!products.length) {
    return (
      <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-14 text-center text-sm text-zinc-500">
        {t("awProductEmpty")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">{t("awProductSelectHint")}</p>
      <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1 md:grid-cols-3 xl:grid-cols-4">
        {products.map((product) => {
          const isSelected = chosen.has(product.id);
          return (
            <button
              key={product.id}
              type="button"
              onClick={() =>
                onChange(isSelected ? selectedIds.filter((id) => id !== product.id) : [...selectedIds, product.id])
              }
              className={cn(
                "flex items-start gap-2 rounded-xl border px-3 py-2 text-left transition",
                isSelected ? "border-sky-300 bg-sky-50/70" : "border-sky-100 bg-white hover:bg-sky-50/40",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-4 shrink-0 place-items-center rounded border",
                  isSelected ? "border-sky-500 bg-sky-500 text-white" : "border-zinc-300 bg-white",
                )}
              >
                {isSelected ? <Check className="size-3" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 text-sm text-zinc-800">{product.name}</span>
                <span className="mt-0.5 block truncate text-[10px] text-zinc-400">
                  {[product.brand, product.category].filter(Boolean).join(" · ") || t("awProductNoMeta")}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AiWritingStepMaterial({
  source,
  onSourceChange,
  topics,
  onTopicsChange,
  productIds,
  onProductIdsChange,
  freeText,
  onFreeTextChange,
}: {
  source: MaterialSource;
  onSourceChange: (next: MaterialSource) => void;
  topics: HotTopicItem[];
  onTopicsChange: (next: HotTopicItem[]) => void;
  productIds: string[];
  onProductIdsChange: (next: string[]) => void;
  freeText: string;
  onFreeTextChange: (next: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 border-b border-sky-100">
        {materialSources.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => onSourceChange(entry)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2.5 text-sm font-medium transition",
              source === entry ? "border-sky-500 text-sky-700" : "border-transparent text-zinc-500 hover:text-zinc-800",
            )}
          >
            {sourceIcons[entry]}
            {t(materialSourceLabelKeys[entry])}
          </button>
        ))}
      </div>

      {source === "hot" ? <HotNewsPanel selected={topics} onChange={onTopicsChange} /> : null}
      {source === "product" ? <ProductPanel selectedIds={productIds} onChange={onProductIdsChange} /> : null}
      {source === "free" ? (
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("awFreeLabel")}</span>
          <textarea
            value={freeText}
            onChange={(event) => onFreeTextChange(event.target.value)}
            placeholder={t("awFreePlaceholder")}
            className={`${consoleInputClass} min-h-40 resize-none`}
          />
        </label>
      ) : null}
    </div>
  );
}
