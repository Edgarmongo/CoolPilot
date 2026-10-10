import { getLocalAgentSettings, updateLocalAgentSettings } from "@/db/repositories/settings";
import { imageProviderIdFor } from "@/features/ai-settings/provider-registry";
import { syncImageProviderSettings } from "@/features/ai-runtime/registry";
import { fail, failFromError, ok } from "@/lib/api";
import { credentialRefFor, describeCredential, writeCredential } from "@/lib/credentials";
import { readProviderKeys, maskKey, writeProviderKey } from "@/lib/secrets";
import { localAgentSettingsSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Text and image credentials are read from two different stores, on purpose
 * (CI-AI-IMG-CONFIG-02): text keys stay where they always were (`readProviderKeys`, i.e. the
 * legacy env/keytar path), while image keys live under their own provider refs in the credential
 * store (`credential://openai-image/default`, `credential://gemini-image/default`). Neither the
 * reference nor the value is shared, so a text key can never sign an image call.
 */
export async function GET() {
  try {
    const [geminiKey, groqKey, openAIKey, openRouterKey, openAIImageCredential, geminiImageCredential] =
      await Promise.all([
        readProviderKeys("gemini").then((keys) => keys[0] ?? ""),
        readProviderKeys("groq").then((keys) => keys[0] ?? ""),
        readProviderKeys("openai").then((keys) => keys[0] ?? ""),
        readProviderKeys("openrouter").then((keys) => keys[0] ?? ""),
        describeCredential(credentialRefFor(imageProviderIdFor("openai"))),
        describeCredential(credentialRefFor(imageProviderIdFor("gemini"))),
      ]);
    return ok({
      ...(await getLocalAgentSettings()),
      geminiKey: maskKey(geminiKey),
      groqKey: maskKey(groqKey),
      openAIKey: maskKey(openAIKey),
      openRouterKey: maskKey(openRouterKey),
      // Already masked by `describeCredential`; the plaintext never leaves the credential store.
      openAIImageKey: openAIImageCredential.masked,
      geminiImageKey: geminiImageCredential.masked,
    });
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = localAgentSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return fail("INVALID_PAYLOAD", 400, parsed.error);
    }

    const { geminiKey, groqKey, openAIKey, openRouterKey, openAIImageKey, geminiImageKey, ...settingsPatch } =
      parsed.data;
    if (geminiKey?.trim() && !geminiKey.includes("*")) {
      await writeProviderKey("gemini", geminiKey.trim());
    }
    if (groqKey?.trim() && !groqKey.includes("*")) {
      await writeProviderKey("groq", groqKey.trim());
    }
    if (openAIKey?.trim() && !openAIKey.includes("*")) {
      await writeProviderKey("openai", openAIKey.trim());
    }
    if (openRouterKey?.trim() && !openRouterKey.includes("*")) {
      await writeProviderKey("openrouter", openRouterKey.trim());
    }
    // Image keys go to the credential store under their own refs. A masked placeholder (the value
    // GET echoed back) or an empty field is a no-op, so opening and saving the form never clears a
    // key the user did not retype.
    if (openAIImageKey?.trim() && !openAIImageKey.includes("*")) {
      await writeCredential(credentialRefFor(imageProviderIdFor("openai")), openAIImageKey.trim());
    }
    if (geminiImageKey?.trim() && !geminiImageKey.includes("*")) {
      await writeCredential(credentialRefFor(imageProviderIdFor("gemini")), geminiImageKey.trim());
    }

    const settings = await updateLocalAgentSettings(settingsPatch);
    // CI-AI-IMG-CONFIG-03: the image endpoint is a registry row the runtime routes to, and the seed
    // only reconciles it once per `seedVersion` - so a URL (or model) the user just saved has to
    // reach the registry here, or "saved" and "effective" would drift apart until the next bump.
    // Best effort on purpose: a registry write that fails must not lose the settings the user just
    // saved, and the next save reconciles the endpoint again.
    await syncImageProviderSettings().catch(() => undefined);
    return ok({ success: true, settings });
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}
