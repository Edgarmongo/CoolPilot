import { eq } from "drizzle-orm";
import { db, ensureDatabase } from "@/db/client";
import { appSettings } from "@/db/schema";
import {
  defaultModelGatewayEndpoint,
  type AgentPermissions,
  type BrandSettings,
  type LocalAgentSettings,
  type MetricsSettings,
  type ModelGatewaySettings,
  type PromptSettings,
} from "@/lib/types";
import {
  brandSettingsSchema,
  localAgentSettingsSchema,
  metricSettingsSchema,
  modelGatewaySettingsSchema,
  promptSettingsSchema,
} from "@/lib/validation";

const LOCAL_AGENT_SETTINGS_KEY = "local-agent";
const BRAND_SETTINGS_KEY = "brand";
const PROMPT_SETTINGS_KEY = "local-agent-prompt";
const METRICS_SETTINGS_KEY = "metrics";

/** Manual sync is the default; background refresh must be explicitly enabled. */
export const defaultMetricsSettings: MetricsSettings = {
  autoRefreshEnabled: false,
  refreshSamplingHours: [2, 24, 72, 168],
  perAccountThrottleMs: 4000,
};

export const defaultLocalAgentSettings: LocalAgentSettings = {
  runtimeMode: "local",
  textProvider: "gemini",
  imageProvider: "openai",
  geminiModel: "",
  groqModel: "",
  openAIBaseUrl: "https://api.openai.com/v1",
  openAIModel: "",
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  openRouterModel: "",
  geminiImageModel: "",
  openAIImageModel: "",
  openAIImageSize: "1024x1024",
  agentPermissions: {
    browserStep: "confirm",
    browserPostContent: "confirm",
    generateImage: "confirm",
    generatePostContent: "confirm",
    schedulePost: "confirm",
  },
};

type LocalAgentSettingsPatch = Partial<Omit<LocalAgentSettings, "agentPermissions">> & {
  agentPermissions?: Partial<AgentPermissions>;
};

function readSettingsJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

export async function readAppSetting(key: string) {
  await ensureDatabase();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row ? readSettingsJson(row.valueJson) : {};
}

export async function writeAppSetting(key: string, value: unknown) {
  await ensureDatabase();
  const updatedAt = Date.now();
  const valueJson = JSON.stringify(value);
  const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (existing) {
    await db.update(appSettings).set({ valueJson, updatedAt }).where(eq(appSettings.key, key));
  } else {
    await db.insert(appSettings).values({ key, valueJson, updatedAt });
  }
}

function parseLocalAgentSettings(value: unknown): LocalAgentSettings {
  const parsed = localAgentSettingsSchema.safeParse(value);
  const data = parsed.success ? parsed.data : {};
  return {
    ...defaultLocalAgentSettings,
    ...data,
    agentPermissions: {
      ...defaultLocalAgentSettings.agentPermissions,
      ...(data.agentPermissions ?? {}),
    },
  };
}

export async function getLocalAgentSettings() {
  return parseLocalAgentSettings(await readAppSetting(LOCAL_AGENT_SETTINGS_KEY));
}

export async function updateLocalAgentSettings(patch: LocalAgentSettingsPatch) {
  await ensureDatabase();
  const current = await getLocalAgentSettings();
  const next = parseLocalAgentSettings({
    ...current,
    ...patch,
    agentPermissions: {
      ...current.agentPermissions,
      ...(patch.agentPermissions ?? {}),
    },
  });
  await writeAppSetting(LOCAL_AGENT_SETTINGS_KEY, next);
  return next;
}

export const defaultBrandSettings: BrandSettings = {
  name: "",
  description: "",
  targetAudience: "",
  voice: "",
  colors: {
    primary: "",
    accent: "",
    background: "",
  },
};

export async function getBrandSettings(): Promise<BrandSettings> {
  const parsed = brandSettingsSchema.safeParse(await readAppSetting(BRAND_SETTINGS_KEY));
  return {
    ...defaultBrandSettings,
    ...(parsed.success ? parsed.data : {}),
    colors: {
      ...defaultBrandSettings.colors,
      ...(parsed.success ? parsed.data.colors : {}),
    },
  };
}

export async function updateBrandSettings(patch: Partial<BrandSettings>): Promise<BrandSettings> {
  const current = await getBrandSettings();
  const next = brandSettingsSchema.parse({
    ...current,
    ...patch,
    colors: {
      ...current.colors,
      ...(patch.colors ?? {}),
    },
  });
  await writeAppSetting(BRAND_SETTINGS_KEY, next);
  return next;
}

export async function getPromptSettings(): Promise<PromptSettings> {
  const parsed = promptSettingsSchema.safeParse(await readAppSetting(PROMPT_SETTINGS_KEY));
  return parsed.success ? parsed.data : { systemPrompt: "" };
}

export async function updatePromptSettings(patch: Partial<PromptSettings>): Promise<PromptSettings> {
  const current = await getPromptSettings();
  const next = promptSettingsSchema.parse({ ...current, ...patch });
  await writeAppSetting(PROMPT_SETTINGS_KEY, next);
  return next;
}

export async function getMetricsSettings(): Promise<MetricsSettings> {
  const parsed = metricSettingsSchema.safeParse(await readAppSetting(METRICS_SETTINGS_KEY));
  const data = parsed.success ? parsed.data : {};
  return {
    autoRefreshEnabled: data.autoRefreshEnabled ?? defaultMetricsSettings.autoRefreshEnabled,
    refreshSamplingHours: data.refreshSamplingHours ?? defaultMetricsSettings.refreshSamplingHours,
    perAccountThrottleMs: data.perAccountThrottleMs ?? defaultMetricsSettings.perAccountThrottleMs,
  };
}

export async function updateMetricsSettings(patch: Partial<MetricsSettings>): Promise<MetricsSettings> {
  const current = await getMetricsSettings();
  const next = metricSettingsSchema.parse({ ...current, ...patch }) as MetricsSettings;
  await writeAppSetting(METRICS_SETTINGS_KEY, {
    ...current,
    ...next,
  });
  return getMetricsSettings();
}

const MODEL_GATEWAY_SETTINGS_KEY = "model-gateway";

/**
 * Manual model-gateway sync state for 系统 / 模型管理. `models` stays empty until
 * the user runs a sync, so the bundled snapshot keeps serving the catalog.
 */
export const defaultModelGatewaySettings: ModelGatewaySettings = {
  enabled: false,
  endpoint: defaultModelGatewayEndpoint,
  models: [],
  source: "",
  syncedAt: null,
  status: "never",
  message: "",
};

export async function getModelGatewaySettings(): Promise<ModelGatewaySettings> {
  const parsed = modelGatewaySettingsSchema.safeParse(await readAppSetting(MODEL_GATEWAY_SETTINGS_KEY));
  const data = parsed.success ? parsed.data : {};
  return {
    enabled: data.enabled ?? defaultModelGatewaySettings.enabled,
    endpoint: data.endpoint ?? defaultModelGatewaySettings.endpoint,
    models: data.models ?? defaultModelGatewaySettings.models,
    source: data.source ?? defaultModelGatewaySettings.source,
    syncedAt: data.syncedAt ?? defaultModelGatewaySettings.syncedAt,
    status: data.status ?? defaultModelGatewaySettings.status,
    message: data.message ?? defaultModelGatewaySettings.message,
  };
}

export async function updateModelGatewaySettings(
  patch: Partial<ModelGatewaySettings>,
): Promise<ModelGatewaySettings> {
  const current = await getModelGatewaySettings();
  const next = modelGatewaySettingsSchema.parse({ ...current, ...patch });
  await writeAppSetting(MODEL_GATEWAY_SETTINGS_KEY, {
    ...current,
    ...next,
  });
  return getModelGatewaySettings();
}

/** Drops the synced model list so the catalog falls back to the bundled snapshot. */
export async function clearModelGatewayModels(): Promise<ModelGatewaySettings> {
  return updateModelGatewaySettings({
    models: [],
    source: "",
    syncedAt: null,
    status: "never",
    message: "",
  });
}

