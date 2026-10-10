"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiDelete, apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import type { TranslationKey } from "@/lib/locale-resources";
import {
  platformVersionDeriveTargets,
  platformVersionDraft,
  platformVersionDraftIssueKey,
  platformVersionErrorKey,
  platformVersionProfile,
  type PlatformVersionMessage,
} from "@/lib/platform-version-view";
import type { PlatformContentVersion, PlatformContentVersionPayload } from "@/lib/types";
import PlatformVersionsView from "./platform-versions-view";

/**
 * 多平台内容版本管理 UI (CI-P2-07) - the container: data, calls and nothing else.
 *
 * Every action goes through the route that already exists - `GET` / `POST` / `PATCH` / `DELETE` on
 * `/api/content/[id]/platform-versions` (CI-P2-05). No second client-side model is kept: each answer
 * replaces the SWR cache, so what the author sees after an action is what the server stored.
 *
 * Three boundaries this component does not cross:
 *
 *  - **It never publishes.** No status field, no `publish_records` write, no schedule: the four calls
 *    above are the whole surface, and the route they hit touches only `metadata.platformVersions`.
 *  - **It never sends a title a platform does not take.** A platform whose profile has no title field
 *    is patched without a `title`, so a `PATCH` cannot invent one the publish path would never send.
 *  - **It never hides a failure.** A failed call keeps the stored versions on screen and shows the
 *    route's own error code (via `platformVersionErrorKey`); a failed read says so instead of showing
 *    an empty list as if there were no versions.
 */
export default function PlatformVersionsPanel({
  contentItemId,
  onChanged,
}: {
  contentItemId: string;
  /** Called after a write, so the host view can refresh what it shows (CI-P2-04 does the same). */
  onChanged?: () => void;
}) {
  const url = `/api/content/${encodeURIComponent(contentItemId)}/platform-versions`;
  const { data, mutate, isLoading, error } = useSWR<PlatformContentVersionPayload>(url, swrFetcher);
  const [busy, setBusy] = useState<string | null>(null);
  const [deriveTarget, setDeriveTarget] = useState("");
  const [editingPlatform, setEditingPlatform] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "" });
  const [confirmDeletePlatform, setConfirmDeletePlatform] = useState<string | null>(null);
  const [notice, setNotice] = useState<(PlatformVersionMessage & { tone: "success" | "warning" | "error" }) | null>(
    null,
  );
  const [actionErrorKey, setActionErrorKey] = useState<TranslationKey | null>(null);

  /** The read failure of the payload itself, kept apart from a failed action. */
  const readErrorKey = error ? platformVersionErrorKey(error, "pvLoadFailed") : null;

  /** Stores an answer verbatim and tells the host. */
  function finish(next: PlatformContentVersionPayload, nextNotice: PlatformVersionMessage & { tone: "success" }) {
    void mutate(next, { revalidate: false });
    setNotice(nextNotice);
    onChanged?.();
  }

  async function derive() {
    if (!data || busy) return;
    const target = deriveTarget || platformVersionDeriveTargets(data.profiles, data.versions)[0]?.platform;
    if (!target) return;
    setBusy("derive");
    setNotice(null);
    setActionErrorKey(null);
    try {
      finish(await apiPost<PlatformContentVersionPayload>(url, { platform: target, mode: "derive" }), {
        key: "pvDerived",
        values: { platform: target },
        tone: "success",
      });
    } catch (callError) {
      setActionErrorKey(platformVersionErrorKey(callError));
    } finally {
      setBusy(null);
    }
  }

  function startEdit(version: PlatformContentVersion) {
    setConfirmDeletePlatform(null);
    setEditingPlatform(version.platform);
    // The editor opens on the stored text: nothing is re-derived behind the author's back (P2-05-04).
    setDraft(platformVersionDraft(version));
    setNotice(null);
    setActionErrorKey(null);
  }

  function cancelEdit() {
    setEditingPlatform(null);
  }

  async function submitEdit() {
    if (!data || !editingPlatform || busy) return;
    const issue = platformVersionDraftIssueKey(draft);
    if (issue) {
      setActionErrorKey(issue);
      return;
    }
    const platform = editingPlatform;
    const profile = platformVersionProfile(data, platform);
    setBusy(platform);
    setNotice(null);
    setActionErrorKey(null);
    try {
      // `PATCH` writes the fields it is given and marks the version `edited`; it never re-derives the
      // fingerprint. A platform the publish path fills no title for is sent no title at all.
      const next = await apiPatch<PlatformContentVersionPayload>(url, {
        platform,
        body: draft.body,
        ...(profile && !profile.titleField ? {} : { title: draft.title }),
      });
      setEditingPlatform(null);
      finish(next, { key: "pvSaved", values: { platform }, tone: "success" });
    } catch (callError) {
      setActionErrorKey(platformVersionErrorKey(callError));
    } finally {
      setBusy(null);
    }
  }

  async function confirmDelete() {
    if (!confirmDeletePlatform || busy) return;
    const platform = confirmDeletePlatform;
    setBusy(platform);
    setNotice(null);
    setActionErrorKey(null);
    try {
      const next = await apiDelete<PlatformContentVersionPayload>(`${url}?platform=${encodeURIComponent(platform)}`);
      setConfirmDeletePlatform(null);
      if (editingPlatform === platform) setEditingPlatform(null);
      finish(next, { key: "pvDeleted", values: { platform }, tone: "success" });
    } catch (callError) {
      setActionErrorKey(platformVersionErrorKey(callError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <PlatformVersionsView
      payload={data ?? null}
      loading={isLoading}
      errorKey={actionErrorKey ?? readErrorKey}
      busy={busy}
      deriveTarget={deriveTarget}
      onDeriveTargetChange={setDeriveTarget}
      onDerive={() => void derive()}
      editingPlatform={editingPlatform}
      draft={draft}
      onDraftChange={setDraft}
      onStartEdit={startEdit}
      onCancelEdit={cancelEdit}
      onSubmitEdit={() => void submitEdit()}
      confirmDeletePlatform={confirmDeletePlatform}
      onAskDelete={(platform) => {
        // Asking to delete leaves edit mode: one dialog's worth of intent at a time.
        setEditingPlatform(null);
        setNotice(null);
        setConfirmDeletePlatform(platform);
      }}
      onCancelDelete={() => setConfirmDeletePlatform(null)}
      onConfirmDelete={() => void confirmDelete()}
      notice={notice}
      onDismissNotice={() => {
        setNotice(null);
        setActionErrorKey(null);
        // Dismissing a failed *read* retries it; the stored versions stay on screen meanwhile.
        void mutate();
      }}
    />
  );
}
