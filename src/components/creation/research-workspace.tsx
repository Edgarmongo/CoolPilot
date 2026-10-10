"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ExternalLink, FileText, Globe2, Inbox, ListChecks, Pencil, Plus, RefreshCw, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiDelete, apiGet, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-config";
import {
  isReadableResearchUrl,
  researchMaterialKindLabelKeys,
  researchMaterialMatchesQuery,
  researchMaterialStatusLabelKeys,
  researchMaterialWritingHref,
} from "@/lib/research";
import { researchMaterialStatuses, type ResearchMaterialKind, type ResearchMaterialRecord, type ResearchMaterialStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ResearchFormDialog } from "./research-form-dialog";
import { ResearchExtractionDialog } from "./research-extraction-dialog";
import { ResearchTranscriptionPanel } from "./research-transcription-panel";
import { ResearchTranscriptDialog } from "./research-transcript-dialog";

/**
 * 研究素材 (CI-P3-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The library of the third input a generation reads: create, import, search, filter, edit, delete, read a
 * source and hand a material to the creation workspace. It follows `TopicsWorkspace`'s shape - the list
 * the API answers, filtered on the client, so the route stays one table read.
 *
 * What the screen refuses to do is state a fact it does not have. The 处理状态 column shows the row's own
 * `status` and, when there is one, the reason the last read left (`statusMessage`); 读取来源 is the only
 * action that can change it, and a failed read shows up as 读取失败 with its reason rather than as a
 * silent no-op. 正文由你提供 marks text the user typed (a `ready` row with no read time), which is how
 * "有正文" stays distinguishable from "抓到正文".
 */

type StatusFilter = "all" | ResearchMaterialStatus;

const statusClass: Record<ResearchMaterialStatus, string> = {
  draft: "bg-zinc-100 text-zinc-500",
  ready: "bg-emerald-100 text-emerald-700",
  empty: "bg-amber-100 text-amber-700",
  failed: "bg-rose-100 text-rose-700",
};

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function KindIcon({ kind }: { kind: ResearchMaterialKind }) {
  const className = "size-3.5";
  if (kind === "url") return <Globe2 className={className} />;
  if (kind === "file") return <FileText className={className} />;
  return <Pencil className={className} />;
}

export function ResearchWorkspace() {
  const { t, locale } = useI18n();
  const { data: materials = [], mutate, isLoading } = useSWR<ResearchMaterialRecord[]>("/api/research", swrFetcher);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ResearchMaterialRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ResearchMaterialRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [readingId, setReadingId] = useState("");
  const [notice, setNotice] = useState("");
  const [transcriptMaterial, setTranscriptMaterial] = useState<ResearchMaterialRecord | null>(null);
  /**
   * The material whose 研究提炼 dialog is open (CI-P3-03).
   *
   * Unlike the transcript dialog this one is opened from the row's own action, so the row in the list *is*
   * what it was opened for - and it is re-read by id before opening (below) for the same reason
   * `openTranscript()` does: a run may have stored a version a moment ago, and a dialog that opened on a
   * stale row would show the version before it.
   */
  const [extractionMaterial, setExtractionMaterial] = useState<ResearchMaterialRecord | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Opens one material's transcript.
   *
   * It re-reads the material by id rather than reusing the row in the list: the panel offers this button
   * the moment a run reports its material, which can be a few hundred milliseconds before the refreshed
   * list arrives - and a transcript dialog that opened without the transcript it was opened for would be
   * worse than one extra `GET`.
   */
  async function openTranscript(materialId: string) {
    try {
      setTranscriptMaterial(await apiGet<ResearchMaterialRecord>(`/api/research/${materialId}`));
    } catch {
      setNotice(t("rsReadError"));
    }
  }

  /**
   * Opens one material's 研究提炼 (CI-P3-03). The row is what the user clicked, so it is used as-is: unlike
   * the transcript button this one is only ever reached from the list, which the same `GET /api/research`
   * just answered - and the dialog's own run watch refreshes both it and the list.
   */
  function openExtraction(material: ResearchMaterialRecord) {
    setExtractionMaterial(material);
  }

  const filtered = useMemo(
    () =>
      materials.filter(
        (material) => (status === "all" || material.status === status) && researchMaterialMatchesQuery(material, query),
      ),
    [materials, query, status],
  );

  // Stable, because the transcription panel refreshes this list from an effect keyed on the material a
  // run reported: a new function identity per render would turn that effect into a request per render.
  const refreshMaterials = useCallback(() => void mutate(), [mutate]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(material: ResearchMaterialRecord) {
    setEditing(material);
    setDialogOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/research/${deleteTarget.id}`);
      setDeleteTarget(null);
      await mutate();
    } finally {
      setDeleting(false);
    }
  }

  /**
   * Reads one source (P3-01-02). The route answers with the material *after* the attempt, so the row that
   * comes back is what the screen shows: `ready` with the page's text, `empty` with the reason, or `failed`
   * with why. Only a transport failure is this screen's to word.
   */
  async function handleRead(material: ResearchMaterialRecord) {
    setReadingId(material.id);
    setNotice("");
    try {
      await apiPost<ResearchMaterialRecord>(`/api/research/${material.id}/fetch`, {});
      await mutate();
    } catch {
      setNotice(t("rsReadError"));
    } finally {
      setReadingId("");
    }
  }

  /** File import reuses the knowledge library's extractor server-side; the browser only carries the file. */
  async function handleUpload(file: File) {
    setNotice("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/research/upload", { method: "POST", body: formData });
      const json = (await response.json()) as { ok: boolean; message?: string; error?: string };
      if (!json.ok) throw new Error(json.message ?? json.error ?? "upload failed");
      setNotice(t("rsUploadDone", { name: file.name }));
      await mutate();
    } catch {
      setNotice(t("rsUploadFailed"));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("rsSearchPlaceholder")}
          className={cn(consoleInputClass, "w-72")}
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          className={cn(consoleInputClass, "w-44")}
        >
          <option value="all">{t("tpFilterStatusAll")}</option>
          {researchMaterialStatuses.map((value) => (
            <option key={value} value={value}>
              {t(researchMaterialStatusLabelKeys[value])}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
          <UploadCloud size={14} />
          {t("rsUpload")}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleUpload(file);
          }}
        />
        <Button size="sm" className="ml-auto" onClick={openCreate}>
          <Plus size={14} />
          {t("rsNew")}
        </Button>
      </div>

      {notice ? <p className="text-sm text-amber-600">{notice}</p> : null}

      <ResearchTranscriptionPanel
        materials={materials}
        onMaterialSaved={refreshMaterials}
        onOpenTranscript={(materialId) => void openTranscript(materialId)}
      />

      {isLoading ? (
        <p className="rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">
          {t("loading")}
        </p>
      ) : filtered.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-sky-100 bg-white px-4 py-20 text-center">
          <Inbox className="size-10 text-zinc-300" />
          <p className="text-sm text-zinc-500">{t("rsEmpty")}</p>
        </div>
      ) : (
        <ResearchTable
          materials={filtered}
          locale={locale}
          readingId={readingId}
          onRead={(material) => void handleRead(material)}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
          onTranscript={(material) => void openTranscript(material.id)}
          onExtract={openExtraction}
        />
      )}

      <span className="block text-xs text-zinc-400">{t("kbTotal", { count: filtered.length })}</span>

      <ResearchFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void mutate()}
        material={editing}
      />

      <ResearchTranscriptDialog
        open={Boolean(transcriptMaterial)}
        onClose={() => setTranscriptMaterial(null)}
        onSaved={() => void mutate()}
        material={transcriptMaterial}
      />

      <ResearchExtractionDialog
        open={Boolean(extractionMaterial)}
        onClose={() => setExtractionMaterial(null)}
        onSaved={() => void mutate()}
        material={extractionMaterial}
      />

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t("rsColumnMaterial")}
        maxWidth="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">{t("rsDeleteConfirm", { title: deleteTarget?.title ?? "" })}</p>
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
 * The list itself, split out so the workspace above reads as state and the row markup lives in one place.
 *
 * Every column is a stored field and nothing is inferred: 类型 is `kind`, 来源 is the url (or the imported
 * file's name), 处理状态 is `status` plus the reason the last read left plus when it was read (or 正文由你提供
 * for text nobody fetched), and 更新时间 is `updatedAt`. A material with no text says so instead of showing an
 * empty cell that could be read as "there is text somewhere".
 */
function ResearchTable({
  materials,
  locale,
  readingId,
  onRead,
  onEdit,
  onDelete,
  onTranscript,
  onExtract,
}: {
  materials: ResearchMaterialRecord[];
  locale: Locale;
  readingId: string;
  onRead: (material: ResearchMaterialRecord) => void;
  onEdit: (material: ResearchMaterialRecord) => void;
  onDelete: (material: ResearchMaterialRecord) => void;
  onTranscript: (material: ResearchMaterialRecord) => void;
  onExtract: (material: ResearchMaterialRecord) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="overflow-x-auto rounded-2xl border border-sky-100 bg-white">
      <table className="w-full min-w-[1040px] text-left text-sm">
        <thead className="bg-sky-50/60 text-xs text-zinc-500">
          <tr>
            <th className="px-4 py-3 font-medium">{t("rsColumnMaterial")}</th>
            <th className="px-3 py-3 font-medium">{t("rsColumnKind")}</th>
            <th className="px-3 py-3 font-medium">{t("rsColumnSource")}</th>
            <th className="px-3 py-3 font-medium">{t("rsColumnStatus")}</th>
            <th className="px-3 py-3 font-medium">{t("rsColumnUpdated")}</th>
            <th className="px-3 py-3 text-right font-medium">{t("rsColumnActions")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sky-50">
          {materials.map((material) => {
            const preview = material.content.replace(/\s+/g, " ").trim().slice(0, 140);
            const readable = isReadableResearchUrl(material.sourceUrl);
            return (
              <tr key={material.id} className="align-top">
                <td className="max-w-[340px] px-4 py-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-sky-50 text-sky-500">
                      {material.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={material.imageUrl}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="size-9 object-cover"
                        />
                      ) : (
                        <KindIcon kind={material.kind} />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 truncate font-medium text-zinc-900">{material.title}</span>
                        {/* The row says a distillation exists, and which version - never that it is current:
                            "素材改过没有" needs the text comparison the dialog makes, not a badge's optimism. */}
                        {material.extraction ? (
                          <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-normal text-violet-700">
                            {t("rxBadge", { version: material.extraction.revision })}
                          </span>
                        ) : null}
                      </span>
                      {preview ? (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-400">{preview}</span>
                      ) : (
                        <span className="mt-0.5 block text-xs text-amber-600">{t("rsTextEmpty")}</span>
                      )}
                      {material.tags.length ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {material.tags.map((tag) => (
                            <span key={tag} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                              {tag}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-zinc-500">
                  {t(researchMaterialKindLabelKeys[material.kind])}
                </td>
                <td className="px-3 py-3">
                  {material.sourceUrl ? (
                    <a
                      href={material.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={t("rsOpenSource")}
                      className="inline-flex max-w-[220px] items-center gap-1 align-bottom text-sky-600 hover:underline"
                    >
                      <ExternalLink className="size-3.5 shrink-0" />
                      <span className="truncate">{material.sourceUrl}</span>
                    </a>
                  ) : material.fileName ? (
                    <span className="inline-flex max-w-[220px] items-center gap-1 text-zinc-500">
                      <FileText className="size-3.5 shrink-0" />
                      <span className="truncate">{material.fileName}</span>
                    </span>
                  ) : (
                    <span className="text-zinc-300">-</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusClass[material.status])}>
                    {t(researchMaterialStatusLabelKeys[material.status])}
                  </span>
                  {material.statusMessage ? (
                    <span
                      className={cn(
                        "mt-1 block max-w-[220px] text-xs",
                        material.status === "failed" ? "text-rose-500" : "text-amber-600",
                      )}
                    >
                      {material.statusMessage}
                    </span>
                  ) : null}
                  {material.fetchedAt ? (
                    <span className="mt-1 block text-xs text-zinc-400">
                      {t("rsFetchedAt", { time: formatDateTime(material.fetchedAt) })}
                    </span>
                  ) : material.content.trim() ? (
                    <span className="mt-1 block text-xs text-zinc-400">{t("rsTextByUser")}</span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-zinc-400">{formatDateTime(material.updatedAt)}</td>
                <td className="whitespace-nowrap px-3 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => onRead(material)}
                      disabled={!readable || readingId === material.id}
                      title={readable ? t("rsReadSource") : t("rsReadNoUrl")}
                      className="rounded-lg p-1.5 text-sky-600 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <RefreshCw className={cn("size-4", readingId === material.id && "animate-spin")} />
                    </button>
                    <Link
                      href={researchMaterialWritingHref(locale, material.id)}
                      title={t("rsWrite")}
                      className="rounded-lg p-1.5 text-violet-600 transition hover:bg-violet-50"
                    >
                      <Sparkles className="size-4" />
                    </Link>
                    {/* Only a row that really carries a transcript offers one: `transcriptJson` decides, not
                        the material's kind - an audio imported for another reason has nothing to show. */}
                    {material.transcript ? (
                      <button
                        type="button"
                        onClick={() => onTranscript(material)}
                        title={t("trViewTranscript")}
                        className="rounded-lg p-1.5 text-emerald-600 transition hover:bg-emerald-50"
                      >
                        <FileText className="size-4" />
                      </button>
                    ) : null}
                    {/* 研究提炼 (CI-P3-03) is offered for every row that has text, because distilling is the
                        action that can *create* a result; the dialog is where "nothing to distil" is said. */}
                    <button
                      type="button"
                      onClick={() => onExtract(material)}
                      disabled={!material.content.trim()}
                      title={material.content.trim() ? t("rxExtract") : t("rxExtractNoText")}
                      className={cn(
                        "rounded-lg p-1.5 transition",
                        material.extraction ? "text-violet-600 hover:bg-violet-50" : "text-zinc-500 hover:bg-zinc-100",
                        !material.content.trim() && "cursor-not-allowed opacity-40",
                      )}
                    >
                      <ListChecks className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(material)}
                      title={t("btnEdit")}
                      className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(material)}
                      title={t("btnDelete")}
                      className="rounded-lg p-1.5 text-rose-500 transition hover:bg-rose-50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </td>

              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
