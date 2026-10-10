import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { locales } from "./i18n-config";
import { localeResources } from "./locale-resources";
import {
  collectConsoleNavGroups,
  consoleMobileNavIds,
  consoleNavLeafHref,
  consoleNavItems,
  consoleNavOffMenuRoutes,
  findActiveConsoleNavEntry,
  flattenConsoleNav,
  labelConsoleNav,
  matchesConsoleNavSegment,
} from "./console-nav";

const consoleAppRoot = path.join(process.cwd(), "src", "app", "[locale]", "(console)");

/**
 * The sidebar routes as they were the moment before CI-IA-01 moved them between groups. This list is
 * hand written on purpose: the card's contract is "regroup, never drop and never invent", so any
 * future add/remove has to touch this expectation consciously.
 */
const routesBeforeRegrouping = [
  "/app-store",
  "/automation/generations",
  "/automation/logs",
  "/automation/nodes",
  "/chatroom",
  "/content/library",
  "/creation/ai-writing",
  "/creation/articles",
  "/creation/brands",
  "/creation/images",
  "/creation/posts",
  "/creation/products",
  "/creation/research",
  "/creation/topics",
  "/creation/videos",
  "/dashboard",
  "/data-center",
  "/mindmap",
  "/publishing/accounts",
  "/publishing/records",
  "/runs/queue",
  "/schedules/calendar",
  "/schedules/list",
  "/settings",
  "/smart-config/knowledge-base",
  "/smart-config/positioning",
  "/system/cost-center",
  "/system/models",
  "/system/workspace",
  "/whiteboard",
];

/**
 * Group id -> the leaves it owns, straight from the IA contract table. The map order is the approved
 * business order (CI-IA-02: production chain first, platform settings last). CI-IA-03 moved one leaf
 * only: `posts` left publishing for creation (author decision, see `consoleNavItems`).
 */
const expectedGroupOrder = [
  "workbench",
  "creation",
  "assets",
  "publishing",
  "automation",
  "operations",
  "app-market",
  "system",
];

const expectedOwnership: Record<string, string[]> = {
  workbench: ["dashboard", "chatroom"],
  creation: ["ai-writing", "topics", "articles", "images", "whiteboard", "mindmap", "posts"],
  assets: ["content-center", "research", "brands", "positioning", "knowledge-base", "products"],
  publishing: ["accounts", "videos", "publish-records", "schedules", "calendar"],
  automation: ["runs", "operation-logs", "execution-nodes"],
  operations: ["data-center", "generations", "cost-center"],
  "app-market": ["app-store"],
  system: ["models", "settings", "workspace"],
};

/**
 * The five mobile tabs, in the approved bottom-bar order, each with its own short label key
 * (CI-IA-02). Groups without a tab must not declare one, so a sixth tab cannot appear by accident.
 */
const expectedMobileTabs = [
  { id: "workbench", labelKey: "navMobileWorkbench" },
  { id: "creation", labelKey: "navMobileCreation" },
  { id: "assets", labelKey: "navMobileAssets" },
  { id: "publishing", labelKey: "navMobilePublishing" },
  { id: "system", labelKey: "navMobileSystem" },
] as const;

function leafIdsOfGroup(groupId: string): string[] {
  const group = consoleNavItems.find((item) => item.id === groupId);
  if (!group) throw new Error(`missing group ${groupId}`);
  return flattenConsoleNav([group]).map((leaf) => leaf.id);
}

function pageFiles(prefix = ""): string[] {
  const dir = path.join(consoleAppRoot, prefix);
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return pageFiles(relative);
    return entry.name === "page.tsx" ? [relative.replace(/\/page\.tsx$/, "")] : [];
  });
}

describe("console navigation structure (CI-IA-01 structure, CI-IA-02 business order, CI-IA-03 ownership)", () => {
  it("keeps eight first-level business groups in the documented order", () => {
    expect(consoleNavItems.map((item) => item.id)).toEqual(expectedGroupOrder);
    for (const group of consoleNavItems) {
      expect(group.children?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("owns exactly the routes that existed before the regrouping", () => {
    const routes = flattenConsoleNav(consoleNavItems).map((leaf) => leaf.href);
    expect([...routes].sort()).toEqual([...routesBeforeRegrouping].sort());
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("keeps every console page reachable: nav routes plus the documented redirect aliases", () => {
    const navRoutes = flattenConsoleNav(consoleNavItems).map((leaf) => leaf.href.replace(/^\//, "")).sort();
    const offMenu = consoleNavOffMenuRoutes.map((route) => route.replace(/^\//, "")).sort();
    expect([...navRoutes, ...offMenu].sort()).toEqual(pageFiles().sort());
  });

  it("puts every leaf in the group the IA contract documents", () => {
    for (const [groupId, leafIds] of Object.entries(expectedOwnership)) {
      expect(leafIdsOfGroup(groupId), `group ${groupId}`).toEqual(leafIds);
    }
    expect(Object.keys(expectedOwnership), "ownership map follows the approved group order").toEqual(expectedGroupOrder);
    const owned = Object.values(expectedOwnership).flat();
    expect(owned.sort()).toEqual(flattenConsoleNav(consoleNavItems).map((leaf) => leaf.id).sort());
  });

  it("keeps the CI-IA-03 author decision: 动态创作 is created, 影片发布 stays published", () => {
    // The author moved 动态发布 (renamed 动态创作) into Content Creation and kept 影片发布 in
    // Publishing; this test pins that split so a later tidy-up cannot silently undo it.
    const posting = flattenConsoleNav(consoleNavItems).find((leaf) => leaf.id === "posts");
    expect(posting).toMatchObject({
      href: "/creation/posts",
      segment: "/creation/posts",
      labelKey: "navDynamicPublishing",
    });
    expect(leafIdsOfGroup("creation")).toContain("posts");
    expect(leafIdsOfGroup("publishing")).not.toContain("posts");
    expect(leafIdsOfGroup("publishing")).toContain("videos");
    expect(leafIdsOfGroup("creation")).not.toContain("videos");
    const creationLeafIds = consoleNavItems.find((item) => item.id === "creation")?.children?.map((child) => child.id) ?? [];
    expect(creationLeafIds[creationLeafIds.length - 1]).toBe("posts");
  });

  it("keeps navigation ids and route segments unique and non-overlapping per leaf", () => {
    const leaves = flattenConsoleNav(consoleNavItems);
    const ids = leaves.map((leaf) => leaf.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groupIds = collectConsoleNavGroups(consoleNavItems).map((group) => group.id);
    expect(new Set([...ids, ...groupIds]).size).toBe(ids.length + groupIds.length);
    for (const leaf of leaves) {
      const conflicting = leaves.filter(
        (other) => other !== leaf && other.segment !== leaf.segment && other.segment.startsWith(leaf.segment),
      );
      expect(conflicting, `segment ${leaf.segment} shadowed by a shorter one`).toEqual([]);
    }
  });

  it("resolves labels through t without changing ids, order or routes", () => {
    const labeled = labelConsoleNav(consoleNavItems, (key) => `t:${key}`);
    expect(labeled.map((entry) => entry.id)).toEqual(consoleNavItems.map((entry) => entry.id));
    const labeledLeaves = flattenConsoleNav(labeled);
    const sourceLeaves = flattenConsoleNav(consoleNavItems);
    expect(labeledLeaves.map((leaf) => leaf.href)).toEqual(sourceLeaves.map((leaf) => leaf.href));
    expect(labeledLeaves.map((leaf) => leaf.name)).toEqual(sourceLeaves.map((leaf) => `t:${leaf.labelKey}`));
    // The bottom bar reads `mobileName`, so a stray `mobileLabelKey` anywhere must show up here.
    expect(labeledLeaves.map((leaf) => leaf.mobileName)).toEqual(
      sourceLeaves.map((leaf) => `t:${leaf.mobileLabelKey ?? leaf.labelKey}`),
    );
    const labeledGroups = labelConsoleNav(consoleNavItems, (key) => `t:${key}`);
    expect(labeledGroups.map((group) => group.mobileName)).toEqual(
      consoleNavItems.map((group) => `t:${group.mobileLabelKey ?? group.labelKey}`),
    );
    expect(labeledLeaves.every((leaf) => !leaf.children?.length)).toBe(true);
  });

  it("keeps every label key present and non-empty in all three locales", () => {
    const entries = [...consoleNavItems, ...collectConsoleNavGroups(consoleNavItems)];
    for (const entry of entries) {
      for (const locale of locales) {
        const value = localeResources[locale][entry.labelKey];
        expect(typeof value, `${locale} ${entry.id} ${entry.labelKey}`).toBe("string");
        expect(value.trim().length, `${locale} ${entry.id} ${entry.labelKey}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the previous route matching behaviour", () => {
    expect(matchesConsoleNavSegment("/", "/dashboard")).toBe(true);
    expect(matchesConsoleNavSegment("/dashboard/recent", "/dashboard")).toBe(true);
    expect(matchesConsoleNavSegment("/data", "/dashboard")).toBe(false);
    expect(matchesConsoleNavSegment("/settings/permissions", "/settings")).toBe(true);
    expect(matchesConsoleNavSegment("/system/workspace", "/settings")).toBe(false);
  });

  it("highlights exactly the leaf that owns the current route, and never goes blank", () => {
    for (const leaf of flattenConsoleNav(consoleNavItems)) {
      expect(findActiveConsoleNavEntry(consoleNavItems, leaf.href)?.href, leaf.id).toBe(leaf.href);
    }
    expect(findActiveConsoleNavEntry(consoleNavItems, "/")?.id).toBe("dashboard");
    expect(findActiveConsoleNavEntry(consoleNavItems, "/a-route-that-does-not-exist")?.id).toBe("dashboard");
  });

  it("keeps five mobile tabs in the approved order, each with its own short label", () => {
    expect(consoleMobileNavIds).toEqual(expectedMobileTabs.map((tab) => tab.id));
    const navRoutes = flattenConsoleNav(consoleNavItems).map((leaf) => leaf.href);
    for (const tab of expectedMobileTabs) {
      const group = consoleNavItems.find((item) => item.id === tab.id);
      expect(group, `mobile tab ${tab.id}`).toBeDefined();
      expect(group?.children?.length ?? 0).toBeGreaterThan(0);
      expect(navRoutes).toContain(consoleNavLeafHref(group!));
      // Only the five tab groups carry a short label, so a sixth tab cannot appear by accident.
      expect(group?.mobileLabelKey, `mobile tab ${tab.id}`).toBe(tab.labelKey);
    }
    for (const group of consoleNavItems) {
      if (!expectedMobileTabs.some((tab) => tab.id === group.id)) {
        expect(group.mobileLabelKey, `${group.id} is not a tab`).toBeUndefined();
      }
    }
  });

  it("keeps the mobile short labels present in every locale and never longer than the group label", () => {
    for (const locale of locales) {
      for (const tab of expectedMobileTabs) {
        const group = consoleNavItems.find((item) => item.id === tab.id)!;
        const short = localeResources[locale][tab.labelKey];
        const full = localeResources[locale][group.labelKey];
        expect(short.trim().length, `${locale} ${tab.labelKey}`).toBeGreaterThan(0);
        expect(short.length, `${locale} ${tab.labelKey} "${short}" vs group "${full}"`).toBeLessThanOrEqual(
          full.length,
        );
      }
    }
  });

  it("never shows two identical labels at the same level in the same locale", () => {
    for (const locale of locales) {
      const groupNames = consoleNavItems.map((group) => localeResources[locale][group.labelKey]);
      expect(new Set(groupNames).size, `${locale} group labels`).toBe(groupNames.length);
      const leafNames = flattenConsoleNav(consoleNavItems).map((leaf) => localeResources[locale][leaf.labelKey]);
      expect(new Set(leafNames).size, `${locale} leaf labels`).toBe(leafNames.length);
    }
  });
});
