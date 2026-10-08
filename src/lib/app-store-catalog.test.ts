import { describe, expect, it } from "vitest";
import { officialAgents, summarizeAppStore } from "./app-store-catalog";
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
});
