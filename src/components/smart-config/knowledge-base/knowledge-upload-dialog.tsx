"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const acceptAttribute =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml";

export function KnowledgeUploadDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setFile(null);
    setError("");
    setDragActive(false);
  }

  async function handleConfirm() {
    if (!file) {
      setError(t("kbUploadEmpty"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/knowledge-base/upload", { method: "POST", body: formData });
      const json = (await response.json()) as { ok: boolean; error?: string; message?: string };
      if (!json.ok) throw new Error(json.message ?? json.error ?? "upload failed");
      reset();
      onSaved();
      onClose();
    } catch {
      setError(t("kbUploadFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("kbUploadTitle")} maxWidth="lg">
      <div className="grid gap-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped) setFile(dropped);
          }}
          className={cn(
            "grid place-items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-12 text-center transition",
            dragActive ? "border-sky-400 bg-sky-50" : "border-sky-100 bg-sky-50/40 hover:bg-sky-50",
          )}
        >
          <UploadCloud className="size-9 text-sky-500" />
          <span className="text-sm font-medium text-zinc-700">{file ? file.name : t("kbUploadDrop")}</span>
          <span className="text-xs text-zinc-400">{t("kbUploadHint")}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={acceptAttribute}
          className="hidden"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("btnCancel")}
          </Button>
          <Button onClick={() => void handleConfirm()} loading={loading} disabled={!file}>
            {t("kbUploadConfirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
