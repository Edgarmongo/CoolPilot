"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Clapperboard, Download, Loader2, Plus, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConsoleNotice, ConsoleCard, ConsoleSectionHeader, consoleInputClass } from "@/components/ui/console-surface";
import { swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import type { TaskStatus, TaskView } from "@/lib/tasks/task-view";
import { cn } from "@/lib/utils";
import { formatVideoSize, type StoredVideo } from "@/lib/video-library";
import {
  videoRenderToolPath,
  type VideoRenderArtifact,
  type VideoRenderTemplateSummary,
} from "@/lib/videos/video-render-artifacts";

/**
 * CI-P1-04, sub-item P1-04-07: the screen the video render capability never had.
 *
 * CI-P1-04 shipped the template contract, the render task, the pass-through renderer and
 * `POST /api/tools/video_render` - and no caller. `video_render` appeared in `GET /api/tools` and in the
 * run queue's raw playbook list, which means a user could not render anything, could not see a render
 * that ran, and could not get the subtitle or metadata sidecars a package writes.
 *
 * Everything this panel reads already existed or was added by this sub-item, and each piece is named so
 * the wiring is checkable:
 *
 * - the **materials** are `GET /api/videos` (the local library) and `GET /api/images` (the covers);
 * - the **templates** and the **renders**, with the artifacts of each, are `GET /api/videos/renders`;
 * - a **render** is created through the one existing entry, `POST /api/tools/video_render`;
 * - the **sidecars** are read from `GET /api/videos/renders/<id>?file=`.
 *
 * Two refusals this panel keeps, for the same reason the transcription panel keeps its own:
 *
 * 1. **No render is started without a material.** The button is disabled until a video of the library is
 *    selected, and an empty library says so instead of offering a run that cannot start.
 * 2. **The approval is the user's.** `video_render` writes files into the workspace and a task row, so the
 *    tool's own `requiresApproval()` is `true` and an unapproved call stops at `APPROVAL_REQUIRED`. This
 *    panel presents the grant the way the Agent loop does - after a confirmation that names what will be
 *    written - and never grants it silently on mount.
 */

/** `GET /api/videos/renders`: the render registry plus the render tasks this workspace has run. */
type RendersPayload = {
  templates: VideoRenderTemplateSummary[];
  renders: Array<{ task: TaskView; artifacts: VideoRenderArtifact[]; encoded: boolean | null }>;
};

/** `GET /api/images`: the workspace's artifact images, which are the covers a package may carry. */
type ImagesPayload = { images: Array<{ fileName: string; url: string }> };

/** One caption row as typed; the numbers become milliseconds only when the row is submitted. */
type CaptionRow = { startMs: string; endMs: string; text: string };

type RenderForm = {
  templateId: string;
  videoFileName: string;
  coverFileName: string;
  title: string;
  subtitles: boolean;
  captions: CaptionRow[];
};

const emptyCaption: CaptionRow = { startMs: "", endMs: "", text: "" };

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

/** `yyyy-MM-dd HH:mm`, the format the rest of the console shows a task's own timestamp in. */
function formatDateTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/** The artifact's slot, in the console's words. */
const artifactLabelKeys: Record<VideoRenderArtifact["slot"], TranslationKey> = {
  video: "vrArtifactVideo",
  subtitles: "vrArtifactSubtitles",
  metadata: "vrArtifactMetadata",
};

/**
 * The deliverable address of one package, or `""` when the task wrote no video.
 *
 * The `<video>` element is only rendered when this answers a real address, so a package that failed before
 * its deliverable stage shows its failure instead of an empty player.
 */
function videoOf(artifacts: readonly VideoRenderArtifact[]) {
  return artifacts.find((artifact) => artifact.slot === "video")?.url ?? "";
}

/**
 * The tool input this form describes: the template it picked, the materials it named and the parameters
 * the user filled in.
 *
 * Empty fields are **omitted rather than sent blank**, because the defaults belong to the template
 * (`video-template.ts`): sending `title: ""` would be this screen claiming an empty title is a choice,
 * and sending `captions: []` would claim the user asked for an empty track.
 */
function buildToolInput(form: RenderForm) {
  const captions = form.captions
    .filter((row) => row.startMs.trim() !== "" || row.endMs.trim() !== "" || row.text.trim() !== "")
    .map((row) => ({ startMs: Number(row.startMs), endMs: Number(row.endMs), text: row.text }));
  return {
    template: { id: form.templateId },
    materials: {
      video: form.videoFileName,
      ...(form.coverFileName ? { cover: form.coverFileName } : {}),
    },
    params: {
      ...(form.title.trim() ? { title: form.title.trim() } : {}),
      ...(captions.length ? { captions } : {}),
      subtitles: form.subtitles,
    },
  };
}

/**
 * A row is refused here, before the request, when its two times are not whole milliseconds or its window
 * does not advance: the gate writes nothing, and a message next to the fields is a better answer than a
 * task row that fails on its first stage.
 */
function invalidCaptionRows(form: RenderForm) {
  return form.captions.some((row) => {
    const empty = row.startMs.trim() === "" && row.endMs.trim() === "" && row.text.trim() === "";
    if (empty) return false;
    const start = Number(row.startMs);
    const end = Number(row.endMs);
    if (!Number.isInteger(start) || start < 0) return true;
    if (!Number.isInteger(end) || end <= start) return true;
    return row.text.trim() === "";
  });
}

type ToolCallAnswer =
  | { ok: true; data: { taskId?: unknown } }
  | { ok: false; code: string; message: string };

/**
 * Calls the render tool and reads the contract's own envelope (§3.2), which is not the `{ ok, data }`
 * shape `apiPost()` unwraps: a tool failure arrives as `{ ok: false, error: { code, message, … } }`, so
 * the code and the message are read from there instead of being flattened into one sentence.
 *
 * The approval is presented here rather than on mount: the caller sends `grantedToolCallId` **after** the
 * user confirmed the dialog that names the files about to be written, which is the same thing the Agent
 * loop does with its own approved tool-call id.
 *
 * The address is named by the Node-free artifacts module rather than imported from the tool's own module:
 * `video-render-tool.ts` executes the task, and the task reaches the database, so importing it from a
 * client component would pull `node:fs` into the browser bundle.
 */
async function callVideoRenderTool(input: unknown, approvalId: string): Promise<ToolCallAnswer> {
  const response = await fetch(videoRenderToolPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, approvals: { grantedToolCallId: approvalId } }),
  });
  const payload = (await response.json().catch(() => null)) as
    | { ok: true; data: { taskId?: unknown } }
    | { ok: false; error?: { code?: string; message?: string } }
    | null;
  if (payload?.ok) return { ok: true, data: payload.data };
  return {
    ok: false,
    code: (payload && !payload.ok && payload.error?.code) || "TOOL_FAILED",
    message: (payload && !payload.ok && payload.error?.message) || `HTTP ${response.status}`,
  };
}

export function VideoRenderPanel() {
  const { t } = useI18n();
  const { data: library } = useSWR<{ videos: StoredVideo[] }>("/api/videos", swrFetcher);
  const { data: images } = useSWR<ImagesPayload>("/api/images", swrFetcher);
  const {
    data: renders,
    error: rendersError,
    mutate,
  } = useSWR<RendersPayload>("/api/videos/renders?limit=20", swrFetcher);

  const templates = renders?.templates ?? [];
  const videos = library?.videos ?? [];
  const covers = images?.images ?? [];
  const history = renders?.renders ?? [];

  const [form, setForm] = useState<RenderForm>({
    templateId: "",
    videoFileName: "",
    coverFileName: "",
    title: "",
    subtitles: true,
    captions: [],
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // The template the form is written for: the one the user picked, else the first the build publishes.
  // Reading it from the registry (instead of holding an id here) is what keeps this screen and the tool
  // from disagreeing about which templates exist.
  const templateId = form.templateId || templates[0]?.id || "";
  const effective: RenderForm = useMemo(() => ({ ...form, templateId }), [form, templateId]);

  const captionsInvalid = useMemo(() => invalidCaptionRows(form), [form]);

  const update = (patch: Partial<RenderForm>) => setForm((current) => ({ ...current, ...patch }));

  async function submit() {
    if (!effective.videoFileName) {
      setError(t("vrNeedVideo"));
      return;
    }
    if (captionsInvalid) {
      setError(t("vrCaptionInvalid"));
      return;
    }
    setRunning(true);
    setError("");
    setNotice("");
    const answer = await callVideoRenderTool(buildToolInput(effective), `video-render-${Date.now()}`);
    setRunning(false);
    setConfirmOpen(false);
    if (!answer.ok) {
      setError(`${answer.code}: ${answer.message}`);
      // The run this refusal belongs to is in the list either way - a failed render keeps its task row and
      // its log - so the list is re-read rather than this message being the only account of it.
      await mutate();
      return;
    }
    setNotice(t("vrSucceeded"));
    await mutate();
  }

  const disabled = running || !effective.videoFileName || templates.length === 0;

  return (
    <ConsoleCard>
      <ConsoleSectionHeader icon={<Clapperboard size={18} />} title={t("vrTitle")} />
      <p className="mt-3 text-xs text-zinc-500">{t("vrDesc")}</p>

      {error ? (
        <div className="mt-4">
          <ConsoleNotice message={error} tone="error" onDismiss={() => setError("")} />
        </div>
      ) : null}
      {notice ? (
        <div className="mt-4">
          <ConsoleNotice message={notice} onDismiss={() => setNotice("")} />
        </div>
      ) : null}

      {templates.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">{t("vrNoTemplates")}</p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-zinc-500">{t("vrTemplateLabel")}</span>
            <select
              className={consoleInputClass}
              value={templateId}
              onChange={(event) => update({ templateId: event.target.value })}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.id} · v{template.version}
                </option>
              ))}
            </select>
            <span className="text-xs text-zinc-400">
              {templates.find((template) => template.id === templateId)?.description ?? ""}
            </span>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-zinc-500">{t("vrVideoLabel")}</span>
            <select
              className={consoleInputClass}
              value={form.videoFileName}
              onChange={(event) => update({ videoFileName: event.target.value })}
            >
              <option value="">{t("vrVideoPlaceholder")}</option>
              {videos.map((video) => (
                <option key={video.fileName} value={video.fileName}>
                  {video.fileName} · {formatVideoSize(video.size)}
                </option>
              ))}
            </select>
            {videos.length === 0 ? <span className="text-xs text-amber-600">{t("vrNoVideos")}</span> : null}
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-zinc-500">{t("vrCoverLabel")}</span>
            <select
              className={consoleInputClass}
              value={form.coverFileName}
              onChange={(event) => update({ coverFileName: event.target.value })}
            >
              <option value="">{t("vrCoverNone")}</option>
              {covers.map((cover) => (
                <option key={cover.fileName} value={cover.fileName}>
                  {cover.fileName}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-zinc-500">{t("vrTitleFieldLabel")}</span>
            <input
              className={consoleInputClass}
              maxLength={120}
              value={form.title}
              onChange={(event) => update({ title: event.target.value })}
            />
          </label>
        </div>
      )}

      {templates.length > 0 ? (
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={form.subtitles}
              onChange={(event) => update({ subtitles: event.target.checked })}
            />
            {t("vrSubtitlesToggle")}
          </label>

          <div className="rounded-2xl border border-sky-100 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-zinc-500">{t("vrCaptionsLabel")}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => update({ captions: [...form.captions, { ...emptyCaption }] })}
              >
                <Plus size={14} />
                {t("vrCaptionAdd")}
              </Button>
            </div>
            {form.captions.length === 0 ? null : (
              <div className="mt-3 space-y-2">
                {form.captions.map((row, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-2">
                    <input
                      className={cn(consoleInputClass, "w-28")}
                      inputMode="numeric"
                      placeholder={t("vrCaptionStartMs")}
                      value={row.startMs}
                      onChange={(event) =>
                        update({
                          captions: form.captions.map((entry, at) =>
                            at === index ? { ...entry, startMs: event.target.value } : entry,
                          ),
                        })
                      }
                    />
                    <input
                      className={cn(consoleInputClass, "w-28")}
                      inputMode="numeric"
                      placeholder={t("vrCaptionEndMs")}
                      value={row.endMs}
                      onChange={(event) =>
                        update({
                          captions: form.captions.map((entry, at) =>
                            at === index ? { ...entry, endMs: event.target.value } : entry,
                          ),
                        })
                      }
                    />
                    <input
                      className={cn(consoleInputClass, "min-w-[12rem] flex-1")}
                      placeholder={t("vrCaptionText")}
                      value={row.text}
                      onChange={(event) =>
                        update({
                          captions: form.captions.map((entry, at) =>
                            at === index ? { ...entry, text: event.target.value } : entry,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      aria-label={t("vrCaptionRemove")}
                      className="rounded-md p-1 text-zinc-400 transition hover:text-rose-500"
                      onClick={() => update({ captions: form.captions.filter((_, at) => at !== index) })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {captionsInvalid ? (
                  <p className="text-xs text-amber-600">{t("vrCaptionInvalid")}</p>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button disabled={disabled} onClick={() => setConfirmOpen(true)}>
              {running ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />}
              {t("vrStart")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 border-t border-sky-100 pt-4">
        <h3 className="text-sm font-semibold text-zinc-900">{t("vrHistoryTitle")}</h3>
        {rendersError ? <p className="mt-2 text-sm text-rose-600">{t("vrLoadFailed")}</p> : null}
        {!rendersError && history.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">{t("vrHistoryEmpty")}</p>
        ) : null}
        <div className="mt-3 space-y-3">
          {history.map((entry, index) => (
            <div key={entry.task.id} className="rounded-2xl border border-sky-100 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={cn("rounded-full px-2 py-0.5 font-medium", statusClass[entry.task.status])}>
                  {t(taskStatusLabelKeys[entry.task.status])}
                </span>
                <span className="text-zinc-400">{formatDateTime(entry.task.createdAt)}</span>
                <span className="font-mono text-[11px] text-zinc-400">{entry.task.id}</span>
                {entry.encoded === false ? (
                  <span className="text-amber-600">{t("vrNotEncoded")}</span>
                ) : null}
              </div>
              {entry.task.error ? (
                <p className="mt-2 text-xs text-rose-600">{entry.task.error.message}</p>
              ) : null}
              {index === 0 && videoOf(entry.artifacts) ? (
                // Only the newest package gets a player: the older entries keep their download links, which
                // is what they are for, and twenty <video> elements on one screen would be twenty decoders.
                <video
                  className="mt-3 max-h-56 w-full rounded-xl bg-black"
                  controls
                  src={videoOf(entry.artifacts)}
                />
              ) : null}
              {entry.artifacts.length === 0 ? null : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {entry.artifacts.map((artifact) => (
                    <a
                      key={artifact.fileName}
                      href={artifact.url}
                      download={artifact.fileName}
                      className="inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50/60 px-2.5 py-1 text-xs text-zinc-700 transition hover:border-sky-300"
                    >
                      <Download size={12} />
                      {t(artifactLabelKeys[artifact.slot])} · {artifact.fileName}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t("vrConfirmTitle")}>
        <p className="text-sm text-zinc-600">
          {t("vrConfirmBody", { video: effective.videoFileName })}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmOpen(false)}>
            {t("vrCancel")}
          </Button>
          <Button disabled={running} onClick={submit}>
            {running ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />}
            {t("vrConfirmOk")}
          </Button>
        </div>
      </Dialog>
    </ConsoleCard>
  );
}

