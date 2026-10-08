import { describe, expect, it } from "vitest";
import { getMetricProfile } from "./metric-profiles";
import { parseCompactNumber, parseFollowerCount, parseLabeledNumber, parseReadings } from "./metric-parse";

describe("parseCompactNumber", () => {
  it("handles commas and compact suffixes", () => {
    expect(parseCompactNumber("1,234")).toBe(1234);
    expect(parseCompactNumber("1.2万")).toBe(12000);
    expect(parseCompactNumber("3.4k")).toBe(3400);
    expect(parseCompactNumber("2.1M")).toBe(2_100_000);
    expect(parseCompactNumber("1.5亿")).toBe(150_000_000);
    expect(parseCompactNumber("88")).toBe(88);
  });

  it("returns undefined for non-numbers", () => {
    expect(parseCompactNumber("赞同")).toBeUndefined();
    expect(parseCompactNumber("")).toBeUndefined();
  });
});

describe("parseLabeledNumber", () => {
  it("reads label-then-number and number-then-label", () => {
    expect(parseLabeledNumber("阅读 1,234 赞同 5", ["阅读"])).toBe(1234);
    expect(parseLabeledNumber("赞同:5  阅读：1.2万", ["阅读"])).toBe(12000);
    expect(parseLabeledNumber("1,024 阅读", ["阅读"])).toBe(1024);
    expect(parseLabeledNumber("nothing here", ["阅读"])).toBeUndefined();
  });
});

describe("parseReadings", () => {
  const profile = getMetricProfile("知乎");

  it("extracts per-title metrics from creator-centre text", () => {
    const text = [
      "我的创作",
      "如何理解本地优先架构",
      "阅读 1,204 赞同 32 评论 6 收藏 12 喜欢 4",
      "一篇表现平平的文章",
      "阅读 88 赞同 1 评论 0 收藏 0 喜欢 0",
    ].join("\n");

    const readings = parseReadings(text, ["如何理解本地优先架构", "一篇表现平平的文章", "不存在的标题"], profile);
    const first = readings.find((r) => r.title === "如何理解本地优先架构");
    expect(first).toMatchObject({ matched: true, views: 1204, likes: 32, comments: 6, favorites: 12 });

    const second = readings.find((r) => r.title === "一篇表现平平的文章");
    expect(second?.views).toBe(88);

    const missing = readings.find((r) => r.title === "不存在的标题");
    expect(missing?.matched).toBe(false);
  });

  it("reads the account follower count", () => {
    expect(parseFollowerCount("关注者 3,418 · 创作等级 Lv6", profile)).toBe(3418);
  });
});
