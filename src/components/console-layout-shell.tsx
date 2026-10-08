"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import {
  BarChart3,
  BookOpen,
  Boxes,
  Brush,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Cloud,
  Database,
  Globe2,
  History,
  House,
  Library,
  ListChecks,
  LogIn,
  LogOut,
  MessageCircle,
  Network,
  Newspaper,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  PenSquare,
  PenTool,
  Play,
  Rocket,
  ScrollText,
  Send,
  Settings,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Target,
  Users,
  Video,
  WalletCards,
  Workflow,
  Image as ImageIcon,
  UserCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ConsoleHeaderActionsProvider, ConsoleHeaderActionsSlot } from "@/components/ui/console-header-actions";
import { LogoButton } from "@/components/ui/logo-button";
import { NavButton } from "@/components/ui/nav-button";
import { useI18n } from "@/lib/i18n";
import { localizedPath, stripLocale, type Locale } from "@/lib/i18n-config";
import { cn } from "@/lib/utils";
import { apiPost, swrFetcher } from "@/lib/api-client";

type AccountState = {
  connected: boolean;
  error?: string;
  auth?: {
    baseUrl: string;
    runnerId: string;
    deviceName: string;
    userId?: string;
    connectedAt: number;
    org: {
      id: string;
      name: string;
      planId: string;
      imageCredit?: number;
      llmCredit?: number;
      planLimits?: {
        imageCredits: number;
        llmCredits: number;
      };
    };
  };
};

type NavEntry = {
  id: string;
  name: string;
  icon: LucideIcon;
  href: string;
  segment: string;
  children?: NavEntry[];
};

function formatCreditAmount(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value % 1 === 0 ? 0 : 1,
  }).format(value);
}

function creditPercent(remaining: number, limit: number) {
  if (limit === -1) return 100;
  if (limit <= 0) return 0;
  return Math.max(0, Math.min(100, (remaining / limit) * 100));
}

function AccountDropdownLink({
  href,
  icon,
  label,
  locale,
  onNavigate,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  locale: Locale;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={localizedPath(locale, href)}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 transition hover:bg-sky-50 hover:text-slate-950"
      onClick={onNavigate}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleHeaderActionsProvider>
      <ConsoleLayoutShell>{children}</ConsoleLayoutShell>
    </ConsoleHeaderActionsProvider>
  );
}

function ConsoleLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const routePath = stripLocale(pathname);
  const { t, locale } = useI18n();
  const isFullBleed = routePath === "/chatroom";
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const { data: account, mutate: reloadAccount } = useSWR<AccountState>("/api/smepost/account", swrFetcher, { refreshInterval: 40_000 });

  const navItems = useMemo<NavEntry[]>(
    () => [
      { id: "dashboard", name: t("navDashboard"), icon: House, href: "/dashboard", segment: "/dashboard" },
      { id: "chatroom", name: t("agentChatShortTitle"), icon: MessageCircle, href: "/chatroom", segment: "/chatroom" },
      { id: "data-center", name: t("navDataCenter"), icon: Database, href: "/data-center", segment: "/data-center" },
      {
        id: "creation",
        name: t("navCreation"),
        icon: PenSquare,
        href: "/creation/ai-writing",
        segment: "/creation",
        children: [
          { id: "ai-writing", name: t("navAiWriting"), icon: Sparkles, href: "/creation/ai-writing", segment: "/creation/ai-writing" },
          { id: "products", name: t("navProductManagement"), icon: Package, href: "/creation/products", segment: "/creation/products" },
          { id: "articles", name: t("navArticleCreation"), icon: Newspaper, href: "/creation/articles", segment: "/creation/articles" },
          { id: "posts", name: t("navDynamicPublishing"), icon: Send, href: "/creation/posts", segment: "/creation/posts" },
          { id: "videos", name: t("navVideoPublishing"), icon: Video, href: "/creation/videos", segment: "/creation/videos" },
          { id: "images", name: t("navImageManagement"), icon: ImageIcon, href: "/creation/images", segment: "/creation/images" },
          { id: "content-center", name: t("navContentCenter"), icon: Library, href: "/content/library", segment: "/content" },
          {
            id: "drawing",
            name: t("navDrawing"),
            icon: Brush,
            href: "/whiteboard",
            segment: "/whiteboard",
            children: [
              { id: "whiteboard", name: t("navWhiteboard"), icon: PenTool, href: "/whiteboard", segment: "/whiteboard" },
              { id: "mindmap", name: t("navMindMap"), icon: Network, href: "/mindmap", segment: "/mindmap" },
            ],
          },
        ],
      },
      { id: "app-store", name: t("navAppStore"), icon: Store, href: "/app-store", segment: "/app-store" },
      {
        id: "smart-config",
        name: t("navSmartConfig"),
        icon: Settings2,
        href: "/smart-config/positioning",
        segment: "/smart-config",
        children: [
          { id: "positioning", name: t("navAccountPositioning"), icon: Target, href: "/smart-config/positioning", segment: "/smart-config/positioning" },
          { id: "knowledge-base", name: t("navKnowledgeBase"), icon: BookOpen, href: "/smart-config/knowledge-base", segment: "/smart-config/knowledge-base" },
        ],
      },
      {
        id: "automation",
        name: t("navAutomation"),
        icon: Workflow,
        href: "/schedules/list",
        segment: "/automation",
        children: [
          { id: "schedules", name: t("navSchedules"), icon: CalendarClock, href: "/schedules/list", segment: "/schedules/list" },
          { id: "calendar", name: t("navContentCalendar"), icon: CalendarDays, href: "/schedules/calendar", segment: "/schedules/calendar" },
          { id: "generations", name: t("navGenerationRecords"), icon: History, href: "/automation/generations", segment: "/automation/generations" },
          { id: "operation-logs", name: t("navOperationLogs"), icon: ScrollText, href: "/automation/logs", segment: "/automation/logs" },
          { id: "cloud-nodes", name: t("navCloudNodes"), icon: Cloud, href: "/automation/nodes", segment: "/automation/nodes" },
          { id: "runs", name: t("navRuns"), icon: Play, href: "/runs/queue", segment: "/runs" },
        ],
      },
      {
        id: "publishing",
        name: t("navPublishing"),
        icon: Rocket,
        href: "/publishing/accounts",
        segment: "/publishing",
        children: [
          { id: "accounts", name: t("navAccountManagement"), icon: Users, href: "/publishing/accounts", segment: "/publishing/accounts" },
          { id: "publish-records", name: t("navPublishRecords"), icon: ListChecks, href: "/publishing/records", segment: "/publishing/records" },
        ],
      },
      {
        id: "system",
        name: t("navSystem"),
        icon: Settings,
        href: "/settings",
        segment: "/settings",
        children: [
          { id: "models", name: t("navModelManagement"), icon: Boxes, href: "/system/models", segment: "/system/models" },
          { id: "usage", name: t("navUsage"), icon: BarChart3, href: "/system/usage", segment: "/system/usage" },
          { id: "settings", name: t("navSettings"), icon: SlidersHorizontal, href: "/settings", segment: "/settings" },
        ],
      },
    ],
    [t],
  );

  const accountItem = useMemo<NavEntry>(
    () => ({ id: "account", name: t("navAccount"), icon: UserCircle, href: "/account/smepost", segment: "/account" }),
    [t],
  );

  function segmentMatches(segment: string) {
    return routePath.startsWith(segment) || (segment === "/dashboard" && routePath === "/");
  }

  function entryIsActive(entry: NavEntry): boolean {
    if (entry.children?.length) return entry.children.some(entryIsActive);
    return segmentMatches(entry.segment);
  }

  function leafHref(entry: NavEntry): string {
    return entry.children?.[0]?.href ?? entry.href;
  }

  const navLeaves = useMemo(() => {
    const flatten = (items: NavEntry[]): NavEntry[] =>
      items.flatMap((item) => (item.children?.length ? flatten(item.children) : [item]));
    return flatten(navItems);
  }, [navItems]);
  const activeItem = navLeaves.find((item) => segmentMatches(item.segment)) ?? navItems[0];

  const mobileMenuItems = useMemo(() => {
    const ids = ["dashboard", "creation", "smart-config", "publishing", "system"];
    const selected = ids
      .map((id) => navItems.find((item) => item.id === id))
      .filter((item): item is NavEntry => Boolean(item));
    return [...selected, accountItem];
  }, [navItems, accountItem]);

  useEffect(() => {
    const groupContainsActive = (group: NavEntry): boolean =>
      Boolean(group.children?.length) &&
      group.children!.some(
        (child) =>
          routePath.startsWith(child.segment) ||
          (child.segment === "/dashboard" && routePath === "/") ||
          groupContainsActive(child),
      );
    const groupIdsToExpand: string[] = [];
    const collectActiveGroups = (items: NavEntry[]) => {
      items.forEach((item) => {
        if (groupContainsActive(item)) {
          groupIdsToExpand.push(item.id);
          collectActiveGroups(item.children!);
        }
      });
    };
    collectActiveGroups(navItems);
    if (groupIdsToExpand.length) {
      window.queueMicrotask(() =>
        setCollapsedGroups((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const id of groupIdsToExpand) {
            if (next[id]) {
              next[id] = false;
              changed = true;
            }
          }
          return changed ? next : prev;
        }),
      );
    }
  }, [routePath, navItems]);

  useEffect(() => {
    if (!isAccountMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsAccountMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAccountMenuOpen]);

  const renderNavigation = (items: NavEntry[], size: "sm" | "default" = "default") =>
    items.map((item) => (
      <Link key={item.id} href={localizedPath(locale, leafHref(item))} className="flex flex-1 justify-center md:w-full md:flex-none">
        <NavButton
          icon={<item.icon className="h-5 w-5" />}
          label={item.name}
          size={size}
          isActive={entryIsActive(item)}
        />
      </Link>
    ));

  const renderDesktopLink = (item: NavEntry) => {
    const isActive = entryIsActive(item);
    const link = (
      <Link
        href={localizedPath(locale, item.href)}
        title={isSidebarCollapsed ? item.name : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg text-sm font-medium transition",
          isSidebarCollapsed ? "size-9 justify-center" : "h-9 px-2",
          isActive ? "bg-white text-sky-700 shadow-sm ring-1 ring-sky-100" : "text-slate-600 hover:bg-white/80 hover:text-slate-950",
        )}
      >
        <item.icon className="size-4 shrink-0" />
        {!isSidebarCollapsed ? <span className="truncate">{item.name}</span> : null}
      </Link>
    );

    return link;
  };

  const renderNavEntry = (item: NavEntry): React.ReactNode => {
    if (!item.children?.length) {
      return <Fragment key={item.id}>{renderDesktopLink(item)}</Fragment>;
    }
    const isOpen = !collapsedGroups[item.id];
    const groupActive = entryIsActive(item);
    return (
      <div key={item.id}>
        <button
          type="button"
          onClick={() => setCollapsedGroups((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
          title={isSidebarCollapsed ? item.name : undefined}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg text-sm font-medium transition",
            isSidebarCollapsed ? "size-9 justify-center" : "h-9 px-2",
            groupActive ? "text-sky-700" : "text-slate-600 hover:bg-white/80 hover:text-slate-950",
          )}
        >
          <item.icon className="size-4 shrink-0" />
          {!isSidebarCollapsed ? (
            <>
              <span className="min-w-0 flex-1 truncate text-left">{item.name}</span>
              <ChevronDown className={cn("size-4 shrink-0 text-slate-400 transition-transform", isOpen && "rotate-180")} />
            </>
          ) : null}
        </button>
        {isOpen && !isSidebarCollapsed ? (
          <div className="ml-3 mt-1 space-y-1 border-l border-slate-200 pl-2">
            {item.children.map((child) => renderNavEntry(child))}
          </div>
        ) : null}
      </div>
    );
  };

  async function logoutSMEPost() {
    await apiPost("/api/smepost/logout", {});
    setIsAccountMenuOpen(false);
    await reloadAccount();
  }

  const accountName = account?.connected && account.auth ? account.auth.org.name : "SMEPost";
  const accountPlan = account?.connected && account.auth ? account.auth.org.planId : t("smepostLoginButton");
  const llmCredits = account?.auth?.org.llmCredit ?? 0;
  const imageCredits = account?.auth?.org.imageCredit ?? 0;
  const llmLimit = account?.auth?.org.planLimits?.llmCredits ?? 0;
  const imageLimit = account?.auth?.org.planLimits?.imageCredits ?? 0;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white md:bg-gradient-to-b md:from-sky-50 md:via-sky-50 md:to-slate-100">
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-border/80 bg-gradient-to-b from-sky-50 via-sky-50 to-slate-100 transition-[width] duration-200 md:flex",
          isSidebarCollapsed ? "w-[56px]" : "w-[260px]",
        )}
      >
        <div className={cn("flex h-full min-h-0 flex-col", isSidebarCollapsed ? "items-center px-2 py-3" : "px-3 py-3")}>
          <div className={cn("flex h-11 w-full items-center", isSidebarCollapsed ? "justify-center" : "justify-between gap-2")}>
            <div className={cn("flex min-w-0 items-center gap-2", isSidebarCollapsed && "justify-center")}>
              {isSidebarCollapsed ? (
                <button
                  type="button"
                  onClick={() => setIsSidebarCollapsed(false)}
                  className="group relative flex size-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/80 hover:text-slate-900"
                  aria-label={t("expandSitesSidebar")}
                  title={t("expandSitesSidebar")}
                >
                  <Image
                    src="/logo.webp"
                    alt={t("productName")}
                    width={32}
                    height={32}
                    priority
                    className="transition group-hover:opacity-0"
                  />
                  <PanelLeftOpen className="absolute size-4 opacity-0 transition group-hover:opacity-100" />
                </button>
              ) : (
                <>
              <LogoButton href={localizedPath(locale, "/dashboard")} size="sm" ariaLabel={t("productName")} />
                <Link href={localizedPath(locale, "/dashboard")} className="truncate text-base font-bold text-slate-950">
                  {t("productName")}
                </Link>
                </>
              )}
            </div>
            {!isSidebarCollapsed ? (
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed(true)}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/80 hover:text-slate-900"
                aria-label={t("collapseSitesSidebar")}
                title={t("collapseSitesSidebar")}
              >
                <PanelLeftClose className="size-4" />
              </button>
            ) : null}
          </div>

          <nav className={cn("mt-4 flex flex-col", isSidebarCollapsed ? "items-center gap-2" : "gap-1")} aria-label={t("consoleNavigation")}>
            {navItems.map((item) => renderNavEntry(item))}
          </nav>

          <div className="min-h-0 flex-1" />

          <div ref={accountMenuRef} className={cn("relative mt-3 w-full border-t border-slate-200 pt-3", isSidebarCollapsed && "flex justify-center")}>
            {isAccountMenuOpen ? (
              <div className="absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-xl">
                {account?.connected && account.auth ? (
                  <div className="border-b border-slate-100 px-3 py-2">
                    <p className="truncate font-semibold text-slate-900">{account.auth.org.name}</p>
                    <p className="mt-1 text-xs capitalize text-slate-500">{account.auth.org.planId}</p>
                    <div className="mt-3 space-y-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-700">{t("sidebarCreditBalance")}</span>
                        <span className="text-[11px] text-slate-500">{t("sidebarLlmImageCredits")}</span>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-slate-500">
                            <Sparkles className="size-3.5" />
                            {t("sidebarLlmCredits")}
                          </span>
                          <span className="font-medium tabular-nums text-slate-800">
                            {llmLimit === -1 ? t("sidebarCreditUnlimited") : `${formatCreditAmount(llmCredits)} / ${formatCreditAmount(llmLimit)}`}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-sky-600" style={{ width: `${creditPercent(llmCredits, llmLimit)}%` }} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-slate-500">
                            <ImageIcon className="size-3.5" />
                            {t("sidebarImageCredits")}
                          </span>
                          <span className="font-medium tabular-nums text-slate-800">
                            {`${formatCreditAmount(imageCredits)} / ${formatCreditAmount(imageLimit)}`}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-sky-600" style={{ width: `${creditPercent(imageCredits, imageLimit)}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                <AccountDropdownLink href="/system/models" icon={<Boxes className="size-4" />} label={t("navModelManagement")} locale={locale} onNavigate={() => setIsAccountMenuOpen(false)} />
                <AccountDropdownLink href="/settings/permissions" icon={<ShieldCheck className="size-4" />} label={t("settingsTabPermissions")} locale={locale} onNavigate={() => setIsAccountMenuOpen(false)} />
                <AccountDropdownLink href="/settings/language" icon={<Globe2 className="size-4" />} label={t("settingsTabLanguage")} locale={locale} onNavigate={() => setIsAccountMenuOpen(false)} />
                <AccountDropdownLink href="/settings/brand" icon={<WalletCards className="size-4" />} label={t("settingsTabBrand")} locale={locale} onNavigate={() => setIsAccountMenuOpen(false)} />
                <AccountDropdownLink href="/settings/prompt" icon={<MessageCircle className="size-4" />} label={t("settingsTabPrompt")} locale={locale} onNavigate={() => setIsAccountMenuOpen(false)} />
                <AccountDropdownLink href="/settings/backup" icon={<Database className="size-4" />} label={t("settingsTabBackup")} locale={locale} onNavigate={() => setIsAccountMenuOpen(false)} />
                <Link
                  href={localizedPath(locale, "/account/smepost")}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 transition hover:bg-sky-50 hover:text-slate-950"
                  onClick={() => setIsAccountMenuOpen(false)}
                >
                  {account?.connected ? <WalletCards className="size-4" /> : <LogIn className="size-4" />}
                  <span>{account?.connected ? t("navAccount") : t("smepostLoginButton")}</span>
                </Link>
                {account?.connected ? (
                  <button
                    type="button"
                    onClick={() => void logoutSMEPost()}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 transition hover:bg-sky-50 hover:text-slate-950"
                  >
                    <LogOut className="size-4" />
                    <span>{t("smepostLogout")}</span>
                  </button>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setIsAccountMenuOpen((current) => !current)}
              className={cn(
                "flex items-center rounded-lg text-left transition hover:bg-white/80",
                isSidebarCollapsed ? "size-9 justify-center" : "w-full gap-2 px-2 py-2",
              )}
              aria-label={accountName}
              aria-expanded={isAccountMenuOpen}
              title={isSidebarCollapsed ? accountName : undefined}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-500 text-[10px] font-bold uppercase text-white">
                {accountName.slice(0, 2)}
              </span>
              {!isSidebarCollapsed ? (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">{accountName}</span>
                    <span className="block truncate text-xs text-slate-500">{accountPlan}</span>
                  </span>
                  <ChevronUp className="size-4 shrink-0 text-slate-400" />
                </>
              ) : null}
            </button>
          </div>
        </div>
      </aside>

      <div className={cn("flex min-w-0 flex-1 flex-col bg-white pb-20 md:bg-transparent md:pb-0", !isFullBleed && "lg:m-3")}>
        {isFullBleed ? (
          children
        ) : (
          <main className="flex min-w-0 flex-1 flex-col bg-card md:overflow-hidden md:rounded-lg md:border md:border-border md:shadow-sm">
            <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-3 border-b bg-background/60 px-4 py-2 backdrop-blur-sm sm:px-6">
              <h1 className="truncate text-sm font-semibold text-foreground sm:text-base">{activeItem.name}</h1>
              <ConsoleHeaderActionsSlot />
            </header>
            <div className="flex-1 overflow-auto p-4 md:p-6">{children}</div>
          </main>
        )}
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-white/90 px-2 pb-4 pt-3 backdrop-blur-md md:hidden"
        aria-label={t("mobileNavigation")}
      >
        <div className="flex items-center justify-around">{renderNavigation(mobileMenuItems, "sm")}</div>
      </nav>
    </div>
  );
}
