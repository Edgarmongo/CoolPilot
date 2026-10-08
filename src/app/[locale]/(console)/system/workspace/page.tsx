"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { CheckCircle2, FolderOpen, HardDrive, RefreshCw, TriangleAlert } from "lucide-react";
import { ApiClientError, swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/locale-resources";
import { cn } from "@/lib/utils";
import type { WorkspaceManifest } from "@/lib/workspace/manifest";
import { buildWorkspaceOverview, type WorkspaceFactPart } from "@/lib/workspace/overview";
import { Button } from "@/components/ui/button";
import { ConsoleCard, ConsoleSectionHeader } from "@/components/ui/console-surface";

/**
 * P5-B0-3-B: System → Workspace, the first screen the read-only manifest has.
 *
 * What this page is allowed to know is narrow on purpose. It reads `GET /api/workspace/manifest`
 * and draws it: "what is in my workspace, and what does nothing point at yet". Every number comes
 * from that one response (`@/lib/workspace/overview` decides which of them are worth a row), so the
 * console cannot describe a workspace the API did not report - the same boundary the route keeps on
 * its side (P5-B0-3-A).
 *
 * The fetch happens in the browser rather than in a server component for a specific reason: the
 * endpoint is `force-dynamic` because the workspace is chosen when the process starts, so a report
 * rendered at build time would name the machine that built the app. Reading it from the running app
 * is what makes the numbers the user's own.
 *
 * The only control on the page is Refresh, which re-issues that same `GET`. There is deliberately no
 * cleanup, export, backup or delete here: those are capabilities with their own API and their own
 * questions ("which file is safe to remove?"), and a button that started one would turn a report
 * into an actor. The Attention section is therefore a list to look at - the entry point a later
 * Workspace capability hangs off, not a queue with actions behind it.
 *
 * A broken manifest (a bug, not a workspace fact) is the one thing that does not arrive as smaller
 * numbers: SWR surfaces it as an error, and it is shown as an error instead of as an empty
 * workspace.
 */
export default function WorkspaceOverviewPage() {
  const { t } = useI18n();
  const { data, error, isLoading, isValidating, mutate } = useSWR<WorkspaceManifest>(
    "/api/workspace/manifest",
    swrFetcher,
    { revalidateOnFocus: false },
  );

  const overview = useMemo(() => (data ? buildWorkspaceOverview(data) : null), [data]);

  function errorMessage(cause: unknown) {
    if (cause instanceof ApiClientError && cause.code) {
      return t(`error_${cause.code}` as TranslationKey);
    }
    return cause instanceof Error ? cause.message : t("unknownError");
  }

  function renderPart(part: WorkspaceFactPart) {
    return "text" in part ? part.text : t(part.key, part.values);
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMessage(error)}
        </div>
      ) : null}

      <ConsoleCard>
        <ConsoleSectionHeader
          icon={<HardDrive className="h-5 w-5" />}
          title={t("navWorkspace")}
          action={
            <Button variant="outline" size="sm" loading={isValidating} onClick={() => void mutate()}>
              <RefreshCw size={16} />
              {t("wsRefresh")}
            </Button>
          }
        />
        <p className="mt-4 text-sm leading-6 text-zinc-500">{t("wsOverviewSubtitle")}</p>
        {overview ? (
          <div className="mt-4 space-y-1 rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{t("wsOverviewLocation")}</p>
            <p className="break-all font-mono text-xs text-zinc-700">{overview.root}</p>
            <p className="text-xs text-zinc-400">
              {t("wsOverviewLastRead", { time: new Date(overview.generatedAt).toLocaleString() })}
            </p>
          </div>
        ) : null}
      </ConsoleCard>

      <ConsoleCard>
        <ConsoleSectionHeader icon={<FolderOpen className="h-5 w-5" />} title={t("wsSectionTitle")} />
        {isLoading && !overview ? (
          <p className="mt-4 rounded-2xl border border-dashed border-sky-100 px-4 py-16 text-center text-sm text-zinc-500">
            {t("loading")}
          </p>
        ) : null}
        {overview ? (
          <div className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {overview.rows.map((row) => (
              <div key={row.id} className="min-w-0">
                <p className="text-sm text-zinc-500">{t(row.labelKey)}</p>
                {/* An empty section is dimmed, never hidden: "0 files" is a fact about the
                    workspace, and a report that dropped empty rows would read like a broken
                    reader. */}
                <p className={cn("mt-3 truncate text-2xl font-semibold", row.empty ? "text-zinc-400" : "text-zinc-950")}>
                  {renderPart(row.primary)}
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">{row.secondary.map(renderPart).join(" · ")}</p>
              </div>
            ))}
          </div>
        ) : null}
      </ConsoleCard>

      <ConsoleCard>
        <ConsoleSectionHeader
          icon={<TriangleAlert className="h-5 w-5" />}
          title={t("wsAttentionTitle")}
          action={
            overview && overview.attentionCount > 0 ? (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                {t("wsAttentionItems", { count: overview.attentionCount })}
              </span>
            ) : null
          }
        />
        {overview?.attention.length === 0 ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="size-4" />
            {t("wsAttentionEmpty")}
          </p>
        ) : null}
        {overview?.attention.length ? (
          <div className="mt-4 space-y-3">
            {overview.attention.map((item) => (
              <div key={item.id} className="space-y-2 rounded-2xl border border-amber-100 bg-amber-50/40 p-4">
                <p className="text-sm font-semibold text-amber-900">{t(item.labelKey, { count: item.count })}</p>
                <div className="flex flex-wrap gap-2">
                  {item.names.map((name) => (
                    <span
                      key={name}
                      className="rounded-full bg-white px-2.5 py-1 font-mono text-[11px] font-medium text-amber-800"
                    >
                      {name}
                    </span>
                  ))}
                  {/* The count above is the whole truth; these are only the names that fit. */}
                  {item.names.length < item.count ? (
                    <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                      {t("wsAttentionMore", { count: item.count - item.names.length })}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <p className="mt-4 text-xs leading-5 text-zinc-400">{t("wsAttentionNote")}</p>
      </ConsoleCard>
    </div>
  );
}
