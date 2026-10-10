import { getAccount } from "@/db/repository";
import { fail, ok, parseJson } from "@/lib/api";
import { rememberPublishDraft } from "@/lib/browser-preview";
import { preparePublishDraft } from "@/lib/publish";
import { publishInputSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Assisted publish, step 1: open the platform editor and prefill the draft
 * (no publish click). The client keeps the session open so the author can edit
 * and publish from the in-app editor.
 *
 * Since C2 (`docs/creator-workflow-audit.md`) this step also tells the session what it is
 * drafting - the content item id and the title/type/method/terminal the author chose. The verify
 * step reads that receipt back, so a publish only becomes a fact when the server itself knows
 * which content and which account it belongs to, instead of being told a second time by a button.
 */
export async function POST(request: Request) {
  const parsed = await parseJson(request, publishInputSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const { accountIds, title, text, imagePath, videoPath, contentItemId, contentType, method, terminal } = parsed.data;
  const site = await getAccount(accountIds[0]);
  if (!site) return fail("Site not found", 404);

  try {
    const result = await preparePublishDraft(site, { title, text, imagePath, videoPath, publish: false });
    // `editorUrl` is where the draft landed. The verify compares the live page against it, so
    // "the author left the draft page" is a fact about this draft rather than a guess about what an
    // editor URL looks like (C2 fix A).
    //
    // Since C2-1a the receipt also carries `drafted` and the per-field `evidence` the prefill
    // observed, so the panel can fail a run whose page took nothing instead of calling it 待编辑发布 -
    // and the record of what was prepared does not depend on the client reading the response.
    rememberPublishDraft(site.id, {
      contentItemId: contentItemId ?? "",
      title,
      contentType,
      method,
      terminal,
      editorUrl: result.url,
      drafted: result.drafted,
      evidence: result.evidence,
    });
    return ok({
      accountId: site.id,
      url: result.url,
      drafted: result.drafted,
      evidence: result.evidence,
      loginRequired: result.loginRequired,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to prepare draft", 500);
  }
}
