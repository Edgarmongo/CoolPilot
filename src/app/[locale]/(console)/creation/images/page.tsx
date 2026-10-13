"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Image as ImageIcon, Images, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { apiDelete, apiErrorTranslationKey, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { ConsoleCard, ConsoleSectionHeader, consoleInputClass } from "@/components/ui/console-surface";
import { ConsolePagination, useClampConsolePage, usePagedItems } from "@/components/ui/console-pagination";
import { EstimateSummary } from "@/components/cost-center/estimate-summary";
import {
  budgetDecisionLabelKeys,
  budgetDecisionToneClass,
  estimateRequestFor,
  type EstimatePreviewAnswer,
} from "@/components/cost-center/estimate-view";
import { ImageSourcePicker } from "@/components/creation/image-source-picker";
import { cn } from "@/lib/utils";

type ImageItem = { fileName: string; url: string };
type SearchMode = "fuzzy" | "exact";

export default function ImagesPage() {
  const { t } = useI18n();
  const { data, mutate } = useSWR<{ images: ImageItem[] }>("/api/images", swrFetcher);
  const images = useMemo(() => data?.images ?? [], [data]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("fuzzy");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  /**
   * 生成前预估（CI-P7-03-D2）。
   *
   * `POST /api/images` 每次只出一张图（`generateImageFile` 里写死的 `quantity: 1`），所以这里估的就是
   * 一张：数量不来自输入框，而是这条路径本身的事实——把数量做成可填的，就等于让屏幕估一件不会发生的
   * 事。提示词也不发送：按张计价跟提示词长度无关，而预估接口本来就会把发过去的文本丢掉。
   *
   * 服务端用的是调用自身那次检查的同一份价格目录 / 预算设置 / 账本，所以目录里没有这个维度的价格时它
   * 会明确说「未计价」，而不是给一个 0。只读：不占额度、不写账本。用 SWR 只是照这个仓库取数的老规矩
   * （失败可见、回到页面重取），价格应当在按「生成」之前就看得见，而不是点一下才知道。
   */
  const {
    data: estimate,
    error: estimateError,
    isValidating: estimating,
    mutate: refreshEstimate,
  } = useSWR<EstimatePreviewAnswer>(["/api/ai-cost-center/estimate", "image"], () =>
    apiPost<EstimatePreviewAnswer>(
      "/api/ai-cost-center/estimate",
      estimateRequestFor({ meteredKind: "image", quantity: "1" }),
    ),
  );

  // Fuzzy matches part of the name, exact matches the whole name.
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return images;
    return images.filter((image) =>
      mode === "exact"
        ? image.fileName.toLowerCase() === keyword
        : image.fileName.toLowerCase().includes(keyword),
    );
  }, [images, mode, query]);
  const { pageItems, safePage } = usePagedItems(filtered, page);
  useClampConsolePage(page, filtered.length, setPage);

  const selectedSet = useMemo(() => new Set(selectedNames), [selectedNames]);
  const allOnPageSelected = pageItems.length > 0 && pageItems.every((image) => selectedSet.has(image.fileName));

  function toggleSelected(fileName: string) {
    setSelectedNames((prev) => (prev.includes(fileName) ? prev.filter((name) => name !== fileName) : [...prev, fileName]));
  }

  function toggleAllOnPage() {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const image of pageItems) next.delete(image.fileName);
      } else {
        for (const image of pageItems) next.add(image.fileName);
      }
      return Array.from(next);
    });
  }

  async function handleDelete(fileNames: string[]) {
    if (fileNames.length === 0) return;
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      await apiDelete<{ deleted: string[] }>("/api/images", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileNames }),
      });
      setSelectedNames((prev) => prev.filter((name) => !fileNames.includes(name)));
      await mutate();
      setNotice(t("imageDeleted", { count: fileNames.length }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await apiPost("/api/images", { prompt: prompt.trim() });
      setPrompt("");
      await mutate();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A text-only provider (e.g. DeepSeek) exposes no image models.
      setError(/No image models returned/i.test(message) ? t("imageGenerateNoModel") : message);
    } finally {
      setLoading(false);
    }
  }

  function updateSearch(value: string) {
    setQuery(value);
    setPage(1);
    setNotice("");
    setSelectedNames([]);
  }

  function updateMode(value: SearchMode) {
    setMode(value);
    setPage(1);
    setSelectedNames([]);
  }

  function handlePicked() {
    void mutate();
    setNotice(t("imageSavedToLibrary"));
  }

  return (
    <ConsoleCard>
      <ConsoleSectionHeader icon={<ImageIcon className="h-5 w-5" />} title={t("navImageManagement")} />
      <div className="mt-5 space-y-4">
        {/* Name search — sits above the AI generate prompt. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(event) => updateSearch(event.target.value)}
              placeholder={t("imageSearchPlaceholder")}
              className={cn(consoleInputClass, "pl-9")}
            />
          </div>
          <div className="inline-flex shrink-0 rounded-2xl border border-sky-100 bg-white p-1">
            {(["fuzzy", "exact"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => updateMode(value)}
                className={cn(
                  "rounded-xl px-3 py-1.5 text-xs font-medium transition",
                  mode === value ? "bg-sky-500 text-white" : "text-zinc-500 hover:text-zinc-800",
                )}
              >
                {value === "fuzzy" ? t("imageSearchFuzzy") : t("imageSearchExact")}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-zinc-400">{t("imageSearchHint")}</p>

        <div className="flex gap-2">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleGenerate();
              }
            }}
            placeholder={t("imagePromptPlaceholder")}
            className={consoleInputClass}
          />
          <Button onClick={() => void handleGenerate()} loading={loading}>
            <Sparkles size={16} />
            {t("imageGenerate")}
          </Button>
        </div>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        {/* 生成前预估（CI-P7-03-D2）：与真正拒绝调用的那次检查用的是同一份目录 / 预算 / 账本，只读。
            没有价格时这里说的是「目录里没有这个维度的价格」，不是 0——「未计价」不等于「免费」。 */}
        <div className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-800">{t("imageEstimateTitle")}</p>
            <Button variant="ghost" size="sm" loading={estimating} onClick={() => void refreshEstimate()}>
              <RefreshCw className="size-4" aria-hidden />
              {t("imageEstimateRefresh")}
            </Button>
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">{t("imageEstimateHint")}</p>

          {estimateError ? (
            <p className="mt-3 text-sm text-rose-600">
              {t(apiErrorTranslationKey(estimateError, "imageEstimateFailed"))}
            </p>
          ) : null}

          {estimate ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs leading-5 text-zinc-500">
                {estimate.target.routeResolved
                  ? t("budgetEstimateTarget", {
                      provider: estimate.target.providerId || "?",
                      model: estimate.target.modelId || "?",
                    })
                  : t("budgetEstimateTargetUnresolved", {
                      provider: estimate.target.providerId || "?",
                      model: estimate.target.modelId || "?",
                    })}
              </p>

              {/* 金额、它乘在哪条基价上、以及服务端附上的每一条保留意见。 */}
              <EstimateSummary estimate={estimate.estimate} />

              <p
                className={`rounded-2xl border px-3 py-2 text-xs leading-5 ${budgetDecisionToneClass[estimate.decision.status]}`}
              >
                {t("imageEstimateVerdict", { verdict: t(budgetDecisionLabelKeys[estimate.decision.status]) })}
              </p>

              {/* 被拒时说明下一步能做什么：真正决定的是发送时那次检查。 */}
              {estimate.decision.status === "blocked" ? (
                <p className="text-xs leading-5 text-zinc-500">{t("imageEstimateBlockedHint")}</p>
              ) : null}

              {/* 目录里没有这一维度的价格时给出去处，而不是让「说不出来」自己站着。 */}
              {estimate.estimate.kind === "unpriced" ? (
                <p className="text-xs leading-5 text-zinc-500">{t("imageEstimatePriceHint")}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* 在线搜索 + 本地上传：与文章「插入图片」弹窗一致 */}
        <div className="rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-800">
            <Images size={16} className="text-sky-500" />
            {t("imageAddTitle")}
          </p>
          <ImageSourcePicker showLibrary={false} onPicked={handlePicked} />
        </div>

        {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}

        {filtered.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">
            {images.length === 0 ? t("emptyImages") : t("imageSearchEmpty")}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-zinc-500">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleAllOnPage}
                  aria-label={t("imageSelectAll")}
                  className="size-4"
                />
                {t("imageSelectAll")}
              </label>
              <span className="text-xs text-zinc-400">{t("imageLibraryCount", { count: filtered.length })}</span>
            </div>

            {selectedNames.length > 0 ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-2 text-sm text-sky-800">
                <span>{t("imageSelectedCount", { count: selectedNames.length })}</span>
                <Button variant="danger" size="sm" loading={deleting} onClick={() => void handleDelete(selectedNames)}>
                  <Trash2 size={14} />
                  {t("imageDeleteSelected")}
                </Button>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {pageItems.map((img) => {
                const isSelected = selectedSet.has(img.fileName);
                return (
                  <figure
                    key={img.fileName}
                    className={cn(
                      "w-36 shrink-0 overflow-hidden rounded-2xl border bg-white transition",
                      isSelected ? "border-sky-400 ring-2 ring-sky-200" : "border-sky-100",
                    )}
                  >
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelected(img.fileName)}
                        aria-label={img.fileName}
                        className="absolute left-1.5 top-1.5 z-10 size-4 cursor-pointer"
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt={img.fileName} className="aspect-square w-full object-cover" />
                    </div>
                    <figcaption className="truncate px-2 py-1 text-[11px] text-zinc-400" title={img.fileName}>
                      {img.fileName}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
            <ConsolePagination
              page={safePage}
              totalItems={filtered.length}
              onPageChange={setPage}
              ariaLabel={t("paginationLabel")}
              previousLabel={t("paginationPrevious")}
              nextLabel={t("paginationNext")}
            />
          </>
        )}
      </div>
    </ConsoleCard>
  );
}
