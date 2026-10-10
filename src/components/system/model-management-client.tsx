"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Boxes, Check, Copy, ExternalLink, Inbox, Search, Server, SlidersHorizontal } from "lucide-react";
import { ConsoleCard, ConsoleNotice } from "@/components/ui/console-surface";
import ModelConfigPanel from "@/components/system/model-config-panel";
import ModelGatewaySyncPanel from "@/components/system/model-gateway-sync-panel";
import ModelPricePanel from "@/components/system/model-price-panel";
import ModelProviderPanel from "@/components/system/model-provider-panel";
import ModelRegistryPanel from "@/components/system/model-registry-panel";
import { aiProviderRegistry } from "@/features/ai-settings/provider-registry";
import {
  mainstreamCapabilityLabelKeys,
  mainstreamModelCapabilities,
  mainstreamProviderStatusLabelKeys,
  type MainstreamModelCapability,
  type MainstreamProviderStatus,
} from "@/features/ai-settings/mainstream-model-catalog";
import { swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import { cn } from "@/lib/utils";
import type { LocalAIProvider } from "@/lib/types";

export type ModelManagementTab = "catalog" | "registry" | "providers" | "config" | "prices";

type CatalogVendor = {
  id: string;
  name: string;
  region: "global" | "cn";
  total: number;
  status: MainstreamProviderStatus;
  docsUrl: string | null;
  apiKeyUrl: string | null;
  compatibleBaseUrl: string | null;
  provider: LocalAIProvider | null;
  baseUrl: string;
  capabilityGroups: Array<{ capability: MainstreamModelCapability; models: string[] }>;
};

type CatalogProvider = {
  id: LocalAIProvider;
  configured: boolean;
  baseUrl: string;
  model: string;
};

type CatalogResponse = {
  source: string;
  capturedAt: string;
  total: number;
  providers: CatalogProvider[];
  capabilities: Array<{ id: MainstreamModelCapability; count: number }>;
  vendors: CatalogVendor[];
};

const statusTone: Record<MainstreamProviderStatus, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
  "key-only": "border-amber-200 bg-amber-50 text-amber-700",
  "missing-key": "border-zinc-200 bg-zinc-50 text-zinc-500",
  external: "border-indigo-200 bg-indigo-50 text-indigo-600",
};

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function ExternalLinkButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-sky-100 bg-white px-2.5 py-1 text-[11px] font-medium text-sky-700 transition hover:bg-sky-50"
    >
      {label}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

function VendorBlock({
  vendor,
  copiedModel,
  onCopy,
}: {
  vendor: CatalogVendor;
  copiedModel: string;
  onCopy: (model: string) => void;
}) {
  const { t } = useI18n();
  const statusLabel = t(mainstreamProviderStatusLabelKeys[vendor.status]);

  return (
    <section className="rounded-2xl border border-sky-100 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-900">
            <span>{vendor.name}</span>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
              {vendor.region === "cn" ? t("modelMgmtRegionCn") : t("modelMgmtRegionGlobal")}
            </span>
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
              {t("modelMgmtTotal", { count: vendor.total })}
            </span>
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", statusTone[vendor.status])}>
              {statusLabel}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {vendor.docsUrl ? <ExternalLinkButton href={vendor.docsUrl} label={t("modelMgmtDocs")} /> : null}
            {vendor.apiKeyUrl ? <ExternalLinkButton href={vendor.apiKeyUrl} label={t("modelMgmtGetKey")} /> : null}
            {vendor.compatibleBaseUrl ? (
              <button
                type="button"
                onClick={() => void copyText(vendor.compatibleBaseUrl as string)}
                className="inline-flex items-center gap-1 rounded-full border border-sky-100 bg-white px-2.5 py-1 font-mono text-[11px] text-zinc-500 transition hover:bg-sky-50"
                title={t("modelMgmtCompatibleBaseUrl")}
              >
                <Copy className="size-3" aria-hidden />
                {vendor.compatibleBaseUrl}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {vendor.capabilityGroups.map((group) => (
          <div key={`${vendor.id}-${group.capability}`} className="flex flex-wrap items-center gap-2">
            <span className="w-24 shrink-0 truncate text-xs font-semibold text-zinc-500">
              {t(mainstreamCapabilityLabelKeys[group.capability])}
            </span>
            <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
              {group.models.length}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {group.models.map((model) => (
                <button
                  key={model}
                  type="button"
                  onClick={() => onCopy(model)}
                  title={model}
                  className={cn(
                    "inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                    copiedModel === model
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-sky-100 bg-sky-50/60 text-zinc-700 hover:border-sky-300 hover:bg-sky-100",
                  )}
                >
                  {copiedModel === model ? <Check className="size-3" aria-hidden /> : <Copy className="size-3 opacity-40" aria-hidden />}
                  <span className="truncate">{model}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CatalogTab() {
  const { t } = useI18n();
  const [capability, setCapability] = useState<MainstreamModelCapability | "all">("all");
  const [vendorId, setVendorId] = useState<string>("all");
  const [keyword, setKeyword] = useState("");
  const [copiedModel, setCopiedModel] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);

  const { data } = useSWR<CatalogResponse>("/api/models/catalog", swrFetcher);

  const visibleVendors = useMemo(() => {
    const search = keyword.trim().toLowerCase();
    return (data?.vendors ?? [])
      .filter((vendor) => vendorId === "all" || vendor.id === vendorId)
      .map((vendor) => {
        const capabilityGroups = vendor.capabilityGroups
          .filter((group) => capability === "all" || group.capability === capability)
          .map((group) => ({
            ...group,
            models: search ? group.models.filter((model) => model.toLowerCase().includes(search)) : group.models,
          }))
          .filter((group) => group.models.length > 0);
        return { ...vendor, capabilityGroups };
      })
      .filter((vendor) => vendor.capabilityGroups.length > 0);
  }, [data, capability, vendorId, keyword]);

  async function handleCopy(model: string) {
    const copied = await copyText(model);
    setCopyFailed(!copied);
    setCopiedModel(model);
  }

  return (
    <ConsoleCard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_10px_24px_-12px_rgba(37,99,235,0.55)]">
            <Boxes className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-zinc-950">{t("modelMgmtTitle")}</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500">{t("modelMgmtSubtitle")}</p>
          </div>
        </div>
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-300" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t("modelMgmtSearchPlaceholder")}
            className="h-10 w-56 rounded-full border border-sky-100 bg-white pl-9 pr-4 text-sm outline-none transition focus:border-sky-400 focus:ring-1 focus:ring-sky-400"
          />
        </label>
      </div>

      <ModelGatewaySyncPanel />

      {copiedModel ? (
        <div className="mt-4">
          <ConsoleNotice
            message={copyFailed ? t("modelMgmtCopyFailed", { model: copiedModel }) : t("modelMgmtCopied", { model: copiedModel })}
            tone={copyFailed ? "error" : "success"}
            onDismiss={() => setCopiedModel("")}
          />
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setVendorId("all")}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition",
            vendorId === "all" ? "bg-sky-500 text-white shadow-sm" : "border border-sky-100 bg-white text-zinc-600 hover:bg-sky-50",
          )}
        >
          {t("modelMgmtFilterAll")}
          {data ? <span className="ml-1 opacity-70">{data.total}</span> : null}
        </button>
        {(data?.vendors ?? []).map((vendor) => (
          <button
            key={vendor.id}
            type="button"
            onClick={() => setVendorId(vendor.id)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition",
              vendorId === vendor.id ? "bg-sky-500 text-white shadow-sm" : "border border-sky-100 bg-white text-zinc-600 hover:bg-sky-50",
            )}
          >
            {vendor.name}
            <span className="ml-1 opacity-70">{vendor.total}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-sky-50 pt-3">
        <button
          type="button"
          onClick={() => setCapability("all")}
          className={cn(
            "rounded-full px-3 py-1 text-[11px] font-medium transition",
            capability === "all" ? "bg-zinc-900 text-white shadow-sm" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200",
          )}
        >
          {t("modelMgmtCapabilityAll")}
        </button>
        {mainstreamModelCapabilities.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setCapability(entry)}
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-medium transition",
              capability === entry ? "bg-zinc-900 text-white shadow-sm" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200",
            )}
          >
            {t(mainstreamCapabilityLabelKeys[entry])}
            {data ? <span className="ml-1 opacity-70">{data.capabilities.find((item) => item.id === entry)?.count ?? 0}</span> : null}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        {visibleVendors.map((vendor) => (
          <VendorBlock key={vendor.id} vendor={vendor} copiedModel={copiedModel} onCopy={(model) => void handleCopy(model)} />
        ))}
        {data && visibleVendors.length === 0 ? (
          <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-sky-100 bg-sky-50/40 py-20 text-center">
            <Inbox className="size-10 text-zinc-300" />
            <p className="max-w-md text-sm leading-6 text-zinc-500">{t("modelMgmtEmpty")}</p>
          </div>
        ) : null}
      </div>

      <p className="mt-5 border-t border-sky-50 pt-4 text-xs leading-5 text-zinc-400">
        {t("modelMgmtCatalogNote", {
          total: data?.total ?? 0,
          source: data?.source ?? "-",
          date: data?.capturedAt ?? "-",
        })}
      </p>
    </ConsoleCard>
  );
}

function ProviderStatusCard({ providers }: { providers: CatalogProvider[] }) {
  const { t } = useI18n();
  return (
    <ConsoleCard>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-zinc-900 text-white">
          <Server className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-zinc-950">{t("modelMgmtProviderStatusTitle")}</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{t("modelMgmtProviderStatusDescription")}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {providers.map((provider) => (
          <div key={provider.id} className="rounded-2xl border border-sky-100 bg-white p-4">
            <p className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-zinc-900">
              <span>{t(aiProviderRegistry[provider.id].displayNameKey as TranslationKey)}</span>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  provider.configured ? statusTone.ready : statusTone["missing-key"],
                )}
              >
                {provider.configured ? t("modelMgmtProviderConfigured") : t("modelMgmtProviderMissing")}
              </span>
            </p>
            <p className="mt-2 truncate text-xs text-zinc-500">
              {t("modelMgmtCurrentModel")}:{" "}
              <span className="font-mono text-zinc-700">{provider.model || t("modelMgmtProviderAuto")}</span>
            </p>
            <p className="mt-1 truncate font-mono text-[11px] text-zinc-400" title={provider.baseUrl}>
              {provider.baseUrl}
            </p>
          </div>
        ))}
      </div>
    </ConsoleCard>
  );
}

export default function ModelManagementClient({ initialTab = "catalog" }: { initialTab?: ModelManagementTab }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<ModelManagementTab>(initialTab);
  const { data } = useSWR<CatalogResponse>("/api/models/catalog", swrFetcher);

  const tabs: Array<{ id: ModelManagementTab; label: string }> = [
    { id: "catalog", label: t("modelMgmtTabCatalog") },
    { id: "registry", label: t("aiModelTabRegistry") },
    { id: "providers", label: t("aiModelTabProviders") },
    { id: "config", label: t("modelMgmtTabConfig") },
    { id: "prices", label: t("modelMgmtTabPrices") },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-6 border-b border-sky-100">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={cn(
              "-mb-px border-b-2 px-1 pb-2.5 text-sm font-medium transition",
              tab === entry.id ? "border-sky-500 text-sky-700" : "border-transparent text-zinc-500 hover:text-zinc-900",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "catalog" ? <CatalogTab /> : null}

      {tab === "registry" ? (
        <ConsoleCard>
          <ModelRegistryPanel />
        </ConsoleCard>
      ) : null}

      {tab === "providers" ? (
        <ConsoleCard>
          <ModelProviderPanel />
        </ConsoleCard>
      ) : null}

      {tab === "config" ? (
        <div className="space-y-6">
          <ConsoleCard>
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white">
                <SlidersHorizontal className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-zinc-950">{t("modelMgmtLocalTitle")}</h2>
                <p className="mt-1 text-xs leading-5 text-zinc-500">{t("modelMgmtLocalDescription")}</p>
              </div>
            </div>
            <div className="mt-5">
              <ModelConfigPanel />
            </div>
          </ConsoleCard>
          <ProviderStatusCard providers={data?.providers ?? []} />
        </div>
      ) : null}

      {tab === "prices" ? <ModelPricePanel /> : null}
    </div>
  );
}
