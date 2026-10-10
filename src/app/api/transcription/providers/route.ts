import { ok } from "@/lib/api";
import { transcriptionProviderIds, type TranscriptionProviderId } from "@/lib/transcription/transcription";
import { transcriptionFallbackOrder, transcriptionProviders } from "@/lib/transcription/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which transcription engines this machine can really run right now (P3-02-01).
 *
 *   GET /api/transcription/providers
 *     -> { providers: [{ providerId, available, detail, fallbackOrder }] }
 *
 * It is a route of its own rather than a field of `GET /api/transcription` for one measured reason: the
 * offline engine answers this by asking Windows for its installed recognizers, which can take up to
 * `listingTimeoutMs` (45 s) on a cold machine. The list of tasks must not wait behind that probe, so the
 * console asks this **before** it offers the engines - "no recognizer is installed" is then something the
 * user reads while choosing, not a failure they wait minutes for.
 *
 * Every engine is probed, not just the first one that works: the answer is per engine (`available` plus
 * the reason it is not), which is what lets the screen show a fallback honestly - including the fact that
 * a run may move *away* from the cloud and never towards it (`transcriptionFallbackOrder`).
 */
export async function GET() {
  const providers = [];
  for (const providerId of transcriptionProviderIds as readonly TranscriptionProviderId[]) {
    const availability = await transcriptionProviders[providerId].availability();
    providers.push({ ...availability, fallbackOrder: transcriptionFallbackOrder[providerId] });
  }
  return ok({ providers });
}
