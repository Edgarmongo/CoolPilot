"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Loader2, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { ApiClientError, apiGet, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import { formatMediaSize, type StoredMediaSource } from "@/lib/media-library";
import type { TaskLogEntry, TaskStatus, TaskView } from "@/lib/tasks/task-view";
import {
  transcriptionProviderIds,
  transcriptionProviderLabelKeys,
  type TranscriptionProviderId,
} from "@/lib/transcription/transcription";
import type { ResearchMaterialRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 音视频转录 (CI-P3-02-01/02 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The entry point of the card: pick an imported audio/video file, pick the engine, submit, watch the run
 * and open the transcript it produced. Everything it shows comes from a route that already exists:
 *
 * - the files are `GET /api/media` (the workspace's `media/` section - the same listing the storage route
 *   serves bytes for, so an entry the screen offers is one the task can really read);
 * - the engines are `GET /api/transcription/providers`, asked **before** the run so "no recognizer is
 *   installed" is read while choosing rather than waited for;
 * - the task is `POST /api/transcription` (create + start) and then `GET /api/tasks/<id>` - the CI-P1-02
 *   view of the very `runs` row the request created, which is why progress, the log lines and the error
 *   text here cannot disagree with the task console.
 *
 * Three deliberate refusals, because a transcription is minutes long and a screen that guesses is worse
 * than one that says nothing:
 *
 * 1. **The button is disabled until the file and the engine are both real.** With no media imported there
 *    is nothing to transcribe, and the panel says that instead of offering a run that cannot start.
 * 2. **Progress is only what the task said.** `task.progress` is `null` until an event carries a signal,
 *    and this panel renders no bar for `null` - a spinner and a stage line are what is known.
 * 3. **A finished task is not a finished transcript.** The panel reads the material id out of the run's
 *    own `done` event, so "打开转写" opens the material the *run* wrote; a task that ended without one is
 *    shown as its failure, never as an empty transcript.
 */

/** `GET /api/transcription/providers`: one entry per engine, with what a run would fall back to. */
type ProviderEntry = {
  providerId: TranscriptionProviderId;
  available: boolean;
  detail: string;
  fallbackOrder: TranscriptionProviderId[];
};

type SubmitResult = {
  taskId: string;
  lookup: string;
  reused: boolean;
  started: boolean;
};

/** The two statuses in which a row still has work ahead of it; the panel polls only then. */
function isInFlight(status: TaskStatus) {
  return status === "queued" || status === "running";
}

/** The canonical status of a task, in the console's own words (the row's literal stays in `rawStatus`). */
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

/** `yyyy-MM-dd HH:mm`, the format the rest of the console shows a task's own timestamp in. */
function formatDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

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

export function ResearchTranscriptionPanel({
  materials,
  onMaterialSaved,
  onOpenTranscript,
}: {
  /** The materials the list already holds: the target `<select>` is built from them, not from a second read. */
  materials: ResearchMaterialRecord[];
  onMaterialSaved: () => void;
  onOpenTranscript: (materialId: string) => void;
}) {
  const { t } = useI18n();
  const { data: media } = useSWR<{ media: StoredMediaSource[] }>("/api/media", swrFetcher);
  const { data: taskList, mutate: reloadTasks } = useSWR<{ tasks: TaskView[] }>("/api/transcription", swrFetcher, {
    refreshInterval: 5000,
  });
  const [providers, setProviders] = useState<ProviderEntry[] | null>(null);
  const [sourceKey, setSourceKey] = useState("");
  const [providerId, setProviderId] = useState<TranscriptionProviderId>("ai-runtime");
  const [language, setLanguage] = useState("");
  const [title, setTitle] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeTaskId, setActiveTaskId] = useState("");

  // Memoised because the preselection effect below reads it: a fresh array per render would make that
  // effect depend on something that never stops changing.
  const sources = useMemo(() => media?.media ?? [], [media]);
  const tasks = taskList?.tasks ?? [];

  // Asked once, on mount: the answer is a probe of *this machine* (a credential, a model, an installed
  // recognizer), not of the request, so re-asking on every render would be a slower way to learn nothing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await apiGet<{ providers: ProviderEntry[] }>("/api/transcription/providers");
        if (!cancelled) setProviders(result.providers);
      } catch {
        // An unreadable engine list is shown as "no engine answered", which is what the empty list means.
        if (!cancelled) setProviders([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The newest import is preselected - "the file I just imported" is what an entry point is for - and it
  // stays a choice the user can change.
  useEffect(() => {
    if (sourceKey || sources.length === 0) return;
    window.queueMicrotask(() => setSourceKey(sources[0].fileName));
  }, [sourceKey, sources]);

  const providerEntry = providers?.find((entry) => entry.providerId === providerId) ?? null;

  const { data: detail } = useSWR<{ task: TaskView; logs: TaskLogEntry[] }>(
    activeTaskId ? `/api/tasks/${activeTaskId}` : null,
    swrFetcher,
    {
      // Polled only while the row has work ahead of it: a settled task's log cannot change, and a timer
      // over a finished task is a request per two seconds that can only ever return the same bytes.
      refreshInterval: (latest) => (latest && isInFlight(latest.task.status) ? 2000 : 0),
    },
  );
  const activeTask = detail?.task ?? null;
  const logs = useMemo(() => detail?.logs ?? [], [detail]);
  const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;

  // The material this run recorded, read out of the run's own events. It is the only honest answer to
  // "where did the transcript go": params carry what was *asked for*, not what was written.
  const producedMaterialId = useMemo(() => {
    for (let index = logs.length - 1; index >= 0; index -= 1) {
      const value = logs[index]?.data?.materialId;
      if (typeof value === "string" && value) return value;
    }
    return "";
  }, [logs]);

  useEffect(() => {
    if (!producedMaterialId) return;
    onMaterialSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producedMaterialId]);

  /**
   * Submits one transcription.
   *
   * No `idempotencyKey` is sent on purpose: without one, a second submission of a file that is *already
   * running* returns that task instead of queueing a duplicate (the protection a double click needs),
   * while a submission after the first finished is a new run - because "transcribe it again, this time
   * with the other engine" is a legitimate thing to ask and a key would have refused it forever.
   */
  async function handleStart() {
    const source = sources.find((entry) => entry.fileName === sourceKey);
    if (!source) return;
    setSubmitting(true);
    setNotice("");
    setActiveTaskId("");
    try {
      const result = await apiPost<SubmitResult>("/api/transcription", {
        sourceRoot: "media",
        sourceFileName: source.fileName,
        providerId,
        language: language.trim(),
        materialId,
        title: title.trim(),
      });
      setActiveTaskId(result.taskId);
      setNotice(result.reused ? t("trSubmittedReused", { id: result.taskId }) : t("trSubmitted", { id: result.taskId }));
      void reloadTasks();
    } catch (error) {
      setNotice(error instanceof ApiClientError ? error.message : t("trSubmitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-sky-100 bg-white p-4">
      <div className="flex items-center gap-2">
        <Play className="size-4 text-sky-600" />
        <h2 className="text-sm font-semibold text-zinc-900">{t("trPanelTitle")}</h2>
      </div>
      <p className="mt-1 text-xs text-zinc-500">{t("trPanelHint")}</p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-xs font-medium text-zinc-600">{t("trMediaFile")}</span>
          <select
            value={sourceKey}
            onChange={(event) => setSourceKey(event.target.value)}
            className={consoleInputClass}
          >
            <option value="">{t("trMediaNone")}</option>
            {sources.map((source) => (
              <option key={source.fileName} value={source.fileName}>
                {source.fileName} · {formatMediaSize(source.size)}
              </option>
            ))}
          </select>
          {sources.length === 0 ? <span className="text-xs text-amber-600">{t("trNoMedia")}</span> : null}
        </label>

        <label className="grid gap-1">
          <span className="text-xs font-medium text-zinc-600">{t("trEngine")}</span>
          <select
            value={providerId}
            onChange={(event) => setProviderId(event.target.value as TranscriptionProviderId)}
            className={consoleInputClass}
            disabled={providers === null}
          >
            {transcriptionProviderIds.map((id) => {
              const entry = providers?.find((item) => item.providerId === id);
              return (
                <option key={id} value={id}>
                  {t(transcriptionProviderLabelKeys[id])}
                  {entry && !entry.available ? ` · ${t("trEngineOff")}` : ""}
                </option>
              );
            })}
          </select>
          {/* The engine's own answer, verbatim: which credential is missing, which recognizer is installed. */}
          <span
            className={cn(
              "text-xs",
              providers === null ? "text-zinc-400" : providerEntry?.available ? "text-zinc-400" : "text-amber-600",
            )}
          >
            {providers === null ? t("trEngineChecking") : (providerEntry?.detail ?? "")}
          </span>
          {providerEntry && providerEntry.fallbackOrder.length > 1 ? (
            <span className="text-xs text-zinc-400">
              {t("trEngineFallback", {
                order: providerEntry.fallbackOrder.map((id) => t(transcriptionProviderLabelKeys[id])).join(" → "),
              })}
            </span>
          ) : null}
        </label>

        <label className="grid gap-1">
          <span className="text-xs font-medium text-zinc-600">{t("trLanguageLabel")}</span>
          <input
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            placeholder={t("trLanguagePlaceholder")}
            className={consoleInputClass}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-xs font-medium text-zinc-600">{t("trMaterialTitle")}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("trMaterialTitlePlaceholder")}
            className={consoleInputClass}
          />
        </label>

        <label className="grid gap-1 md:col-span-2">
          <span className="text-xs font-medium text-zinc-600">{t("trTargetMaterial")}</span>
          <select value={materialId} onChange={(event) => setMaterialId(event.target.value)} className={consoleInputClass}>
            <option value="">{t("trTargetMaterialNew")}</option>
            {materials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => void handleStart()} loading={submitting} disabled={!sourceKey || providers === null}>
          <Play size={14} />
          {submitting ? t("trStarting") : t("trStart")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void reloadTasks()}>
          <RefreshCw size={14} />
          {t("trRefresh")}
        </Button>
      </div>

      {notice ? <p className="mt-2 text-sm text-zinc-600">{notice}</p> : null}
      {activeTask ? (
        <div className="mt-4 grid gap-2 rounded-xl border border-sky-100 bg-sky-50/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusClass[activeTask.status])}>
              {t(taskStatusLabelKeys[activeTask.status])}
            </span>
            {isInFlight(activeTask.status) ? <Loader2 className="size-3.5 animate-spin text-sky-500" /> : null}
            <span className="truncate font-mono text-xs text-zinc-400" title={activeTask.type}>
              {activeTask.id}
            </span>
            {/* The row's own literal, kept next to the canonical status: never dropped, never translated. */}
            <span className="text-xs text-zinc-400">{t("trRawStatus", { status: activeTask.rawStatus })}</span>
          </div>
          {typeof activeTask.progress === "number" ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white">
              <div className="h-full rounded-full bg-sky-500" style={{ width: `${activeTask.progress}%` }} />
            </div>
          ) : null}
          {lastLog ? <span className="text-xs text-zinc-500">{lastLog.message}</span> : null}
          {activeTask.error ? <span className="text-xs text-rose-500">{activeTask.error.message}</span> : null}
          {producedMaterialId ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => onOpenTranscript(producedMaterialId)}>
                {t("trViewTranscript")}
              </Button>
              <span className="text-xs text-zinc-500">{t("trStored")}</span>
            </div>
          ) : null}
          {logs.length > 0 ? (
            <details className="text-xs text-zinc-500">
              <summary className="cursor-pointer">{t("trShowLogs", { count: logs.length })}</summary>
              <div className="mt-1 max-h-40 overflow-y-auto font-mono text-[11px] leading-5">
                {logs.map((entry, index) => (
                  <p key={index} className={entry.level === "error" ? "text-rose-500" : undefined}>
                    {entry.message}
                  </p>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4">
        <span className="text-xs font-medium text-zinc-600">{t("trTasksTitle")}</span>
        {tasks.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-400">{t("trTasksEmpty")}</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-xl border border-sky-100">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="bg-sky-50/60 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("trMediaFile")}</th>
                  <th className="px-3 py-2 font-medium">{t("trColumnStatus")}</th>
                  <th className="px-3 py-2 font-medium">{t("trColumnUpdated")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-50">
                {tasks.slice(0, 5).map((task) => (
                  <tr key={task.id}>
                    <td className="max-w-[220px] truncate px-3 py-2 text-zinc-700">
                      {String(task.input.sourceFileName ?? task.id)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={cn("rounded-full px-2 py-0.5 font-medium", statusClass[task.status])}>
                        {t(taskStatusLabelKeys[task.status])}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-400">{formatDateTime(task.updatedAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setActiveTaskId(task.id)}
                        className="text-sky-600 hover:underline"
                      >
                        {t("trOpenTask")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

