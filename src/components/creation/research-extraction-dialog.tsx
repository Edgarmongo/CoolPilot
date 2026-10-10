"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ListChecks, Plus, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Dialog } from "@/components/ui/dialog";
import { apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n-config";
import type { TranslationKey } from "@/lib/locale-resources";
import { researchMaterialWritingHref } from "@/lib/research";
import {
  researchExtractionEvidenceLocator,
  researchExtractionIsStale,
  type ResearchExtractionRecord,
} from "@/lib/research-extraction/extraction";
import type { TaskLogEntry, TaskStatus, TaskView } from "@/lib/tasks/task-view";
import type { ResearchMaterialRecord, TopicRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * One material's 研究提炼 (CI-P3-03 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The screen keeps four things apart, which is the whole point of the card:
 *
 * - **什么来自素材、什么来自模型。** 摘要 / 核心观点 / 事实与数据 / 关键引述 are shown as source-derived, and every
 *   fact and quote carries the excerpt it claims - checked *here*, against the material's own stored text
 *   (`researchExtractionEvidenceLocator`), so 原文可查 is a computed answer and 原文中未找到 is shown rather
 *   than hidden. 选题建议 are shown as the model's *ideas*, with no verification badge at all, because
 *   there is nothing in the source to verify them against.
 * - **谁写的哪一版。** The version (`revision`), the run that produced it, the model, when it was
 *   generated, and whether a human has edited it since (`editedAt`) come from the record. Earlier versions
 *   are listed as such, so regenerating is visibly *replacing* something.
 * - **素材改过没有。** `researchExtractionIsStale` compares the stored fingerprint with the material as it
 *   is now; when they differ the dialog says so instead of pretending the result is current.
 * - **原始正文与逐字稿不会被覆盖。** Saving patches the extraction only (`PATCH .../extraction`), and the
 *   dialog never sends `content`.
 *
 * A run is watched, not guessed: `POST .../extraction` creates a task and `GET /api/tasks/<id>` reports it,
 * which is why the status, the progress and the error text here cannot disagree with the task console.
 */

type ExtractionDraft = {
  summary: string;
  /** One key point per line - the simplest list a textarea can hold, and how the user sees them. */
  keyPoints: string;
  facts: { statement: string; evidence: string }[];
  quotes: string;
};

function draftOf(record: ResearchExtractionRecord | null): ExtractionDraft {
  return {
    summary: record?.summary ?? "",
    keyPoints: (record?.keyPoints ?? []).join("\n"),
    facts: (record?.facts ?? []).map((fact) => ({ statement: fact.statement, evidence: fact.evidence })),
    quotes: (record?.quotes ?? []).join("\n"),
  };
}

/** One entry per non-empty line, trimmed; an empty line is how a user removes an item. */
function linesOf(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The two statuses in which a row still has work ahead of it; the dialog polls only then. */
function isInFlight(status: TaskStatus) {
  return status === "queued" || status === "running";
}

const taskStatusLabelKeys: Record<TaskStatus, TranslationKey> = {
  queued: "trStateQueued",
  running: "trStateRunning",
  paused: "trStatePaused",
  succeeded: "trStateSucceeded",
  warning: "trStateWarning",
  failed: "trStateFailed",
  cancelled: "trStateCancelled",
  missed: "trStateMissed",
};

const statusClass: Record<TaskStatus, string> = {
  queued: "bg-zinc-100 text-zinc-500",
  running: "bg-sky-100 text-sky-700",
  paused: "bg-amber-100 text-amber-700",
  succeeded: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  failed: "bg-rose-100 text-rose-700",
  cancelled: "bg-zinc-100 text-zinc-500",
  missed: "bg-rose-100 text-rose-700",
};

function formatDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export function ResearchExtractionDialog({
  open,
  onClose,
  material,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  material: ResearchMaterialRecord | null;
  /** Called when a run stored a new version or the user saved an edit, so the list reloads. */
  onSaved: () => void;
}) {
  const { t, locale } = useI18n();
  const record = material?.extraction ?? null;
  const [draft, setDraft] = useState<ExtractionDraft>(() => draftOf(null));
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [topicNotice, setTopicNotice] = useState("");
  const [createdTopic, setCreatedTopic] = useState<TopicRecord | null>(null);
  const [activeTaskId, setActiveTaskId] = useState("");

  /**
   * The version the draft was built from, so a re-render of the same version does not throw the user's
   * unsaved edits away: the draft is reset only when the stored version really becomes a different one
   * (a new revision, a saved edit, or another material).
   */
  const draftKey = material ? `${material.id}:${record?.revision ?? 0}:${record?.editedAt ?? 0}` : "";
  const draftedRef = useRef("");
  useEffect(() => {
    if (!open) return;
    if (draftedRef.current === draftKey) return;
    draftedRef.current = draftKey;
    const next = draftOf(record);
    // Deferred like the sibling dialogs: a dialog that opens with its draft cannot render one frame of
    // someone else's text.
    window.queueMicrotask(() => {
      setDraft(next);
      setError("");
      setNotice("");
      setTopicNotice("");
      setCreatedTopic(null);
    });
  }, [open, draftKey, record]);

  const { data: detail } = useSWR<{ task: TaskView; logs: TaskLogEntry[] }>(
    activeTaskId ? `/api/tasks/${activeTaskId}` : null,
    swrFetcher,
    {
      // Polled only while the row has work ahead of it: a settled task's log cannot change.
      refreshInterval: (latest) => (latest && isInFlight(latest.task.status) ? 2000 : 0),
    },
  );
  const activeTask = detail?.task ?? null;
  const lastLog = useMemo(() => {
    const logs = detail?.logs ?? [];
    return logs.length > 0 ? logs[logs.length - 1] : null;
  }, [detail]);

  // A settled run is reported once, and a successful one refreshes the list so this dialog reads the
  // version the run really stored instead of the one that was there before it.
  const settledRef = useRef("");
  useEffect(() => {
    if (!activeTask || isInFlight(activeTask.status)) return;
    const settled = `${activeTask.id}:${activeTask.status}`;
    if (settledRef.current === settled) return;
    settledRef.current = settled;
    if (activeTask.status === "succeeded" || activeTask.status === "warning") {
      window.queueMicrotask(() => setNotice(t("rxGenerated")));
      onSaved();
    }
  }, [activeTask, onSaved, t]);

  const stale = material && record ? researchExtractionIsStale(record, material) : false;
  const hasText = (material?.content ?? "").trim().length > 0;

  /** Starts one distillation. No idempotency key: a second click while a run is in flight must return
   * that run, while a click after it settled must be a legitimate 重新提炼. */
  async function handleGenerate() {
    if (!material) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    setActiveTaskId("");
    try {
      const result = await apiPost<{ taskId: string; reused: boolean }>(
        `/api/research/${material.id}/extraction`,
        {},
      );
      setActiveTaskId(result.taskId);
      setNotice(result.reused ? t("rxTaskReused", { id: result.taskId }) : t("rxTaskCreated", { id: result.taskId }));
    } catch {
      setError(t("rxGenerateFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  /** Saves the user's edit of the current version. Only the extraction is patched - never the text. */
  async function handleSave() {
    if (!material || !record) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiPatch(`/api/research/${material.id}/extraction`, {
        summary: draft.summary,
        keyPoints: linesOf(draft.keyPoints),
        facts: draft.facts.filter((fact) => fact.statement.trim()),
        quotes: linesOf(draft.quotes),
      });
      setNotice(t("rxSaved"));
      onSaved();
    } catch {
      setError(t("rxSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  /** Turns one suggestion into a real topic; the topic then records which material the idea came from. */
  async function handleCreateTopic(index: number) {
    if (!material) return;
    setTopicNotice("");
    setError("");
    try {
      const result = await apiPost<{ topic: TopicRecord }>(
        `/api/research/${material.id}/extraction/topics`,
        { index },
      );
      setCreatedTopic(result.topic);
      setTopicNotice(t("rxTopicCreated", { title: result.topic.title }));
      onSaved();
    } catch {
      setTopicNotice(t("rxTopicFailed"));
    }
  }

  const quoteLines = linesOf(draft.quotes);
  const history = material?.extractionHistory ?? [];

  return (
    <Dialog open={open} onClose={onClose} title={t("rxDialogTitle")} maxWidth="lg">
      <div className="grid gap-4">
        <p className="text-xs text-zinc-500">{t("rxDialogHint")}</p>

        {material && !hasText ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">{t("rxNoText")}</p>
        ) : null}

        {record ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-sky-50/60 px-4 py-3 text-xs">
            <Meta label={t("rxRevision")} value={`v${record.revision}`} />
            <Meta label={t("rxGeneratedAt")} value={formatDateTime(record.generatedAt)} />
            <Meta label={t("rxModel")} value={`${record.providerId}${record.model ? ` / ${record.model}` : ""}`} />
            <Meta label={t("rxTask")} value={record.taskId} />
            <Meta label={t("rxSourceCharacters")} value={String(record.sourceCharacters)} />
            <Meta
              label={t("rxEditedAt")}
              value={record.editedAt ? formatDateTime(record.editedAt) : t("rxNotEdited")}
            />
          </dl>
        ) : null}

        {stale ? <p className="text-xs text-amber-600">{t("rxStale")}</p> : null}

        {/* The run, read from the task system: status, progress, the newest log line and the real error. */}
        {activeTask ? (
          <div className="rounded-xl border border-sky-100 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusClass[activeTask.status])}>
                {t(taskStatusLabelKeys[activeTask.status])}
              </span>
              <span className="text-xs text-zinc-400">{t("trRawStatus", { status: activeTask.rawStatus })}</span>
            </div>
            {typeof activeTask.progress === "number" ? (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sky-50">
                <div className="h-full rounded-full bg-sky-500" style={{ width: `${activeTask.progress}%` }} />
              </div>
            ) : null}
            {lastLog ? <span className="mt-2 block text-xs text-zinc-500">{lastLog.message}</span> : null}
            {activeTask.error ? (
              <span className="mt-1 block text-xs text-rose-500">{activeTask.error.message}</span>
            ) : null}
          </div>
        ) : null}

        {!record ? (
          <p className="rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-500">{t("rxNoExtraction")}</p>
        ) : null}

        {record ? (
          <>
            <Section title={t("rxSummary")}>
              <textarea
                value={draft.summary}
                onChange={(event) => setDraft((prev) => ({ ...prev, summary: event.target.value }))}
                className={`${consoleInputClass} min-h-24 resize-y`}
              />
            </Section>

            <Section title={t("rxKeyPoints")} hint={t("rxListHint")}>
              <textarea
                value={draft.keyPoints}
                onChange={(event) => setDraft((prev) => ({ ...prev, keyPoints: event.target.value }))}
                className={`${consoleInputClass} min-h-24 resize-y`}
              />
            </Section>

            <Section title={t("rxFacts")} hint={t("rxFactsHint")}>
              {draft.facts.length === 0 ? (
                <span className="text-xs text-zinc-400">{t("rxNoFacts")}</span>
              ) : (
                <div className="grid gap-3">
                  {draft.facts.map((fact, index) => {
                    // Every badge is computed from the material's own text here, on the client, through the
                    // same function the run used - a model never gets to say 已核实.
                    const locator = material
                      ? researchExtractionEvidenceLocator(material, fact.evidence)
                      : { verified: false, at: "" };
                    return (
                      <div key={index} className="grid gap-2 rounded-xl border border-sky-100 bg-white px-3 py-2">
                        <div className="flex items-start gap-2">
                          <input
                            value={fact.statement}
                            onChange={(event) =>
                              setDraft((prev) => ({
                                ...prev,
                                facts: prev.facts.map((entry, position) =>
                                  position === index ? { ...entry, statement: event.target.value } : entry,
                                ),
                              }))
                            }
                            className={consoleInputClass}
                          />
                          <button
                            type="button"
                            title={t("btnDelete")}
                            onClick={() =>
                              setDraft((prev) => ({
                                ...prev,
                                facts: prev.facts.filter((_entry, position) => position !== index),
                              }))
                            }
                            className="rounded-lg p-1.5 text-rose-500 transition hover:bg-rose-50"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                        <input
                          value={fact.evidence}
                          placeholder={t("rxEvidencePlaceholder")}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              facts: prev.facts.map((entry, position) =>
                                position === index ? { ...entry, evidence: event.target.value } : entry,
                              ),
                            }))
                          }
                          className={consoleInputClass}
                        />
                        <VerifiedBadge locator={locator} />
                      </div>
                    );
                  })}
                </div>
              )}
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({ ...prev, facts: [...prev.facts, { statement: "", evidence: "" }] }))
                }
                className="mt-1 inline-flex items-center gap-1 text-xs text-sky-600 hover:underline"
              >
                <Plus className="size-3.5" />
                {t("rxAddFact")}
              </button>
            </Section>

            <Section title={t("rxQuotes")} hint={t("rxListHint")}>
              <textarea
                value={draft.quotes}
                onChange={(event) => setDraft((prev) => ({ ...prev, quotes: event.target.value }))}
                className={`${consoleInputClass} min-h-20 resize-y`}
              />
              {quoteLines.length > 0 ? (
                <ul className="mt-1 grid gap-1">
                  {quoteLines.map((quote, index) => (
                    <li key={index} className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="min-w-0 flex-1 truncate" title={quote}>
                        {quote}
                      </span>
                      <VerifiedBadge
                        locator={
                          material
                            ? researchExtractionEvidenceLocator(material, quote)
                            : { verified: false, at: "" }
                        }
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </Section>

            <Section title={t("rxTopicSuggestions")} hint={t("rxSuggestionNote")}>
              {record.topicSuggestions.length === 0 ? (
                <span className="text-xs text-zinc-400">{t("rxNoTopics")}</span>
              ) : (
                <ul className="grid gap-2">
                  {record.topicSuggestions.map((suggestion, index) => (
                    <li
                      key={index}
                      className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-zinc-800">{suggestion.title}</span>
                        {suggestion.rationale ? (
                          <span className="mt-0.5 block text-xs text-zinc-500">{suggestion.rationale}</span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleCreateTopic(index)}
                        className="rounded-lg border border-violet-200 px-2 py-1 text-xs text-violet-700 transition hover:bg-violet-100"
                      >
                        {t("rxConvertTopic")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {history.length > 0 ? (
              <details className="text-xs text-zinc-500">
                <summary className="cursor-pointer">{t("rxHistory", { count: history.length })}</summary>
                <ul className="mt-1 grid gap-1">
                  {history.map((version) => (
                    <li key={version.revision}>
                      v{version.revision} · {formatDateTime(version.generatedAt)} · {version.taskId}
                      {version.editedAt ? ` · ${t("rxEditedTag")}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}
        {topicNotice ? <p className="text-sm text-violet-600">{topicNotice}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={material ? researchMaterialWritingHref(locale, material.id, { includeExtraction: true }) : "#"}
              className="text-sm text-violet-600 hover:underline"
            >
              {t("rxWriteFrom")}
            </Link>
            {createdTopic ? (
              <Link href={localizedPath(locale, "/creation/topics")} className="text-sm text-sky-600 hover:underline">
                {t("rxOpenTopics")}
              </Link>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("btnCancel")}
            </Button>
            {record ? (
              <Button variant="outline" onClick={() => void handleSave()} loading={saving}>
                {t("btnSave")}
              </Button>
            ) : null}
            <Button onClick={() => void handleGenerate()} loading={submitting} disabled={!material || !hasText}>
              {record ? <RefreshCw size={15} /> : <ListChecks size={15} />}
              {record ? t("rxRegenerate") : t("rxGenerate")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** One stored fact about the run; a field the record does not carry renders as `-`, never as a guess. */
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-zinc-400">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-zinc-600" title={value}>
        {value || "-"}
      </dd>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium text-zinc-700">{title}</span>
      {children}
      {hint ? <span className="text-xs text-zinc-400">{hint}</span> : null}
    </div>
  );
}

/**
 * The verification badge of one excerpt.
 *
 * 原文可查 means the material's own text really contains that excerpt - and, for a transcript, where in the
 * media it was said (`at`). 原文中未找到 means it does not, and such a fact is also what the writing prompt
 * leaves out. There is no third state: a badge always says one of the two.
 */
function VerifiedBadge({ locator }: { locator: { verified: boolean; at: string } }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
        locator.verified ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
      )}
    >
      {locator.verified ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
      {locator.verified ? t("rxVerified") : t("rxUnverified")}
      {locator.at ? <span className="font-mono">{locator.at}</span> : null}
    </span>
  );
}
