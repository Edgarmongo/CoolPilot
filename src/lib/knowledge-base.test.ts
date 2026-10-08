import { describe, expect, it } from "vitest";
import {
  buildKnowledgeFromProduct,
  guessKnowledgeCategory,
  knowledgeCharacterCount,
  parseKnowledgeFromRawText,
} from "./knowledge-base";
import type { ProductRecord } from "./types";

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
