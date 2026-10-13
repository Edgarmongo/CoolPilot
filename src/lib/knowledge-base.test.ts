import { describe, expect, it } from "vitest";
import {
  buildKnowledgeFromProduct,
  compareSemanticMatches,
  guessKnowledgeCategory,
  knowledgeCharacterCount,
  parseKnowledgeFromRawText,
  selectSemanticKnowledgeReferences,
} from "./knowledge-base";
import type { KnowledgeBaseRecord, ProductRecord } from "./types";

/**
 * The semantic ranking of CI-EMB-01 (D6), pinned as a rule rather than as a sorted array.
 *
 * D6 is specific about the order of the steps and about what may *not* decide them, so each case below is one of
 * those promises: the two existing filters still come first, only compatible and current vectors are compared, a
 * record is scored by its best chunk, one record appears once, and near-ties are decided by the business factors
 * a user set - never by a floating-point difference.
 */
function entry(overrides: Partial<KnowledgeBaseRecord> & { id: string }): KnowledgeBaseRecord {
  return {
    title: overrides.id,
    content: `${overrides.id} 的正文`,
    category: "product",
    weight: "medium",
    enabled: true,
    origin: "manual",
    tags: [],
    sourceUrl: "",
    fileName: "",
    positionId: "",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const sourceHashOf = (record: KnowledgeBaseRecord) => `hash:${record.id}`;
const target = { providerId: "qwen", modelId: "text-embedding-v4" };

function chunk(knowledgeId: string, chunkIndex: number, vector: number[], overrides: Record<string, unknown> = {}) {
  return { knowledgeId, chunkIndex, vector, sourceHash: `hash:${knowledgeId}`, ...target, ...overrides };
}

function select(
  entries: KnowledgeBaseRecord[],
  chunks: ReturnType<typeof chunk>[],
  queryVector: number[],
  extra: { positioningId?: string | null } = {},
) {
  return selectSemanticKnowledgeReferences({ entries, chunks, queryVector, sourceHashOf, target, ...extra });
}

describe("knowledge base helpers", () => {
  it("counts non-whitespace characters for the size column", () => {
    expect(knowledgeCharacterCount("a b\nc")).toBe(3);
    expect(knowledgeCharacterCount("   ")).toBe(0);
  });

  it("guesses a category from keywords and falls back to other", () => {
    expect(guessKnowledgeCategory("常见问题：如何退款")).toBe("faq");
    expect(guessKnowledgeCategory("蛋糕配方与配料")).toBe("formula");
    expect(guessKnowledgeCategory("品牌 slogan 与调性")).toBe("brand");
    expect(guessKnowledgeCategory("行业趋势洞察")).toBe("industry");
    expect(guessKnowledgeCategory("产品型号参数")).toBe("product");
    expect(guessKnowledgeCategory("参考资料汇编")).toBe("reference");
    expect(guessKnowledgeCategory("一些散落的内容")).toBe("other");
  });

  it("parses raw text using the first line as the title", () => {
    const draft = parseKnowledgeFromRawText("标题行\n正文第一段\n正文第二段");
    expect(draft.title).toBe("标题行");
    expect(draft.content).toBe("正文第一段\n正文第二段");
    expect(draft.weight).toBe("medium");
  });

  it("builds a knowledge entry from a product record", () => {
    const product: ProductRecord = {
      id: "p1",
      name: "HighlandSoar 足球",
      brand: "HighlandSoar",
      description: "专业比赛用球",
      category: "体育",
      keywords: ["足球", "比赛"],
      price: "199",
      imagePath: "",
      linkUrl: "https://example.com/p1",
      status: "active",
      createdAt: 0,
      updatedAt: 0,
    };
    const draft = buildKnowledgeFromProduct(product);
    expect(draft.title).toBe("HighlandSoar 足球");
    expect(draft.category).toBe("product");
    expect(draft.content).toContain("专业比赛用球");
    expect(draft.content).toContain("品牌：HighlandSoar");
    expect(draft.tags).toEqual(["HighlandSoar", "体育", "足球", "比赛"]);
  });
});

describe("semantic knowledge selection", () => {
  it("filters disabled entries and the positioning rule before any vector is compared", () => {
    const entries = [
      entry({ id: "a" }),
      entry({ id: "b", enabled: false }),
      entry({ id: "c", positionId: "other-position" }),
    ];
    const chunks = [chunk("a", 0, [1, 0]), chunk("b", 0, [1, 0]), chunk("c", 0, [1, 0])];

    const result = select(entries, chunks, [1, 0], { positioningId: "my-position" });
    expect(result.matches.map((match) => match.entry.id)).toEqual(["a"]);
    // The disabled entry and the other positioning's entry are not even counted as considered.
    expect(result.diagnostics.considered).toBe(1);
  });

  it("keeps an entry with no positioning applicable to every positioning", () => {
    const result = select([entry({ id: "shared" })], [chunk("shared", 0, [1, 0])], [1, 0], {
      positioningId: "p1",
    });
    expect(result.references).toEqual(["【shared】shared 的正文"]);
  });

  it("never compares vectors of another model, another dimension or a stale source", () => {
    const entries = [
      entry({ id: "other-model" }),
      entry({ id: "other-dim" }),
      entry({ id: "stale" }),
      entry({ id: "ok" }),
    ];
    const chunks = [
      chunk("other-model", 0, [1, 0], { modelId: "bge-m3" }),
      chunk("other-dim", 0, [1, 0, 0]),
      chunk("stale", 0, [1, 0], { sourceHash: "hash:old" }),
      chunk("ok", 0, [1, 0]),
    ];

    const result = select(entries, chunks, [1, 0]);
    expect(result.matches.map((match) => match.entry.id)).toEqual(["ok"]);
    expect(result.diagnostics.incompatibleVectors).toBe(2);
    expect(result.diagnostics.staleVectors).toBe(1);
  });

  it("scores a record by its best chunk and reports it once", () => {
    const entries = [entry({ id: "long" }), entry({ id: "short" })];
    const chunks = [
      chunk("long", 0, [0, 1]),
      chunk("long", 1, [0.2, 1]),
      chunk("long", 2, [1, 0]),
      chunk("short", 0, [0.6, 0.8]),
    ];

    const result = select(entries, chunks, [1, 0]);
    // `long` wins on its third chunk, and appears once: a record cannot fill the list with its own paragraphs.
    expect(result.matches.map((match) => match.entry.id)).toEqual(["long", "short"]);
    expect(result.matches[0].chunkIndex).toBe(2);
    expect(result.matches[0].similarity).toBeCloseTo(1);
  });

  it("decides a near-tie by weight, then recency - not by floating-point noise", () => {
    const entries = [
      entry({ id: "medium", weight: "medium" }),
      entry({ id: "high", weight: "high" }),
      entry({ id: "low", weight: "low" }),
    ];
    const chunks = [
      chunk("medium", 0, [1, 0.001]),
      chunk("high", 0, [1, 0.002]),
      chunk("low", 0, [1, 0.003]),
    ];

    const result = select(entries, chunks, [1, 0]);
    expect(result.matches.map((match) => match.entry.id)).toEqual(["high", "medium", "low"]);
    // The three similarities really are inside the documented tie window, so this is a test of the ranking rule
    // rather than one of cosine.
    const similarities = result.matches.map((match) => match.similarity);
    expect(Math.max(...similarities) - Math.min(...similarities)).toBeLessThan(0.02);
  });

  it("drops an entry whose only match is not positively similar", () => {
    const result = select([entry({ id: "unrelated" })], [chunk("unrelated", 0, [0, 1])], [1, 0]);
    expect(result.references).toEqual([]);
    expect(result.diagnostics.unrelated).toBe(1);
  });

  it("counts a record with no vectors separately from one that matched nothing", () => {
    const result = select([entry({ id: "unembedded" })], [], [1, 0]);
    expect(result.diagnostics.withoutCompatibleVectors).toBe(1);
    expect(result.diagnostics.unrelated).toBe(0);
  });

  it("compares two matches by the documented rule and nothing else", () => {
    const left = { entry: entry({ id: "a", weight: "high", updatedAt: 1 }), similarity: 0.5, chunkIndex: 0 };
    const right = { entry: entry({ id: "b", weight: "low", updatedAt: 2 }), similarity: 0.5, chunkIndex: 0 };
    // Inside the tie window the heavier entry wins, whatever the ids are...
    expect(compareSemanticMatches(left, right)).toBeLessThan(0);
    // ...and outside it, similarity wins over weight.
    expect(compareSemanticMatches({ ...left, similarity: 0.9 }, right)).toBeLessThan(0);
    expect(compareSemanticMatches(left, { ...right, similarity: 0.9 })).toBeGreaterThan(0);
  });
});
