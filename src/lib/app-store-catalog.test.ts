import { describe, expect, it } from "vitest";
import {
  appStoreAgentIds,
  appStoreListingIdOfPosition,
  isAppStoreAgentId,
  officialAgents,
  summarizeAppStore,
} from "./app-store-catalog";
import { appStoreCategories } from "./types";

describe("app store catalog", () => {
  it("covers every category with at least one official agent", () => {
    for (const category of appStoreCategories) {
      expect(officialAgents.some((agent) => agent.category === category)).toBe(true);
    }
  });

  it("uses unique ids and marks every seed agent as official", () => {
    const ids = new Set(officialAgents.map((agent) => agent.id));
    expect(ids.size).toBe(officialAgents.length);
    expect(officialAgents.every((agent) => agent.official)).toBe(true);
  });

  it("summarizes totals and per-category counts", () => {
    const summary = summarizeAppStore(officialAgents);
    expect(summary.total).toBe(officialAgents.length);
    const summed = appStoreCategories.reduce((acc, category) => acc + summary.categoryCounts[category], 0);
    expect(summed).toBe(summary.total);
  });

  // CI-P7-05-03: the storefront's identity for a listing is what the ledger attributes money to, so
  // it is pinned here as the store's own rule rather than as a string a writer happened to use.
  it("publishes one listing id for a stored position, and none for an unnamed one", () => {
    expect(appStoreListingIdOfPosition("abc")).toBe("position-abc");
    expect(appStoreListingIdOfPosition("  abc  ")).toBe("position-abc");
    expect(appStoreListingIdOfPosition("")).toBe("");
    expect(appStoreListingIdOfPosition("   ")).toBe("");
  });

  it("tells an id it really lists from one it does not", () => {
    expect(appStoreAgentIds()).toEqual(officialAgents.map((agent) => agent.id));
    expect(isAppStoreAgentId(officialAgents[0].id)).toBe(true);
    expect(isAppStoreAgentId(`  ${officialAgents[0].id}  `)).toBe(true);
    // The generation panel's picker has agents of its own: real agents, but not listings of this
    // catalogue, so no money may be attributed to them as if the storefront published them.
    expect(isAppStoreAgentId("general")).toBe(false);
    expect(isAppStoreAgentId("marketing")).toBe(false);
    expect(isAppStoreAgentId("")).toBe(false);
    expect(isAppStoreAgentId("   ")).toBe(false);
  });
});
