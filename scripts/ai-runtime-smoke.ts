import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ModelRequirement } from "../src/features/ai-runtime/contracts";

/**
 * Dev-only smoke check for the AI runtime (Model Gateway): creates the schema, runs the
 * seed, then prints what the registry actually holds and how a requirement routes.
 *
 * Usage: tsx scripts/ai-runtime-smoke.ts [dataDir]
 * With no argument it uses a throwaway temp directory, so it never touches the real
 * app data - pass `./web-data` to inspect the local development database instead.
 */
async function main() {
  const dir = path.resolve(process.argv[2] ?? mkdtempSync(path.join(tmpdir(), "coolpilot-ai-runtime-")));
  process.env.SOCIAL_AUTO_POST_DATA_DIR ??= dir;
  process.env.SOCIAL_AUTO_POST_DB_URL ??= `file:${path.join(dir, "ai-runtime-smoke.db").replace(/\\/g, "/")}`;

  // Env is set before the database client is imported: it resolves its URL on first load.
  const registry = await import("../src/features/ai-runtime/registry");
  const repository = await import("../src/db/repositories/ai-runtime");

  await registry.ensureModelRuntimeSeeded();

  const totals = await registry.getRuntimeTotals();
  const capabilityCounts = await repository.countModelsByCapability();
  const views = await registry.listProviderViews();
  const callable = views.filter((view) => view.endpoints.some((endpoint) => endpoint.implemented));

  console.log(`database      ${process.env.SOCIAL_AUTO_POST_DB_URL}`);
  console.log(`models        ${totals.total} registered / ${totals.callable} callable`);
  console.log(`providers     ${views.length} registered / ${callable.length} with an implemented endpoint`);
  for (const view of views) {
    const endpoints = view.endpoints
      .map((endpoint) => `${endpoint.protocol}${endpoint.credential.configured ? "+key" : ""}${endpoint.implemented ? "" : "(no adapter)"}`)
      .join(", ");
    console.log(
      `  ${view.provider.providerId.padEnd(12)} models=${String(view.modelCount).padStart(4)} callable=${String(view.callableCount).padStart(4)} ${endpoints || "catalog only"}`,
    );
  }

  console.log(
    `capabilities  ${Object.entries(capabilityCounts)
      .map(([capability, counts]) => `${capability}=${counts.total}/${counts.callable}`)
      .join(" ")}`,
  );

  for (const requirement of [
    { capabilities: ["chat"], capability: "chat" },
    { capabilities: ["chat", "vision"], capability: "vision" },
    { capabilities: ["video_generation"], capability: "video_generation" },
  ] satisfies ModelRequirement[]) {
    const resolution = await registry.resolveRoute(requirement);
    const label = (requirement.capabilities ?? []).join("+");
    console.log(
      `route(${label})`.padEnd(24) +
        (resolution.candidate
          ? `${resolution.candidate.provider.providerId}/${resolution.candidate.model.modelId} [${resolution.reason}]`
          : `none - ${resolution.explanation?.reason} ${JSON.stringify(resolution.explanation?.missing)}`),
    );
  }

  console.log(`defaults      ${JSON.stringify(await registry.loadModelDefaults())}`);

  // G2 bridge: legacy settings/env → registry. With no legacy model configured this reports
  // "none"; with GEMINI_MODEL set it creates/enables that row and (if free) defaults chat to it.
  const legacy = await registry.importLegacyAiSettings();
  console.log(
    `legacy import preferred=${legacy.preferredProviderId} entries=${
      legacy.entries.map((entry) => `${entry.providerId}:${entry.modelId}(${entry.action})`).join(", ") || "none"
    }`,
  );
  console.log(
    `legacy defs   ${legacy.defaults.map((entry) => `${entry.capability}=${entry.modelId}(${entry.action})`).join(", ") || "none"}`,
  );

  // The legacy entry point `lib/agent/image-generation` is a facade over the runtime now: first
  // the routes the legacy settings imply - text passes the configured text provider as a
  // *preference*, image pins the configured image provider - then a real facade call against a
  // stubbed transport, so this costs no tokens and needs no network.
  const settings = await import("../src/db/repositories/settings");
  const localSettings = await settings.getLocalAgentSettings();
  const { requirementForIntent } = await import("../src/features/ai-runtime/contracts");
  const legacyRoutes: { label: string; requirement: ModelRequirement }[] = [
    {
      label: "legacy chat",
      requirement: {
        capabilities: ["chat"],
        capability: "chat",
        preferProviderId: localSettings.textProvider,
      },
    },
    {
      label: "legacy image",
      requirement: requirementForIntent("image-generation", { providerId: localSettings.imageProvider }),
    },
  ];
  for (const entry of legacyRoutes) {
    const resolution = await registry.resolveRoute(entry.requirement);
    console.log(
      `route(${entry.label})`.padEnd(24) +
        (resolution.candidate
          ? `${resolution.candidate.provider.providerId}/${resolution.candidate.model.modelId} [${resolution.reason}]`
          : `none - ${resolution.explanation?.reason}`),
    );
  }

  const imageFacade = await import("../src/lib/agent/image-generation");
  const realFetch = globalThis.fetch;
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    // Only the image endpoints are driven below: OpenAI-compatible installs post to
    // `/images/generations`, a gemini-pinned one to `:generateContent`.
    const payload = url.includes("/images/generations")
      ? { data: [{ b64_json: pngBase64 }] }
      : { candidates: [{ content: { parts: [{ text: "smoke reply" }] } }] };
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => payload,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response;
  }) as typeof fetch;
  try {
    const image = await imageFacade.generateImageFile({ prompt: "smoke: one pixel" });
    const { rm } = await import("node:fs/promises");
    await rm(image.path, { force: true });
    console.log(`facade image  ${image.provider}/${image.model} file=${path.basename(image.path)} (removed)`);
  } catch (error) {
    console.log(`facade image  unavailable: ${(error as Error).message}`);
  } finally {
    globalThis.fetch = realFetch;
  }

  // Credential layer: register a second key, then prove the pool cools down a 429'd key
  // and rotates to the healthy one - no network, the "provider" is the stub below.
  const keyPool = await import("../src/features/ai-runtime/key-pool");
  const credentials = await import("../src/lib/credentials");
  const { AppError } = await import("../src/lib/app-errors");

  const providerId = views.find((view) => view.provider.providerId === "qwen")?.provider.providerId ?? views[0]?.provider.providerId;
  if (providerId) {
    const ref = credentials.credentialRefFor(providerId);
    const previous = await credentials.describeCredential(ref);
    if (previous.source !== "vault") {
      await credentials.writeCredential(ref, "smoke-key-one,smoke-key-two");
    }
    const tried: string[] = [];
    const run = await keyPool
      .runWithCredentialKey({ ref, providerId }, async (secret) => {
        tried.push(secret ?? "");
        if (tried.length === 1) {
          throw new AppError("MODEL_RATE_LIMITED", {
            status: 429,
            message: "simulated 429",
            details: { status: 429, retryAfterMs: 60_000 },
          });
        }
        return "ok";
      })
      .catch((error: unknown) => error as Error);
    const health = (await keyPool.planCredentialKeys({ ref, providerId })).health;

    console.log(`key rotation  ${providerId}: tried=${tried.length} signed=${run instanceof Error ? "none" : "yes"}`);
    for (const key of health) {
      console.log(
        `  ${key.masked.padEnd(10)} status=${key.status.padEnd(13)} skip=${key.skipReason ?? "-"} used=${key.useCount} errors=${key.errorCount}`,
      );
    }
    console.log(`key storage   fingerprints only: ${health.every((key) => /^[0-9a-f]{64}$/.test(key.fingerprint))}`);
    if (previous.source !== "vault") {
      await credentials.writeCredential(ref, "");
      await keyPool.forgetCredentialKeys(ref);
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
