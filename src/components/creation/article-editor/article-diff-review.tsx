"use client";

import { useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { diffChangeCount, diffLines, toSideBySide, type DiffLine } from "@/lib/text-diff";
import { cn } from "@/lib/utils";

function DiffPane({ title, lines, tone }: { title: string; lines: DiffLine[]; tone: "removed" | "added" }) {
  return (
    <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3">
      <p className={cn("mb-2 text-xs font-medium", tone === "added" ? "text-sky-600" : "text-zinc-500")}>{title}</p>
      <div className="max-h-72 space-y-1 overflow-y-auto text-sm leading-6">
        {lines.length === 0 ? (
          <p className="px-2 py-1 text-zinc-300">—</p>
        ) : (
          lines.map((line, index) => (
            <p
              key={`${index}-${line.type}`}
              className={cn(
                "rounded-md px-2 py-1",
                line.type === tone
                  ? tone === "added"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-rose-50 text-rose-700"
                  : "text-zinc-600",
              )}
            >
              {line.text}
            </p>
          ))
        )}
      </div>
    </section>
  );
}

/**
 * Side-by-side paragraph diff used before AI output replaces the article body.
 * Removed paragraphs are highlighted on the left, additions on the right.
 */
export function ArticleDiffReview({ before, after }: { before: string; after: string }) {
  const { t } = useI18n();
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const { left, right } = useMemo(() => toSideBySide(lines), [lines]);
  const changes = useMemo(() => diffChangeCount(lines), [lines]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-400">{t("aiCompareHint", { count: changes })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <DiffPane title={t("aiCompareBefore")} lines={left} tone="removed" />
        <DiffPane title={t("aiCompareAfter")} lines={right} tone="added" />
      </div>
    </div>
  );
}
