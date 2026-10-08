"use client";

import { useEffect, useState } from "react";
import { LogIn, Send } from "lucide-react";
import type { AccountRecord } from "@/lib/types";
import { apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { consoleInputClass } from "@/components/ui/console-surface";

export function LoginBrowserDialog({
  site,
  onClose,
  onDone,
}: {
  site: AccountRecord;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [frameUrl, setFrameUrl] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.queueMicrotask(() => {
      setFrameUrl("");
      setDone(false);
    });

    apiPost(`/api/browser-profiles/${site.id}/open`, { headless: true }).catch(() => undefined);

    const timer = setInterval(() => {
      if (cancelled) return;
      setFrameUrl(`/api/browser-profiles/${site.id}/preview/frame?t=${Date.now()}`);
    }, 800);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [site.id]);

  async function shutdown() {
    try {
      await fetch(`/api/browser-profiles/${site.id}/preview`, { method: "DELETE" });
    } catch {
      // ignore
    }
  }

  function sendMouse(event: "mousePressed" | "mouseReleased", e: React.MouseEvent<HTMLImageElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    apiPost(`/api/browser-profiles/${site.id}/input`, {
      type: "mouse",
      x,
      y,
      event,
      button: "left",
      clickCount: 1,
    }).catch(() => undefined);
  }

  async function sendText() {
    if (!text) return;
    setSending(true);
    try {
      await apiPost(`/api/browser-profiles/${site.id}/input`, { type: "text", text });
      setText("");
    } finally {
      setSending(false);
    }
  }

  async function sendKey(key: string, code: string, keyCode: number) {
    await apiPost(`/api/browser-profiles/${site.id}/input`, { type: "key", key, code, keyCode }).catch(() => undefined);
  }

  async function handleClose() {
    await shutdown();
    onClose();
  }

  async function handleDone() {
    if (done) return;
    setDone(true);
    await shutdown();
    await onDone();
  }

  return (
    <Dialog open onClose={() => void handleClose()} title={`${t("loginAccount")} · ${site.name}`} maxWidth="lg">
      <div className="space-y-3">
        <div className="overflow-hidden rounded-2xl border border-sky-100 bg-white">
          {frameUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={frameUrl}
              onMouseDown={(e) => sendMouse("mousePressed", e)}
              onMouseUp={(e) => sendMouse("mouseReleased", e)}
              className="aspect-[64/45] w-full cursor-crosshair bg-sky-50/50 object-contain"
              alt={t("browserPreviewAlt")}
              draggable={false}
            />
          ) : (
            <div className="grid aspect-[64/45] w-full place-items-center text-sm text-zinc-400">
              {t("browserStarting")}
            </div>
          )}
        </div>

        <p className="text-xs text-zinc-500">{t("loginIframeHint")}</p>

        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void sendText();
              }
            }}
            placeholder={t("loginTypeHint")}
            className={consoleInputClass}
          />
          <Button onClick={() => void sendText()} loading={sending}>
            <Send size={14} />
            {t("btnSave")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void sendKey("Enter", "Enter", 13)}>Enter</Button>
          <Button variant="outline" size="sm" onClick={() => void sendKey("Tab", "Tab", 9)}>Tab</Button>
          <Button variant="outline" size="sm" onClick={() => void sendKey("Backspace", "Backspace", 8)}>⌫</Button>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-100 pt-3">
          <Button variant="ghost" onClick={() => void handleClose()}>{t("dlgCancel")}</Button>
          <Button onClick={() => void handleDone()} loading={done}>
            <LogIn size={14} />
            {t("loginDone")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
