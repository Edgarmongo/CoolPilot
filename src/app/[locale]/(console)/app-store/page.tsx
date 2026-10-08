"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Inbox, Search, Store } from "lucide-react";
import { ConsoleCard } from "@/components/ui/console-surface";
import { swrFetcher } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { appStoreCategoryLabelKeys } from "@/lib/positions";
import { appStoreCategories, type AppStoreAgent, type AppStoreCategory, type AppStoreListing } from "@/lib/types";
import { cn } from "@/lib/utils";

const storeTabs = ["browse", "mine"] as const;
type StoreTab = (typeof storeTabs)[number];

const storeTabLabelKeys = { browse: "appStoreTabBrowse", mine: "appStoreTabMine" } as const;

function AgentCard({ agent }: { agent: AppStoreAgent }) {
  const { t } = useI18n();
  return (
    <article className="rounded-2xl border border-sky-100 bg-white p-4 transition hover:shadow-[0_12px_28px_rgba(37,99,235,0.08)]">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-sky-50 text-xl" aria-hidden>
          {agent.emoji}
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <span className="truncate">{agent.name}</span>
            <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
              {agent.official ? t("appStoreOfficial") : t("appStoreMine")}
            </span>
          </p>
          <p className="mt-1 line-clamp-2 text-xs font-medium text-zinc-600">{agent.tagline}</p>
        </div>
      </div>
      <p className="mt-3 line-clamp-3 text-xs leading-5 text-zinc-500">{agent.description}</p>
      {agent.tags.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {agent.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-600">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export default function AppStorePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<StoreTab>("browse");
  const [category, setCategory] = useState<AppStoreCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"recommended" | "latest">("recommended");

  const { data } = useSWR<AppStoreListing>("/api/app-store", swrFetcher);
  const categoryCounts = data?.categoryCounts;

  const visible = useMemo(() => {
    const agents = data?.agents ?? [];
    const keyword = search.trim().toLowerCase();
    const filtered = agents.filter((agent) => {
      if (tab === "mine" && agent.official) return false;
      if (category !== "all" && agent.category !== category) return false;
      if (!keyword) return true;
      return [agent.name, agent.tagline, agent.description, ...agent.tags].some((value) =>
        value.toLowerCase().includes(keyword),
      );
    });
    return sort === "latest" ? [...filtered].reverse() : filtered;
  }, [data, category, search, sort, tab]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-6 border-b border-sky-100">
        {storeTabs.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTab(entry)}
            className={cn(
              "-mb-px border-b-2 px-1 pb-2.5 text-sm font-medium transition",
              tab === entry ? "border-sky-500 text-sky-700" : "border-transparent text-zinc-500 hover:text-zinc-800",
            )}
          >
            {t(storeTabLabelKeys[entry])}
          </button>
        ))}
      </div>

      <ConsoleCard>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white">
              <Store className="size-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">{t("appStoreTitle")}</h2>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{t("appStoreSubtitle")}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-300" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("appStoreSearchPlaceholder")}
                className="h-10 w-52 rounded-full border border-sky-100 bg-white pl-9 pr-4 text-sm outline-none transition focus:border-sky-400 focus:ring-1 focus:ring-sky-400"
              />
            </label>
            <div className="flex items-center gap-1 rounded-full border border-sky-100 bg-white p-1">
              {(["recommended", "latest"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSort(option)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition",
                    sort === option ? "bg-sky-500 text-white shadow-sm" : "text-zinc-500 hover:bg-sky-50",
                  )}
                >
                  {option === "recommended" ? t("appStoreSortRecommended") : t("appStoreSortLatest")}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition",
              category === "all" ? "bg-sky-500 text-white shadow-sm" : "border border-sky-100 bg-white text-zinc-600 hover:bg-sky-50",
            )}
          >
            {t("appStoreCategoryAll")}
            {data ? <span className="ml-1 opacity-70">{data.total}</span> : null}
          </button>
          {appStoreCategories.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setCategory(value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition",
                category === value
                  ? "bg-sky-500 text-white shadow-sm"
                  : "border border-sky-100 bg-white text-zinc-600 hover:bg-sky-50",
              )}
            >
              {t(appStoreCategoryLabelKeys[value])}
              {categoryCounts ? <span className="ml-1 opacity-70">{categoryCounts[value]}</span> : null}
            </button>
          ))}
        </div>

        {visible.length ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        ) : (
          <div className="mt-6 grid place-items-center gap-3 rounded-2xl border border-dashed border-sky-100 bg-sky-50/40 py-20 text-center">
            <Inbox className="size-10 text-zinc-300" />
            <p className="max-w-md text-sm leading-6 text-zinc-500">
              {tab === "mine" ? t("appStoreEmptyMine") : t("appStoreEmptyBrowse")}
            </p>
          </div>
        )}
      </ConsoleCard>
    </div>
  );
}
