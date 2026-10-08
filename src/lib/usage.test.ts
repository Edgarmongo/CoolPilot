import { describe, expect, it } from "vitest";
import type { UsageRecord } from "@/lib/types";
import { countTextCharacters, normalizeUsageRange, summarizeUsageRecords, usageRangeStart } from "./usage";

const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();

function usageRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id: overrides.id ?? `usage-${Math.random().toString(36).slice(2)}`,
    provider: "deepseek",
    model: "deepseek-chat",
    kind: "article",
    status: "success",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    wordCount: 0,
    createdAt: NOW,
    ...overrides,
  };
}

describe("usage range helpers", () => {
  it("normalizes unsupported ranges to the default window", () => {
    expect(normalizeUsageRange(30)).toBe(30);
    expect(normalizeUsageRange("90")).toBe(90);
    expect(normalizeUsageRange(5)).toBe(7);
    expect(normalizeUsageRange(undefined)).toBe(7);
  });

  it("starts an inclusive window at the beginning of the oldest day", () => {
    const start = usageRangeStart(7, NOW);
    const expected = new Date(2026, 0, 9, 0, 0, 0, 0).getTime();
    expect(start).toBe(expected);
  });

  it("counts characters without whitespace", () => {
    expect(countTextCharacters("hello world\n\n  你好")).toBe("helloworld你好".length);
    expect(countTextCharacters("")).toBe(0);
  });
});

describe("summarizeUsageRecords", () => {
  it("aggregates successful generations per model and sorts by total tokens", () => {
    const summary = summarizeUsageRecords(
      [
        usageRecord({ id: "a", inputTokens: 5813, outputTokens: 5472, totalTokens: 11285, wordCount: 1198 }),
        usageRecord({ id: "b", inputTokens: 10, outputTokens: 20, totalTokens: 30, wordCount: 40 }),
        usageRecord({
          id: "c",
          provider: "gemini",
          model: "gemini-2.5-flash",
          inputTokens: 1000,
          outputTokens: 500,
          totalTokens: 1500,
          wordCount: 900,
        }),
      ],
      7,
      NOW,
    );

    expect(summary.rangeDays).toBe(7);
    expect(summary.totals.articles).toBe(3);
    expect(summary.totals.totalTokens).toBe(11285 + 30 + 1500);
    expect(summary.totals.wordCount).toBe(1198 + 40 + 900);
    expect(summary.totals.avgWords).toBe(Math.round((1198 + 40 + 900) / 3));
    expect(summary.totals.avgTokens).toBe(Math.round((11285 + 30 + 1500) / 3));

    expect(summary.models.map((model) => model.model)).toEqual(["deepseek-chat", "gemini-2.5-flash"]);
    const deepseek = summary.models[0];
    expect(deepseek.articles).toBe(2);
    expect(deepseek.totalTokens).toBe(11315);
    expect(deepseek.avgTokens).toBe(Math.round(11315 / 2));
    expect(deepseek.avgWords).toBe(Math.round((1198 + 40) / 2));
  });

  it("ignores failed rows and rows outside the window", () => {
    const summary = summarizeUsageRecords(
      [
        usageRecord({ id: "ok", totalTokens: 100, wordCount: 10 }),
        usageRecord({ id: "failed", status: "failed", totalTokens: 9999 }),
        usageRecord({
          id: "old",
          totalTokens: 5000,
          createdAt: new Date(2026, 0, 1, 8, 0, 0).getTime(),
        }),
      ],
      7,
      NOW,
    );

    expect(summary.totals.articles).toBe(1);
    expect(summary.totals.totalTokens).toBe(100);
    expect(summary.models).toHaveLength(1);
  });

  it("returns zeroed averages when there is no data", () => {
    const summary = summarizeUsageRecords([], 30, NOW);
    expect(summary.totals).toEqual({
      articles: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      wordCount: 0,
      avgWords: 0,
      avgTokens: 0,
    });
    expect(summary.models).toEqual([]);
  });
});
