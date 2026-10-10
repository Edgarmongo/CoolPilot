"use client";

import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsoleNotice, consoleInputClass } from "@/components/ui/console-surface";
import { SelectField } from "@/components/ui/form-controls";
import { formatClockTime, formatDayLabel } from "@/lib/calendar";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import {
  platformAdaptationMessage,
  platformComposerEntryLabelKeys,
  platformFieldLabelKey,
  platformTextLimitMessage,
  platformTitleLimitMessage,
  platformVersionDeriveTargets,
  platformVersionProfile,
  platformVersionSourceClass,
  platformVersionSourceLabelKeys,
  platformVersionStale,
  platformVideoRouteLabelKeys,
  versionTitleOffered,
  versionVideoIncluded,
  type PlatformVersionMessage,
} from "@/lib/platform-version-view";
import type { PlatformContentVersion, PlatformContentVersionPayload } from "@/lib/types";

/**
 * 多平台内容版本管理 UI (CI-P2-07) - the rendered part.
 *
 * It is a plain function of its props: no data fetching, no state and no API call lives here, so the
 * container (`platform-versions-panel.tsx`) owns the calls and a smoke test can render every branch
 * (loading, empty, unreadable, stale, error) from fixtures without a DOM
 * (`platform-versions-render.test.ts`).
 *
 * What it insists on showing, because the model records it:
 *
 *  - the two things a version *is* apart from its text - `source` (`derived` / `edited`) and the
 *    `adaptations` notes - so an adapted version never looks like the base text (P2-07-03);
 *  - `stale` as a reported fact: the base moved on, the version is kept, nothing was refreshed;
 *  - the unreadable entries as a counted notice rather than a silent gap (P2-07-01);
 *  - adapter facts exactly as `PlatformContentProfile` holds them - a `null` budget reads as "this
 *    layer enforces no budget", never as a platform's own limit (P2-07-04);
 *  - the plain statement that producing a version is not publishing (P2-07-05).
 */
export type PlatformVersionsViewProps = {
  payload: PlatformContentVersionPayload | null;
  loading: boolean;
  /** A failed *read* of the payload, already mapped to a translation. */
  errorKey: TranslationKey | null;
  /** The platform an action is running for, `"derive"` while deriving, or `null` when idle. */
  busy: string | null;
  deriveTarget: string;
  onDeriveTargetChange: (platform: string) => void;
  onDerive: () => void;
  editingPlatform: string | null;
  draft: { title: string; body: string };
  onDraftChange: (draft: { title: string; body: string }) => void;
  onStartEdit: (version: PlatformContentVersion) => void;
  onCancelEdit: () => void;
  onSubmitEdit: () => void;
  confirmDeletePlatform: string | null;
  onAskDelete: (platform: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  notice: (PlatformVersionMessage & { tone: "success" | "warning" | "error" }) | null;
  onDismissNotice: () => void;
};

export default function PlatformVersionsView({
  payload,
  loading,
  errorKey,
  busy,
  deriveTarget,
  onDeriveTargetChange,
  onDerive,
  editingPlatform,
  draft,
  onDraftChange,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  confirmDeletePlatform,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  notice,
  onDismissNotice,
}: PlatformVersionsViewProps) {
  const { t, locale } = useI18n();
  const versions = payload?.versions ?? [];
  const targets = payload ? platformVersionDeriveTargets(payload.profiles, payload.versions) : [];
  const targetProfile = payload && deriveTarget ? platformVersionProfile(payload, deriveTarget) : null;

  return (
    <section className="min-w-0 space-y-3 rounded-[28px] border border-sky-100 bg-sky-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase text-zinc-400">{t("pvTitle")}</h3>
        {payload ? (
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-zinc-600">
            {t("pvCount", { count: versions.length })}
          </span>
        ) : null}
        {payload && payload.unreadable > 0 ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            {t("pvUnreadableTag", { count: payload.unreadable })}
          </span>
        ) : null}
        {loading && payload ? <span className="text-xs text-zinc-400">{t("loading")}</span> : null}
      </div>

      <p className="text-xs text-zinc-500">{t("pvHint")}</p>

      {payload && payload.unreadable > 0 ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t("pvUnreadableHint", { count: payload.unreadable })}
        </p>
      ) : null}

      {errorKey ? <ConsoleNotice message={t(errorKey)} tone="error" onDismiss={onDismissNotice} /> : null}
      {notice ? (
        <ConsoleNotice message={t(notice.key, notice.values)} tone={notice.tone} onDismiss={onDismissNotice} />
      ) : null}

      {!payload ? (
        <p className="text-xs text-zinc-500">{loading ? t("loading") : t("pvLoadFailed")}</p>
      ) : (
        <>
          <div className="rounded-2xl bg-white p-3 text-xs text-zinc-600">
            <p className="font-semibold text-zinc-500">{t("pvBase")}</p>
            <p className="mt-1 [overflow-wrap:anywhere]">{t("pvBaseTextLength", { count: payload.base.body.length })}</p>
            <p className="mt-1">
              {t("pvBaseMedia", {
                images: payload.base.images.length,
                video: t(payload.base.videoPath ? "pvYes" : "pvNo"),
              })}
            </p>
          </div>

          <div className="rounded-2xl bg-white p-3">
            <p className="text-xs font-semibold text-zinc-500">{t("pvDeriveSection")}</p>
            {payload.profiles.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-500">{t("pvDeriveNoProfiles")}</p>
            ) : targets.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-500">{t("pvDeriveNone")}</p>
            ) : (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <SelectField
                  label={t("pvDeriveTarget")}
                  className="min-w-48"
                  value={deriveTarget || targets[0].platform}
                  options={targets.map((profile) => ({ value: profile.platform, label: profile.platform }))}
                  onChange={onDeriveTargetChange}
                />
                <Button size="sm" loading={busy === "derive"} onClick={onDerive} disabled={busy !== null}>
                  {t("pvDeriveAction")}
                </Button>
              </div>
            )}

            {targetProfile ? (
              <div className="mt-3 space-y-1 rounded-2xl bg-zinc-50 p-3 text-xs text-zinc-600">
                <p className="font-semibold text-zinc-500">
                  {t("pvAdapterFacts", { platform: targetProfile.platform })}
                </p>
                <p>
                  {t("pvComposerEntry")}: {t(platformComposerEntryLabelKeys[targetProfile.composerEntry])}
                </p>
                <p>
                  {t("pvTitleField")}: {t(platformFieldLabelKey(targetProfile.titleField))} · {t("pvBodyField")}:{" "}
                  {t(platformFieldLabelKey(targetProfile.bodyField))}
                </p>
                <p>
                  {t("pvVideoRoute")}: {t(platformVideoRouteLabelKeys[targetProfile.videoRoute])}
                </p>
                <p>{t(platformTextLimitMessage(targetProfile).key, platformTextLimitMessage(targetProfile).values)}</p>
                <p>
                  {t(platformTitleLimitMessage(targetProfile).key, platformTitleLimitMessage(targetProfile).values)}
                </p>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl bg-white p-3">
            <p className="text-xs font-semibold text-zinc-500">{t("pvVersions")}</p>
            {versions.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-500">{t("pvEmpty")}</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {versions.map((version) => {
                  const stale = platformVersionStale(version, payload.base.fingerprint);
                  const profile = platformVersionProfile(payload, version.platform);
                  const editing = editingPlatform === version.platform;
                  const titleOffered = versionTitleOffered(version);
                  return (
                    <li key={version.platform} className="space-y-2 rounded-2xl border border-sky-100 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-zinc-900">{version.platform}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${platformVersionSourceClass[version.source]}`}
                        >
                          {t(platformVersionSourceLabelKeys[version.source])}
                        </span>
                        {stale ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                            {t("pvStaleTag")}
                          </span>
                        ) : null}
                        <span className="text-xs tabular-nums text-zinc-400">
                          {t("pvUpdated")} {formatDayLabel(version.updatedAt, locale)}{" "}
                          {formatClockTime(version.updatedAt, locale)}
                        </span>
                      </div>

                      {stale ? <p className="text-xs text-amber-900">{t("pvStale")}</p> : null}

                      {version.adaptations.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                          <span>{t("pvAdaptations")}:</span>
                          {version.adaptations.map((adaptation, index) => {
                            const message = platformAdaptationMessage(adaptation);
                            return (
                              <span
                                key={`${adaptation.code}-${index}`}
                                className="rounded-full bg-zinc-100 px-2 py-0.5"
                              >
                                {t(message.key, message.values)}
                              </span>
                            );
                          })}
                        </div>
                      ) : null}

                      {editing ? (
                        <div className="space-y-2">
                          {!profile || profile.titleField ? (
                            <label className="grid gap-1 text-xs font-semibold text-zinc-500">
                              <span>{t("pvVersionTitle")}</span>
                              <input
                                className={consoleInputClass}
                                value={draft.title}
                                onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
                              />
                            </label>
                          ) : (
                            <p className="text-xs text-zinc-500">{t("pvNoTitleForPlatform")}</p>
                          )}
                          <label className="grid gap-1 text-xs font-semibold text-zinc-500">
                            <span>{t("pvVersionBody")}</span>
                            <textarea
                              className={consoleInputClass}
                              rows={5}
                              value={draft.body}
                              onChange={(event) => onDraftChange({ ...draft, body: event.target.value })}
                            />
                          </label>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              loading={busy === version.platform}
                              onClick={onSubmitEdit}
                              disabled={busy !== null}
                            >
                              {t("pvSave")}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={onCancelEdit} disabled={busy !== null}>
                              {t("pvCancel")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1 text-sm text-zinc-700">
                          {titleOffered ? (
                            <p className="font-medium [overflow-wrap:anywhere]">
                              {version.title || t("contentNoValue")}
                            </p>
                          ) : (
                            <p className="text-xs text-zinc-500">{t("pvNoTitleForPlatform")}</p>
                          )}
                          <p className="whitespace-pre-wrap rounded-2xl bg-zinc-50 p-3 leading-6 [overflow-wrap:anywhere]">
                            {version.body || t("contentNoValue")}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {t("pvVersionMedia", {
                              cover: t(version.imagePath ? "pvYes" : "pvNo"),
                              video: t(versionVideoIncluded(version) && version.videoPath ? "pvYes" : "pvNo"),
                            })}
                          </p>
                        </div>
                      )}

                      {confirmDeletePlatform === version.platform ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
                          <p>{t("pvDeleteConfirm")}</p>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={onCancelDelete} disabled={busy !== null}>
                              {t("pvCancel")}
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              loading={busy === version.platform}
                              onClick={onConfirmDelete}
                              disabled={busy !== null}
                            >
                              {t("pvDelete")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onStartEdit(version)}
                            disabled={busy !== null || editing}
                          >
                            {t("pvEdit")}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => onAskDelete(version.platform)}
                            disabled={busy !== null}
                          >
                            {t("pvDelete")}
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="flex items-start gap-1.5 text-xs text-zinc-400">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {t("pvNotPublishing")}
          </p>
        </>
      )}
    </section>
  );
}

