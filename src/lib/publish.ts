import path from "node:path";
import { runSiteBrowserTool } from "@/lib/browser-preview";
import { NO_DRAFT_HANDED_OVER, type PublishDraftEvidence } from "@/lib/browser-preview-shared";
import { artifactsRoot, videosRoot } from "@/lib/paths";
import type { AccountRecord } from "@/lib/types";

export type PublishContent = {
  title: string;
  text: string;
  imagePath?: string;
  /** Local video file forwarded to platforms that support video uploads. */
  videoPath?: string;
  publish: boolean;
};

export type PublishAccountStatus = "published" | "drafted" | "login_required" | "unsupported" | "failed";

export type PublishSiteResult = {
  accountId: string;
  accountName: string;
  platform: string;
  status: PublishAccountStatus;
  url?: string;
  error?: string;
  /**
   * Set by `POST /api/publish` only, when the route itself threw for this account (E2E-FIX-01 5b).
   * The five `status` values cannot express "we never managed to ask the platform", and reporting
   * such a fault as an ordinary business failure would hide it; the batch summary counts these
   * separately as `unexpected` instead.
   */
  errorKind?: "unexpected";
};

function resolveLocalImagePath(imagePath: string) {
  if (!imagePath) return "";
  if (/^https?:\/\//i.test(imagePath)) return "";
  if (path.isAbsolute(imagePath)) return imagePath;
  const fileName = imagePath.split(/[\\/]/).pop() ?? "";
  return fileName ? path.join(artifactsRoot(), fileName) : "";
}

function resolveLocalVideoPath(videoPath: string) {
  if (!videoPath) return "";
  if (/^https?:\/\//i.test(videoPath)) return "";
  if (path.isAbsolute(videoPath)) return videoPath;
  const fileName = videoPath.split(/[\\/]/).pop() ?? "";
  return fileName ? path.join(videosRoot(), fileName) : "";
}

export async function publishToSite(site: AccountRecord, content: PublishContent): Promise<PublishSiteResult> {
  try {
    const args: Record<string, unknown> = {
      title: content.title,
      text: content.text,
      imagePath: resolveLocalImagePath(content.imagePath ?? ""),
      publish: content.publish,
    };
    // Only sent when present, so image/text publishing keeps its current payload.
    const videoPath = resolveLocalVideoPath(content.videoPath ?? "");
    if (videoPath) args.videoPath = videoPath;

    // Headless so publishing never pops a separate browser window: the session
    // streams into the in-app run dialog (see PublishRunPanel) instead.
    const output = (await runSiteBrowserTool(
      site,
      {
        name: "configured_create_post",
        args,
      },
      { headless: true, bringToFront: false },
    )) as { url?: string; published?: boolean; drafted?: boolean; loginRequired?: boolean };

    if (output.loginRequired) {
      return { accountId: site.id, accountName: site.name, platform: site.platform, status: "login_required", url: output.url };
    }
    if (output.published) {
      return { accountId: site.id, accountName: site.name, platform: site.platform, status: "published", url: output.url };
    }
    return { accountId: site.id, accountName: site.name, platform: site.platform, status: "drafted", url: output.url };
  } catch (error) {
    return {
      accountId: site.id,
      accountName: site.name,
      platform: site.platform,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * What the prefill handed back (C2-1a of `docs/assisted-publishing-engine.md`).
 *
 * `drafted` and `evidence` are the run's answer about the *page*, not about the run having finished:
 * the assisted flow used to treat "the prefill did not throw" as "the platform holds a draft", which
 * is how an author ended up being told to finish a 小红书 page that had taken none of the content.
 */
export type PublishDraftPreparation = {
  url: string;
  drafted: boolean;
  evidence: PublishDraftEvidence;
  loginRequired: boolean;
};

/**
 * Assisted-publish step 1: open the platform editor and prefill the draft
 * (title/body/media) WITHOUT clicking publish. The returned URL is the page the author finishes on,
 * with the draft's evidence beside it.
 */
export async function preparePublishDraft(site: AccountRecord, content: PublishContent): Promise<PublishDraftPreparation> {
  const args: Record<string, unknown> = {
    title: content.title,
    text: content.text,
    imagePath: resolveLocalImagePath(content.imagePath ?? ""),
    publish: false,
  };
  const videoPath = resolveLocalVideoPath(content.videoPath ?? "");
  if (videoPath) args.videoPath = videoPath;

  const output = (await runSiteBrowserTool(
    site,
    { name: "configured_create_post", args },
    { headless: true, bringToFront: false },
  )) as { url?: string; drafted?: boolean; evidence?: PublishDraftEvidence; loginRequired?: boolean };

  return {
    url: output.url ?? "",
    // An answer that says nothing is not a page that took nothing: absent means the run never got far
    // enough to have an opinion, so nothing is claimed and the author is not sent to an empty editor.
    drafted: output.drafted === true,
    evidence: output.evidence ?? NO_DRAFT_HANDED_OVER,
    loginRequired: output.loginRequired === true,
  };
}

export async function publishToSites(accounts: AccountRecord[], content: PublishContent): Promise<PublishSiteResult[]> {
  const results: PublishSiteResult[] = [];
  for (const site of accounts) {
    results.push(await publishToSite(site, content));
  }
  return results;
}
