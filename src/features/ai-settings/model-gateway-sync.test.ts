import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultModelGatewayEndpoint } from "@/lib/types";

/**
 * Exercises the manual model-gateway sync against a throwaway SQLite file and a
 * stubbed gateway response. The account cookie is mocked away from `.env.local`
 * so the test never writes credentials into the working tree.
 */
const secrets = vi.hoisted(() => ({ cookie: "", writes: [] as string[] }));

vi.mock("@/lib/secrets", async () => {
  const actual = await vi.importActual<typeof import("@/lib/secrets")>("@/lib/secrets");
  return {
    ...actual,
    readModelGatewayCookie: async () => secrets.cookie,
    writeModelGatewayCookie: async (value: string) => {
      if (!value.trim() || value.includes("*")) return false;
      secrets.cookie = value.trim();
      secrets.writes.push(value);
      return true;
    },
    clearModelGatewayCookie: async () => {
      secrets.cookie = "";
    },
  };
});

// The sqlite client resolves its url on first import, so point it at a temp file
// before the modules under test are loaded.
const testDbDir = mkdtempSync(path.join(tmpdir(), "coolpilot-gateway-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(testDbDir, "gateway.db").replace(/\\/g, "/")}`;

const snapshot = await import("@/features/ai-settings/model-gateway-snapshot");
const gateway = await import("@/features/ai-settings/model-gateway-sync");

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("model gateway sync", () => {
  beforeEach(async () => {
    secrets.cookie = "";
    secrets.writes = [];
    vi.unstubAllGlobals();
    // Back to the shipped defaults: bundled snapshot, switch off, no credential.
    await gateway.resetModelGateway();
    await gateway.saveModelGatewaySettings({ enabled: false, endpoint: defaultModelGatewayEndpoint });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses to sync while the feature switch is off", async () => {
    await expect(gateway.syncModelGateway()).rejects.toMatchObject({ code: "MODEL_GATEWAY_DISABLED" });

    const state = await gateway.getModelGatewayState();
    expect(state.enabled).toBe(false);
    expect(state.usingSyncedModels).toBe(false);
    expect(state.modelCount).toBe(snapshot.modelGatewayModels.length);
  });

  it("stores the switch, endpoint and cookie without leaking the cookie", async () => {
    const saved = await gateway.saveModelGatewaySettings({
      enabled: true,
      endpoint: "https://quanzil.com/api/user/models",
      cookie: "session=super-secret-value",
    });

    expect(saved.enabled).toBe(true);
    expect(saved.cookieConfigured).toBe(true);
    expect(saved.cookieMasked.endsWith("alue")).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("super-secret-value");
    expect(secrets.writes).toEqual(["session=super-secret-value"]);
  });

  it("ignores masked cookie placeholders echoed back by the UI", async () => {
    await gateway.saveModelGatewaySettings({ enabled: true, cookie: "session=super-secret-value" });
    secrets.writes = [];

    const saved = await gateway.saveModelGatewaySettings({ cookie: "****************alue" });

    expect(secrets.writes).toEqual([]);
    expect(saved.cookieMasked.endsWith("alue")).toBe(true);
  });

  it("persists the synced model list and serves it to the catalog", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: ["gpt-5.6-sol", "kling-v2", " gpt-5.6-sol "] }));
    vi.stubGlobal("fetch", fetchMock);

    await gateway.saveModelGatewaySettings({ enabled: true, cookie: "session=abc" });
    const state = await gateway.syncModelGateway();

    expect(state.status).toBe("ok");
    expect(state.message).toBe("");
    expect(state.usingSyncedModels).toBe(true);
    expect(state.modelCount).toBe(2);
    expect(state.source).toBe("quanzil.com/api/user/models");
    expect(state.syncedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const catalog = await gateway.resolveModelGatewayCatalog();
    expect(catalog.usingSyncedModels).toBe(true);
    expect(catalog.models).toEqual(["gpt-5.6-sol", "kling-v2"]);
    expect(catalog.source).toBe("quanzil.com/api/user/models");
    expect(catalog.syncedAt).toBe(state.syncedAt);
  });

  it("sends the stored cookie to the endpoint and reports gateway errors", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return jsonResponse({ message: "unauthorized" }, 401);
      }),
    );

    await gateway.saveModelGatewaySettings({ enabled: true, cookie: "session=abc" });
    await expect(gateway.syncModelGateway()).rejects.toMatchObject({ code: "MODEL_GATEWAY_REQUEST_FAILED" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://quanzil.com/api/user/models");
    expect((calls[0]?.init?.headers as Record<string, string>)?.cookie).toBe("session=abc");

    const state = await gateway.getModelGatewayState();
    expect(state.status).toBe("error");
    expect(state.message).toBe("HTTP 401");
    expect(state.usingSyncedModels).toBe(false);

    // The catalog keeps serving the bundled snapshot after a failed attempt.
    const catalog = await gateway.resolveModelGatewayCatalog();
    expect(catalog.usingSyncedModels).toBe(false);
    expect(catalog.models.length).toBe(snapshot.modelGatewayModels.length);
  });

  it("fails without a cookie and reports an empty payload", async () => {
    await gateway.saveModelGatewaySettings({ enabled: true, endpoint: "https://quanzil.com/api/user/models" });
    await expect(gateway.syncModelGateway()).rejects.toMatchObject({ code: "MODEL_GATEWAY_MISSING_COOKIE" });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [] })));
    await gateway.saveModelGatewaySettings({ cookie: "session=abc" });
    await expect(gateway.syncModelGateway()).rejects.toMatchObject({ code: "MODEL_GATEWAY_EMPTY_RESPONSE" });
  });

  it("resets the synced list, the credential and the sync status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(["model-a"])));
    await gateway.saveModelGatewaySettings({ enabled: true, cookie: "session=abc" });
    await gateway.syncModelGateway();

    const reset = await gateway.resetModelGateway();

    expect(reset.cookieConfigured).toBe(false);
    expect(reset.cookieMasked).toBe("");
    expect(reset.status).toBe("never");
    expect(reset.syncedAt).toBeNull();
    expect(reset.syncedOn).toBe("");
    expect(reset.usingSyncedModels).toBe(false);
    expect(reset.modelCount).toBe(snapshot.modelGatewayModels.length);
    expect(reset.source).toBe(snapshot.modelGatewaySnapshotSource);

    const catalog = await gateway.resolveModelGatewayCatalog();
    expect(catalog.models).toBe(snapshot.modelGatewayModels);
  });
});
