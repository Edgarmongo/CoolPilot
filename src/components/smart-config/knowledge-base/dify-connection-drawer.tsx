"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Eye, EyeOff, ListChecks, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consoleInputClass } from "@/components/ui/console-surface";
import { Drawer } from "@/components/ui/drawer";
import { apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { difyInsufficientLabelKeys, difyScopeLabelKeys } from "@/lib/knowledge-base";
import {
  difyInsufficientModes,
  difyScopes,
  type DifyConnectionRecord,
  type DifyDatasetSummary,
  type DifyInsufficientMode,
  type DifyScope,
  type PositionRecord,
} from "@/lib/types";
import { Field, NoticeBanner, Toggle } from "../positioning-fields";

type FormState = {
  name: string;
  apiBase: string;
  apiKey: string;
  knowledgeIds: string[];
  publicConfirmed: boolean;
  scopes: DifyScope[];
  positionId: string;
  insufficientMode: DifyInsufficientMode;
  scoreThreshold: number;
  enabled: boolean;
};

const emptyForm: FormState = {
  name: "",
  apiBase: "",
  apiKey: "",
  knowledgeIds: [],
  publicConfirmed: false,
  scopes: [...difyScopes],
  positionId: "",
  insufficientMode: "knowledge_first",
  scoreThreshold: 45,
  enabled: false,
};

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function DifyConnectionDrawer({
  open,
  onClose,
  onSaved,
  connection,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  connection: DifyConnectionRecord | null;
}) {
  const { t } = useI18n();
  const { data: positions = [] } = useSWR<PositionRecord[]>("/api/positions", swrFetcher);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [datasets, setDatasets] = useState<DifyDatasetSummary[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const next: FormState = connection
      ? {
          name: connection.name,
          apiBase: connection.apiBase,
          apiKey: "",
          knowledgeIds: connection.knowledgeIds,
          publicConfirmed: connection.publicConfirmed,
          scopes: connection.scopes,
          positionId: connection.positionId,
          insufficientMode: connection.insufficientMode,
          scoreThreshold: connection.scoreThreshold,
          enabled: connection.enabled,
        }
      : emptyForm;
    window.queueMicrotask(() => {
      setDatasets(null);
      setError("");
      setShowKey(false);
      setForm(next);
    });
  }, [open, connection]);

  function patch(next: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  function toggleScope(scope: DifyScope) {
    patch({
      scopes: form.scopes.includes(scope)
        ? form.scopes.filter((item) => item !== scope)
        : [...form.scopes, scope],
    });
  }

  function toggleKnowledgeId(id: string) {
    if (form.knowledgeIds.includes(id)) {
      patch({ knowledgeIds: form.knowledgeIds.filter((item) => item !== id) });
    } else if (form.knowledgeIds.length < 4) {
      patch({ knowledgeIds: [...form.knowledgeIds, id] });
    }
  }

  async function handleFetchDatasets() {
    if (!form.apiKey.trim()) {
      setError(t("kbDifyNeedKeyForFetch"));
      return;
    }
    setFetching(true);
    setError("");
    try {
      const result = await apiPost<{ datasets: DifyDatasetSummary[] }>("/api/dify/datasets", {
        apiBase: form.apiBase,
        apiKey: form.apiKey,
      });
      setDatasets(result.datasets);
    } catch {
      setError(t("kbDifyFetchFailed"));
    } finally {
      setFetching(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError(t("kbDifyNeedName"));
      return;
    }
    if (!isHttpsUrl(form.apiBase.trim())) {
      setError(t("kbDifyNeedApiBase"));
      return;
    }
    if (!connection && !form.apiKey.trim()) {
      setError(t("kbDifyNeedKey"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, name: form.name.trim(), apiBase: form.apiBase.trim() };
      if (connection) await apiPatch(`/api/dify/connections/${connection.id}`, payload);
      else await apiPost("/api/dify/connections", payload);
      onSaved();
      onClose();
    } catch {
      setError(t("kbDifySaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("kbDifyDrawerTitle")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("btnCancel")}
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            {t("kbDifySave")}
          </Button>
        </div>
      }
    >
      <div className="grid gap-5">
        <NoticeBanner title={t("kbDifyBannerTitle")}>
          <p>{t("kbDifyBannerDesc")}</p>
        </NoticeBanner>

        <Field label={t("kbDifyName")} hint={t("kbRequired")}>
          <input
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
            className={consoleInputClass}
          />
        </Field>

        <Field label={t("kbDifyApiBase")} hint={t("kbRequired")}>
          <input
            value={form.apiBase}
            onChange={(event) => patch({ apiBase: event.target.value })}
            placeholder="https://your-dify.example/v1"
            className={consoleInputClass}
          />
          <span className="text-xs text-zinc-400">{t("kbDifyApiBaseHint")}</span>
        </Field>

        <Field label={t("kbDifyApiKey")}>
          <div className="flex items-center gap-2">
            <input
              value={form.apiKey}
              type={showKey ? "text" : "password"}
              onChange={(event) => patch({ apiKey: event.target.value })}
              placeholder={connection?.apiKeyMasked ?? t("kbDifyApiKeyPlaceholder")}
              className={consoleInputClass}
            />
            <button
              type="button"
              onClick={() => setShowKey((prev) => !prev)}
              className="grid size-10 shrink-0 place-items-center rounded-2xl border border-sky-100 bg-white text-zinc-500 transition hover:bg-sky-50"
              aria-label={t("kbDifyApiKey")}
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <span className="text-xs text-zinc-400">{t("kbDifyApiKeyHint")}</span>
        </Field>

        <div className="grid gap-2 rounded-2xl border border-sky-100 bg-sky-50/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-zinc-700">{t("kbDifyDatasetLabel")}</span>
            <Button size="sm" variant="outline" onClick={() => void handleFetchDatasets()} loading={fetching}>
              <ListChecks size={14} />
              {t("kbDifyFetchDatasets")}
            </Button>
          </div>
          <span className="text-xs text-zinc-400">{t("kbDifyDatasetHint")}</span>
          {datasets ? (
            datasets.length ? (
              <ul className="grid gap-1">
                {datasets.map((dataset) => {
                  const checked = form.knowledgeIds.includes(dataset.id);
                  const disabled = !checked && form.knowledgeIds.length >= 4;
                  return (
                    <li key={dataset.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-white">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleKnowledgeId(dataset.id)}
                          className="size-4 accent-sky-600"
                        />
                        <span className="min-w-0 flex-1 truncate text-zinc-700">{dataset.name || dataset.id}</span>
                        <span className="shrink-0 text-xs text-zinc-400">{dataset.documentCount}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-zinc-400">{t("kbDifyEmptyDatasets")}</p>
            )
          ) : (
            <div className="flex items-center gap-2">
              <input
                value={form.knowledgeIds.join(", ")}
                onChange={(event) =>
                  patch({
                    knowledgeIds: event.target.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean)
                      .slice(0, 4),
                  })
                }
                placeholder={t("kbDifyDatasetPlaceholder")}
                className={consoleInputClass}
              />
              <Plus className="size-4 shrink-0 text-zinc-300" aria-hidden />
            </div>
          )}
        </div>
        <label className="flex items-start gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={form.publicConfirmed}
            onChange={(event) => patch({ publicConfirmed: event.target.checked })}
            className="mt-0.5 size-4 accent-sky-600"
          />
          <span>{t("kbDifyPublicConfirm")}</span>
        </label>

        <div className="grid gap-2">
          <span className="text-sm font-medium text-zinc-700">
            {t("kbDifyScopes")} <span className="text-rose-500">*</span>
          </span>
          <div className="flex flex-wrap gap-4">
            {difyScopes.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={form.scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  className="size-4 accent-sky-600"
                />
                {t(difyScopeLabelKeys[scope])}
              </label>
            ))}
          </div>
        </div>

        <Field label={t("kbDifyPosition")}>
          <select
            value={form.positionId}
            onChange={(event) => patch({ positionId: event.target.value })}
            className={consoleInputClass}
          >
            <option value="">{t("kbDifyPositionPlaceholder")}</option>
            {positions.map((position) => (
              <option key={position.id} value={position.id}>
                {position.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-400">{t("kbDifyPositionHint")}</span>
        </Field>

        <Field label={t("kbDifyInsufficient")}>
          <select
            value={form.insufficientMode}
            onChange={(event) => patch({ insufficientMode: event.target.value as DifyInsufficientMode })}
            className={consoleInputClass}
          >
            {difyInsufficientModes.map((mode) => (
              <option key={mode} value={mode}>
                {t(difyInsufficientLabelKeys[mode])}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-3 rounded-2xl border border-sky-100 bg-white p-4">
          <span className="text-sm font-medium text-zinc-700">{t("kbDifyAdvanced")}</span>
          <Field label={t("kbDifyScoreThreshold")}>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={form.scoreThreshold}
              onChange={(event) => patch({ scoreThreshold: Number(event.target.value) })}
              className={consoleInputClass}
            />
            <span className="text-xs text-zinc-400">{t("kbDifyScoreHint")}</span>
          </Field>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-700">{t("kbDifyEnable")}</span>
          <Toggle
            checked={form.enabled}
            onChange={(enabled) => patch({ enabled })}
            onLabel={t("kbDifyEnabled")}
            offLabel={t("kbDifyDisabled")}
          />
        </div>

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
      </div>
    </Drawer>
  );
}
