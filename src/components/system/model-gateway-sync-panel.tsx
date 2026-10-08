"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { CloudDownload, RefreshCw, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsoleNotice, consoleInputClass } from "@/components/ui/console-surface";
import { ApiClientError, apiErrorTranslationKey, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import type { ModelGatewayState } from "@/features/ai-settings/model-gateway-sync";
import { cn } from "@/lib/utils";
import type { ModelGatewaySyncStatus } from "@/lib/types";

const statusTone: Record<ModelGatewaySyncStatus, string> = {
  never: "border-zinc-200 bg-zinc-100 text-zinc-600",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border-red-200 bg-red-50 text-red-700",
};

const statusLabelKeys: Record<ModelGatewaySyncStatus, TranslationKey> = {
  never: "modelGatewaySyncStatusNever",
  ok: "modelGatewaySyncStatusOk",
  error: "modelGatewaySyncStatusError",
};

type Action = "save" | "sync" | "reset";

function Switch({ checked, onChange, onLabel, offLabel }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs font-semibold transition",
        checked ? "bg-sky-500 text-white shadow-sm" : "bg-zinc-200 text-zinc-600",
      )}
    >
      <span
        className={cn("size-2 rounded-full bg-white", checked ? "opacity-100" : "opacity-40")}
        aria-hidden
      />
      {checked ? onLabel : offLabel}
    </button>
  );
}

/**
 * Feature switch for the manual model-gateway sync: store your own account cookie,
 * then pull the live model list with a button press. Off by default, so the catalog
 * keeps serving the snapshot bundled with the app.
 */
export default function ModelGatewaySyncPanel() {
  const { t } = useI18n();
  const { mutate: mutateByKey } = useSWRConfig();
  const { data, mutate } = useSWR<ModelGatewayState>("/api/models/gateway", swrFetcher, {
    revalidateOnFocus: false,
  });
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState<Action | "">("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    // Same workaround as model-config-panel: seed the form once SWR resolves.
    window.queueMicrotask(() => {
      setEnabled(data.enabled);
      setEndpoint(data.endpoint);
      setCookie("");
    });
  }, [data]);

  async function submit(action: Action, body: Record<string, unknown>, successKey: TranslationKey) {
    setBusy(action);
    setNotice(null);
    try {
      const next = await apiPost<ModelGatewayState>("/api/models/gateway", body);
      await mutate(next, { revalidate: false });
      // The catalog page reads the resolved list, so refresh it too.
      await mutateByKey("/api/models/catalog");
      setNotice({
        tone: "success",
        message: t(successKey, { count: next.modelCount, source: next.source || next.bundledSource }),
      });
      if (next.status === "error" && next.message) {
        setNotice({ tone: "error", message: t("modelGatewaySyncLastError", { detail: next.message }) });
      }
    } catch (error) {
      setNotice({
        tone: "error",
        message: t(apiErrorTranslationKey(error, "modelGatewaySyncFailed"), {
          detail: error instanceof ApiClientError ? error.message : "",
        }),
      });
    } finally {
      setBusy("");
    }
  }

  const status: ModelGatewaySyncStatus = data?.status ?? "never";
  const cookieHint = data?.cookieConfigured
    ? t("modelGatewaySyncCookieSaved", { masked: data.cookieMasked })
    : t("modelGatewaySyncCookieEmpty");

  return (
    <div className="mt-5 rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-sky-600 shadow-sm">
            <CloudDownload className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-zinc-950">{t("modelGatewaySyncTitle")}</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">{t("modelGatewaySyncDescription")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
              statusTone[status],
            )}
          >
            {t(statusLabelKeys[status])}
          </span>
          <Switch
            checked={enabled}
            onChange={setEnabled}
            onLabel={t("modelGatewaySyncToggleOn")}
            offLabel={t("modelGatewaySyncToggleOff")}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <span className="rounded-full bg-white px-2.5 py-1">
          {t("modelGatewaySyncLastSynced", { date: data?.syncedOn || "-" })}
        </span>
        <span className="rounded-full bg-white px-2.5 py-1">
          {t("modelGatewaySyncActiveSource", { source: data?.source ?? "-", count: data?.modelCount ?? 0 })}
        </span>
        <span className="rounded-full bg-white px-2.5 py-1">
          {data?.usingSyncedModels
            ? t("modelGatewaySyncUsingSynced")
            : t("modelGatewaySyncUsingBundled", {
                count: data?.bundledModelCount ?? 0,
                source: data?.bundledSource ?? "-",
              })}
        </span>
      </div>

      {enabled ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("modelGatewaySyncEndpointLabel")}</span>
            <input
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              className={consoleInputClass}
              placeholder={data?.defaultEndpoint ?? ""}
            />
            <span className="text-xs font-normal text-zinc-400">{t("modelGatewaySyncEndpointHint")}</span>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
            <span>{t("modelGatewaySyncCookieLabel")}</span>
            <input
              type="password"
              autoComplete="off"
              value={cookie}
              onChange={(event) => setCookie(event.target.value)}
              className={`${consoleInputClass} font-mono`}
              placeholder={t("modelGatewaySyncCookiePlaceholder")}
            />
            <span className="text-xs font-normal text-zinc-400">{cookieHint}</span>
          </label>
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-sky-100 bg-white px-3 py-2 text-xs leading-5 text-zinc-500">
          {t("modelGatewaySyncDisabledHint")}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => void submit("save", { action: "save", enabled, endpoint, cookie }, "modelGatewaySyncSaved")}
          loading={busy === "save"}
        >
          <Save className="size-4" aria-hidden />
          {t("modelGatewaySyncSave")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!enabled || busy !== ""}
          onClick={() => void submit("sync", { action: "sync" }, "modelGatewaySyncDone")}
          loading={busy === "sync"}
        >
          <RefreshCw className="size-4" aria-hidden />
          {t("modelGatewaySyncNow")}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={busy !== ""}
          onClick={() => void submit("reset", { action: "reset" }, "modelGatewaySyncResetDone")}
          loading={busy === "reset"}
        >
          <RotateCcw className="size-4" aria-hidden />
          {t("modelGatewaySyncReset")}
        </Button>
      </div>

      {notice ? (
        <div className="mt-3">
          <ConsoleNotice message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />
        </div>
      ) : null}

      <p className="mt-3 text-[11px] leading-5 text-zinc-400">{t("modelGatewaySyncCookieHint")}</p>
    </div>
  );
}
