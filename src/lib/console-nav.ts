import {
  Activity,
  Blocks,
  BookMarked,
  BookOpen,
  Boxes,
  Brush,
  CalendarClock,
  CalendarDays,
  ChartLine,
  Database,
  Globe2,
  Handshake,
  HardDrive,
  History,
  House,
  Image as ImageIcon,
  LayoutDashboard,
  Library,
  Lightbulb,
  ListChecks,
  MessageCircle,
  Network,
  Newspaper,
  Package,
  PenSquare,
  PenTool,
  Play,
  Rocket,
  ScrollText,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Store,
  Tag,
  Target,
  Users,
  Video,
  WalletCards,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TranslationKey } from "./locale-resources";

/**
 * CoolPilot console information architecture (CI-IA-01 structure, CI-IA-02 business orientation,
 * CI-IA-03 ownership fix).
 *
 * The menu is a product contract, not a mirror of the source tree: every entry answers "what business
 * task do I come here to finish", and every page lives in exactly one business group. The structure
 * sits outside the layout component so `console-nav.test.ts` can pin it without a DOM (group count,
 * order, the exact set of routes, the pages behind them, label keys in all three locales).
 *
 * Eight first-level business groups, ordered along the user's production chain, settings at the end:
 *   1 Workbench      enter the day's work (dashboard + general AI chat)
 *   2 Content        turn a request into content - the surface people buy CoolPilot for
 *   3 Assets         reusable brand / knowledge / research / product material
 *   4 Publishing     deliver content to channels (accounts, composers, records, schedules)
 *   5 Automation     run and observe repeatable executions
 *   6 Data & Costs   observe business activity, generation records and AI spend
 *   7 Extensions     the extension surface that exists today (long-term Marketplace seat)
 *   8 System         local machine configuration: models, preferences, workspace
 *
 * CI-IA-03 (author-directed): 动态发布 became 动态创作 and moved from Publishing to Content
 * Creation; 影片发布 stays in Publishing. It is the only ownership change in this revision, and
 * the one deliberate exception to IA-01 decision 2.
 *
 * Two display layers on purpose (CI-IA-02): the desktop sidebar shows the business label
 * (`labelKey`), the five mobile tabs show a short label (`mobileLabelKey`). A display name may
 * improve, but the route, the id and the translation key stay.
 *
 * Rules for future cards (do not bypass):
 *   - new pages go into an existing group; do not add a ninth first-level group casually;
 *   - a group is never a placeholder - it renders only when it already owns real pages;
 *   - publish results (发布记录) and execution logs (执行历史) are different business objects and
 *     are not merged into one generic "records" menu;
 *   - nobody lands in this tree because a module exists in `src/`; it lands here because a user has
 *     a job to do.
 *
 * Routes are untouched by these cards: every `href` below is a URL that already existed.
 * Business responsibilities, per-entry ownership, evidence and verification:
 * docs/development/menu-information-architecture.md
 */
export type ConsoleNavEntry = {
  id: string;
  labelKey: TranslationKey;
  /** Short label for the mobile bottom bar; falls back to `labelKey` when absent. */
  mobileLabelKey?: TranslationKey;
  icon: LucideIcon;
  href: string;
  segment: string;
  children?: ConsoleNavEntry[];
};

/** The same tree with the i18n label resolved, i.e. what the sidebar renders. */
export type ConsoleNavLabeledEntry = {
  id: string;
  name: string;
  /** `name` unless the entry declares a shorter `mobileLabelKey` (mobile bottom bar only). */
  mobileName: string;
  icon: LucideIcon;
  href: string;
  segment: string;
  children?: ConsoleNavLabeledEntry[];
};

export type ConsoleNavTranslate = (key: TranslationKey) => string;

export const consoleNavItems: ConsoleNavEntry[] = [
  {
    id: "workbench",
    labelKey: "navWorkbench",
    mobileLabelKey: "navMobileWorkbench",
    icon: LayoutDashboard,
    href: "/dashboard",
    segment: "/dashboard",
    children: [
      { id: "dashboard", labelKey: "navDashboard", icon: House, href: "/dashboard", segment: "/dashboard" },
      // General agent chat is a daily entry point of its own, not a creation tool (IA-01 decision 1).
      { id: "chatroom", labelKey: "agentChatShortTitle", icon: MessageCircle, href: "/chatroom", segment: "/chatroom" },
    ],
  },
  {
    id: "creation",
    labelKey: "navCreation",
    mobileLabelKey: "navMobileCreation",
    icon: PenSquare,
    href: "/creation/ai-writing",
    segment: "/creation",
    children: [
      // First on purpose: the mobile "Content Creation" tab opens the group's first child (#leafHref).
      { id: "ai-writing", labelKey: "navAiWriting", icon: Sparkles, href: "/creation/ai-writing", segment: "/creation/ai-writing" },
      { id: "topics", labelKey: "navTopics", icon: Lightbulb, href: "/creation/topics", segment: "/creation/topics" },
      { id: "articles", labelKey: "navArticleCreation", icon: Newspaper, href: "/creation/articles", segment: "/creation/articles" },
      // /creation/images really is an AI image workbench (prompt driven) with a gallery, so it is a
      // creation surface rather than an asset library (IA-01 decision 3; label renamed to match).
      { id: "images", labelKey: "navImageManagement", icon: ImageIcon, href: "/creation/images", segment: "/creation/images" },
      {
        id: "drawing",
        labelKey: "navDrawing",
        icon: Brush,
        href: "/whiteboard",
        segment: "/whiteboard",
        children: [
          { id: "whiteboard", labelKey: "navWhiteboard", icon: PenTool, href: "/whiteboard", segment: "/whiteboard" },
          { id: "mindmap", labelKey: "navMindMap", icon: Network, href: "/mindmap", segment: "/mindmap" },
        ],
      },
      // CI-IA-03 (author-directed): 动态发布 became 动态创作 and moved here from Publishing. The page
      // drafts a 图文动态 (caption + gallery image) and its route already lives under /creation/*, so
      // the group now matches the URL tree; 影片发布 deliberately stays in Publishing.
      { id: "posts", labelKey: "navDynamicPublishing", icon: Send, href: "/creation/posts", segment: "/creation/posts" },
    ],
  },
  {
    id: "assets",
    labelKey: "navDataAssets",
    mobileLabelKey: "navMobileAssets",
    icon: Database,
    href: "/content/library",
    segment: "/content",
    children: [
      { id: "content-center", labelKey: "navContentCenter", icon: Library, href: "/content/library", segment: "/content" },
      { id: "research", labelKey: "navResearch", icon: BookMarked, href: "/creation/research", segment: "/creation/research" },
      { id: "brands", labelKey: "navBrands", icon: Tag, href: "/creation/brands", segment: "/creation/brands" },
      // Account positioning profiles and the knowledge base are generation inputs, i.e. reusable
      // material, not machine configuration (IA-01 decision 4; the old 智能配置 container had no page).
      { id: "positioning", labelKey: "navAccountPositioning", icon: Target, href: "/smart-config/positioning", segment: "/smart-config/positioning" },
      { id: "knowledge-base", labelKey: "navKnowledgeBase", icon: BookOpen, href: "/smart-config/knowledge-base", segment: "/smart-config/knowledge-base" },
      { id: "products", labelKey: "navProductManagement", icon: Package, href: "/creation/products", segment: "/creation/products" },
    ],
  },
  {
    id: "publishing",
    labelKey: "navPublishing",
    mobileLabelKey: "navMobilePublishing",
    icon: Rocket,
    href: "/publishing/accounts",
    segment: "/publishing",
    children: [
      { id: "accounts", labelKey: "navAccountManagement", icon: Users, href: "/publishing/accounts", segment: "/publishing/accounts" },
      // 影片发布 is a publish composer (content -> platform -> review) and stays next to the publish
      // records it writes (IA-01 decision 2). 动态发布 moved to Content Creation as 动态创作 in
      // CI-IA-03, at the author's request - the one exception to that decision.
      { id: "videos", labelKey: "navVideoPublishing", icon: Video, href: "/creation/videos", segment: "/creation/videos" },
      { id: "publish-records", labelKey: "navPublishRecords", icon: ListChecks, href: "/publishing/records", segment: "/publishing/records" },
      // CI-LEAD-01: 营销线索与成交. It sits next to 发布记录 on purpose - a lead is what a published
      // content produced, and the page links each lead back to the content and the record it came from.
      { id: "leads", labelKey: "navMarketingLeads", icon: Handshake, href: "/publishing/leads", segment: "/publishing/leads" },
      // Schedules carry an account and a content item (a publishing plan), so they are publish
      // scheduling rather than a generic workflow engine (IA-01 decision 5).
      { id: "schedules", labelKey: "navSchedules", icon: CalendarClock, href: "/schedules/list", segment: "/schedules/list" },
      { id: "calendar", labelKey: "navContentCalendar", icon: CalendarDays, href: "/schedules/calendar", segment: "/schedules/calendar" },
    ],
  },
  {
    id: "automation",
    labelKey: "navAutomation",
    icon: Workflow,
    href: "/runs/queue",
    segment: "/automation",
    children: [
      { id: "runs", labelKey: "navRuns", icon: Play, href: "/runs/queue", segment: "/runs" },
      // The page reads /api/runs plus the newest run's events, i.e. execution history - it is not a
      // cross-business operations log (IA-01 decision 6; key unchanged, label renamed to match).
      { id: "operation-logs", labelKey: "navOperationLogs", icon: ScrollText, href: "/automation/logs", segment: "/automation/logs" },
      { id: "execution-nodes", labelKey: "navExecutionNodes", icon: Globe2, href: "/automation/nodes", segment: "/automation/nodes" },
    ],
  },
  {
    id: "operations",
    labelKey: "navOperations",
    icon: Activity,
    href: "/data-center",
    segment: "/operations",
    children: [
      // This group answers "how is the business actually running": activity reporting, what was
      // generated, and what the AI spend was. Nothing here is reusable material (IA-01 decision 7)
      // and nothing here executes work - execution is the Automation group (CI-IA-02 split).
      { id: "data-center", labelKey: "navDataCenter", icon: ChartLine, href: "/data-center", segment: "/data-center" },
      { id: "generations", labelKey: "navGenerationRecords", icon: History, href: "/automation/generations", segment: "/automation/generations" },
      { id: "cost-center", labelKey: "navAiCostCenter", icon: WalletCards, href: "/system/cost-center", segment: "/system/cost-center" },
    ],
  },
  {
    id: "app-market",
    labelKey: "navAppMarket",
    icon: Blocks,
    href: "/app-store",
    segment: "/app-store",
    children: [
      // Only surfaces that exist today: Agent / Workflow / Template markets stay unlisted until they
      // have a real page (no placeholder menu entries).
      { id: "app-store", labelKey: "navAppStore", icon: Store, href: "/app-store", segment: "/app-store" },
    ],
  },
  {
    id: "system",
    labelKey: "navSystem",
    mobileLabelKey: "navMobileSystem",
    icon: Settings,
    href: "/system/models",
    segment: "/settings",
    children: [
      // First on purpose: the mobile "System Settings" tab opens the group's first child (#leafHref).
      { id: "models", labelKey: "navModelManagement", icon: Boxes, href: "/system/models", segment: "/system/models" },
      // /settings holds app preferences (runtime, permissions, language, brand, prompts, backup); its
      // label deliberately does not repeat the group's own name (IA-01 decision 8).
      { id: "settings", labelKey: "navSettings", icon: SlidersHorizontal, href: "/settings", segment: "/settings" },
      { id: "workspace", labelKey: "navWorkspace", icon: HardDrive, href: "/system/workspace", segment: "/system/workspace" },
    ],
  },
];

/**
 * Mobile bottom bar (md and below): the same production chain in five tabs, in the same order as the
 * desktop groups, each landing on its first child. The three groups without a tab (Automation,
 * Data & Costs, Extensions) stay reachable from the desktop sidebar or a direct URL - the same
 * situation 数据中心 / 聊天 / 应用商店 / 自动化 were in before the menu cards. Tab labels come from
 * `mobileLabelKey` (short form), never from truncating the desktop name (CI-IA-02).
 */
export const consoleMobileNavIds: string[] = ["workbench", "creation", "assets", "publishing", "system"];

/**
 * Console routes that are on purpose not menu entries: `/schedule` and `/system/usage` are aliases
 * that redirect to the surface which now owns them, `/settings/[tab]` is the dynamic settings tab
 * route. `console-nav.test.ts` uses this list to prove no real page silently lost its menu entry.
 */
export const consoleNavOffMenuRoutes: string[] = ["/schedule", "/system/usage", "/settings/[tab]"];

/** Flatten a nav tree to its leaves (group entries are containers and never render as links). */
export function flattenConsoleNav<T extends { children?: T[] }>(items: T[]): T[] {
  return items.flatMap((item) => (item.children?.length ? flattenConsoleNav(item.children) : [item]));
}

/** Every group in the tree, including nested groups such as 智能画布. */
export function collectConsoleNavGroups<T extends { children?: T[] }>(items: T[]): T[] {
  return items.flatMap((item) => (item.children?.length ? [item, ...collectConsoleNavGroups(item.children)] : []));
}

/** Where a group lands when its label is clicked (its first leaf). */
export function consoleNavLeafHref<T extends { href: string; children?: T[] }>(entry: T): string {
  const [first] = entry.children ?? [];
  return first ? consoleNavLeafHref(first) : entry.href;
}

/**
 * Route -> entry match, unchanged from the sidebar this replaces: a leaf owns every path below its
 * segment, and `/` counts as the dashboard. The locale prefix is stripped by the caller.
 */
export function matchesConsoleNavSegment(routePath: string, segment: string): boolean {
  return routePath.startsWith(segment) || (segment === "/dashboard" && routePath === "/");
}

/** The leaf whose segment owns `routePath`, else the first leaf (so the header never goes blank). */
export function findActiveConsoleNavEntry<T extends { href: string; segment: string; children?: T[] }>(
  items: T[],
  routePath: string,
): T | undefined {
  const leaves = flattenConsoleNav(items);
  return leaves.find((leaf) => matchesConsoleNavSegment(routePath, leaf.segment)) ?? leaves[0];
}

/**
 * Resolve every `labelKey` through the store's `t` so rendering stays a pure map. `mobileName` is the
 * short bottom-bar label: the entry's own `mobileLabelKey`, else the same business label.
 */
export function labelConsoleNav(items: ConsoleNavEntry[], t: ConsoleNavTranslate): ConsoleNavLabeledEntry[] {
  return items.map(({ labelKey, mobileLabelKey, children, ...rest }) => ({
    ...rest,
    name: t(labelKey),
    mobileName: t(mobileLabelKey ?? labelKey),
    ...(children?.length ? { children: labelConsoleNav(children, t) } : {}),
  }));
}
