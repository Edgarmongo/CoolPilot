"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  BookOpen,
  FileText,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsolePagination, useClampConsolePage, usePagedItems } from "@/components/ui/console-pagination";
import { consoleInputClass } from "@/components/ui/console-surface";
import { apiDelete, apiErrorTranslationKey, apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import {
  knowledgeBaseCategoryLabelKeys,
  knowledgeBaseOriginLabelKeys,
  knowledgeBaseWeightLabelKeys,
  knowledgeCharacterCount,
} from "@/lib/knowledge-base";
import {
  knowledgeBaseCategories,
  type DifyConnectionRecord,
  type KnowledgeBaseCategory,
  type KnowledgeBaseRecord,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { NoticeBanner } from "../positioning-fields";
import { DifyConnectionDrawer } from "./dify-connection-drawer";
import { KnowledgeEntryDialog } from "./knowledge-entry-dialog";
import { KnowledgeProductImportDialog } from "./knowledge-product-import-dialog";
import { KnowledgeSmartDialog } from "./knowledge-smart-dialog";
import { KnowledgeUploadDialog } from "./knowledge-upload-dialog";

type KnowledgeTab = "local" | "dify";

/** The index reading `GET /api/knowledge-base/embeddings` answers with (CI-EMB-01). */
type KnowledgeIndexPayload = {
  model: { providerId: string; modelId: string } | null;
  summary: {
    records: number;
    empty: number;
    ready: number;
    pending: number;
    missing: number;
    stale: number;
    incompatible: number;
    chunks: number;
  } | null;
};

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

export function KnowledgeBaseWorkspace() {
  const { t } = useI18n();
  const [tab, setTab] = useState<KnowledgeTab>("local");
  const { data: entries = [], mutate: mutateEntries, isLoading } = useSWR<KnowledgeBaseRecord[]>(
    "/api/knowledge-base",
    swrFetcher,
  );
  const { data: connections = [], mutate: mutateConnections } = useSWR<DifyConnectionRecord[]>(
    "/api/dify/connections",
    swrFetcher,
  );
  /** CI-EMB-01: what the vector index looks like right now, read (never computed) from its own endpoint. */
  const { data: index, mutate: mutateIndex } = useSWR<KnowledgeIndexPayload>("/api/knowledge-base/embeddings", swrFetcher);

  const [category, setCategory] = useState<KnowledgeBaseCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const [entryOpen, setEntryOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<KnowledgeBaseRecord | null>(null);
  const [smartOpen, setSmartOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [difyOpen, setDifyOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<DifyConnectionRecord | null>(null);
  const [indexBusy, setIndexBusy] = useState(false);
  const [indexNotice, setIndexNotice] = useState("");

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (category !== "all" && entry.category !== category) return false;
      if (keyword && !entry.title.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [entries, category, query]);

  const { pageItems } = usePagedItems(filtered, page);
  useClampConsolePage(page, filtered.length, setPage);

  function openCreate() {
    setEditingEntry(null);
    setEntryOpen(true);
  }

  function openEdit(entry: KnowledgeBaseRecord) {
    setEditingEntry(entry);
    setEntryOpen(true);
  }

  async function handleDelete(id: string) {
    await apiDelete(`/api/knowledge-base/${id}`);
    await mutateEntries();
  }

  async function toggleEnabled(entry: KnowledgeBaseRecord, enabled: boolean) {
    await apiPatch(`/api/knowledge-base/${entry.id}`, { enabled });
    await mutateEntries();
  }

  function openDify(connection: DifyConnectionRecord | null) {
    setEditingConnection(connection);
    setDifyOpen(true);
  }

  async function handleDeleteConnection(id: string) {
    await apiDelete(`/api/dify/connections/${id}`);
    await mutateConnections();
  }

  /**
   * CI-EMB-01: the explicit entry the card requires - the vector index is never rebuilt by saving a record.
   *
   * `scope: "stale"` is the ordinary button: it fills in what is missing or outdated. A rebuild of everything
   * (the model-migration path, D4) is a separate, deliberate action below, so a click here can never recompute
   * an index that is already current - and the cost of one click is the cost of what is actually stale.
   */
  async function buildIndex(scope: "stale" | "rebuild") {
    setIndexBusy(true);
    setIndexNotice("");
    try {
      await apiPost<{ taskId: string; reused: boolean }>("/api/knowledge-base/embeddings", { scope });
      setIndexNotice(t("kbIndexStarted"));
      await mutateIndex();
    } catch (error) {
      setIndexNotice(t(apiErrorTranslationKey(error, "kbIndexFailed")));
    } finally {
      setIndexBusy(false);
    }
  }

  return (
    <>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-5 border-b border-sky-100">
          {(["local", "dify"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "-mb-px border-b-2 px-1 pb-2.5 text-sm font-medium transition",
                tab === id ? "border-sky-500 text-sky-700" : "border-transparent text-zinc-500 hover:text-zinc-800",
              )}
            >
              {t(id === "local" ? "kbTabLocal" : "kbTabExternal")}
            </button>
          ))}
        </div>

        {tab === "local" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value as KnowledgeBaseCategory | "all");
                  setPage(1);
                }}
                className={cn(consoleInputClass, "w-40")}
              >
                <option value="all">{t("kbFilterAll")}</option>
                {knowledgeBaseCategories.map((item) => (
                  <option key={item} value={item}>
                    {t(knowledgeBaseCategoryLabelKeys[item])}
                  </option>
                ))}
              </select>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder={t("kbSearchPlaceholder")}
                className={cn(consoleInputClass, "w-56")}
              />
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {/*
                  CI-EMB-01 (D10). The index is built by an explicit action, never by saving a record: this
                  button asks for what is stale, and the second one rebuilds everything (the migration path a
                  model change uses). Both create a task and answer immediately - the work runs in the worker /
                  in this process, and the task system reports its progress.
                */}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={indexBusy}
                  onClick={() => void buildIndex("stale")}
                  title={t("kbIndexHint")}
                >
                  <RefreshCw size={14} className={cn(indexBusy && "animate-spin")} />
                  {t("kbBuildIndex")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={indexBusy}
                  onClick={() => void buildIndex("rebuild")}
                  title={t("kbRebuildIndexHint")}
                >
                  <RefreshCw size={14} />
                  {t("kbRebuildIndex")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSmartOpen(true)}>
                  <Sparkles size={14} />
                  {t("kbSmartImport")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
                  <UploadCloud size={14} />
                  {t("kbUploadFile")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setProductOpen(true)}>
                  <Package size={14} />
                  {t("kbProductImport")}
                </Button>
                <Button size="sm" onClick={openCreate}>
                  <Plus size={14} />
                  {t("kbAdd")}
                </Button>
              </div>
            </div>

            {indexNotice ? <NoticeBanner title={indexNotice} /> : null}
            {index?.summary ? (
              <p className="text-xs text-zinc-500">
                {t("kbIndexSummary", {
                  ready: index.summary.ready,
                  pending: index.summary.pending,
                  model: index.model ? `${index.model.providerId}/${index.model.modelId}` : "",
                })}
              </p>
            ) : (
              // No summary is a reading of its own: either nothing can embed yet, or the index could not be
              // read. Both are said rather than shown as an index of zero.
              <p className="text-xs text-amber-600">{t("kbIndexUnavailable")}</p>
            )}

            {isLoading ? (
              <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">
                {t("loading")}
              </p>
            ) : filtered.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">
                {t("kbEmpty")}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-sky-100 bg-white">
                <table className="w-full min-w-[840px] text-left text-sm">
                  <thead className="bg-sky-50/60 text-xs text-zinc-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t("kbColName")}</th>
                      <th className="px-3 py-3 font-medium">{t("kbColType")}</th>
                      <th className="px-3 py-3 font-medium">{t("kbColCategory")}</th>
                      <th className="px-3 py-3 font-medium">{t("kbColWeight")}</th>
                      <th className="px-3 py-3 font-medium">{t("kbColSize")}</th>
                      <th className="px-3 py-3 font-medium">{t("kbColStatus")}</th>
                      <th className="px-3 py-3 font-medium">{t("kbColAddedAt")}</th>
                      <th className="px-3 py-3 text-right font-medium">{t("kbColActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((entry) => (
                      <tr key={entry.id} className="border-t border-sky-50">
                        <td className="max-w-xs px-4 py-3">
                          <div className="flex items-center gap-2">
                            {entry.origin === "file" ? (
                              <FileText className="size-4 shrink-0 text-zinc-400" />
                            ) : (
                              <BookOpen className="size-4 shrink-0 text-zinc-400" />
                            )}
                            <span className="truncate font-medium text-zinc-900">{entry.title}</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-zinc-500">
                          {t(knowledgeBaseOriginLabelKeys[entry.origin])}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                            {t(knowledgeBaseCategoryLabelKeys[entry.category])}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-zinc-500">
                          {t(knowledgeBaseWeightLabelKeys[entry.weight])}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-zinc-500">
                          {knowledgeCharacterCount(entry.content)}
                          {t("kbCharUnit")}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={entry.enabled}
                            onClick={() => void toggleEnabled(entry, !entry.enabled)}
                            className={cn(
                              "relative inline-flex h-5 w-9 items-center rounded-full transition",
                              entry.enabled ? "bg-sky-500" : "bg-zinc-300",
                            )}
                          >
                            <span
                              className={cn(
                                "absolute size-4 rounded-full bg-white transition-all",
                                entry.enabled ? "left-4" : "left-0.5",
                              )}
                            />
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-zinc-400">{formatDateTime(entry.createdAt)}</td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openEdit(entry)}
                              title={t("btnEdit")}
                              className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100"
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(entry.id)}
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

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-400">{t("kbTotal", { count: filtered.length })}</span>
              <ConsolePagination page={page} totalItems={filtered.length} onPageChange={setPage} />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <NoticeBanner title={t("kbDifyBannerTitle")}>{t("kbDifyBannerDesc")}</NoticeBanner>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => openDify(null)}>
                <Plus size={14} />
                {t("kbDifyAdd")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void mutateConnections()}>
                <RefreshCw size={14} />
                {t("kbDifyRefresh")}
              </Button>
            </div>
            {connections.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">
                {t("kbDifyEmpty")}
              </p>
            ) : (
              <div className="grid gap-3">
                {connections.map((connection) => (
                  <div key={connection.id} className="rounded-2xl border border-sky-100 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-semibold text-zinc-900">{connection.name}</h3>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-medium",
                              connection.enabled ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500",
                            )}
                          >
                            {connection.enabled ? t("kbDifyEnabled") : t("kbDifyDisabled")}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-zinc-400">{connection.apiBase}</p>
                        <p className="mt-1 text-xs text-zinc-400">
                          {t("kbDifyKnowledgeCount", { count: connection.knowledgeIds.length })} ·{" "}
                          {connection.apiKeyMasked}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => openDify(connection)}
                          title={t("btnEdit")}
                          className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteConnection(connection.id)}
                          title={t("btnDelete")}
                          className="rounded-lg p-1.5 text-rose-500 transition hover:bg-rose-50"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <KnowledgeEntryDialog
        open={entryOpen}
        onClose={() => setEntryOpen(false)}
        onSaved={() => void mutateEntries()}
        entry={editingEntry}
      />
      <KnowledgeSmartDialog
        open={smartOpen}
        onClose={() => setSmartOpen(false)}
        onSaved={() => void mutateEntries()}
      />
      <KnowledgeUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSaved={() => void mutateEntries()}
      />
      <KnowledgeProductImportDialog
        open={productOpen}
        onClose={() => setProductOpen(false)}
        onSaved={() => void mutateEntries()}
      />
      <DifyConnectionDrawer
        open={difyOpen}
        onClose={() => setDifyOpen(false)}
        onSaved={() => void mutateConnections()}
        connection={editingConnection}
      />
    </>
  );
}
