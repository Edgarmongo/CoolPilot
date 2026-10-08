"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Plus, Save, Sparkles, Star, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConsoleHeaderActions } from "@/components/ui/console-header-actions";
import { ConsoleCard, ConsoleNotice } from "@/components/ui/console-surface";
import { apiDelete, apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import {
  normalizePositionDraft,
  positionTabIds,
  positionTabLabelKeys,
  type PositionTabId,
} from "@/lib/positions";
import type { PositionDraft, PositionRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PositioningAiDialog } from "./positioning-ai-dialog";
import { PositioningStoreDialog } from "./positioning-store-dialog";
import { PositioningTabPanel } from "./positioning-tabs";

export function PositioningWorkspace() {
  const { t } = useI18n();
  const { data: positions = [], mutate, isLoading } = useSWR<PositionRecord[]>("/api/positions", swrFetcher);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PositionDraft | null>(null);
  const [tab, setTab] = useState<PositionTabId>("basic");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [isStoreOpen, setIsStoreOpen] = useState(false);

  const activePosition = useMemo<PositionRecord | null>(() => {
    if (!positions.length) return null;
    return positions.find((position) => position.id === activeId) ?? positions[0];
  }, [positions, activeId]);

  const syncKey = activePosition ? `${activePosition.id}:${activePosition.updatedAt}` : "";
  const syncedKeyRef = useRef("");

  useEffect(() => {
    if (!activePosition) {
      syncedKeyRef.current = "";
      window.queueMicrotask(() => setDraft(null));
      return;
    }
    // Reload the editor only when the active record actually changes, so SWR
    // revalidation (e.g. window focus) never discards unsaved edits.
    if (syncedKeyRef.current === syncKey) return;
    syncedKeyRef.current = syncKey;
    const nextDraft = normalizePositionDraft(activePosition);
    window.queueMicrotask(() => setDraft(nextDraft));
  }, [activePosition, syncKey]);

  useEffect(() => {
    if (activePosition && activePosition.id !== activeId) {
      const nextId = activePosition.id;
      window.queueMicrotask(() => setActiveId(nextId));
    }
  }, [activePosition, activeId]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2500);
  }, []);

  const patchDraft = useCallback((patch: Partial<PositionDraft>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const handleSave = useCallback(async () => {
    if (!activePosition || !draft) return;
    setSaving(true);
    try {
      await apiPatch<PositionRecord>(`/api/positions/${activePosition.id}`, draft);
      await mutate();
      showNotice(t("posSaved"));
    } finally {
      setSaving(false);
    }
  }, [activePosition, draft, mutate, showNotice, t]);

  const handleCreate = useCallback(async () => {
    const created = await apiPost<PositionRecord>("/api/positions", { name: t("posNewName") });
    await mutate();
    if (created) {
      setActiveId(created.id);
      setTab("basic");
    }
  }, [mutate, t]);

  const handleSetDefault = useCallback(async () => {
    if (!activePosition) return;
    await apiPatch<PositionRecord>(`/api/positions/${activePosition.id}`, { isDefault: true });
    await mutate();
  }, [activePosition, mutate]);

  const handleDelete = useCallback(async () => {
    if (!activePosition) return;
    await apiDelete(`/api/positions/${activePosition.id}`);
    setActiveId(null);
    await mutate();
  }, [activePosition, mutate]);

  const saveRef = useRef(handleSave);

  useEffect(() => {
    saveRef.current = handleSave;
  }, [handleSave]);

  const handleSaveClick = useCallback(() => {
    void saveRef.current();
  }, []);
  const hasActivePosition = Boolean(activePosition);

  const headerActions = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setIsAiOpen(true)}>
          <Sparkles size={16} />
          {t("posAiTitle")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setIsStoreOpen(true)} disabled={!hasActivePosition}>
          <UploadCloud size={16} />
          {t("posPublishToStore")}
        </Button>
        <Button size="sm" onClick={handleSaveClick} loading={saving}>
          <Save size={16} />
          {t("btnSave")}
        </Button>
      </div>
    ),
    [t, saving, hasActivePosition, handleSaveClick],
  );
  useConsoleHeaderActions(headerActions);

  return (
    <>
      {notice ? <ConsoleNotice message={notice} onDismiss={() => setNotice("")} /> : null}

      <div className={cn("grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]", notice && "mt-4")}>
        <ConsoleCard className="self-start lg:sticky lg:top-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-900">{t("posMine")}</h2>
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="inline-flex items-center gap-1 rounded-full border border-sky-100 bg-white px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-50"
            >
              <Plus className="size-3.5" />
              {t("posNew")}
            </button>
          </div>

          <div className="mt-4 grid gap-2">
            {isLoading && !positions.length ? (
              <p className="py-6 text-center text-xs text-zinc-400">{t("loadingSites")}</p>
            ) : null}
            {positions.map((position) => {
              const isActive = position.id === activePosition?.id;
              return (
                <button
                  key={position.id}
                  type="button"
                  onClick={() => setActiveId(position.id)}
                  className={cn(
                    "rounded-2xl border px-3 py-3 text-left transition",
                    isActive ? "border-sky-200 bg-sky-50/70" : "border-transparent hover:bg-zinc-50",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-zinc-900">{position.name}</span>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-sky-600 ring-1 ring-sky-100">
                      {position.isDefault ? t("posDefaultBadge") : t("posNoAccounts")}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-zinc-400">
                    {position.description || t("posNoDescription")}
                  </span>
                </button>
              );
            })}
          </div>
        </ConsoleCard>

        <ConsoleCard>
          {!activePosition || !draft ? (
            <p className="py-16 text-center text-sm text-zinc-400">{t("posEmpty")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-sky-100 pb-4">
                <h2 className="truncate text-lg font-semibold text-zinc-950">{draft.name || t("posUntitled")}</h2>
                {activePosition.isDefault ? (
                  <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-600">
                    {t("posDefaultBadge")}
                  </span>
                ) : null}
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => void handleSetDefault()} disabled={activePosition.isDefault}>
                    <Star size={15} />
                    {t("posSetDefault")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void handleDelete()}>
                    <Trash2 size={15} />
                    {t("btnDelete")}
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-5 border-b border-sky-100">
                {positionTabIds.map((tabId) => (
                  <button
                    key={tabId}
                    type="button"
                    onClick={() => setTab(tabId)}
                    className={cn(
                      "-mb-px border-b-2 px-1 pb-2.5 text-sm font-medium transition",
                      tab === tabId
                        ? "border-sky-500 text-sky-700"
                        : "border-transparent text-zinc-500 hover:text-zinc-800",
                    )}
                  >
                    {t(positionTabLabelKeys[tabId])}
                  </button>
                ))}
              </div>

              <div className="pt-6">
                <PositioningTabPanel tab={tab} draft={draft} onChange={patchDraft} positionId={activePosition.id} />
              </div>
            </>
          )}
        </ConsoleCard>
      </div>

      <PositioningAiDialog open={isAiOpen} onClose={() => setIsAiOpen(false)} onApply={patchDraft} />
      <PositioningStoreDialog
        open={isStoreOpen}
        onClose={() => setIsStoreOpen(false)}
        position={activePosition}
        onUpdated={() => void mutate()}
      />
    </>
  );
}
