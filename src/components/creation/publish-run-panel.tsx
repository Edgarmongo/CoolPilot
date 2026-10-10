"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, SkipForward, TriangleAlert, XCircle } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { offeredDraftFields, type PublishDraftEvidence } from "@/lib/browser-preview-shared";
import { useI18n } from "@/lib/i18n";
import type { RunLifecycleStatus } from "@/lib/publish-run-teardown";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import type { TranslationKey } from "@/lib/locale-resources";
import type { AccountRecord, ContentItem } from "@/lib/types";
import { videoPathFromMetadata } from "@/lib/video-library";

/**
 * The tab's status vocabulary *is* the teardown guard's (`src/lib/publish-run-teardown.ts`), so
 * "which run is still holding a session" is answered in one place: the panel renders it and the
 * dialog asks about it before closing (C2-1d).
 */
type RunStatus = RunLifecycleStatus;

type RunTab = {
  accountId: string;
  name: string;
  platform: string;
  status: RunStatus;
  error?: string;
  url?: string;
  /** What the prefill's page took, once the draft step has answered (C2-1a). */
  evidence?: PublishDraftEvidence;
};

/**
 * The verify's answer (C2-1b of `docs/assisted-publishing-engine.md`). `outcome` is optional so a
 * panel talking to a server that only knows `published` still works: an answer without it is read as
 * "keep waiting".
 */
type VerifyResponse = {
  published: boolean;
  outcome?: "waiting" | "published" | "unknown";
  url: string;
};

const statusLabelKey: Record<RunStatus, TranslationKey> = {
  queued: "publishTabQueued",
  preparing: "publishTabPreparing",
  editing: "publishTabEditing",
  unknown: "publishTabUnknown",
  published: "publishResultPublished",
  discarded: "publishTabDiscarded",
  failed: "publishResultFailed",
};

const statusToneClass: Record<RunStatus, string> = {
  queued: "bg-zinc-100 text-zinc-600",
  preparing: "bg-amber-100 text-amber-700",
  editing: "bg-sky-100 text-sky-700",
  unknown: "bg-orange-100 text-orange-700",
  published: "bg-emerald-100 text-emerald-700",
  discarded: "bg-zinc-100 text-zinc-600",
  failed: "bg-rose-100 text-rose-700",
};

const settledStatuses: RunStatus[] = ["published", "discarded", "failed"];

/** The three pieces a draft can be evidence about, as the panel names them. */
const draftFieldLabelKey: Record<"title" | "text" | "media", TranslationKey> = {
  title: "publishEvidenceTitle",
  text: "publishEvidenceText",
  media: "publishEvidenceMedia",
};

/**
 * Maps a pointer position on the live preview back to a 0..1 coordinate in the
 * remote page. The image is laid out with `object-contain`, so on a maximized
 * dialog there are letterbox margins; ignoring them would skew clicks and wheel
 * scrolling.
 */
function pointerToFrame(img: HTMLImageElement, clientX: number, clientY: number) {
  const rect = img.getBoundingClientRect();
  const naturalWidth = img.naturalWidth || rect.width || 1;
  const naturalHeight = img.naturalHeight || rect.height || 1;
  const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight) || 1;
  const renderedWidth = naturalWidth * scale;
  const renderedHeight = naturalHeight * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  const x = (clientX - rect.left - offsetX) / renderedWidth;
  const y = (clientY - rect.top - offsetY) / renderedHeight;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

/**
 * Assisted (human-in-the-loop) publish runner. For each selected platform it
 * opens the editor, prefills the draft, and hands control to the author — who
 * edits in the embedded live view and clicks publish on the platform page. It
 * polls for success, then moves to the next platform.
 *
 * Since C2-1a it also reports what the prefill's page actually took, and a draft whose page took
 * nothing fails the run here rather than being shown as an editor to finish. Since C2-1d, asking to
 * close no longer stops a live session by itself: the request goes up to the dialog, which asks
 * first when a run would be abandoned (`src/lib/publish-run-teardown.ts`).
 */
export function PublishRunPanel({
  item,
  type,
  accounts,
  fullscreen = false,
  onClose,
  onPublished,
  onRequestClose,
  onStatusesChange,
}: {
  item: ContentItem;
  type: string;
  accounts: AccountRecord[];
  /** When true, stretch the live preview to fill the (maximized) dialog. */
  fullscreen?: boolean;
  onClose: () => void;
  onPublished?: () => void;
  /**
   * Close asked for by the author. `onClose` stays the panel's own "this run is over" (the
   * all-published auto-close); this is the author asking to leave, and it goes up to the dialog,
   * which is the only place that can ask whether the live runs should be abandoned (C2-1d).
   */
  onRequestClose?: () => void;
  /** Reports the tabs' statuses up, so the dialog knows whether a close would cost anything. */
  onStatusesChange?: (statuses: RunStatus[]) => void;
}) {
  const { t } = useI18n();
  const [tabs, setTabs] = useState<RunTab[]>(() =>
    accounts.map((account) => ({ accountId: account.id, name: account.name, platform: account.platform, status: "queued" })),
  );
  const [active, setActive] = useState(0);
  const [finished, setFinished] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const [debugPersist, setDebugPersist] = useState(false);
  const [copied, setCopied] = useState(false);

  const runToken = useRef(0);

  function patchTab(index: number, patch: Partial<RunTab>) {
    setTabs((prev) => prev.map((tab, i) => (i === index ? { ...tab, ...patch } : tab)));
  }

  async function stopAccount(accountId: string) {
    await fetch(`/api/browser-profiles/${accountId}/preview`, { method: "DELETE" }).catch(() => undefined);
  }

  async function startTab(index: number, token: number) {
    const account = accounts[index];
    setActive(index);
    setTypedText("");
    patchTab(index, { status: "preparing", error: undefined, url: undefined });

    await apiPost(`/api/browser-profiles/${account.id}/open`, { headless: true }).catch(() => undefined);
    if (runToken.current !== token) return;

    try {
      const data = await apiPost<{
        url: string;
        drafted?: boolean;
        evidence?: PublishDraftEvidence;
        loginRequired?: boolean;
      }>("/api/publish/draft", {
        accountIds: [account.id],
        title: item.title,
        text: item.postReadyText || item.body,
        imagePath: item.imagePath ?? "",
        videoPath: videoPathFromMetadata(item.metadata),
        contentType: type,
        method: "manual",
        terminal: "local",
        contentItemId: item.id,
      });
      if (runToken.current !== token) return;
      // C2-1a: `drafted` is the prefill's own answer about the page it is leaving the author on. A
      // page that took none of the content is not an editor, so this run fails here - with the page
      // still in front of the author - instead of showing 待编辑发布 over an empty draft. The old
      // panel read the response's URL only, which is how the smoke's 小红书 run reported "ready to
      // edit" while the prefill had walked through the creator home matching nothing.
      if (data.loginRequired) {
        patchTab(index, { status: "failed", error: t("publishDraftLoginRequired"), url: data.url });
        advanceFrom(index, token);
        return;
      }
      if (data.drafted === false) {
        patchTab(index, { status: "failed", error: t("publishDraftEmpty"), url: data.url });
        advanceFrom(index, token);
        return;
      }
      patchTab(index, { status: "editing", url: data.url, evidence: data.evidence });
    } catch (error) {
      patchTab(index, { status: "failed", error: error instanceof Error ? error.message : String(error) });
      advanceFrom(index, token);
    }
  }

  function advanceFrom(index: number, token: number) {
    if (runToken.current !== token) return;
    if (index + 1 < accounts.length) {
      void startTab(index + 1, token);
    } else {
      setFinished(true);
    }
  }

  // Start the first platform, and invalidate the run on unmount.
  useEffect(() => {
    const token = (runToken.current += 1);
    window.queueMicrotask(() => void startTab(0, token));
    return () => {
      runToken.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // C2-1d: whether closing would abandon work is decided from these statuses, and they live here.
  // The dialog keeps the copy it is given and asks its own question; the panel never stops a session
  // for a close the author has not confirmed.
  useEffect(() => {
    onStatusesChange?.(tabs.map((tab) => tab.status));
  }, [tabs, onStatusesChange]);

  const activeTab = tabs[active];
  const activeLive = activeTab ? activeTab.status === "preparing" || activeTab.status === "editing" || activeTab.status === "unknown" : false;
  // `unknown` keeps everything the author can still do: the page is theirs to finish - only the
  // *claim* is withheld, not the session, the view or the controls (C2-1b).
  const activeEditing = activeTab?.status === "editing" || activeTab?.status === "unknown";
  const allSettled = tabs.every((tab) => settledStatuses.includes(tab.status));
  const allSucceeded = tabs.every((tab) => tab.status === "published");

  // The live frame is streamed by <LiveFrame/> below, which owns its own polling
  // so the ~5×/s bitmap refresh only re-renders the preview, not this whole panel.

  // Poll for the platform's answer while the author finishes on the page.
  //
  // `unknown` keeps polling on purpose: the platform may confirm a moment later, and a run that went
  // quiet would look exactly like one that is still waiting. The tab only moves when the answer
  // changes, so a steady `waiting` does not re-render the panel every 2.5 s.
  useEffect(() => {
    if (!activeTab || (activeTab.status !== "editing" && activeTab.status !== "unknown")) return;
    const token = runToken.current;
    const index = active;
    const account = activeTab;
    const timer = setInterval(async () => {
      try {
        const res = await apiPost<VerifyResponse>("/api/publish/verify", { accountId: account.accountId });
        if (runToken.current !== token) return;
        if (res.published) {
          patchTab(index, { status: "published", url: res.url });
          void stopAccount(account.accountId);
          advanceFrom(index, token);
          return;
        }
        // C2-1b: the page left the draft and the server cannot certify a post. Say that much, rather
        // than showing "Ready to edit" for a page the draft is no longer on - and rather than
        // claiming a publish that nothing observed.
        const next: RunStatus = res.outcome === "unknown" ? "unknown" : "editing";
        if (next !== account.status) {
          patchTab(index, { status: next, url: res.url });
        }
      } catch {
        // transient; keep polling
      }
    }, 2500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, active]);

  // Poll the publish step log while the debug panel is open.
  useEffect(() => {
    const accountId = activeTab?.accountId;
    if (!debugOpen || !accountId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiPost<{ lines: string[]; enabled: boolean }>("/api/publish/logs", { accountId });
        if (!cancelled) {
          setDebugLines(res.lines);
          setDebugPersist(res.enabled);
        }
      } catch {
        // transient; keep polling
      }
    };
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [debugOpen, activeTab?.accountId]);

  async function togglePersist() {
    if (!activeTab) return;
    const next = !debugPersist;
    setDebugPersist(next);
    try {
      const res = await apiPost<{ lines: string[]; enabled: boolean }>("/api/publish/logs", {
        accountId: activeTab.accountId,
        debug: next,
      });
      setDebugLines(res.lines);
      setDebugPersist(res.enabled);
    } catch {
      setDebugPersist(!next);
    }
  }

  async function copyLogs() {
    try {
      await navigator.clipboard?.writeText(debugLines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; ignore
    }
  }

  async function skipActive() {
    const tab = tabs[active];
    // `unknown` is discardable too: the author can give up on a run the server cannot certify.
    if (!tab || (tab.status !== "editing" && tab.status !== "unknown")) return;
    const token = runToken.current;
    patchTab(active, { status: "discarded" });
    await apiPost("/api/publish/discard", { accountId: tab.accountId }).catch(() => undefined);
    await stopAccount(tab.accountId);
    advanceFrom(active, token);
  }

  async function handleClose() {
    await Promise.all(accounts.map((account) => stopAccount(account.id)));
    onClose();
  }

  /**
   * The author asked to leave (the 关闭 button). Nothing is stopped here (C2-1d): the dialog owns the
   * decision, because it is the one that can ask before a live session - and the draft on it - is
   * thrown away.
   */
  function requestClose() {
    if (onRequestClose) {
      onRequestClose();
      return;
    }
    void handleClose();
  }

  // Auto-close once every platform published.
  useEffect(() => {
    if (!finished || !allSettled || !allSucceeded) return;
    const timer = setTimeout(() => {
      onPublished?.();
      void handleClose();
    }, 1400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, allSettled, allSucceeded]);

  // Input forwarding: click, drag-select, wheel, typed text and keys.
  function sendInput(payload: Record<string, unknown>) {
    if (!activeTab) return;
    apiPost(`/api/browser-profiles/${activeTab.accountId}/input`, payload).catch(() => undefined);
  }
  // The remote browser runs on the host OS, so mirror its shortcut modifier (⌘ vs Ctrl).
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const accel = isMac ? 4 : 2; // CDP modifier bitmask: Ctrl=2, Meta=4
  const modLabel = isMac ? "⌘" : "Ctrl+";
  function sendKey(key: string, code: string, keyCode: number, modifiers = 0) {
    sendInput({ type: "key", key, code, keyCode, ...(modifiers ? { modifiers } : {}) });
  }
  function sendText() {
    if (!typedText) return;
    sendInput({ type: "text", text: typedText });
    setTypedText("");
  }


  return (
    <div className={fullscreen ? "flex h-full min-h-0 flex-col gap-3" : "space-y-3"}>
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab, index) => (
          <button
            key={tab.accountId}
            type="button"
            onClick={() => setActive(index)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              index === active ? "border-sky-300 bg-sky-50 text-sky-700" : "border-sky-100 bg-white text-zinc-600 hover:bg-sky-50/60"
            }`}
          >
            {tab.status === "preparing" ? <Loader2 size={13} className="animate-spin" /> : null}
            <span className="max-w-40 truncate">{tab.name}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${statusToneClass[tab.status]}`}>
              {t(statusLabelKey[tab.status])}
            </span>
          </button>
        ))}
      </div>

      <div
        className={`relative grid w-full place-items-center overflow-hidden rounded-2xl border border-sky-100 bg-sky-50/50 ${
          fullscreen ? "min-h-0 flex-1" : "aspect-[64/45]"
        }`}
      >
        {activeTab && activeLive ? (
          <LiveFrame
            key={activeTab.accountId}
            accountId={activeTab.accountId}
            interactive={activeEditing}
            placeholder={t("browserStarting")}
            onInput={sendInput}
          />
        ) : activeTab ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 text-center">
            <ResultIcon status={activeTab.status} />
            <p className="text-sm font-medium text-zinc-800">{t(statusLabelKey[activeTab.status])}</p>
            {activeTab.error ? <p className="max-w-lg text-xs text-rose-600">{activeTab.error}</p> : null}
            {activeTab.url ? (
              <a
                href={activeTab.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 truncate text-xs text-sky-600 hover:underline"
              >
                <ExternalLink size={13} />
                <span className="truncate">{activeTab.url}</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      {/*
        C2-1a: what the prefill's page actually took, shown where the author is about to work. A
        `✗` here is a part of the draft the platform refused, so the author knows to type or upload it
        themselves instead of publishing something that is quietly missing half of what they wrote.
      */}
      {activeTab?.evidence && activeEditing ? (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <li className="font-medium text-zinc-500">{t("publishPreparedHeading")}</li>
          {offeredDraftFields(activeTab.evidence).map(({ field, outcome }) => (
            <li key={field} className="inline-flex items-center gap-1 text-zinc-600">
              {outcome === "filled" ? (
                <CheckCircle2 size={13} className="text-emerald-500" />
              ) : (
                <XCircle size={13} className="text-rose-500" />
              )}
              {t(draftFieldLabelKey[field])}
            </li>
          ))}
        </ul>
      ) : null}

      {activeTab && activeEditing ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  sendText();
                }
              }}
              placeholder={t("loginTypeHint")}
              className={consoleInputClass}
            />
            <Button variant="outline" onClick={sendText}>
              {t("btnSave")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => sendKey("Enter", "Enter", 13)}>Enter</Button>
            <Button variant="outline" size="sm" onClick={() => sendKey("Tab", "Tab", 9)}>Tab</Button>
            <Button variant="outline" size="sm" onClick={() => sendKey("Backspace", "Backspace", 8)}>⌫</Button>
            <Button variant="outline" size="sm" title={`${modLabel}B`} onClick={() => sendKey("b", "KeyB", 66, accel)}>
              <span className="font-bold">B</span>
            </Button>
            <Button variant="outline" size="sm" title={`${modLabel}I`} onClick={() => sendKey("i", "KeyI", 73, accel)}>
              <span className="italic">I</span>
            </Button>
            <Button variant="outline" size="sm" title={`${modLabel}U`} onClick={() => sendKey("u", "KeyU", 85, accel)}>
              <span className="underline">U</span>
            </Button>
            <Button variant="outline" size="sm" title={`${modLabel}A`} onClick={() => sendKey("a", "KeyA", 65, accel)}>
              {modLabel}A
            </Button>
            <Button variant="outline" size="sm" title={`${modLabel}C`} onClick={() => sendKey("c", "KeyC", 67, accel)}>
              {modLabel}C
            </Button>
            <Button variant="outline" size="sm" title={`${modLabel}V`} onClick={() => sendKey("v", "KeyV", 86, accel)}>
              {modLabel}V
            </Button>
          </div>
          <p className={`text-xs ${activeTab?.status === "unknown" ? "text-orange-600" : "text-zinc-500"}`}>
            {activeTab?.status === "unknown" ? t("publishUnknownNotice") : t("publishEditingHint")}
          </p>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          {finished && allSettled && allSucceeded ? t("publishClosing") : t("publishDiscardHint")}
        </p>
      )}

      {activeTab ? (
        <div className="space-y-2 border-t border-zinc-100 pt-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setDebugOpen((open) => !open)}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-700"
            >
              {debugOpen ? "▾ " : "▸ "}
              {t("publishDebugLogs")}
            </button>
            {debugOpen ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void togglePersist()}
                  title={t("publishDebugRecordHint")}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium transition ${
                    debugPersist
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
                  }`}
                >
                  {debugPersist ? "●" : "○"} {t("publishDebugRecord")}
                </button>
                <Button variant="outline" size="sm" onClick={() => void copyLogs()}>
                  {copied ? t("publishCopied") : t("publishCopyLogs")}
                </Button>
              </div>
            ) : null}
          </div>
          {debugOpen ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-900 p-3 text-[11px] leading-relaxed text-zinc-100">
              {debugLines.join("\n")}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-end gap-2 border-t border-zinc-100 pt-3">
        {activeEditing ? (
          <Button variant="outline" onClick={() => void skipActive()}>
            <SkipForward size={14} />
            {t("publishDiscardDraft")}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => requestClose()}>
          {t("dlgClose")}
        </Button>
      </div>
    </div>
  );
}

function ResultIcon({ status }: { status: RunStatus }) {
  if (status === "published") return <CheckCircle2 size={34} className="text-emerald-500" />;
  if (status === "failed") return <XCircle size={34} className="text-rose-500" />;
  if (status === "discarded") return <SkipForward size={34} className="text-zinc-400" />;
  return <TriangleAlert size={34} className="text-amber-500" />;
}

/**
 * Live browser preview. Owns its own frame polling so the ~5×/s bitmap refresh
 * re-renders only this node, not the whole publish panel. Frames are fetched as
 * blobs guarded by the server's ETag (an idle editor answers 304 and the current
 * bitmap is kept, so there is no re-download or flicker) and swapped in via an
 * object URL. Pointer coordinates are mapped through `pointerToFrame` so clicks
 * and wheel scrolling land correctly even when the image is letterboxed.
 */
function LiveFrame({
  accountId,
  interactive,
  placeholder,
  onInput,
}: {
  accountId: string;
  interactive: boolean;
  placeholder: string;
  onInput: (payload: Record<string, unknown>) => void;
}) {
  const [src, setSrc] = useState("");
  const versionRef = useRef("");
  const urlRef = useRef("");
  const draggingRef = useRef(false);
  const lastMoveRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();

    function schedule() {
      if (!cancelled) timer = window.setTimeout(tick, 200);
    }

    async function tick() {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      try {
        const res = await fetch(`/api/browser-profiles/${accountId}/preview/frame`, {
          headers: versionRef.current ? { "If-None-Match": versionRef.current } : undefined,
          cache: "no-store",
          signal: controller.signal,
        });
        if (cancelled) return;
        if (res.status === 200) {
          const blob = await res.blob();
          if (cancelled) return;
          const nextUrl = URL.createObjectURL(blob);
          const previous = urlRef.current;
          urlRef.current = nextUrl;
          versionRef.current = res.headers.get("ETag") ?? "";
          setSrc(nextUrl);
          // Revoke once the browser has swapped the bitmap so there is no flash.
          if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 1000);
        }
      } catch {
        // transient error or abort; retry on the next tick
      }
      schedule();
    }

    void tick();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) window.clearTimeout(timer);
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = "";
      }
      versionRef.current = "";
    };
  }, [accountId]);

  function onMouseDown(e: React.MouseEvent<HTMLImageElement>) {
    draggingRef.current = true;
    lastMoveRef.current = e.timeStamp;
    onInput({
      type: "mouse",
      ...pointerToFrame(e.currentTarget, e.clientX, e.clientY),
      event: "mousePressed",
      button: "left",
      clickCount: 1,
      buttons: 1,
    });
  }
  function onMouseMove(e: React.MouseEvent<HTMLImageElement>) {
    if (!draggingRef.current) return;
    // Throttle drag moves so a fast selection doesn't flood the input API.
    if (e.timeStamp - lastMoveRef.current < 45) return;
    lastMoveRef.current = e.timeStamp;
    onInput({
      type: "mouse",
      ...pointerToFrame(e.currentTarget, e.clientX, e.clientY),
      event: "mouseMoved",
      button: "left",
      buttons: 1,
    });
  }
  function onMouseUp(e: React.MouseEvent<HTMLImageElement>) {
    draggingRef.current = false;
    onInput({
      type: "mouse",
      ...pointerToFrame(e.currentTarget, e.clientX, e.clientY),
      event: "mouseReleased",
      button: "left",
      clickCount: 1,
      buttons: 1,
    });
  }
  function onWheel(e: React.WheelEvent<HTMLImageElement>) {
    const { x, y } = pointerToFrame(e.currentTarget, e.clientX, e.clientY);
    onInput({ type: "wheel", x, y, deltaX: e.deltaX, deltaY: e.deltaY });
  }

  return (
    <>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          decoding="async"
          onMouseDown={interactive ? onMouseDown : undefined}
          onMouseMove={interactive ? onMouseMove : undefined}
          onMouseUp={interactive ? onMouseUp : undefined}
          onWheel={interactive ? onWheel : undefined}
          className={`h-full w-full object-contain ${interactive ? "cursor-crosshair" : ""}`}
          alt={placeholder}
          draggable={false}
        />
      ) : null}
      {!src ? (
        <div className="absolute inset-0 grid place-items-center text-sm text-zinc-400">{placeholder}</div>
      ) : null}
    </>
  );
}


