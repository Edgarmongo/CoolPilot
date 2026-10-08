import { getAccount } from "@/db/repository";
import { fail, ok, parseJson } from "@/lib/api";
import { preparePublishDraft } from "@/lib/publish";
import { publishInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Assisted publish, step 1: open the platform editor and prefill the draft
 * (no publish click). The client keeps the session open so the author can edit
 * and publish from the in-app editor.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, publishInputSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const { accountIds, title, text, imagePath, videoPath } = parsed.data;
  const site = await getAccount(accountIds[0]);
  if (!site) return fail("Site not found", 404);

  try {
    const result = await preparePublishDraft(site, { title, text, imagePath, videoPath, publish: false });
    return ok({ accountId: site.id, url: result.url });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to prepare draft", 500);
  }
}
