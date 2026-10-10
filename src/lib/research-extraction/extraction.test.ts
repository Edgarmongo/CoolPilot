import { describe, expect, it } from "vitest";
import {
  nextResearchExtractionRevision,
  parseResearchExtraction,
  parseResearchExtractionHistory,
  researchExtractionEvidenceLocator,
  researchExtractionHistoryWith,
  researchExtractionIsEmpty,
  researchExtractionIsStale,
  researchExtractionOutputSchema,
  researchExtractionPromptText,
  researchExtractionRequestSchema,
  researchExtractionSourceFingerprint,
  researchExtractionSourcePromptText,
  researchExtractionSourceText,
  type ResearchExtractionOutput,
  type ResearchExtractionRecord,
  type ResearchExtractionSource,
} from "./extraction";

/**
 * The pure half of 研究提炼 (CI-P3-03 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * These cases pin the promises the card is made of, and none of them needs a model, a database or a
 * network to be decided:
 *
 * - **A fact is 已核实 only when the source says it.** `researchExtractionEvidenceLocator` is the whole
 *   answer to that question, and it is checked here against a page *and* a transcript (where it also
 *   locates the sentence in the media).
 * - **Suggestions never travel into a writing prompt**, and an unlocatable fact is left out *and counted*.
 * - **A version is a version**: revising and replacing are two different things, and neither invents a
 *   version that was never generated.
 * - **素材改过没有** is a fingerprint comparison, not a timestamp guess.
 */

const sourceText = "七点以后冰饮最好卖，夜市摊位比商场高 40%。\n夜市摊位平均每小时出单 12 杯。";

function material(overrides: Partial<ResearchExtractionSource> = {}): ResearchExtractionSource {
  return {
    id: "m1",
    title: "夏季冰饮动销报告",
    kind: "url",
    sourceUrl: "https://example.com/research/summer-drinks",
    content: sourceText,
    transcript: null,
    ...overrides,
  };
}

function transcriptMaterial(overrides: Partial<ResearchExtractionSource> = {}): ResearchExtractionSource {
  return {
    id: "m2",
    title: "访谈录音",
    kind: "audio",
    sourceUrl: "",
    content: "第一段说冰饮。夜市摊位平均每小时出单 12 杯。",
    transcript: {
      segments: [
        { index: 0, startMs: 0, endMs: 4_000, text: "第一段说冰饮。" },
        { index: 1, startMs: 4_000, endMs: 9_000, text: "夜市摊位平均每小时出单 12 杯。" },
      ],
    },
    ...overrides,
  };
}

function output(overrides: Partial<ResearchExtractionOutput> = {}): ResearchExtractionOutput {
  return {
    summary: "夜市比商场更好卖，七点之后是高峰。",
    keyPoints: ["七点以后是高峰", "夜市比商场高 40%"],
    facts: [
      { statement: "夜市摊位比商场高 40%", evidence: "夜市摊位比商场高 40%" },
      { statement: "平均每小时出单 12 杯", evidence: "每小时出单 12 杯" },
      // A figure the source never states: the model supplied it, so nothing can locate it.
      { statement: "客单价 25 元", evidence: "客单价 25 元" },
    ],
    quotes: ["七点以后冰饮最好卖", "这段话在素材里没有出现过"],
    topicSuggestions: [{ title: "夜市冰饮选品指南", rationale: "素材里的出单数据支持这个方向。" }],
    ...overrides,
  };
}

function record(overrides: Partial<ResearchExtractionRecord> = {}): ResearchExtractionRecord {
  const base = material();
  return {
    ...output(),
    revision: 1,
    taskId: "task-1",
    providerId: "qwen",
    model: "qwen3-max",
    generatedAt: 1_700_000_000_000,
    editedAt: null,
    materialId: base.id,
    materialTitle: base.title,
    materialKind: base.kind,
    sourceUrl: base.sourceUrl,
    sourceCharacters: sourceText.length,
    sourceFingerprint: researchExtractionSourceFingerprint(researchExtractionSourceText(base)),
    ...overrides,
  };
}

describe("the request a distillation task stores", () => {
  it("needs a material, and defaults the optional dedupe key", () => {
    expect(researchExtractionRequestSchema.parse({ materialId: "m1" })).toEqual({
      materialId: "m1",
      idempotencyKey: "",
    });
    expect(researchExtractionRequestSchema.safeParse({ materialId: "   " }).success).toBe(false);
    // A hand-written `runs` row without the id must be refused, not run against an empty material.
    expect(researchExtractionRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("the answer the model must produce", () => {
  it("refuses an answer that is missing a field, and keeps a complete one", () => {
    expect(researchExtractionOutputSchema.safeParse(output()).success).toBe(true);
    expect(researchExtractionOutputSchema.safeParse({ summary: "只有摘要" }).success).toBe(false);
    // The three outputs are separate fields: an answer that merges them is not this schema.
    expect(
      researchExtractionOutputSchema.safeParse({ ...output(), topicSuggestions: ["夜市选品"] }).success,
    ).toBe(false);
  });

  it("treats an answer with nothing usable in it as empty", () => {
    expect(researchExtractionIsEmpty(output())).toBe(false);
    expect(
      researchExtractionIsEmpty({
        summary: " ",
        keyPoints: [],
        facts: [],
        quotes: [],
        topicSuggestions: [],
      }),
    ).toBe(true);
  });
});

describe("whether an excerpt is really in the material", () => {
  it("verifies an exact excerpt and refuses one the source does not contain", () => {
    expect(researchExtractionEvidenceLocator(material(), "夜市摊位比商场高 40%")).toEqual({
      verified: true,
      at: "",
    });
    expect(researchExtractionEvidenceLocator(material(), "客单价 25 元")).toEqual({ verified: false, at: "" });
    // Whitespace is not allowed to decide it: an excerpt the model re-wrapped across a line break is the
    // same words, and the source's own newline is where the two spellings differ.
    expect(researchExtractionEvidenceLocator(material(), "夜市摊位比商场高 40%。\n   夜市摊位平均").verified).toBe(
      true,
    );
    // Nor is a fragment the model assembled out of two real sentences.
    expect(researchExtractionEvidenceLocator(material(), "商场比夜市高 40%").verified).toBe(false);
  });

  it("refuses an excerpt too short to mean anything", () => {
    expect(researchExtractionEvidenceLocator(material(), "40%")).toEqual({ verified: false, at: "" });
    expect(researchExtractionEvidenceLocator(material(), "   ")).toEqual({ verified: false, at: "" });
  });

  it("locates a transcript excerpt in the media, at the mark the engine reported", () => {
    expect(researchExtractionEvidenceLocator(transcriptMaterial(), "夜市摊位平均每小时出单 12 杯。")).toEqual({
      verified: true,
      // The app's own timestamp format, used exactly as a transcript view shows a segment.
      at: "00:00:04",
    });
    // A page has no marks to give, so a verified page excerpt carries an empty `at` - never `00:00`.
    expect(researchExtractionEvidenceLocator(material(), sourceText)).toEqual({ verified: true, at: "" });
  });

  it("verifies against the stored text a generation reads, nothing else", () => {
    expect(researchExtractionSourceText(material({ content: `  ${sourceText}  ` }))).toBe(sourceText);
    // A transcript's segments are not read on top of `content`: the text is the record's own field.
    expect(researchExtractionSourceText(transcriptMaterial({ content: "只有这一句。" }))).toBe("只有这一句。");
    expect(
      researchExtractionEvidenceLocator(transcriptMaterial({ content: "只有这一句。" }), "夜市摊位平均每小时出单 12 杯。")
        .verified,
    ).toBe(false);
  });
});

describe("whether a stored result is older than the material", () => {
  it("compares fingerprints, so an edit after the run is visible", () => {
    const stored = record();

    expect(researchExtractionIsStale(stored, material())).toBe(false);
    expect(researchExtractionIsStale(stored, material({ content: `${sourceText}\n补一句。` }))).toBe(true);
    // The same characters in a different order are a different text.
    expect(researchExtractionSourceFingerprint("ab")).not.toBe(researchExtractionSourceFingerprint("ba"));
    expect(researchExtractionSourceFingerprint(sourceText)).toBe(researchExtractionSourceFingerprint(sourceText));
  });
});

describe("how one version relates to the one it replaced", () => {
  it("keeps the replaced version, newest first, and never invents one", () => {
    const first = record();
    const second = record({ revision: 2, taskId: "task-2" });

    expect(nextResearchExtractionRevision(null)).toBe(1);
    expect(nextResearchExtractionRevision(first)).toBe(2);
    expect(researchExtractionHistoryWith(null, [], 1)).toEqual([]);
    expect(researchExtractionHistoryWith(first, [], 2)).toEqual([first]);
    // A version that replaced a version keeps both, newest first.
    expect(researchExtractionHistoryWith(second, [first], 3)).toEqual([second, first]);
  });

  it("caps the history and does not push one version in twice", () => {
    const versions = [1, 2, 3, 4, 5, 6].map((revision) => record({ revision, taskId: `task-${revision}` }));
    const history = versions.slice(0, 5).reverse();
    const current = versions[5];

    expect(researchExtractionHistoryWith(current, history, 7)).toHaveLength(5);
    // Re-saving the current version (a doubly executed run) adds nothing: the same revision is not a
    // second version, so the history it leaves behind is the one that was already there.
    expect(researchExtractionHistoryWith(current, history, current.revision)).toEqual(history);
  });

  it("reads back only what it can read", () => {
    const stored = record();
    expect(parseResearchExtraction(JSON.stringify(stored))).toEqual(stored);
    expect(parseResearchExtraction("")).toBeNull();
    expect(parseResearchExtraction("{not json")).toBeNull();
    expect(parseResearchExtraction(JSON.stringify({ revision: 1 }))).toBeNull();

    expect(parseResearchExtractionHistory(JSON.stringify([stored]))).toEqual([stored]);
    expect(parseResearchExtractionHistory(JSON.stringify([stored, { revision: 9 }]))).toEqual([stored]);
    expect(parseResearchExtractionHistory("[]")).toEqual([]);
    expect(parseResearchExtractionHistory("nope")).toEqual([]);
  });
});

describe("what a run sends the model", () => {
  it("carries the material's own text, labelled, and never summarises it on the way in", () => {
    const prompt = researchExtractionSourcePromptText(material());

    expect(prompt).toContain("研究素材：夏季冰饮动销报告");
    expect(prompt).toContain("来源：https://example.com/research/summer-drinks");
    expect(prompt).toContain("素材类型：url");
    expect(prompt).toContain(`正文：\n${sourceText}`);
  });
});

describe("what a stored result becomes inside a writing prompt", () => {
  it("travels as a labelled digest with only the locatable facts and quotes", () => {
    const block = researchExtractionPromptText(record(), material());

    // The digest says what it is, and which version of itself it is.
    expect(block).toContain("AI 提炼自同一份素材，非素材原文；第 1 版");
    expect(block).toContain("摘要：夜市比商场更好卖");
    expect(block).toContain("- 七点以后是高峰");
    // A fact whose excerpt is in the material travels with that excerpt, so the writer can trace it.
    expect(block).toContain("- 夜市摊位比商场高 40%（原文：夜市摊位比商场高 40%）");
    expect(block).toContain("- 七点以后冰饮最好卖");
    // The fact the model could not source is left out, and the omission is stated rather than silent.
    expect(block).not.toContain("客单价 25 元");
    expect(block).toContain("另有 1 条事实在素材原文中找不到对应片段，已省略");
    expect(block).not.toContain("这段话在素材里没有出现过");
  });

  it("never carries a topic suggestion, because a suggestion is not a source fact", () => {
    const block = researchExtractionPromptText(record(), material());

    expect(block).not.toContain("夜市冰饮选品指南");
    expect(block).not.toContain("素材里的出单数据支持这个方向");
  });

  it("caps what it carries, so a long result cannot become the whole prompt", () => {
    const many = record({
      keyPoints: Array.from({ length: 12 }, (_entry, index) => `观点 ${index + 1}`),
      facts: Array.from({ length: 20 }, (_entry, index) => ({
        statement: `事实 ${index + 1}`,
        evidence: "夜市摊位比商场高 40%",
      })),
      quotes: Array.from({ length: 12 }, () => "七点以后冰饮最好卖"),
    });
    const block = researchExtractionPromptText(many, material());

    expect(block).toContain("观点 6");
    expect(block).not.toContain("观点 7");
    expect(block).toContain("事实 8");
    expect(block).not.toContain("事实 9");
    expect(block.match(/七点以后冰饮最好卖/g)?.length).toBe(5);
  });
});
