"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Check, ChevronDown, Film, Plus, Search, Send, SlidersHorizontal, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConsoleNotice, consoleInputClass } from "@/components/ui/console-surface";
import { platformMeta } from "@/components/account-platform-meta";
import { accountGroupOf } from "@/components/account-group-manager";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import type { PublishSiteResult } from "@/lib/publish";
import type { ContentItem, AccountPlatform, AccountRecord } from "@/lib/types";
import {
  MAX_VIDEO_BYTES,
  VIDEO_DESCRIPTION_MAX_LENGTH,
  VIDEO_FILE_EXTENSIONS,
  VIDEO_TITLE_MAX_LENGTH,
  formatVideoSize,
  isVideoFileName,
  type StoredVideo,
} from "@/lib/video-library";
import { uploadVideoFile } from "@/lib/video-upload";
import { cn } from "@/lib/utils";

type ImageLibraryEntry = { fileName: string; url: string };

/** Which of the three composer tabs is visible. */
type ComposerTab = "content" | "platform" | "review";

/** Where the copy shown on the review tab comes from. */
type VisibilityValue = "" | "public" | "followers" | "private";

/** Per-account overrides configured on the 平台设置 tab. */
type AccountOverride = {
  /** When false the account uses its own server-side preset. */
  useCustom: boolean;
  title: string;
  description: string;
  topics: string;
  visibility: VisibilityValue;
};

const emptyOverride: AccountOverride = {
  useCustom: false,
  title: "",
  description: "",
  topics: "",
  visibility: "",
};

const publishStatusKey: Record<PublishSiteResult["status"], TranslationKey> = {
  published: "publishResultPublished",
  drafted: "publishResultDrafted",
  login_required: "publishResultLoginRequired",
  unsupported: "publishResultUnsupported",
  failed: "publishResultFailed",
};

const publishStatusClass: Record<PublishSiteResult["status"], string> = {
  published: "bg-emerald-100 text-emerald-700",
  drafted: "bg-sky-100 text-sky-700",
  login_required: "bg-amber-100 text-amber-700",
  unsupported: "bg-zinc-100 text-zinc-600",
  failed: "bg-rose-100 text-rose-700",
};

/** What the file picker offers; the server re-validates the real extension. */
const VIDEO_ACCEPT = VIDEO_FILE_EXTENSIONS.join(",");

/** Daily publish allowance mirrored by the reference console. */
const DAILY_PUBLISH_QUOTA = 100;

function coverUrl(fileName: string) {
  return `/api/agent/artifacts?file=${encodeURIComponent(fileName)}`;
}

/** Colored rounded tile standing in for a platform brand mark. */
function PlatformAvatar({ platform, size = "md" }: { platform: AccountPlatform; size?: "sm" | "md" }) {
  const meta = platformMeta[platform];
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-lg font-semibold text-white",
        size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs",
        meta?.colorClass ?? "bg-zinc-500",
      )}
    >
      {meta?.glyph ?? platform.slice(0, 1)}
    </span>
  );
}

/** Composer behind the 视频发布 (video publishing) screen, matching the reference console. */
export function VideosComposer() {
  const { t } = useI18n();
  const { data: accounts = [] } = useSWR<AccountRecord[]>("/api/accounts", swrFetcher);
  const { data: imageData } = useSWR<{ images: ImageLibraryEntry[] }>("/api/images", swrFetcher);

  const library = imageData?.images ?? [];

  const [tab, setTab] = useState<ComposerTab>("content");
  const [video, setVideo] = useState<StoredVideo | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState("");
  const [videoClue, setVideoClue] = useState("");
  const [knowledgeScope, setKnowledgeScope] = useState("");
  const [positionScope, setPositionScope] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, AccountOverride>>({});
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerGroup, setPickerGroup] = useState("");
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<PublishSiteResult[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // Grow the description box downward as the text gets longer.
  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [description]);

  const uploading = uploadPercent > 0;

  const selectedSites = useMemo(
    () => accounts.filter((site) => selectedAccountIds.includes(site.id)),
    [accounts, selectedAccountIds],
  );
  const platformCount = useMemo(() => new Set(selectedSites.map((site) => site.platform)).size, [selectedSites]);
  const accountCount = selectedSites.length;

  /** Selected accounts bucketed by platform, driving the 平台设置 tab. */
  const selectedPlatformGroups = useMemo(() => {
    const map = new Map<AccountPlatform, AccountRecord[]>();
    for (const site of selectedSites) {
      const list = map.get(site.platform) ?? [];
      list.push(site);
      map.set(site.platform, list);
    }
    return [...map.entries()];
  }, [selectedSites]);

  const availableGroups = useMemo(() => {
    const set = new Set<string>();
    for (const site of accounts) {
      const group = accountGroupOf(site);
      if (group) set.add(group);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [accounts]);

  /** Accounts remaining in the picker after the search + group filters. */
  const filteredSites = useMemo(() => {
    const keyword = pickerSearch.trim().toLowerCase();
    return accounts.filter((site) => {
      if (pickerGroup && accountGroupOf(site) !== pickerGroup) return false;
      if (!keyword) return true;
      const aliases = platformMeta[site.platform]?.aliases ?? [];
      return (
        site.name.toLowerCase().includes(keyword) ||
        site.platform.toLowerCase().includes(keyword) ||
        aliases.some((alias) => alias.toLowerCase().includes(keyword))
      );
    });
  }, [accounts, pickerSearch, pickerGroup]);

  const pickerGroups = useMemo(() => {
    const map = new Map<AccountPlatform, AccountRecord[]>();
    for (const site of filteredSites) {
      const list = map.get(site.platform) ?? [];
      list.push(site);
      map.set(site.platform, list);
    }
    return [...map.entries()];
  }, [filteredSites]);

  /** Effective copy submitted for a single account (shared value unless overridden). */
  function effectiveFor(site: AccountRecord) {
    const override = overrides[site.id];
    const custom = Boolean(override?.useCustom);
    return {
      custom,
      title: custom && override && override.title.trim() ? override.title.trim() : title.trim(),
      description: custom && override && override.description.trim() ? override.description : description,
      topics: custom && override ? override.topics : "",
      visibility: (custom && override ? override.visibility : "") as VisibilityValue,
    };
  }

  function visibilityLabel(value: VisibilityValue) {
    switch (value) {
      case "public":
        return t("vcVisibilityPublic");
      case "followers":
        return t("vcVisibilityFollowers");
      case "private":
        return t("vcVisibilityPrivate");
      default:
        return t("vcVisibilityDefault");
    }
  }

  /** Accounts still missing a title; surfaced as 待完善 on the review tab. */
  const pendingCount = selectedSites.filter((site) => effectiveFor(site).title.length === 0).length;

  function toggleSite(accountId: string) {
    setSelectedAccountIds((prev) => (prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]));
  }

  function removeSite(accountId: string) {
    setSelectedAccountIds((prev) => prev.filter((id) => id !== accountId));
  }

  function updateOverride(accountId: string, patch: Partial<AccountOverride>) {
    setOverrides((prev) => ({ ...prev, [accountId]: { ...(prev[accountId] ?? emptyOverride), ...patch } }));
  }

  async function handleVideoFile(file: File | undefined) {
    if (!file) return;
    if (!isVideoFileName(file.name)) {
      setError(t("vcUnsupportedFormat"));
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setError(t("vcTooLarge"));
      return;
    }
    setError("");
    setNotice("");
    setUploadPercent(1);
    try {
      const uploaded = await uploadVideoFile(file, setUploadPercent);
      setVideo(uploaded);
      // Offer the file name as a starting title instead of an empty box.
      setTitle((prev) => prev || uploaded.fileName.replace(/\.[^.]+$/, ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadPercent(0);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function resetComposer() {
    setVideo(null);
    setTitle("");
    setDescription("");
    setCover("");
    setVideoClue("");
    setKnowledgeScope("");
    setPositionScope("");
    setSelectedAccountIds([]);
    setOverrides({});
  }

  function selectAllAvailable() {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      for (const site of filteredSites) next.add(site.id);
      return [...next];
    });
  }

  async function handlePublish() {
    if (!video) {
      setError(t("vcNeedVideo"));
      setTab("content");
      return;
    }
    if (accountCount === 0) {
      setError(t("vcNeedAccounts"));
      setAccountPickerOpen(true);
      return;
    }

    // Group accounts by the exact copy they will receive, so per-account overrides are
    // respected while the shared case still publishes in a single request.
    const groups = new Map<string, { title: string; text: string; accountIds: string[] }>();
    for (const site of selectedSites) {
      const effective = effectiveFor(site);
      const key = `${effective.title}\u0000${effective.description}`;
      const group = groups.get(key) ?? { title: effective.title, text: effective.description, accountIds: [] };
      group.accountIds.push(site.id);
      groups.set(key, group);
    }
    if ([...groups.values()].some((group) => group.title.length === 0)) {
      setError(t("vcNeedTitle"));
      setTab("content");
      return;
    }

    setPublishing(true);
    setError("");
    setNotice("");
    setResults(null);
    try {
      const item = await apiPost<ContentItem>("/api/content", {
        title: title.trim() || video.fileName,
        body: description,
        postReadyText: description,
        type: "video",
        images: cover ? [cover] : [],
        videoPath: video.fileName,
      });
      const collected: PublishSiteResult[] = [];
      for (const group of groups.values()) {
        const data = await apiPost<{ results: PublishSiteResult[] }>("/api/publish", {
          accountIds: group.accountIds,
          title: group.title,
          text: group.text,
          imagePath: cover,
          videoPath: video.fileName,
          publish: true,
          contentType: "video",
          method: "manual",
          terminal: "local",
          contentItemId: item.id,
        });
        collected.push(...data.results);
      }
      setResults(collected);
      setNotice(t("vcPublished"));
      resetComposer();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  }

  const tabs: Array<{ id: ComposerTab; label: string }> = [
    { id: "content", label: t("vcTabContent") },
    { id: "platform", label: t("vcTabPlatform") },
    { id: "review", label: t("vcTabReview") },
  ];

  return (
    <div className="space-y-4">
      {notice ? <ConsoleNotice message={notice} onDismiss={() => setNotice("")} /> : null}
      {error ? <ConsoleNotice message={error} tone="error" onDismiss={() => setError("")} /> : null}

      {/* 发布到 header */}
      <section className="rounded-2xl border border-sky-100 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-zinc-500">{t("vcPublishTo")}</span>
            <span className="font-semibold text-zinc-900">{t("vcPlatformCount", { count: platformCount })}</span>
            <span className="font-semibold text-zinc-900">{t("vcAccountCount", { count: accountCount })}</span>
            <span className="text-xs text-zinc-400">{t("vcHeaderHint")}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAccountPickerOpen(true)}>
            <Plus size={14} />
            {t("vcSelectAccount")}
          </Button>
        </div>
        {accountCount > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {selectedSites.map((site) => (
              <span
                key={site.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50/60 py-0.5 pl-1.5 pr-2 text-xs text-zinc-700"
              >
                <PlatformAvatar platform={site.platform} size="sm" />
                <span className="max-w-[10rem] truncate">{site.name}</span>
                <button
                  type="button"
                  onClick={() => removeSite(site.id)}
                  className="text-zinc-400 transition hover:text-rose-500"
                  aria-label={t("vcClearSelection")}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-sky-100">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition",
              tab === entry.id ? "border-sky-500 text-sky-600" : "border-transparent text-zinc-500 hover:text-zinc-800",
            )}
          >
            {entry.label}
            {entry.id === "review" && pendingCount > 0 ? (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">
                {pendingCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {tab === "content" ? (
            <>
              <div className="space-y-5 rounded-2xl border border-sky-100 bg-white p-4">
                <div>
                  <h3 className="text-base font-semibold text-zinc-900">{t("vcDistributeTitle")}</h3>
                  <p className="mt-0.5 text-xs text-zinc-400">{t("vcDistributeDesc")}</p>
                </div>

                {/* 添加本地视频 */}
                <div className="flex items-center gap-3 rounded-xl border border-sky-100 px-3 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-500">
                    <Film className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-800">{t("vcAddLocalVideo")}</p>
                    <p className="truncate text-xs text-zinc-400">
                      {video ? video.fileName : t("vcVideoFormatHint", { size: formatVideoSize(MAX_VIDEO_BYTES) })}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <Upload size={14} />
                    {video ? t("vcReplaceVideo") : t("vcUploadButton")}
                  </Button>
                </div>

                {/* AI 文案素材与知识库 */}
                <div className="rounded-xl border border-sky-100">
                  <button
                    type="button"
                    onClick={() => setAiOpen((open) => !open)}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                  >
                    <span className="text-sm font-medium text-zinc-800">{t("vcAiMaterial")}</span>
                    <ChevronDown className={cn("size-4 text-zinc-400 transition", aiOpen && "rotate-180")} />
                  </button>
                  {aiOpen ? (
                    <div className="space-y-4 border-t border-sky-100 px-3 py-3">
                      <label className="grid gap-1.5 text-sm">
                        <span className="font-medium text-zinc-700">{t("vcVideoClueLabel")}</span>
                        <textarea
                          value={videoClue}
                          onChange={(event) => setVideoClue(event.target.value)}
                          rows={4}
                          placeholder={t("vcVideoCluePlaceholder")}
                          className={cn(consoleInputClass, "min-h-[96px] resize-none")}
                        />
                      </label>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="grid gap-1.5 text-sm">
                          <span className="font-medium text-zinc-700">{t("vcKnowledgeBaseLabel")}</span>
                          <select
                            value={knowledgeScope}
                            onChange={(event) => setKnowledgeScope(event.target.value)}
                            className={consoleInputClass}
                          >
                            <option value="">{t("vcKnowledgeSceneMatch")}</option>
                          </select>
                        </label>
                        <label className="grid gap-1.5 text-sm">
                          <span className="font-medium text-zinc-700">{t("vcCopyPositionLabel")}</span>
                          <select
                            value={positionScope}
                            onChange={(event) => setPositionScope(event.target.value)}
                            className={consoleInputClass}
                          >
                            <option value="">{t("vcCopyPositionPlaceholder")}</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* 公共标题 */}
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-zinc-700">
                    {t("vcPublicTitle")} <span className="text-rose-500">*</span>
                  </span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value.slice(0, VIDEO_TITLE_MAX_LENGTH))}
                    placeholder={t("vcPublicTitlePlaceholder")}
                    className={consoleInputClass}
                  />
                </label>

                {/* 公共简介 */}
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-zinc-700">{t("vcPublicDescription")}</span>
                  <textarea
                    ref={descriptionRef}
                    value={description}
                    onChange={(event) => setDescription(event.target.value.slice(0, VIDEO_DESCRIPTION_MAX_LENGTH))}
                    placeholder={t("vcPublicDescriptionPlaceholder")}
                    rows={5}
                    className={cn(consoleInputClass, "min-h-[120px] resize-none overflow-hidden")}
                  />
                </label>
                <p className="text-xs text-zinc-400">{t("vcBlankUsesPreset")}</p>
              </div>

              <div className="flex items-start gap-2 rounded-2xl border border-sky-100 bg-white p-4">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-sky-100 text-sky-600">
                  <Check className="size-3" />
                </span>
                <div>
                  <p className="text-sm font-medium text-zinc-800">{t("vcAccountIndependentTitle")}</p>
                  <p className="mt-0.5 text-xs text-zinc-400">{t("vcAccountIndependentDesc")}</p>
                </div>
              </div>
            </>
          ) : null}
          {tab === "platform" ? (
            accountCount === 0 ? (
              <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-sky-100 bg-white px-6 py-20 text-center">
                <span className="grid size-12 place-items-center rounded-2xl bg-sky-50 text-sky-400">
                  <SlidersHorizontal className="size-5" />
                </span>
                <p className="text-sm text-zinc-500">{t("vcPlatformEmptyTitle")}</p>
                <Button variant="outline" size="sm" onClick={() => setAccountPickerOpen(true)}>
                  {t("vcSelectAccount")}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {selectedPlatformGroups.map(([platform, list]) => (
                  <div key={platform} className="space-y-3 rounded-2xl border border-sky-100 bg-white p-4">
                    <div className="flex items-center gap-2">
                      <PlatformAvatar platform={platform} />
                      <span className="text-sm font-semibold text-zinc-900">{platform}</span>
                      <span className="text-xs text-zinc-400">{list.length}</span>
                    </div>
                    {list.map((site) => {
                      const override = overrides[site.id] ?? emptyOverride;
                      return (
                        <div key={site.id} className="space-y-3 rounded-xl border border-sky-100 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-medium text-zinc-800">{site.name}</span>
                            <div className="flex items-center gap-1 rounded-full bg-zinc-100 p-0.5 text-xs">
                              <button
                                type="button"
                                onClick={() => updateOverride(site.id, { useCustom: false })}
                                className={cn(
                                  "rounded-full px-2.5 py-1 transition",
                                  !override.useCustom ? "bg-white font-medium text-sky-600 shadow-sm" : "text-zinc-500",
                                )}
                              >
                                {t("vcUsePreset")}
                              </button>
                              <button
                                type="button"
                                onClick={() => updateOverride(site.id, { useCustom: true })}
                                className={cn(
                                  "rounded-full px-2.5 py-1 transition",
                                  override.useCustom ? "bg-white font-medium text-sky-600 shadow-sm" : "text-zinc-500",
                                )}
                              >
                                {t("vcUseCustom")}
                              </button>
                            </div>
                          </div>
                          {override.useCustom ? (
                            <div className="space-y-3">
                              <label className="grid gap-1.5 text-sm">
                                <span className="text-zinc-600">{t("vcOverrideTitle")}</span>
                                <input
                                  value={override.title}
                                  onChange={(event) => updateOverride(site.id, { title: event.target.value })}
                                  className={consoleInputClass}
                                />
                              </label>
                              <label className="grid gap-1.5 text-sm">
                                <span className="text-zinc-600">{t("vcOverrideDescription")}</span>
                                <textarea
                                  value={override.description}
                                  onChange={(event) => updateOverride(site.id, { description: event.target.value })}
                                  rows={3}
                                  className={cn(consoleInputClass, "resize-none")}
                                />
                              </label>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="grid gap-1.5 text-sm">
                                  <span className="text-zinc-600">{t("vcTopics")}</span>
                                  <input
                                    value={override.topics}
                                    onChange={(event) => updateOverride(site.id, { topics: event.target.value })}
                                    placeholder={t("vcTopicsPlaceholder")}
                                    className={consoleInputClass}
                                  />
                                </label>
                                <label className="grid gap-1.5 text-sm">
                                  <span className="text-zinc-600">{t("vcVisibility")}</span>
                                  <select
                                    value={override.visibility}
                                    onChange={(event) =>
                                      updateOverride(site.id, { visibility: event.target.value as VisibilityValue })
                                    }
                                    className={consoleInputClass}
                                  >
                                    <option value="">{t("vcVisibilityDefault")}</option>
                                    <option value="public">{t("vcVisibilityPublic")}</option>
                                    <option value="followers">{t("vcVisibilityFollowers")}</option>
                                    <option value="private">{t("vcVisibilityPrivate")}</option>
                                  </select>
                                </label>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-zinc-400">{t("vcBlankUsesPreset")}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )
          ) : null}
          {tab === "review" ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-sky-100 bg-white p-4">
                <h3 className="text-base font-semibold text-zinc-900">{t("vcReviewTitle")}</h3>
                <p className="mt-0.5 text-xs text-zinc-400">{t("vcReviewDesc")}</p>
              </div>

              {accountCount === 0 ? (
                <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-sky-100 bg-white px-6 py-16 text-center">
                  <p className="text-sm text-zinc-500">{t("vcPlatformEmptyTitle")}</p>
                  <Button variant="outline" size="sm" onClick={() => setAccountPickerOpen(true)}>
                    {t("vcSelectAccount")}
                  </Button>
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-sky-100 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-sky-50/60 text-xs text-zinc-500">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-medium">{t("vcColAccount")}</th>
                        <th className="px-4 py-2.5 text-left font-medium">{t("vcColSource")}</th>
                        <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">{t("vcColVisibility")}</th>
                        <th className="px-4 py-2.5 text-left font-medium">{t("vcColCheck")}</th>
                        <th className="px-4 py-2.5 text-right font-medium" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sky-50">
                      {selectedSites.map((site) => {
                        const effective = effectiveFor(site);
                        const ready = effective.title.length > 0;
                        return (
                          <tr key={site.id}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <PlatformAvatar platform={site.platform} size="sm" />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-zinc-900">{site.platform}</p>
                                  <p className="truncate text-xs text-zinc-400">{site.name}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-zinc-600">
                              {effective.custom ? t("vcSourceCustom") : t("vcSourcePreset")}
                            </td>
                            <td className="hidden px-4 py-3 text-zinc-600 sm:table-cell">
                              {visibilityLabel(effective.visibility)}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-xs font-medium",
                                  ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
                                )}
                              >
                                {ready ? t("vcCheckReady") : t("vcCheckPending")}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => setTab("platform")}
                                className="text-sm text-sky-600 hover:underline"
                              >
                                {t("vcAdjust")}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-zinc-400">{t("vcReviewNote")}</p>
            </div>
          ) : null}
        </div>

        <aside className="space-y-4">
          {/* 本次视频 */}
          <div className="space-y-3 rounded-2xl border border-sky-100 bg-white p-4">
            <p className="font-medium text-zinc-900">{t("vcThisVideo")}</p>
            {video ? (
              <div className="space-y-2">
                <video src={video.url} controls preload="metadata" className="max-h-44 w-full rounded-xl bg-zinc-950" />
                <p className="truncate text-xs text-zinc-400">
                  {video.fileName} · {formatVideoSize(video.size)}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <Upload size={14} />
                    {t("vcReplaceVideo")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setVideo(null)} disabled={publishing}>
                    <X size={14} />
                    {t("vcRemoveVideo")}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className={cn(
                  "grid w-full place-items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-8 text-center transition",
                  dragging ? "border-sky-400 bg-sky-50" : "border-sky-100 hover:border-sky-300",
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  void handleVideoFile(event.dataTransfer.files[0]);
                }}
              >
                <span className="grid size-10 place-items-center rounded-xl bg-sky-50 text-sky-400">
                  <Upload size={18} />
                </span>
                <span className="text-sm text-zinc-600">{t("vcWaitingVideo")}</span>
                <span className="text-xs text-zinc-400">{t("vcVideoNoUpload")}</span>
              </button>
            )}

            {uploading ? (
              <div className="space-y-1.5">
                <p className="text-xs text-zinc-500">{t("vcUploading", { percent: uploadPercent })}</p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-sky-100">
                  <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${uploadPercent}%` }} />
                </div>
              </div>
            ) : null}

            {/* 封面 */}
            <div className="flex items-center justify-between gap-2 border-t border-sky-50 pt-3">
              <span className="text-xs text-zinc-500">{t("vcCoverLabel")}</span>
              <div className="flex items-center gap-2">
                {cover ? (
                  <button type="button" onClick={() => setCover("")} className="text-xs text-sky-600 hover:underline">
                    {t("vcClearCover")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setCoverPickerOpen(true)}
                  className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border-2 border-dashed border-sky-200 text-zinc-400 transition hover:border-sky-400 hover:text-sky-500"
                >
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverUrl(cover)} alt="" className="size-9 object-cover" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* 发布摘要 */}
          <div className="space-y-3 rounded-2xl border border-sky-100 bg-white p-4">
            <p className="font-medium text-zinc-900">{t("vcPublishSummary")}</p>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-zinc-500">{t("vcTargetPlatforms")}</dt>
                <dd className="text-zinc-800">{t("vcSummaryCount", { count: platformCount })}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-zinc-500">{t("vcTargetAccounts")}</dt>
                <dd className="text-zinc-800">{t("vcSummaryCount", { count: accountCount })}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-zinc-500">{t("vcPendingPlatforms")}</dt>
                <dd className="text-zinc-800">
                  {pendingCount ? t("vcSummaryCount", { count: pendingCount }) : t("vcNoneValue")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-zinc-500">{t("vcDailyQuota")}</dt>
                <dd className="text-zinc-800">{t("vcQuotaTimes", { count: DAILY_PUBLISH_QUOTA })}</dd>
              </div>
            </dl>
            <p className="border-t border-sky-50 pt-3 text-xs text-zinc-400">{t("vcSummaryNote")}</p>
          </div>
        </aside>
      </div>
      {results ? (
        <div className="space-y-2">
          <p className="font-medium text-zinc-900">{t("vcPublishResultTitle")}</p>
          {results.map((result) => (
            <div
              key={result.accountId}
              className="flex items-center justify-between gap-3 rounded-xl border border-sky-100 bg-white px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900">{result.accountName || result.accountId}</p>
                {result.error ? <p className="text-xs text-rose-600">{result.error}</p> : null}
                {result.url ? (
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-sky-600 hover:underline"
                  >
                    {t("vcOpenPost")}
                  </a>
                ) : null}
              </div>
              <span
                className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", publishStatusClass[result.status])}
              >
                {t(publishStatusKey[result.status])}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Bottom action bar */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-600">
            <Check className="size-3" />
          </span>
          <div>
            <p className="text-sm font-medium text-zinc-800">{t("vcReadyTitle")}</p>
            <p className="text-xs text-zinc-400">{t("vcReadyDesc")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setTab("review")}>
            {t("vcTabReview")}
          </Button>
          <Button loading={publishing} disabled={!video || accountCount === 0 || uploading} onClick={() => void handlePublish()}>
            <Send size={16} />
            {t("vcPublishNowCount", { count: accountCount })}
          </Button>
        </div>
      </section>

      {/* Hidden file input shared by the header field and the sidebar */}
      <input
        ref={fileRef}
        type="file"
        accept={VIDEO_ACCEPT}
        className="hidden"
        disabled={uploading}
        onChange={(event) => void handleVideoFile(event.target.files?.[0])}
      />

      <Dialog open={coverPickerOpen} onClose={() => setCoverPickerOpen(false)} title={t("vcCoverPickerTitle")} maxWidth="lg">
        {library.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-10 text-center text-sm text-zinc-500">
            {t("emptyImages")}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid max-h-80 grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
              {library.map((entry) => (
                <button
                  key={entry.fileName}
                  type="button"
                  onClick={() => {
                    setCover(entry.fileName);
                    setCoverPickerOpen(false);
                  }}
                  className={cn(
                    "relative overflow-hidden rounded-xl border-2 transition",
                    cover === entry.fileName ? "border-sky-500" : "border-transparent hover:border-sky-200",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={entry.url || coverUrl(entry.fileName)}
                    alt={entry.fileName}
                    className="aspect-square w-full object-cover"
                  />
                  {cover === entry.fileName ? (
                    <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-sky-500 text-white">
                      <Check className="size-3" />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setCoverPickerOpen(false)}>{t("pcDone")}</Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={accountPickerOpen}
        onClose={() => setAccountPickerOpen(false)}
        title={t("vcPickerTitle")}
        maxWidth="2xl"
      >
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">{t("vcPickerDesc")}</p>

          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={pickerSearch}
                onChange={(event) => setPickerSearch(event.target.value)}
                placeholder={t("vcSearchAccount")}
                className={cn(consoleInputClass, "pl-9")}
              />
            </label>
            <select
              value={pickerGroup}
              onChange={(event) => setPickerGroup(event.target.value)}
              className={cn(consoleInputClass, "w-auto min-w-[10rem]")}
            >
              <option value="">{t("vcAllGroups")}</option>
              {availableGroups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between gap-3 text-sm">
            <button
              type="button"
              onClick={selectAllAvailable}
              className="font-medium text-sky-600 hover:underline"
            >
              {t("vcSelectAllAccounts")} ({filteredSites.length})
            </button>
            <button
              type="button"
              onClick={() => setSelectedAccountIds([])}
              className="text-xs text-zinc-500 hover:text-sky-600"
            >
              {t("vcClearSelection")}
            </button>
          </div>

          {pickerGroups.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-12 text-center text-sm text-zinc-500">
              {t("publishEmptyAccounts")}
            </p>
          ) : (
            <div className="grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2">
              {pickerGroups.map(([platform, list]) => (
                <div key={platform} className="space-y-2 rounded-2xl border border-sky-100 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <PlatformAvatar platform={platform} size="sm" />
                      <span className="text-sm font-medium text-zinc-800">{platform}</span>
                    </span>
                    <span className="text-xs text-zinc-400">
                      {list.filter((site) => selectedAccountIds.includes(site.id)).length}/{list.length}
                    </span>
                  </div>
                  <div className="space-y-1">
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

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sky-100 pt-3">
            <span className="text-xs text-zinc-500">
              {t("vcSelectedSummary", { accounts: accountCount, platforms: platformCount })}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setAccountPickerOpen(false)}>
                {t("dlgCancel")}
              </Button>
              <Button onClick={() => setAccountPickerOpen(false)}>{t("vcConfirmSelect")}</Button>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
