import { describe, expect, it } from "vitest";
import {
  buildPositionDraftFromPrompt,
  emptyPositionDraft,
  evaluateStoreListing,
  normalizePositionDraft,
  splitTextLines,
} from "./positions";
import { defaultStoreListing } from "./positions";

describe("normalizePositionDraft", () => {
  it("returns fully-populated defaults for junk input", () => {
    const draft = normalizePositionDraft(null);
    expect(draft).toEqual(emptyPositionDraft());
    expect(draft.antiAiDetection).toBe(true);
    expect(draft.allowKnowledgeReuse).toBe(true);
    expect(draft.cooldownDays).toBe(7);
    expect(draft.knowledgeHotspotBalance).toBe(50);
    expect(draft.store).toEqual(defaultStoreListing());
  });

  it("clamps numbers, trims strings and drops invalid codes", () => {
    const draft = normalizePositionDraft({
      name: "  美食号  ",
      cooldownDays: 9999,
      maxUses: -4,
      aiFreedom: 250,
      knowledgeHotspotBalance: -10,
      antiAiDetection: false,
      platformOverrides: [
        { platform: "小红书", tone: "humorous", style: "not-a-style", wordCount: "120字", topicAngle: "  " },
        { platform: "知乎", tone: "", style: "", wordCount: "", topicAngle: "" },
        { platform: "", tone: "formal" },
      ],
    });

    expect(draft.name).toBe("美食号");
    expect(draft.cooldownDays).toBe(365);
    expect(draft.maxUses).toBe(0);
    expect(draft.aiFreedom).toBe(100);
    expect(draft.knowledgeHotspotBalance).toBe(0);
    expect(draft.antiAiDetection).toBe(false);
    // empty override dropped, blank platform dropped, invalid style stripped but digits kept
    expect(draft.platformOverrides).toEqual([
      { platform: "小红书", tone: "humorous", style: "", wordCount: "120", topicAngle: "" },
    ]);
  });

  it("de-duplicates and trims list values", () => {
    const draft = normalizePositionDraft({
      bannedWords: [" 政治 ", "政治", "", "宗教"],
      rssSources: [" https://a.com/rss ", "https://a.com/rss", "https://b.com/rss"],
    });
    expect(draft.bannedWords).toEqual(["政治", "宗教"]);
    expect(draft.rssSources).toEqual(["https://a.com/rss", "https://b.com/rss"]);
  });

  it("keeps a valid store listing and defaults an unknown category", () => {
    const draft = normalizePositionDraft({
      store: { emoji: "🍳", category: "nope", tagline: "家常菜一分钟上手", status: "bogus", testScore: 400 },
    });
    expect(draft.store.emoji).toBe("🍳");
    expect(draft.store.category).toBe("content");
    expect(draft.store.status).toBe("none");
    expect(draft.store.testScore).toBe(100);
  });
});

describe("buildPositionDraftFromPrompt", () => {
  it("derives a name and a persona from the prompt", () => {
    const draft = buildPositionDraftFromPrompt("搞笑新闻专家，用段子口语解说热点新闻");
    expect(draft.name).toBe("搞笑新闻专家");
    expect(draft.description).toContain("搞笑新闻专家");
    expect(draft.personaRole).toContain("搞笑新闻专家");
    expect(draft.writingGuide).toContain("生活场景");
  });

  it("falls back to a placeholder name for an empty prompt", () => {
    const draft = buildPositionDraftFromPrompt("   ");
    expect(draft.name).toBe("新定位");
  });
});

describe("evaluateStoreListing", () => {
  const complete = {
    ...emptyPositionDraft("美食号"),
    description: "专注家常菜的美食博主，服务烹饪新手，帮助观众一次做成。",
    personaRole:
      "你是一位专注家常菜的美食写手，语言生活化、节奏明快；先给可复现的步骤，再解释原理与常见误区，让新手一次就能做成。",
  };

  it("passes a complete listing", () => {
    const result = evaluateStoreListing(
      { ...defaultStoreListing(), tagline: "家常菜一分钟上手", sampleQuestion: "怎么做番茄炒蛋？" },
      complete,
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });

  it("fails when the sample question is missing", () => {
    const result = evaluateStoreListing({ ...defaultStoreListing(), tagline: "家常菜一分钟上手" }, complete);
    expect(result.passed).toBe(false);
    expect(result.missing).toContain("sampleQuestion");
  });
});

describe("splitTextLines", () => {
  it("trims and drops empty lines", () => {
    expect(splitTextLines(" a \n\n b \r\n c ")).toEqual(["a", "b", "c"]);
  });
});
