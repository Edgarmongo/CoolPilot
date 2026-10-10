import { describe, expect, it } from "vitest";
import {
  readTopicWritingTarget,
  topicMaterialText,
  topicMatchesQuery,
  topicStatusLabelKeys,
  topicStatuses,
  topicWritingHref,
  topicWritingParam,
  topicWritingPath,
} from "./topics";
import type { TopicRecord } from "./types";

/**
 * The client-safe half of 选题管理 (CI-P2-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Two of these functions are the whole hand-off between the topic list and the writing wizard: the
 * href that carries a topic id (`topicWritingHref`) and the reader that turns that id back into a
 * target (`readTopicWritingTarget`). The third is what a topic becomes once the wizard has it
 * (`topicMaterialText`) - the user edits that text, so what it says has to be what the topic says.
 */

function topic(overrides: Partial<TopicRecord> = {}): TopicRecord {
  return {
    id: "tp-1",
    title: "夏季厨房降油烟",
    description: "从换锅开始讲",
    keywords: ["不粘锅", "少油"],
    source: "微博",
    sourceUrl: "https://example.com/hot/summer",
    status: "active",
    contentItemId: null,
    // CI-P3-03: a topic the user (or a hot-topic source) created came from no material.
    researchMaterialId: "",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("topic statuses", () => {
  it("offers exactly the two statuses the archive action writes", () => {
    expect(topicStatuses).toEqual(["active", "archived"]);
    expect(topicStatuses.map((status) => topicStatusLabelKeys[status])).toEqual([
      "tpStatusActive",
      "tpStatusArchived",
    ]);
  });
});

describe("topicMatchesQuery", () => {
  it("searches every field the list shows", () => {
    expect(topicMatchesQuery(topic(), "夏季")).toBe(true);
    expect(topicMatchesQuery(topic(), "换锅")).toBe(true);
    expect(topicMatchesQuery(topic(), "少油")).toBe(true);
    expect(topicMatchesQuery(topic(), "微博")).toBe(true);
    expect(topicMatchesQuery(topic(), "weibo")).toBe(false);
  });

  it("matches everything for an empty query, so the empty box is not a filter", () => {
    expect(topicMatchesQuery(topic(), "")).toBe(true);
    expect(topicMatchesQuery(topic(), "   ")).toBe(true);
  });
});

describe("topicMaterialText", () => {
  it("words the topic's own fields as material, source link included", () => {
    expect(topicMaterialText(topic())).toBe(
      ["选题：夏季厨房降油烟", "说明：从换锅开始讲", "关键词：不粘锅、少油", "来源：https://example.com/hot/summer"].join(
        "\n",
      ),
    );
  });

  it("falls back to the source name when there is no link, and omits what is empty", () => {
    expect(topicMaterialText(topic({ sourceUrl: "" }))).toBe(
      ["选题：夏季厨房降油烟", "说明：从换锅开始讲", "关键词：不粘锅、少油", "来源：微博"].join("\n"),
    );
    expect(topicMaterialText(topic({ description: "", keywords: [], sourceUrl: "", source: "" }))).toBe(
      "选题：夏季厨房降油烟",
    );
  });
});

describe("topicWritingHref / readTopicWritingTarget", () => {
  it("builds the wizard link for the locale it is given", () => {
    // The builder and the reader have to agree on one route and one parameter name.
    expect(topicWritingPath).toBe("/creation/ai-writing");
    expect(topicWritingParam).toBe("topicId");
    expect(topicWritingHref("zh-cn", "tp-1")).toBe("/zh-cn/creation/ai-writing?topicId=tp-1");
    expect(topicWritingHref("en", "tp-1")).toBe("/en/creation/ai-writing?topicId=tp-1");
    expect(topicWritingHref("zh-hk", "tp-1")).toBe("/zh-hk/creation/ai-writing?topicId=tp-1");
  });

  it("encodes the id and answers the plain wizard for an id that is empty", () => {
    expect(topicWritingHref("en", "a b&c=d")).toBe("/en/creation/ai-writing?topicId=a%20b%26c%3Dd");
    expect(topicWritingHref("en", "   ")).toBe("/en/creation/ai-writing");
  });

  it("reads the target back the way Next hands the search params over", () => {
    expect(readTopicWritingTarget(new URLSearchParams({ topicId: "tp-1" }))).toBe("tp-1");
    expect(readTopicWritingTarget(new URLSearchParams({ topicId: "  tp-1  " }))).toBe("tp-1");
    expect(readTopicWritingTarget(new URLSearchParams(""))).toBe("");
    expect(readTopicWritingTarget(null)).toBe("");
    expect(readTopicWritingTarget(undefined)).toBe("");
  });
});
