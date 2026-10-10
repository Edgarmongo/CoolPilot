"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Archive,
  ArchiveRestore,
  FileText,
  Flame,
  Inbox,
  Lightbulb,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiDelete, apiGet, apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import { articleEditorHref } from "@/lib/editor-link";
import { HOT_TOPICS_ALL, hotTopicPlatforms } from "@/lib/hot-topic-platforms";
import { useI18n } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-config";
import { topicMatchesQuery, topicStatusLabelKeys, topicStatuses, topicWritingHref } from "@/lib/topics";
import type { TopicRecord, TopicStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TopicFormDialog } from "./topic-form-dialog";

/**
 * 选题管理 (CI-P2-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The workspace is the topic library: create, edit, search, archive and delete, plus the two links
 * that make a topic worth keeping - "write about it" (`/creation/ai-writing?topicId=...`, which the
 * wizard reads and the generation entry records back) and "open the article" once one exists. It
 * follows `ProductsWorkspace`'s shape, including the client-side search over the list the API answers:
 * topics are small, the two filters belong to the screen, and the route stays one table read.
 *
 * "Import from hot topics" is P2-01-03's "create a topic from material" in the only form this build
 * can honestly offer today: the hot-topic endpoint already exists and is already what the wizard's
 * first step reads. The research-material module of the plan is CI-P3-01 and is not built yet, so
 * nothing here pretends to import from it.
 */

type StatusFilter = "all" | TopicStatus;

const statusClass: Record<TopicStatus, string> = {
  active: "bg-sky-100 text-sky-700",
  archived: "bg-zinc-100 text-zinc-500",
};

/** One row of `GET /api/hot-topics`, the same shape the wizard's first step reads. */
type HotTopicItem = { id: string; title: string; url: string; source: string; hot?: number };

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/**
 * Material -> topic (P2-01-03) over the existing hot-topic feed that the wizard's first step already
 * reads.
 *
 * A hot topic becomes a topic of the user's own with its source and link kept, and something already
 * added is reported instead of added twice: the feed is re-fetched every time it is opened, so the
 * duplicate check compares links (what the user can see), not ids that only the feed knows.
 */
function HotImportPanel({ addedUrls, onImported }: { addedUrls: Set<string>; onImported: () => void }) {
  const { t } = useI18n();
  const [platform, setPlatform] = useState<string>(HOT_TOPICS_ALL);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState("");
  const { data, isValidating, mutate } = useSWR<{ items: HotTopicItem[] }>(
    ["/api/hot-topics", platform],
    () => apiGet<{ items: HotTopicItem[] }>(`/api/hot-topics?platform=${encodeURIComponent(platform)}`),
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const items = useMemo(() => {
    const list = data?.items ?? [];
    const keyword = query.trim().toLowerCase();
    return keyword ? list.filter((item) => item.title.toLowerCase().includes(keyword)) : list;
  }, [data, query]);

  /** A platform chip names the source; "all" falls back to the platform the feed reported. */
  function sourceOf(item: HotTopicItem) {
    if (platform === HOT_TOPICS_ALL) return item.source;
    return hotTopicPlatforms.find((entry) => entry.id === platform)?.label || item.source;
  }

  async function add(item: HotTopicItem) {
    setAdding(item.id);
    try {
      await apiPost("/api/topics", { title: item.title, source: sourceOf(item), sourceUrl: item.url });
      onImported();
    } finally {
      setAdding("");
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-sky-100 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-700">
          <Flame className="size-4 text-orange-500" />
          {t("tpImportHot")}
        </span>
        <span className="text-xs text-zinc-400">{t("tpImportHotHint")}</span>
      </div>

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

      <div className="flex items-center gap-2">
        <Search className="size-4 shrink-0 text-zinc-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("tpImportHotSearch")}
          className={cn(consoleInputClass, "flex-1")}
        />
        <button
          type="button"
          onClick={() => void mutate()}
          title={t("awRefresh")}
          className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100"
        >
          <RefreshCw className={cn("size-4", isValidating && "animate-spin")} />
        </button>
      </div>

      {items.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-zinc-400">{t("tpImportHotEmpty")}</p>
      ) : (
        <ul className="max-h-72 divide-y divide-sky-50 overflow-y-auto rounded-xl border border-sky-50">
          {items.map((item) => {
            const already = Boolean(item.url) && addedUrls.has(item.url);
            return (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-sm text-zinc-800">{item.title}</span>
                  <span className="text-[10px] text-zinc-400">
                    {item.source}
                    {item.hot ? ` · ${item.hot}` : ""}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={already}
                  loading={adding === item.id}
                  onClick={() => void add(item)}
                >
                  {already ? t("tpImportHotAdded") : t("tpImportHotAction")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function TopicsWorkspace() {
  const { t, locale } = useI18n();
  const { data: topics = [], mutate, isLoading } = useSWR<TopicRecord[]>("/api/topics", swrFetcher);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TopicRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TopicRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [hotOpen, setHotOpen] = useState(false);

  const filtered = useMemo(
    () => topics.filter((topic) => (status === "all" || topic.status === status) && topicMatchesQuery(topic, query)),
    [topics, query, status],
  );
  /** Links already kept as topics, so the hot-topic panel can say "added" instead of adding twice. */
  const addedUrls = useMemo(() => new Set(topics.map((topic) => topic.sourceUrl).filter(Boolean)), [topics]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(topic: TopicRecord) {
    setEditing(topic);
    setDialogOpen(true);
  }

  async function toggleArchive(topic: TopicRecord) {
    await apiPatch(`/api/topics/${topic.id}`, { status: topic.status === "active" ? "archived" : "active" });
    await mutate();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/topics/${deleteTarget.id}`);
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
          placeholder={t("tpSearchPlaceholder")}
          className={cn(consoleInputClass, "w-72")}
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          className={cn(consoleInputClass, "w-32")}
        >
          <option value="all">{t("tpFilterStatusAll")}</option>
          {topicStatuses.map((value) => (
            <option key={value} value={value}>
              {t(topicStatusLabelKeys[value])}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={() => setHotOpen((open) => !open)}>
          <Flame size={14} />
          {t("tpImportHot")}
        </Button>
        <Button size="sm" className="ml-auto" onClick={openCreate}>
          <Plus size={14} />
          {t("tpNew")}
        </Button>
      </div>

      {hotOpen ? <HotImportPanel addedUrls={addedUrls} onImported={() => void mutate()} /> : null}

      {isLoading ? (
        <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">
          {t("loading")}
        </p>
      ) : filtered.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-sky-100 bg-white px-4 py-20 text-center">
          <Inbox className="size-10 text-zinc-300" />
          <p className="text-sm text-zinc-500">{t("tpEmpty")}</p>
        </div>
      ) : (
        <TopicsTable
          topics={filtered}
          locale={locale}
          onEdit={openEdit}
          onArchive={(topic) => void toggleArchive(topic)}
          onDelete={setDeleteTarget}
        />
      )}

      <span className="block text-xs text-zinc-400">{t("kbTotal", { count: filtered.length })}</span>

      <TopicFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void mutate()}
        topic={editing}
      />

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title={t("tpColumnTopic")} maxWidth="sm">
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">{t("tpDeleteConfirm", { title: deleteTarget?.title ?? "" })}</p>
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

/**
 * The list itself, split out so the workspace above reads as state and the row markup lives in one
 * place. Every action a topic offers is one of the four the card asks for: write (P2-01-04), edit,
 * archive/restore and delete - plus the article the topic produced, when there is one (P2-01-05).
 */
function TopicsTable({
  topics,
  locale,
  onEdit,
  onArchive,
  onDelete,
}: {
  topics: TopicRecord[];
  locale: Locale;
  onEdit: (topic: TopicRecord) => void;
  onArchive: (topic: TopicRecord) => void;
  onDelete: (topic: TopicRecord) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="overflow-x-auto rounded-2xl border border-sky-100 bg-white">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead className="bg-sky-50/60 text-xs text-zinc-500">
          <tr>
            <th className="px-4 py-3 font-medium">{t("tpColumnTopic")}</th>
            <th className="px-3 py-3 font-medium">{t("tpColumnKeywords")}</th>
            <th className="px-3 py-3 font-medium">{t("tpColumnSource")}</th>
            <th className="px-3 py-3 font-medium">{t("tpColumnStatus")}</th>
            <th className="px-3 py-3 font-medium">{t("tpColumnArticle")}</th>
            <th className="px-3 py-3 font-medium">{t("tpColumnUpdated")}</th>
            <th className="px-3 py-3 text-right font-medium">{t("tpColumnActions")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sky-50">
          {topics.map((topic) => (
            <tr key={topic.id} className="align-top">
              <td className="max-w-[280px] px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-500">
                    <Lightbulb className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-zinc-900">{topic.title}</span>
                    {topic.description ? (
                      <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-400">{topic.description}</span>
                    ) : null}
                  </span>
                </div>
              </td>
              <td className="px-3 py-3">
                {topic.keywords.length ? (
                  <div className="flex flex-wrap gap-1">
                    {topic.keywords.map((keyword) => (
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
                {topic.sourceUrl ? (
                  <a
                    href={topic.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-[200px] items-center gap-1 align-bottom text-sky-600 hover:underline"
                  >
                    <Link2 className="size-3.5 shrink-0" />
                    <span className="truncate">{topic.source || topic.sourceUrl}</span>
                  </a>
                ) : topic.source ? (
                  <span className="text-zinc-500">{topic.source}</span>
                ) : (
                  <span className="text-zinc-300">-</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-3">
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusClass[topic.status])}>
                  {t(topicStatusLabelKeys[topic.status])}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-3">
                {topic.contentItemId ? (
                  <Link
                    href={articleEditorHref(locale, topic.contentItemId)}
                    className="inline-flex items-center gap-1 text-sky-600 hover:underline"
                  >
                    <FileText className="size-3.5" />
                    {t("tpOpenArticle")}
                  </Link>
                ) : (
                  <span className="text-zinc-300">-</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-400">{formatDateTime(topic.updatedAt)}</td>
              <td className="whitespace-nowrap px-3 py-3">
                <div className="flex items-center justify-end gap-1">
                  <Link
                    href={topicWritingHref(locale, topic.id)}
                    title={t("tpStartWriting")}
                    className="rounded-lg p-1.5 text-violet-600 transition hover:bg-violet-50"
                  >
                    <Sparkles className="size-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => onEdit(topic)}
                    title={t("btnEdit")}
                    className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onArchive(topic)}
                    title={topic.status === "active" ? t("tpArchive") : t("tpUnarchive")}
                    className="rounded-lg p-1.5 text-amber-600 transition hover:bg-amber-50"
                  >
                    {topic.status === "active" ? <Archive className="size-4" /> : <ArchiveRestore className="size-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(topic)}
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
