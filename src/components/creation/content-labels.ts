import type { TranslationKey } from "@/lib/locale-resources";
import type { ContentStatus, ContentLifecycleStage, PublishRecordStatus } from "@/lib/types";

/**
 * Labels for the two axes CI-P2-04 keeps apart (P2-04-07): what a content item *is*
 * (`content_items.status`), and where it is in its way to a platform (`lifecycleStage`).
 *
 * They are deliberately separate maps. Before this card the content list rendered
 * `status === "ready" ? ready : draft`, which quietly showed a published article as a draft; a single
 * combined map would have made that mistake hard to see.
 */

export const contentStatusLabelKeys: Record<ContentStatus, TranslationKey> = {
  draft: "contentStatusDraft",
  ready: "contentStatusReady",
  posted: "contentStatusPosted",
  failed: "contentStatusFailed",
};

export const contentStatusClass: Record<ContentStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  ready: "bg-emerald-100 text-emerald-700",
  posted: "bg-sky-100 text-sky-700",
  failed: "bg-rose-100 text-rose-700",
};

export const lifecycleStageLabelKeys: Record<ContentLifecycleStage, TranslationKey> = {
  draft: "lifecycleStageDraft",
  pending: "lifecycleStagePending",
  scheduled: "lifecycleStageScheduled",
  publishing: "lifecycleStagePublishing",
  published: "lifecycleStagePublished",
  failed: "lifecycleStageFailed",
};

export const lifecycleStageClass: Record<ContentLifecycleStage, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  pending: "bg-amber-100 text-amber-800",
  scheduled: "bg-sky-100 text-sky-700",
  publishing: "bg-indigo-100 text-indigo-700",
  published: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
};

/** Publish-task statuses reuse the labels the 发布记录 page already defines, verbatim. */
export const publishTaskStatusLabelKeys: Record<PublishRecordStatus, TranslationKey> = {
  queued: "publishRecordStatusQueued",
  running: "publishRecordStatusRunning",
  published: "publishRecordStatusPublished",
  drafted: "publishRecordStatusDrafted",
  failed: "publishRecordStatusFailed",
  cancelled: "publishRecordStatusCancelled",
};

export const publishTaskStatusClass: Record<PublishRecordStatus, string> = {
  queued: "bg-zinc-100 text-zinc-600",
  running: "bg-amber-100 text-amber-700",
  published: "bg-emerald-100 text-emerald-700",
  drafted: "bg-sky-100 text-sky-700",
  failed: "bg-rose-100 text-rose-700",
  cancelled: "bg-zinc-100 text-zinc-600",
};
