import { fail, failFromError, ok, parseJson } from "@/lib/api";
import { chat } from "@/features/ai-runtime/runtime";
import { aiChatSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The unified chat endpoint. It resolves provider → endpoint → credential → adapter
 * and returns the route it took, so the caller can show which model actually answered
 * without knowing anything about vendors.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, aiChatSchema);
  if (parsed.error) {
    return fail("INVALID_PAYLOAD", 400, parsed.error);
  }

  try {
    const result = await chat({
      messages: parsed.data.messages,
      model: parsed.data.model,
      providerId: parsed.data.providerId,
      capability: parsed.data.capability,
      systemPrompt: parsed.data.systemPrompt,
      temperature: parsed.data.temperature,
      maxTokens: parsed.data.maxTokens,
      json: parsed.data.json,
      forceUnhealthyCredential: parsed.data.forceUnhealthyCredential,
    });
    return ok(result);
  } catch (error) {
    return failFromError(error, "MODEL_UPSTREAM_FAILED", 502);
  }
}
