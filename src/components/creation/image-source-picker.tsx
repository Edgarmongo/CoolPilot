"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { ImageIcon, Images, Link2, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { OnlineImage } from "@/lib/image-search";
import { cn } from "@/lib/utils";

export type ImageLibraryEntry = { fileName: string; url: string };

/**
 * Online-library search, local upload and image-library pick, shared by the
 * article “insert image” dialog and the image-management page. A remote image is
 * stored locally before it is reported, so the chosen file always ends up in the
 * library.
 */
export function ImageSourcePicker({
  onPicked,
  showLibrary = true,
  className,
}: {
  onPicked: (image: ImageLibraryEntry) => void;
  /** When false, the “from library” tab is hidden (the page already lists them). */
  showLibrary?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const { data, mutate, isLoading } = useSWR<{ images: ImageLibraryEntry[] }>("/api/images", swrFetcher);
  const library = data?.images ?? [];
  const [tab, setTab] = useState<"online" | "upload" | "library">("online");
  const tabs: Array<"online" | "upload" | "library"> = showLibrary
    ? ["online", "upload", "library"]
    : ["online", "upload"];
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [results, setResults] = useState<OnlineImage[]>([]);
  const [searching, setSearching] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const trimmedQuery = query.trim();
  /** An http(s) link pasted straight into the box is offered as-is. */
  const link = /^https?:\/\/\S+$/i.test(trimmedQuery) ? trimmedQuery : "";

  async function runSearch(term: string) {
    const value = term.trim();
    if (!value) return;
    setSearching(true);
    setError("");
    setSubmitted(value);
    setResults([]);
    try {
      const response = await fetch(`/api/images/search?q=${encodeURIComponent(value)}`);
      const json = (await response.json()) as { ok: boolean; data?: { images: OnlineImage[] } };
      if (!json.ok || !json.data) throw new Error("Image search failed");
      setResults(json.data.images);
    } catch {
      setError(t("aimgSearchFailed"));
    } finally {
      setSearching(false);
    }
  }

  /** Stores a remote image locally before reporting it, so it keeps rendering. */
  async function insertRemote(url: string, fallbackUrl?: string) {
    setInserting(true);
    setError("");
    try {
      const response = await fetch("/api/images/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, fallbackUrl }),
      });
      const json = (await response.json()) as { ok: boolean; data?: ImageLibraryEntry; error?: string };
      if (!json.ok || !json.data) throw new Error(json.error ?? "Insert failed");
      void mutate();
      onPicked(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInserting(false);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/images/upload", { method: "POST", body: form });
      const json = (await response.json()) as { ok: boolean; data?: ImageLibraryEntry; error?: string };
      if (!json.ok || !json.data) throw new Error(json.error ?? "Upload failed");
      void mutate();
      onPicked(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  let onlineBody: React.ReactNode;
  if (link) {
    onlineBody = (
      <div className="space-y-2 rounded-2xl border border-sky-100 p-3">
        <p className="flex items-center gap-2 text-sm text-zinc-600">
          <Link2 className="size-4 shrink-0 text-sky-500" />
          <span className="truncate">{link}</span>
        </p>
        <div className="grid place-items-center overflow-hidden rounded-xl border border-sky-100 bg-zinc-50 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={link} alt="" className="max-h-48 object-contain" />
        </div>
        <Button size="sm" loading={inserting} onClick={() => void insertRemote(link)}>
          {t("aimgUseLink")}
        </Button>
      </div>
    );
  } else if (searching) {
    onlineBody = <p className="py-10 text-center text-sm text-zinc-400">{t("aimgSearching")}</p>;
  } else if (submitted) {
    onlineBody =
      results.length === 0 ? (
        <div className="grid place-items-center gap-2 rounded-2xl border border-dashed border-sky-100 py-12 text-center">
          <ImageIcon className="size-8 text-zinc-300" />
          <p className="text-sm text-zinc-400">{t("aimgEmpty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex max-h-80 flex-wrap gap-2 overflow-y-auto">
            {results.map((image) => (
              <button
                key={image.id}
                type="button"
                disabled={inserting}
                onClick={() => void insertRemote(image.url, image.thumbUrl)}
                title={image.title}
                className="size-28 shrink-0 overflow-hidden rounded-xl border border-sky-100 transition hover:border-sky-400 disabled:opacity-60"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.thumbUrl}
                  alt={image.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="size-full object-cover"
                />
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-400">{inserting ? t("aimgInserting") : t("aimgSourceNote")}</p>
        </div>
      );
  } else {
    // The online tab only ever shows search results; the library has its own tab.
    onlineBody = (
      <div className="grid place-items-center gap-2 rounded-2xl border border-dashed border-sky-100 py-12 text-center">
        <ImageIcon className="size-8 text-zinc-300" />
        <p className="text-sm text-zinc-400">{t("aimgSearchHint")}</p>
      </div>
    );
  }

  let libraryBody: React.ReactNode;
  if (isLoading) {
    libraryBody = <p className="py-10 text-center text-sm text-zinc-400">{t("loading")}</p>;
  } else if (library.length === 0) {
    libraryBody = (
      <div className="grid place-items-center gap-2 rounded-2xl border border-dashed border-sky-100 py-12 text-center">
        <ImageIcon className="size-8 text-zinc-300" />
        <p className="text-sm text-zinc-400">{t("emptyImages")}</p>
      </div>
    );
  } else {
    libraryBody = (
      <div className="flex max-h-80 flex-wrap gap-2 overflow-y-auto">
        {library.map((image) => (
          <button
            key={image.fileName}
            type="button"
            onClick={() => onPicked(image)}
            className="size-28 shrink-0 overflow-hidden rounded-xl border border-sky-100 transition hover:border-sky-400"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt={image.fileName} className="size-full object-cover" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-2 border-b border-zinc-100 pb-2">
        {tabs.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 px-2 pb-1 text-sm font-medium transition",
              tab === value ? "border-sky-500 text-sky-700" : "border-transparent text-zinc-500 hover:text-zinc-800",
            )}
          >
            {value === "online" ? <Search className="size-4" /> : value === "upload" ? <Upload className="size-4" /> : <Images className="size-4" />}
            {value === "online" ? t("aimgOnline") : value === "upload" ? t("aimgUpload") : t("aimgFromLibrary")}
          </button>
        ))}
      </div>

      {tab === "online" ? (
        <div className="space-y-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch(query);
            }}
          >
            <input
              value={query}
              onChange={(event) => {
                const value = event.target.value;
                setQuery(value);
                setError("");
                if (!value.trim()) {
                  setSubmitted("");
                  setResults([]);
                }
              }}
              placeholder={t("aimgPlaceholder")}
              className={consoleInputClass}
            />
            <Button type="submit" size="sm" className="shrink-0" loading={searching}>
              <Search size={14} />
              {t("aimgSearch")}
            </Button>
          </form>
          <p className="text-xs text-zinc-400">{t("aimgSearchHint")}</p>
          {onlineBody}
        </div>
      ) : tab === "library" ? (
        <div className="space-y-3">{libraryBody}</div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="grid w-full place-items-center gap-2 rounded-2xl border-2 border-dashed border-sky-200 bg-sky-50/40 py-12 text-center transition hover:border-sky-400 disabled:opacity-60"
          >
            <Upload className="size-7 text-sky-400" />
            <span className="text-sm font-medium text-zinc-700">{t("aimgUploadHint")}</span>
            <span className="text-xs text-zinc-400">{t("aimgUploadSub")}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          {uploading ? <p className="text-sm text-sky-600">{t("aimgUploading")}</p> : null}
        </div>
      )}

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}
    </div>
  );
}

