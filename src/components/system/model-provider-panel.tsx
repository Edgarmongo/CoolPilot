"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { KeyRound, PlugZap, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsoleNotice, consoleInputClass } from "@/components/ui/console-surface";
import { SelectField } from "@/components/ui/form-controls";
import {
  credentialKeySkipReasonLabelKeys,
  credentialKeyStatusLabelKeys,
  modelProtocols,
  modelProtocolLabelKeys,
  type CredentialKeyHealth,
  type ModelEndpointRecord,
  type ModelProtocol,
  type ModelProviderRecord,
} from "@/features/ai-runtime/contracts";
import { ApiClientError, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * 供应商与凭据: a provider is a vendor, an endpoint is one callable base URL of that
 * vendor, and the secrets live in the local credential store - the database only keeps the
 * `credential://…` reference plus a health row per key (masked label + fingerprint).
 */

type EndpointView = ModelEndpointRecord & {
  credential: { backend: string; configured: boolean; masked: string; keyCount: number; source: string };
  credentialKeys: CredentialKeyHealth[];
  usableKeyCount: number;
  implemented: boolean;
  modelCount: number;
  callableCount: number;
};

type ProviderView = {
  provider: ModelProviderRecord;
  endpoints: EndpointView[];
  modelCount: number;
  callableCount: number;
};

type ProvidersResponse = { providers: ProviderView[]; implementedProtocols: ModelProtocol[] };

type TestResult = { status: "ok" | "error"; modelCount: number; sample: string[]; message?: string };

function credentialLabelKey(view: EndpointView) {
  if (!view.credential.configured) return "aiProvidersCredentialNone";
  return view.credential.source === "vault" ? "aiProvidersCredentialVault" : "aiProvidersCredentialEnv";
}

/** Blue = healthy, amber = cooling down, rose = rejected or switched off by the user. */
function keyTone(key: CredentialKeyHealth) {
  if (key.skipReason === "cooling-down") return "border-amber-200 bg-amber-50 text-amber-700";
  if (key.skipReason) return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export default function ModelProviderPanel() {
  const { t } = useI18n();
  const { mutate: mutateByKey } = useSWRConfig();
  const { data, mutate } = useSWR<ProvidersResponse>("/api/ai/providers", swrFetcher, { revalidateOnFocus: false });
  const providers = data?.providers ?? [];

  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState<ModelProtocol>("openai-compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [endpointEnabled, setEndpointEnabled] = useState(true);
  const [busy, setBusy] = useState<"save" | "test" | "delete" | "key" | "">("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  const selected = providers.find((view) => view.provider.providerId === selectedId) ?? providers[0];
  const endpoint = selected?.endpoints[0];

  useEffect(() => {
    if (!selected) return;
    // Same seeding pattern as the other settings panels: fill the form once SWR resolves.
    window.queueMicrotask(() => {
      setSelectedId(selected.provider.providerId);
      setName(selected.provider.name);
      setProtocol(endpoint?.protocol ?? "openai-compatible");
      setBaseUrl(endpoint?.baseUrl ?? "");
      setEndpointEnabled(endpoint?.enabled ?? true);
      setEnabled(selected.provider.enabled);
      setApiKey("");
    });
  }, [selected, endpoint]);

  async function refresh() {
    await mutate();
    await mutateByKey("/api/ai/runtime");
  }

  async function submit(body: Record<string, unknown>, action: "save" | "test" | "delete" | "key") {
    setBusy(action);
    setNotice(null);
    try {
      const payload = await apiPost<Record<string, unknown>>("/api/ai/providers", body);
      await refresh();
      return payload;
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof ApiClientError ? error.message : String(error),
      });
      return null;
    } finally {
      setBusy("");
    }
  }

  async function handleSave() {
    if (!selected) return;
    const label = name;
    const payload = await submit(
      {
        action: "save",
        providerId: selected.provider.providerId,
        name,
        protocol,
        baseUrl,
        apiKey,
        enabled,
        endpointEnabled,
      },
      "save",
    );
    if (payload) {
      setApiKey("");
      setNotice({ tone: "success", message: t("aiProvidersSaved", { name: label }) });
    }
  }

  async function handleTest() {
    if (!selected) return;
    const payload = await submit({ action: "test", providerId: selected.provider.providerId }, "test");
    if (!payload) return;
    const result = payload as unknown as TestResult;
    setNotice(
      result.status === "ok"
        ? { tone: "success", message: t("aiProvidersTestOk", { count: result.modelCount }) }
        : { tone: "error", message: result.message || t("error_MODEL_SYNC_FAILED") },
    );
  }

  async function handleDelete() {
    if (!selected) return;
    const label = selected.provider.name;
    const payload = await submit({ action: "delete", providerId: selected.provider.providerId }, "delete");
    if (payload) {
      setSelectedId("");
      setNotice({ tone: "success", message: t("aiProvidersDeleted", { name: label }) });
    }
  }

  /** Manual key lifecycle: clear a cooldown, switch a key off, or switch it back on. */
  async function handleKeyAction(keyId: string, keyAction: "reset" | "disable" | "enable") {
    if (!selected) return;
    const payload = await submit(
      { action: "key", providerId: selected.provider.providerId, keyId, keyAction },
      "key",
    );
    if (payload) {
      setNotice({
        tone: "success",
        message:
          keyAction === "reset"
            ? t("aiProvidersKeyResetDone")
            : t(keyAction === "disable" ? "aiProvidersKeyDisabled" : "aiProvidersKeyEnabled"),
      });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white">
          <PlugZap className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-zinc-950">{t("aiProvidersTitle")}</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{t("aiProvidersDescription")}</p>
        </div>
      </div>

      {providers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-sky-100 bg-sky-50/40 px-4 py-6 text-center text-sm text-zinc-500">
          {t("aiProvidersEmpty")}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-2">
            {providers.map((view) => {
              const viewEndpoint = view.endpoints[0];
              const active = view.provider.providerId === selected?.provider.providerId;
              return (
                <button
                  key={view.provider.providerId}
                  type="button"
                  onClick={() => setSelectedId(view.provider.providerId)}
                  className={cn(
                    "flex w-full flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-left transition",
                    active ? "border-sky-300 bg-sky-50" : "border-sky-100 bg-white hover:bg-sky-50/60",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-zinc-900">{view.provider.name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-400">
                      {viewEndpoint ? viewEndpoint.baseUrl : t("aiProvidersProtocolUnsupported")}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                      {t("aiProvidersStats", { total: view.modelCount, callable: view.callableCount })}
                    </span>
                    {viewEndpoint ? (
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          viewEndpoint.credential.configured
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-zinc-200 bg-zinc-50 text-zinc-500",
                        )}
                      >
                        {t(credentialLabelKey(viewEndpoint))}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          {selected ? (
            <div className="space-y-3 rounded-2xl border border-sky-100 bg-white p-4">
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                <span>{t("aiProvidersName")}</span>
                <input value={name} onChange={(event) => setName(event.target.value)} className={consoleInputClass} />
              </label>
              <SelectField
                label={t("aiProvidersProtocol")}
                value={protocol}
                options={modelProtocols.map((entry) => ({
                  value: entry,
                  label: t(modelProtocolLabelKeys[entry]),
                  disabled: !(data?.implementedProtocols ?? []).includes(entry),
                }))}
                onChange={setProtocol}
              />
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                <span>{t("aiProvidersBaseUrl")}</span>
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  className={`${consoleInputClass} font-mono`}
                  placeholder="https://…/v1"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                <span className="flex items-center gap-1.5">
                  <KeyRound className="size-3.5" aria-hidden />
                  {t("aiProvidersApiKey")}
                  {endpoint?.credential.configured ? (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                      {t("aiProvidersKeyCount", { count: endpoint.credential.keyCount })}
                    </span>
                  ) : null}
                </span>
                <textarea
                  autoComplete="off"
                  rows={2}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  className={`${consoleInputClass} font-mono`}
                  placeholder={endpoint?.credential.masked ?? ""}
                />
                <span className="text-xs font-normal text-zinc-400">{t("aiProvidersApiKeyHint")}</span>
              </label>

              {endpoint && endpoint.credentialKeys.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-zinc-500">{t("aiProvidersKeyRotation")}</p>
                  {endpoint.credentialKeys.map((key) => (
                    <div
                      key={key.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-100 bg-zinc-50/60 px-2.5 py-1.5"
                    >
                      <span className="min-w-0 font-mono text-[11px] text-zinc-600">{key.masked || key.label}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", keyTone(key))}
                          title={key.errorCount > 0 ? t("aiProvidersKeyErrors", { count: key.errorCount }) : undefined}
                        >
                          {key.skipReason
                            ? t(credentialKeySkipReasonLabelKeys[key.skipReason])
                            : t(credentialKeyStatusLabelKeys[key.status])}
                        </span>
                        <span className="text-[10px] text-zinc-400">
                          {t("aiProvidersKeyUsage", { count: key.useCount })}
                        </span>
                        {key.skipReason ? (
                          <button
                            type="button"
                            onClick={() => void handleKeyAction(key.id, "reset")}
                            disabled={busy === "key"}
                            className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                          >
                            {t("aiProvidersKeyReset")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() =>
                            void handleKeyAction(key.id, key.status === "disabled" ? "enable" : "disable")
                          }
                          disabled={busy === "key"}
                          className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                        >
                          {t(key.status === "disabled" ? "aiProvidersKeyEnable" : "aiProvidersKeyDisable")}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setEnabled(!enabled)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 font-medium",
                    enabled
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-zinc-200 bg-zinc-50 text-zinc-500",
                  )}
                >
                  {t("aiProvidersEnabled")}
                </button>
                <button
                  type="button"
                  onClick={() => setEndpointEnabled(!endpointEnabled)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 font-medium",
                    endpointEnabled
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700",
                  )}
                >
                  {t("aiProvidersEndpointDisabled")}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => void handleSave()} loading={busy === "save"}>
                  <Save className="size-4" aria-hidden />
                  {t("aiProvidersSave")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleTest()}
                  loading={busy === "test"}
                  disabled={!endpoint}
                >
                  <PlugZap className="size-4" aria-hidden />
                  {t("aiProvidersTest")}
                </Button>
                <Button size="sm" variant="danger" onClick={() => void handleDelete()} loading={busy === "delete"}>
                  <Trash2 className="size-4" aria-hidden />
                  {t("aiProvidersDelete")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {notice ? <ConsoleNotice message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} /> : null}

      <p className="text-[11px] leading-5 text-zinc-400">{t("aiProvidersKeychainUnavailable")}</p>
    </div>
  );
}
