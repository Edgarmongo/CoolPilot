import {
  deleteModelProvider,
  getModelProvider,
  listModelEndpoints,
  setEndpointStatus,
  upsertModelEndpoint,
  upsertModelProvider,
} from "@/db/repositories/ai-runtime";
import { AppError } from "@/lib/app-errors";
import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { clearCredential, credentialRefFor, describeCredential, writeCredential } from "@/lib/credentials";
import { forgetCredentialKeys, planCredentialKeys, resetCredentialKey, setCredentialKeyEnabled } from "@/features/ai-runtime/key-pool";
import { fetchProviderCatalog } from "@/features/ai-runtime/sync";
import { listProviderViews } from "@/features/ai-runtime/registry";
import { implementedProtocols } from "@/features/ai-runtime/adapters";
import { aiProviderActionSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const endpointIdFor = (providerId: string) => `${providerId}/default`;

/**
 * Providers, endpoints, credential state and model counts. Endpoint views carry the live
 * health of every key, so the UI can show a cooling-down key instead of hiding it.
 */
export async function GET() {
  try {
    return ok({ providers: await listProviderViews(), implementedProtocols });
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}

/**
 * `save` writes the provider, its default endpoint and (optionally) the keys;
 * `test` pulls the provider's live model list to prove the endpoint + key work;
 * `key` resets / disables / re-enables one stored key;
 * `delete` removes the provider with its models and key health.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, aiProviderActionSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }

  try {
    const input = parsed.data;
    if (input.action === "delete") {
      await deleteModelProvider(input.providerId);
      await clearCredential(credentialRefFor(input.providerId));
      await forgetCredentialKeys(credentialRefFor(input.providerId));
      return ok({ providers: await listProviderViews() });
    }

    if (input.action === "key") {
      if (input.keyAction === "reset") {
        await resetCredentialKey(input.keyId);
      } else {
        await setCredentialKeyEnabled(input.keyId, input.keyAction === "enable");
      }
      return ok({ providers: await listProviderViews() });
    }

    if (input.action === "test") {
      try {
        const { endpoint, models } = await fetchProviderCatalog(input.providerId);
        await setEndpointStatus(endpoint.endpointId, "ok", `${models.length} models`);
        return ok({
          status: "ok" as const,
          modelCount: models.length,
          sample: models.slice(0, 12).map((model) => model.modelId),
        });
      } catch (error) {
        const failure =
          error instanceof AppError ? error : new AppError("MODEL_SYNC_FAILED", { message: (error as Error).message });
        await setEndpointStatus(endpointIdFor(input.providerId), "error", failure.message);
        return ok({ status: "error" as const, modelCount: 0, sample: [], message: failure.message });
      }
    }

    const current = await getModelProvider(input.providerId);
    const provider = await upsertModelProvider({
      providerId: input.providerId,
      name: input.name ?? current?.name ?? input.providerId,
      region: input.region,
      docsUrl: input.docsUrl,
      apiKeyUrl: input.apiKeyUrl,
      enabled: input.enabled,
      source: current ? current.source : "manual",
    });

    const [existingEndpoint] = (await listModelEndpoints(input.providerId)).filter(
      (entry) => entry.endpointId === endpointIdFor(input.providerId),
    );
    const wantsEndpoint = Boolean(input.protocol || input.baseUrl !== undefined || input.endpointEnabled !== undefined);
    if (wantsEndpoint || !existingEndpoint) {
      await upsertModelEndpoint({
        endpointId: endpointIdFor(input.providerId),
        providerId: input.providerId,
        name: existingEndpoint?.name ?? "Default",
        protocol: input.protocol ?? existingEndpoint?.protocol ?? "openai-compatible",
        baseUrl: input.baseUrl ?? existingEndpoint?.baseUrl ?? "",
        credentialRef: existingEndpoint?.credentialRef ?? credentialRefFor(input.providerId),
        enabled: input.endpointEnabled ?? existingEndpoint?.enabled ?? true,
      });
    }

    if (input.apiKey !== undefined) {
      const ref = credentialRefFor(input.providerId);
      await writeCredential(ref, input.apiKey);
      // A pasted key may have replaced the whole set: reconciling here drops the health
      // rows of keys that are gone and registers the new ones before the next call.
      if ((await describeCredential(ref)).configured) {
        await planCredentialKeys({ ref, providerId: input.providerId });
      } else {
        await forgetCredentialKeys(ref);
      }
    }

    const providers = await listProviderViews();
    return ok({ providers, provider });
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}
