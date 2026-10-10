"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Boxes, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsoleNotice, consoleInputClass } from "@/components/ui/console-surface";
import { SelectField } from "@/components/ui/form-controls";
import { aiProviderOrder, aiProviderRegistry } from "@/features/ai-settings/provider-registry";
import { ApiClientError, apiPost, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import { localizedPath } from "@/lib/i18n-config";
import type { LocalAIProvider, LocalAgentSettings, LocalImageProvider } from "@/lib/types";

export type ModelConfigForm = LocalAgentSettings & {
  geminiKey: string;
  groqKey: string;
  openAIKey: string;
  openRouterKey: string;
  // Image credentials are their own fields: they are stored under separate provider refs and are
  // never the text key echoed back (CI-AI-IMG-CONFIG-02, Q1/Q2).
  openAIImageKey: string;
  geminiImageKey: string;
};

type ModelListResponse = {
  models: Array<{ id: string; label: string }>;
};

type TranslateFn = (key: TranslationKey, values?: Record<string, string | number>) => string;

function providerLabel(t: TranslateFn, provider: LocalAIProvider | LocalImageProvider) {
  if (provider === "gemini") return t("providerGemini");
  if (provider === "groq") return t("providerGroq");
  if (provider === "openai") return t("providerOpenAI");
  return t("providerOpenRouter");
}

export function ModelInput({
  id,
  label,
  value,
  models,
  placeholder,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  models: ModelListResponse["models"] | undefined;
  placeholder: string;
  hint: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
      <span>{label}</span>
      <input
        value={value}
        list={id}
        onChange={(event) => onChange(event.target.value)}
        className={consoleInputClass}
        placeholder={placeholder}
      />
      <datalist id={id}>
        {(models ?? []).map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </datalist>
      <span className="text-xs font-normal text-zinc-400">{hint}</span>
    </label>
  );
}

/**
 * Local model configuration (runtime mode, provider keys, provider models and
 * image generation). Shared by 系统 / 模型管理 and the settings runtime tab so
 * the provider form has a single implementation.
 */
export default function ModelConfigPanel({ showCatalogLink = false }: { showCatalogLink?: boolean }) {
  const { t, locale } = useI18n();
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState<"success" | "error">("success");
  const [form, setForm] = useState<ModelConfigForm | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: initialData, mutate: reloadSettings } = useSWR<ModelConfigForm>("/api/settings/ai", swrFetcher, {
    revalidateOnFocus: false,
  });
  const { data: textModelData } = useSWR<ModelListResponse>(
    form ? `/api/settings/ai/models?provider=${form.textProvider}&capability=text` : null,
    swrFetcher,
    { revalidateOnFocus: false },
  );
  const { data: imageModelData } = useSWR<ModelListResponse>(
    form ? `/api/settings/ai/models?provider=${form.imageProvider}&capability=image` : null,
    swrFetcher,
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    if (initialData) {
      window.queueMicrotask(() => setForm(initialData));
    }
  }, [initialData]);

  function showNotice(message: string, type: "success" | "error" = "success") {
    setNotice(message);
    setNoticeType(type);
  }

  function errorNotice(error: unknown) {
    if (error instanceof ApiClientError && error.code) {
      return t(`error_${error.code}` as Parameters<typeof t>[0]);
    }
    return error instanceof Error ? error.message : t("unknownError");
  }

  function updateForm(patch: Partial<ModelConfigForm>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    try {
      await apiPost("/api/settings/ai", form);
      showNotice(t("settingsSaved"));
      await reloadSettings();
    } catch (error) {
      showNotice(errorNotice(error), "error");
    } finally {
      setSaving(false);
    }
  }

  function textModelValue() {
    if (!form) return "";
    if (form.textProvider === "gemini") return form.geminiModel;
    if (form.textProvider === "groq") return form.groqModel;
    if (form.textProvider === "openai") return form.openAIModel;
    return form.openRouterModel;
  }

  function updateTextModel(model: string) {
    if (!form) return;
    if (form.textProvider === "gemini") updateForm({ geminiModel: model });
    else if (form.textProvider === "groq") updateForm({ groqModel: model });
    else if (form.textProvider === "openai") updateForm({ openAIModel: model });
    else updateForm({ openRouterModel: model });
  }

  function imageModelValue() {
    if (!form) return "";
    return form.imageProvider === "gemini" ? form.geminiImageModel : form.openAIImageModel;
  }

  function updateImageModel(model: string) {
    if (!form) return;
    if (form.imageProvider === "gemini") updateForm({ geminiImageModel: model });
    else updateForm({ openAIImageModel: model });
  }

  const modelInputCopy = {
    placeholder: t("modelAutoPlaceholder"),
    hint: t("modelListHint"),
  };

  return (
    <div className="space-y-5">
      {notice ? <ConsoleNotice message={notice} tone={noticeType} onDismiss={() => setNotice("")} /> : null}

      {form ? (
        <>
          <div className="w-full space-y-5">
            <section className="space-y-4 border-b border-border pb-5">
              <SelectField<LocalAIProvider>
                label={t("textProvider")}
                value={form.textProvider}
                options={aiProviderOrder.map((provider) => ({
                  value: provider,
                  label: t(aiProviderRegistry[provider].displayNameKey as TranslationKey),
                }))}
                onChange={(textProvider) => updateForm({ textProvider })}
              />

              <div className="grid gap-4 md:grid-cols-2">
                {form.textProvider === "gemini" ? (
                  <>
                    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                      <span>{t("geminiKey")}</span>
                      <input
                        type="password"
                        value={form.geminiKey}
                        onChange={(event) => updateForm({ geminiKey: event.target.value })}
                        className={`${consoleInputClass} font-mono`}
                      />
                    </label>
                    <ModelInput id="text-models" label={t("textModel")} value={textModelValue()} models={textModelData?.models} onChange={updateTextModel} {...modelInputCopy} />
                  </>
                ) : null}
                {form.textProvider === "groq" ? (
                  <>
                    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                      <span>{t("groqKey")}</span>
                      <input
                        type="password"
                        value={form.groqKey}
                        onChange={(event) => updateForm({ groqKey: event.target.value })}
                        className={`${consoleInputClass} font-mono`}
                      />
                    </label>
                    <ModelInput id="text-models" label={t("textModel")} value={textModelValue()} models={textModelData?.models} onChange={updateTextModel} {...modelInputCopy} />
                  </>
                ) : null}
                {form.textProvider === "openai" ? (
                  <>
                    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                      <span>{t("openAIKey")}</span>
                      <input
                        type="password"
                        value={form.openAIKey}
                        onChange={(event) => updateForm({ openAIKey: event.target.value })}
                        className={`${consoleInputClass} font-mono`}
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                      <span>{t("openAIBaseUrl")}</span>
                      <input
                        value={form.openAIBaseUrl}
                        onChange={(event) => updateForm({ openAIBaseUrl: event.target.value })}
                        className={consoleInputClass}
                      />
                    </label>
                    <ModelInput id="text-models" label={t("textModel")} value={textModelValue()} models={textModelData?.models} onChange={updateTextModel} {...modelInputCopy} />
                  </>
                ) : null}
                {form.textProvider === "openrouter" ? (
                  <>
                    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                      <span>{t("openRouterKey")}</span>
                      <input
                        type="password"
                        value={form.openRouterKey}
                        onChange={(event) => updateForm({ openRouterKey: event.target.value })}
                        className={`${consoleInputClass} font-mono`}
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                      <span>{t("openRouterBaseUrl")}</span>
                      <input
                        value={form.openRouterBaseUrl}
                        onChange={(event) => updateForm({ openRouterBaseUrl: event.target.value })}
                        className={consoleInputClass}
                      />
                    </label>
                    <ModelInput id="text-models" label={t("openRouterModel")} value={textModelValue()} models={textModelData?.models} onChange={updateTextModel} {...modelInputCopy} />
                  </>
                ) : null}
              </div>
            </section>

            <section className="space-y-4">
              <SelectField<LocalImageProvider>
                label={t("imageProvider")}
                value={form.imageProvider}
                options={(["openai", "gemini"] as LocalImageProvider[]).map((provider) => ({
                  value: provider,
                  label: providerLabel(t, provider),
                }))}
                onChange={(imageProvider) => updateForm({ imageProvider })}
              />
              {form.imageProvider === "openai" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                    <span>{t("openAIImageKey")}</span>
                    <input
                      type="password"
                      value={form.openAIImageKey}
                      onChange={(event) => updateForm({ openAIImageKey: event.target.value })}
                      className={`${consoleInputClass} font-mono`}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                    <span>{t("openAIImageBaseUrl")}</span>
                    <input
                      value={form.openAIImageBaseUrl}
                      onChange={(event) => updateForm({ openAIImageBaseUrl: event.target.value })}
                      className={consoleInputClass}
                    />
                    <span className="text-xs font-normal text-zinc-400">{t("openAIImageBaseUrlHint")}</span>
                  </label>
                  <ModelInput id="image-models" label={t("openAIImageModel")} value={imageModelValue()} models={imageModelData?.models} onChange={updateImageModel} {...modelInputCopy} />
                  <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                    <span>{t("imageSize")}</span>
                    <input
                      value={form.openAIImageSize}
                      onChange={(event) => updateForm({ openAIImageSize: event.target.value })}
                      className={consoleInputClass}
                    />
                  </label>
                </div>
              ) : null}
              {form.imageProvider === "gemini" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                    <span>{t("geminiImageKey")}</span>
                    <input
                      type="password"
                      value={form.geminiImageKey}
                      onChange={(event) => updateForm({ geminiImageKey: event.target.value })}
                      className={`${consoleInputClass} font-mono`}
                    />
                  </label>
                  <ModelInput id="image-models" label={t("imageModel")} value={imageModelValue()} models={imageModelData?.models} onChange={updateImageModel} {...modelInputCopy} />
                </div>
              ) : null}
            </section>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void handleSave()} loading={saving}>
              <ShieldCheck size={16} />
              {t("btnSaveSettings")}
            </Button>
            {showCatalogLink ? (
              <Link
                href={localizedPath(locale, "/system/models?tab=catalog")}
                className="inline-flex items-center gap-2 rounded-2xl border border-sky-100 bg-white px-4 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-50"
              >
                <Boxes size={16} />
                {t("modelMgmtBrowseCatalog")}
              </Link>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
