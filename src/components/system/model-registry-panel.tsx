"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Boxes, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsoleNotice, consoleInputClass } from "@/components/ui/console-surface";
import { SelectField } from "@/components/ui/form-controls";
import {
  modelCapabilityLabelKeys,
  modelCapabilitySourceLabelKeys,
  modelCapabilities,
  type ModelCapability,
  type ModelRecord,
  type ModelSyncRecord,
} from "@/features/ai-runtime/contracts";
import { ApiClientError, apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * 模型注册表: what the runtime discovered per provider, which models are callable, and
 * which capability each of them actually provides (with the source of that claim).
 */

type ModelsResponse = {
  models: ModelRecord[];
  defaults: Partial<Record<ModelCapability, { modelRowId: string; providerId: string; modelId: string }>>;
  providers: Array<{ providerId: string; name: string; enabled: boolean; modelCount: number; callableCount: number }>;
};

type RuntimeResponse = {
  totals: { total: number; callable: number };
  capabilities: Array<{ capability: ModelCapability; total: number; callable: number }>;
  syncs: ModelSyncRecord[];
};

type ProbeResult = { capability: ModelCapability; status: "ok" | "failed" | "unsupported"; message: string };

/** Capabilities the manager offers a default for - the ones a product feature asks by name. */
const defaultableCapabilities: ModelCapability[] = [
  "chat",
  "reasoning",
  "structured_output",
  "vision",
  "tool_calling",
  "image_generation",
  "video_generation",
  "embedding",
];

const probeableCapabilities = new Set<ModelCapability>(["chat", "vision", "tool_calling", "structured_output"]);

export default function ModelRegistryPanel() {
  const { t } = useI18n();
  const { mutate: mutateByKey } = useSWRConfig();
  const [providerId, setProviderId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [callableOnly, setCallableOnly] = useState(false);
  const [busy, setBusy] = useState<"sync" | "patch" | "probe" | "">("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({});

  const query = new URLSearchParams();
  if (providerId) query.set("providerId", providerId);
  if (keyword.trim()) query.set("keyword", keyword.trim());
  if (callableOnly) query.set("enabled", "1");
  const modelsKey = `/api/ai/models?${query.toString()}`;

  const { data, mutate: mutateModels } = useSWR<ModelsResponse>(modelsKey, swrFetcher, { revalidateOnFocus: false });
  const { data: runtime, mutate: mutateRuntime } = useSWR<RuntimeResponse>("/api/ai/runtime", swrFetcher, {
    revalidateOnFocus: false,
  });

  const models = useMemo(() => data?.models ?? [], [data]);
  const providers = data?.providers ?? [];
  const defaults = data?.defaults ?? {};

  const callableByCapability = useMemo(() => {
    const grouped = new Map<ModelCapability, ModelRecord[]>();
    for (const model of models) {
      if (!model.enabled || !model.endpointId) continue;
      for (const entry of model.capabilities) {
        if (!entry.supported) continue;
        grouped.set(entry.capability, [...(grouped.get(entry.capability) ?? []), model]);
      }
    }
    return grouped;
  }, [models]);

  async function refreshAll() {
    await Promise.all([mutateModels(), mutateRuntime(), mutateByKey("/api/ai/providers")]);
  }

  async function runSync() {
    if (!providerId) {
      setNotice({ tone: "error", message: t("aiRegistrySyncHint") });
      return;
    }
    setBusy("sync");
    setNotice(null);
    try {
      const result = await apiPost<{ modelCount: number; created: number }>("/api/ai/models/sync", { providerId });
      await refreshAll();
      setNotice({
        tone: "success",
        message: t("aiRegistrySyncDone", { count: result.modelCount, created: result.created }),
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof ApiClientError ? error.message : String(error),
      });
    } finally {
      setBusy("");
    }
  }

  async function patch(body: Record<string, unknown>, successMessage?: string) {
    setBusy("patch");
    setNotice(null);
    try {
      await apiPatch("/api/ai/models", body);
      await refreshAll();
      if (successMessage) setNotice({ tone: "success", message: successMessage });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof ApiClientError ? error.message : String(error) });
    } finally {
      setBusy("");
    }
  }

  async function runProbe(model: ModelRecord, capability: ModelCapability) {
    setBusy("probe");
    setNotice(null);
    try {
      const result = await apiPost<ProbeResult>("/api/ai/models/probe", { modelRowId: model.id, capability });
      setProbes((current) => ({ ...current, [`${model.id}#${capability}`]: result }));
      await refreshAll();
      setNotice({
        tone: result.status === "ok" ? "success" : "error",
        message: t("aiRegistryProbeResult", {
          capability: t(modelCapabilityLabelKeys[capability]),
          status: result.status,
        }),
      });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof ApiClientError ? error.message : String(error) });
    } finally {
      setBusy("");
    }
  }

  const [capabilityFilter, setCapabilityFilter] = useState<"" | ModelCapability>("");
  const visibleModels = useMemo(() => {
    const list = capabilityFilter
      ? models.filter((model) =>
          model.capabilities.some((entry) => entry.supported && entry.capability === capabilityFilter),
        )
      : models;
    return list.slice(0, 300);
  }, [models, capabilityFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-sky-600 text-white">
            <Boxes className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-zinc-950">{t("aiRegistryTitle")}</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500">{t("aiRegistryDescription")}</p>
          </div>
        </div>
        <Button size="sm" onClick={() => void runSync()} loading={busy === "sync"} disabled={!providerId}>
          <RefreshCw className="size-4" aria-hidden />
          {t("aiRegistrySync")}
        </Button>
      </div>

      <p className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-xs leading-5 text-sky-900">
        {t("aiRegistrySummary", {
          total: runtime?.totals.total ?? 0,
          callable: runtime?.totals.callable ?? 0,
        })}
        {" · "}
        {t("aiRegistrySyncHint")}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SelectField
          label={t("aiRegistryAllProviders")}
          value={providerId}
          options={[
            { value: "", label: t("aiRegistryAllProviders") },
            ...providers.map((provider) => ({
              value: provider.providerId,
              label: `${provider.name} (${provider.callableCount}/${provider.modelCount})`,
            })),
          ]}
          onChange={setProviderId}
        />
        <SelectField
          label={t("aiRegistryCapabilityFilter")}
          value={capabilityFilter}
          options={[
            { value: "", label: t("aiRegistryCapabilityAll") },
            ...modelCapabilities.map((capability) => ({
              value: capability,
              label: t(modelCapabilityLabelKeys[capability]),
            })),
          ]}
          onChange={(value) => setCapabilityFilter(value as "" | ModelCapability)}
        />
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          <span>{t("aiRegistrySearch")}</span>
          <span className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              className={`${consoleInputClass} pl-9`}
              placeholder="gpt, qwen, kling…"
            />
          </span>
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => setCallableOnly(!callableOnly)}
            className={cn(
              "min-h-10 w-full rounded-2xl border px-3 py-2 text-sm font-medium transition",
              callableOnly ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-sky-100 bg-white text-zinc-600",
            )}
          >
            {t("aiRegistryCallableOnly")}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-sky-100 bg-white p-4">
        <p className="text-sm font-semibold text-zinc-900">{t("aiRegistryDefault")}</p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">{t("aiRegistrySetDefault")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {defaultableCapabilities.map((capability) => {
            const candidates = callableByCapability.get(capability) ?? [];
            const current = defaults[capability];
            const options = [
              { value: "", label: t("aiRegistryAutoDefault") },
              ...candidates.map((model) => ({ value: model.id, label: model.displayName })),
            ];
            if (current && !candidates.some((model) => model.id === current.modelRowId)) {
              options.push({ value: current.modelRowId, label: current.modelId });
            }
            return (
              <SelectField
                key={capability}
                label={t(modelCapabilityLabelKeys[capability])}
                value={current?.modelRowId ?? ""}
                options={options}
                onChange={(value) =>
                  void patch({ defaultFor: { capability, modelRowId: value || null } }, t("aiRegistrySetDefault"))
                }
              />
            );
          })}
        </div>
      </div>
      <div className="space-y-2">
        {visibleModels.map((model) => (
          <div key={model.id} className="rounded-2xl border border-sky-100 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900">{model.displayName}</p>
                <p className="truncate font-mono text-[11px] text-zinc-400">
                  {model.providerId} · {model.modelId}
                  {model.modelType === "unknown" ? "" : ` · ${model.modelType}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    model.enabled
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : model.endpointId
                        ? "border-zinc-200 bg-zinc-50 text-zinc-500"
                        : "border-indigo-200 bg-indigo-50 text-indigo-600",
                  )}
                >
                  {model.enabled
                    ? t("aiRegistryEnabled")
                    : model.endpointId
                      ? t("aiRegistryDisabled")
                      : t("aiRegistryCatalogOnly")}
                </span>
                <button
                  type="button"
                  disabled={!model.endpointId || busy !== ""}
                  onClick={() => void patch({ modelRowIds: [model.id], enabled: !model.enabled })}
                  className="rounded-full border border-sky-100 bg-white px-2.5 py-1 text-[11px] font-medium text-sky-700 transition hover:bg-sky-50 disabled:opacity-40"
                >
                  {model.enabled ? t("aiRegistryDisable") : t("aiRegistryEnable")}
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {model.capabilities
                .filter((entry) => entry.supported)
                .map((entry) => {
                  const probe = probes[`${model.id}#${entry.capability}`];
                  const probeable = probeableCapabilities.has(entry.capability);
                  return (
                    <button
                      key={entry.capability}
                      type="button"
                      disabled={!probeable || busy !== ""}
                      onClick={() => void runProbe(model, entry.capability)}
                      title={`${t(modelCapabilitySourceLabelKeys[entry.source])} · ${entry.confidence}`}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition",
                        probe?.status === "ok"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : probe?.status === "failed"
                            ? "border-red-200 bg-red-50 text-red-600"
                            : "border-sky-100 bg-sky-50/60 text-zinc-700",
                        probeable ? "hover:border-sky-300" : "cursor-default opacity-70",
                      )}
                    >
                      {t(modelCapabilityLabelKeys[entry.capability])}
                      <span className="rounded bg-black/5 px-1 text-[9px] text-zinc-500">
                        {t(modelCapabilitySourceLabelKeys[entry.source]).slice(0, 1)}
                      </span>
                    </button>
                  );
                })}
              {model.capabilities.some((entry) => entry.supported) ? null : (
                <span className="text-[11px] text-zinc-400">{t("aiRegistrySources")}</span>
              )}
            </div>
          </div>
        ))}
        {visibleModels.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-sky-100 bg-sky-50/40 px-4 py-10 text-center text-sm text-zinc-500">
            {t("aiRegistryEmpty")}
          </p>
        ) : null}
      </div>

      {runtime && runtime.syncs.length > 0 ? (
        <div className="rounded-2xl border border-sky-100 bg-white p-4">
          <p className="text-sm font-semibold text-zinc-900">{t("aiRegistrySyncs")}</p>
          <ul className="mt-2 space-y-1 text-xs text-zinc-500">
            {runtime.syncs.map((record) => (
              <li
                key={`${record.providerId}-${record.finishedAt}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="font-medium text-zinc-700">{record.providerId}</span>
                <span>{new Date(record.finishedAt).toLocaleString()}</span>
                <span className={record.status === "ok" ? "text-emerald-600" : "text-red-600"}>
                  {record.modelCount} · {record.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notice ? <ConsoleNotice message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} /> : null}
    </div>
  );
}
