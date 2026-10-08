/**
 * Server-side glue for the manual model-gateway sync behind 系统 / 模型管理.
 *
 * The feature switch (`ModelGatewaySettings.enabled`) is off by default: while it
 * stays off, the catalog only serves the snapshot bundled in
 * `model-gateway-snapshot.ts`. When the user enables it, stores their own account
 * cookie and presses 同步, this module fetches the live model list, persists it in
 * the local database and the catalog starts serving it instead - no rebuild and no
 * writes back into the source tree (packaged Electron builds are read-only).
 *
 * The cookie itself never reaches the database, the API response or the logs; it is
 * kept in `.env.local` next to the provider keys by `@/lib/secrets`.
 */
import { AppError } from "@/lib/app-errors";
import {
  clearModelGatewayModels,
  getModelGatewaySettings,
  updateModelGatewaySettings,
} from "@/db/repositories/settings";
import { clearModelGatewayCookie, maskKey, readModelGatewayCookie, writeModelGatewayCookie } from "@/lib/secrets";
import { defaultModelGatewayEndpoint, type ModelGatewaySettings, type ModelGatewaySyncStatus } from "@/lib/types";
import { formatGatewaySyncDate, gatewayEndpointLabel, parseGatewayModelPayload } from "./model-gateway-payload";
import {
  modelGatewayModels,
  modelGatewaySnapshotCapturedAt,
  modelGatewaySnapshotSource,
} from "./model-gateway-snapshot";

const requestTimeoutMs = 20_000;

/** Safe projection of the sync state for the client - never includes the cookie. */
export type ModelGatewayState = {
  enabled: boolean;
  endpoint: string;
  cookieConfigured: boolean;
  cookieMasked: string;
  syncedAt: number | null;
  /** Local yyyy-mm-dd of the last successful sync, empty when never synced. */
  syncedOn: string;
  status: ModelGatewaySyncStatus;
  /** Failure reason of the last attempt, empty after a successful one. */
  message: string;
  modelCount: number;
  source: string;
  capturedAt: string;
  usingSyncedModels: boolean;
  bundledModelCount: number;
  bundledSource: string;
  bundledCapturedAt: string;
  defaultEndpoint: string;
};

/** Model list the catalog should render right now. */
export type ModelGatewayCatalog = {
  models: readonly string[];
  source: string;
  capturedAt: string;
  syncedAt: number | null;
  usingSyncedModels: boolean;
};

function activeSyncedModels(settings: ModelGatewaySettings) {
  return settings.enabled && settings.models.length > 0;
}

function syncedSource(settings: ModelGatewaySettings) {
  return settings.source || gatewayEndpointLabel(settings.endpoint);
}

export async function getModelGatewayState(): Promise<ModelGatewayState> {
  const settings = await getModelGatewaySettings();
  const cookie = await readModelGatewayCookie();
  const usingSyncedModels = activeSyncedModels(settings);
  const syncedOn = settings.syncedAt ? formatGatewaySyncDate(settings.syncedAt) : "";

  return {
    enabled: settings.enabled,
    endpoint: settings.endpoint,
    cookieConfigured: Boolean(cookie),
    cookieMasked: cookie ? maskKey(cookie) : "",
    syncedAt: settings.syncedAt,
    syncedOn,
    status: settings.status,
    message: settings.message,
    modelCount: usingSyncedModels ? settings.models.length : modelGatewayModels.length,
    source: usingSyncedModels ? syncedSource(settings) : modelGatewaySnapshotSource,
    capturedAt: usingSyncedModels && syncedOn ? syncedOn : modelGatewaySnapshotCapturedAt,
    usingSyncedModels,
    bundledModelCount: modelGatewayModels.length,
    bundledSource: modelGatewaySnapshotSource,
    bundledCapturedAt: modelGatewaySnapshotCapturedAt,
    defaultEndpoint: defaultModelGatewayEndpoint,
  };
}

/** Model list for the catalog page: synced models win, the bundled snapshot is the fallback. */
export async function resolveModelGatewayCatalog(): Promise<ModelGatewayCatalog> {
  const settings = await getModelGatewaySettings();
  if (activeSyncedModels(settings)) {
    return {
      models: settings.models,
      source: syncedSource(settings),
      capturedAt: settings.syncedAt ? formatGatewaySyncDate(settings.syncedAt) : modelGatewaySnapshotCapturedAt,
      syncedAt: settings.syncedAt,
      usingSyncedModels: true,
    };
  }

  return {
    models: modelGatewayModels,
    source: modelGatewaySnapshotSource,
    capturedAt: modelGatewaySnapshotCapturedAt,
    syncedAt: null,
    usingSyncedModels: false,
  };
}

/**
 * Stores the feature switch, endpoint and (optionally) the account cookie.
 * Masked cookie placeholders echoed back by the UI are ignored.
 */
export async function saveModelGatewaySettings(input: {
  enabled?: boolean;
  endpoint?: string;
  cookie?: string;
}): Promise<ModelGatewayState> {
  const patch: Partial<ModelGatewaySettings> = {};
  if (typeof input.enabled === "boolean") {
    patch.enabled = input.enabled;
  }
  if (input.endpoint?.trim()) {
    patch.endpoint = input.endpoint.trim();
  }
  if (Object.keys(patch).length > 0) {
    await updateModelGatewaySettings(patch);
  }
  if (input.cookie !== undefined) {
    await writeModelGatewayCookie(input.cookie);
  }
  return getModelGatewayState();
}

/**
 * Fetches the live model list with the stored cookie. Failures are persisted so the
 * panel can show why the last attempt failed, and the catalog keeps serving the last
 * good list (synced models or the bundled snapshot).
 */
export async function syncModelGateway(): Promise<ModelGatewayState> {
  const settings = await getModelGatewaySettings();
  if (!settings.enabled) {
    throw new AppError("MODEL_GATEWAY_DISABLED", { status: 400 });
  }

  const cookie = await readModelGatewayCookie();
  if (!cookie) {
    await updateModelGatewaySettings({ status: "error", message: "No session cookie stored" });
    throw new AppError("MODEL_GATEWAY_MISSING_COOKIE", { status: 400 });
  }

  let models: string[];
  try {
    const response = await fetch(settings.endpoint, {
      headers: {
        accept: "application/json",
        cookie,
        "user-agent": "coolpilot-model-gateway-sync/1.0",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });

    if (!response.ok) {
      throw new AppError("MODEL_GATEWAY_REQUEST_FAILED", {
        status: 502,
        message: `HTTP ${response.status}`,
        details: { endpoint: settings.endpoint, status: response.status },
      });
    }

    models = parseGatewayModelPayload(await response.json());
  } catch (error) {
    const failure =
      error instanceof AppError
        ? error
        : new AppError("MODEL_GATEWAY_REQUEST_FAILED", {
            status: 502,
            message: error instanceof Error ? error.message : undefined,
            details: { endpoint: settings.endpoint },
          });
    await updateModelGatewaySettings({ status: "error", message: failure.message });
    throw failure;
  }

  if (models.length === 0) {
    await updateModelGatewaySettings({ status: "error", message: "Gateway returned no models" });
    throw new AppError("MODEL_GATEWAY_EMPTY_RESPONSE", {
      status: 502,
      details: { endpoint: settings.endpoint },
    });
  }

  await updateModelGatewaySettings({
    models,
    source: gatewayEndpointLabel(settings.endpoint),
    syncedAt: Date.now(),
    status: "ok",
    message: "",
  });

  return getModelGatewayState();
}

/** Drops the synced list and the stored cookie, restoring the bundled snapshot. */
export async function resetModelGateway(): Promise<ModelGatewayState> {
  await clearModelGatewayModels();
  await clearModelGatewayCookie();
  return getModelGatewayState();
}
