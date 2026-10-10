"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Check, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { apiPost, swrFetcher, ApiClientError, apiErrorTranslationKey } from "@/lib/api-client";
import { resolveArtifactImageSrc } from "@/lib/artifact-image-url";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import type { PublishSiteResult } from "@/lib/publish";
import { reportedPublishResults } from "@/lib/publish-groups";
import { summarizePublishResults, type PublishRunSummary } from "@/lib/publish-results";
import type { ContentItem, AccountRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

type ImageLibraryEntry = { fileName: string; url: string };

const publishStatusKey: Record<PublishSiteResult["status"], TranslationKey> = {
  published: "publishResultPublished",
  drafted: "publishResultDrafted",
  login_required: "publishResultLoginRequired",
  unsupported: "publishResultUnsupported",
  failed: "publishResultFailed",
};

/** The run notice is not a boolean: a batch can half-succeed, and the banner has to say which. */
const noticeToneClass: Record<"success" | "warning" | "error", string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-rose-200 bg-rose-50 text-rose-800",
};

/** Maximum number of characters allowed in the post body. */
const CONTENT_MAX_LENGTH = 1000;

/** Composer behind the 动态发布 (post publishing) screen. */
export function PostsComposer() {
  const { t } = useI18n();
  const { data: accounts = [] } = useSWR<AccountRecord[]>("/api/accounts", swrFetcher);
  const { data: imageData } = useSWR<{ images: ImageLibraryEntry[] }>("/api/images", swrFetcher);
  const library = imageData?.images ?? [];

  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "warning" | "error">("success");
  const [error, setError] = useState("");
  const [results, setResults] = useState<PublishSiteResult[] | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // Grow the content box downward as the text gets longer.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [content]);

  const grouped = useMemo(() => {
    const map = new Map<string, AccountRecord[]>();
    for (const site of accounts) {
      const list = map.get(site.platform) ?? [];
      list.push(site);
      map.set(site.platform, list);
    }
    return [...map.entries()];
  }, [accounts]);

  function toggleSite(accountId: string) {
    setSelectedAccountIds((prev) => (prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]));
  }

  function toggleImage(fileName: string) {
    setImages((prev) => (prev.includes(fileName) ? prev.filter((entry) => entry !== fileName) : [...prev, fileName].slice(0, 9)));
  }

  /**
   * The banner names which of the three things happened. "Publish task submitted" is only true when
   * every account delivered; the other two say what is left to do - check the records before retrying
   * - so a batch that half succeeded can never read as a success (A2 of the card).
   */
  function showNotice(summary: PublishRunSummary) {
    if (summary.outcome === "succeeded") {
      setNotice(t("pcPublished"));
      setNoticeTone("success");
      return;
    }
    if (summary.outcome === "partial") {
      setNotice(t("pcPublishPartial", { count: summary.delivered, failed: summary.requested - summary.delivered }));
      setNoticeTone("warning");
      return;
    }
    setNotice(t("pcPublishAllFailed", { failed: summary.requested - summary.delivered }));
    setNoticeTone("error");
  }

  /** `error_<CODE>` when the API named a code, the raw message otherwise. */
  function describeError(err: unknown) {
    if (err instanceof ApiClientError && err.code) return t(apiErrorTranslationKey(err, "unknownError"));
    return err instanceof Error ? err.message : t("unknownError");
  }

  async function handlePublish() {
    if (!content.trim()) {
      setError(t("pcNeedContent"));
      return;
    }
    setPublishing(true);
    setError("");
    setResults(null);
    try {
      const item = await apiPost<ContentItem>("/api/content", {
        title: title.trim() || content.trim().slice(0, 9),
        body: content,
        postReadyText: content,
        type: "post",
        images,
      });
      const data = await apiPost<{ results: PublishSiteResult[]; summary?: PublishRunSummary }>("/api/publish", {
        accountIds: selectedAccountIds,
        title: item.title,
        text: content,
        imagePath: images[0] ?? "",
        publish: true,
        contentType: "post",
        method: "manual",
        terminal: "local",
        contentItemId: item.id,
      });
      setResults(data.results);
      // Prefer the server's verdict; a server older than this field is still handled correctly,
      // because the same rule can be applied here to the `results` it did send.
      const summary = data.summary ?? summarizePublishResults(data.results);
      showNotice(summary);
      // Nothing was submitted unless every account delivered, so 已提交发布任务 would be exactly the
      // lie this card fixes - and the form below is deliberately left filled: retyping the post is not
      // a fair price for a run that half succeeded or failed.
      if (summary.outcome === "succeeded") {
        setContent("");
        setTitle("");
        setImages([]);
        setSelectedAccountIds([]);
      }
    } catch (err) {
      // 5b: a batch the server could not finish still hands back what it did manage to evaluate, and
      // dropping that would hide accounts the platform may already have taken. The panel gets the
      // server's own results, and the banner is the verdict those results add up to.
      const reported = reportedPublishResults(err);
      if (reported) {
        setResults(reported);
        showNotice(summarizePublishResults(reported));
      }
      setError(describeError(err));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <div className={cn("rounded-2xl border px-4 py-2 text-sm", noticeToneClass[noticeTone])}>{notice}</div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-2xl border border-sky-100 bg-white p-4">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="font-medium text-zinc-900">{t("pcContentTitle")}</span>
            <span
              className={cn(
                "text-xs tabular-nums",
                content.length >= CONTENT_MAX_LENGTH ? "text-rose-500" : "text-zinc-400",
              )}
            >
              {content.length}/{CONTENT_MAX_LENGTH}
            </span>
          </div>
          <textarea
            ref={contentRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t("pcContentPlaceholder")}
            maxLength={CONTENT_MAX_LENGTH}
            className="min-h-40 w-full resize-none overflow-hidden rounded-xl border border-sky-100 px-3 py-2 text-sm leading-6 outline-none transition focus:border-sky-400"
          />

          <div className="mt-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600">{t("pcTitleLabel")}</span>
              <span className="text-xs tabular-nums text-zinc-400">{title.length}/9</span>
            </div>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={9}
              className="mt-1 h-9 w-full rounded-xl border border-sky-100 px-3 text-sm outline-none transition focus:border-sky-400"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {images.map((fileName) => (
              <button
                key={fileName}
                type="button"
                onClick={() => toggleImage(fileName)}
                title={t("pcRemoveImage")}
                className="size-20 overflow-hidden rounded-xl border border-sky-100"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={resolveArtifactImageSrc(fileName)} alt="" className="size-20 object-cover" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="grid size-20 place-items-center gap-1 rounded-xl border border-dashed border-sky-200 text-xs text-zinc-500 transition hover:border-sky-400 hover:text-sky-600"
            >
              <Plus className="size-4" />
              {t("pcAddImage")}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-sky-100 bg-white p-4 lg:self-start">
          <p className="mb-3 font-medium text-zinc-900">{t("pcAccountsTitle")}</p>
          {accounts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-sky-100 px-4 py-10 text-center text-sm text-zinc-500">
              {t("publishEmptyAccounts")}
            </p>
          ) : (
            <div className="max-h-80 space-y-3 overflow-y-auto">
              {grouped.map(([platform, list]) => (
                <div key={platform}>
                  <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-zinc-700">
                    <span className="grid size-5 place-items-center rounded-md bg-sky-100 text-[10px] text-sky-700">
                      {platform.slice(0, 1).toUpperCase()}
                    </span>
                    {platform}
                  </p>
                  <div className="space-y-1 pl-3">
                    {list.map((site) => (
                      <label
                        key={site.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-sky-50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAccountIds.includes(site.id)}
                          onChange={() => toggleSite(site.id)}
                          className="size-4"
                        />
                        <span className="min-w-0 flex-1 truncate text-zinc-700">{site.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-zinc-400">{t("pcSelectedAccounts", { count: selectedAccountIds.length })}</p>
          <Button
            className="mt-3 w-full"
            loading={publishing}
            disabled={!content.trim() || selectedAccountIds.length === 0}
            onClick={() => void handlePublish()}
          >
            <Send size={16} />
            {t("pcPublishNow")}
          </Button>
        </section>
      </div>

      {results ? (
        <div className="space-y-2">
          {results.map((result) => (
            <div
              key={result.accountId}
              className="flex items-center justify-between gap-3 rounded-xl border border-sky-100 bg-white px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900">{result.accountName || result.accountId}</p>
                {result.error ? <p className="text-xs text-rose-600">{result.error}</p> : null}
              </div>
              <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                {t(publishStatusKey[result.status])}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}

      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} title={t("pcImagePickerTitle")} maxWidth="lg">
        {library.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-10 text-center text-sm text-zinc-500">
            {t("emptyImages")}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid max-h-80 grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
              {library.map((image) => {
                const selected = images.includes(image.fileName);
                return (
                  <button
                    key={image.fileName}
                    type="button"
                    onClick={() => toggleImage(image.fileName)}
                    className={cn(
                      "relative overflow-hidden rounded-xl border-2 transition",
                      selected ? "border-sky-500" : "border-transparent hover:border-sky-200",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.url} alt={image.fileName} className="aspect-square w-full object-cover" />
                    {selected ? (
                      <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-sky-500 text-white">
                        <Check className="size-3" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">
                {t("imageSelectHint")} {images.length}
              </span>
              <Button onClick={() => setPickerOpen(false)}>{t("pcDone")}</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
