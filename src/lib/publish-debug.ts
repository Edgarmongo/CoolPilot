import fs from "node:fs";
import path from "node:path";
import { artifactsRoot } from "@/lib/paths";

/**
 * Publish debug logging.
 *
 * Steps are always buffered in memory and returned by `/api/publish/logs`, so the
 * run panel can show/copy the last run. Set the `COOLPILOT_PUBLISH_DEBUG` env var
 * (e.g. `COOLPILOT_PUBLISH_DEBUG=1`) — or flip the in-app switch via the same route
 * — to also persist the log + screenshots to `<artifacts>/publish-logs`.
 */
let runtimeOverride: boolean | null = null;

export function isPublishDebugEnabled(): boolean {
  if (runtimeOverride !== null) return runtimeOverride;
  const value = (process.env.COOLPILOT_PUBLISH_DEBUG ?? "").trim().toLowerCase();
  return value !== "" && value !== "0" && value !== "false" && value !== "off";
}

/** In-app switch (persists for the server process); `null` falls back to the env var. */
export function setPublishDebugEnabled(value: boolean | null) {
  runtimeOverride = value;
}

export type PublishLogger = {
  step: (message: string) => void;
  screenshot: (filePath: string) => void;
};

type PublishLogStore = { lines: string[]; screenshots: string[]; filePath: string };

const stores = new Map<string, PublishLogStore>();

function logsDir() {
  return path.join(artifactsRoot(), "publish-logs");
}

/** Creates (or resets) the log buffer for a scope, typically the account id. */
export function createPublishLog(scope: string): PublishLogger {
  const filePath = path.join(logsDir(), `${scope}-${Date.now()}.log`);
  const store: PublishLogStore = { lines: [], screenshots: [], filePath };
  stores.set(scope, store);

  const persist = (line: string) => {
    if (!isPublishDebugEnabled()) return;
    try {
      fs.mkdirSync(logsDir(), { recursive: true });
      fs.appendFileSync(filePath, `${line}\n`);
    } catch {
      // Logging must never break a publish run.
    }
  };

  const push = (line: string) => {
    store.lines.push(line);
    if (store.lines.length > 800) {
      store.lines.splice(0, store.lines.length - 800);
    }
    persist(line);
  };

  return {
    step(message: string) {
      push(`[${new Date().toISOString()}] ${message}`);
    },
    screenshot(file: string) {
      store.screenshots.push(file);
      push(`[screenshot] ${file}`);
    },
  };
}

export function getPublishDebugLog(scope: string) {
  const store = stores.get(scope);
  return {
    enabled: isPublishDebugEnabled(),
    lines: store?.lines ?? [],
    screenshots: store?.screenshots ?? [],
    file: store?.filePath ?? "",
  };
}
