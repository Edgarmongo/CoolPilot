import { describe, expect, it } from "vitest";
import { productImageFileName, productImageUrl, productMatchesQuery } from "./products";
import type { ProductRecord } from "./types";

function makeProduct(patch: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: "p1",
    name: "HighlandSoar 足球",
    brand: "HighlandSoar",
    description: "",
    category: "体育",
    keywords: ["足球", "比赛"],
    price: "",
    imagePath: "",
    linkUrl: "",
    status: "active",
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

describe("product helpers", () => {
  it("resolves the stored file name across separators", () => {
    expect(productImageFileName("C:\\data\\uploads\\product-images\\a.png")).toBe("a.png");
    expect(productImageFileName("/data/uploads/product-images/b.jpg")).toBe("b.jpg");
    expect(productImageFileName("")).toBe("");
  });

  it("builds a served, cache-busted image URL only when a path exists", () => {
    expect(productImageUrl("C:\\x\\product-images\\a.png")).toBe("/api/products/image?file=a.png");
    expect(productImageUrl("/x/product-images/a.png", 123)).toBe("/api/products/image?file=a.png&v=123");
    expect(productImageUrl("")).toBe("");
  });

  it("matches by name, brand or keyword", () => {
    const product = makeProduct();
    expect(productMatchesQuery(product, "")).toBe(true);
    expect(productMatchesQuery(product, "足球")).toBe(true);
    expect(productMatchesQuery(product, "highland")).toBe(true);
    expect(productMatchesQuery(product, "比赛")).toBe(true);
    expect(productMatchesQuery(product, "篮球")).toBe(false);
  });
});
