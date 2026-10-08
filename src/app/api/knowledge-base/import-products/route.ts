import { createKnowledgeBase } from "@/db/repositories/knowledge-base";
import { listProducts } from "@/db/repositories/products";
import { fail, ok, parseJson } from "@/lib/api";
import { buildKnowledgeFromProduct } from "@/lib/knowledge-base";
import { knowledgeBaseProductImportSchema } from "@/lib/validation";
import type { KnowledgeBaseRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await parseJson(request, knowledgeBaseProductImportSchema);
  if (parsed.error) return fail("INVALID_PAYLOAD", 400, parsed.error);

  const { positionId, productIds } = parsed.data;
  const products = await listProducts();
  const selected = productIds.length ? products.filter((product) => productIds.includes(product.id)) : products;
  if (!selected.length) return fail("INVALID_PAYLOAD", 400, "no products");

  const created: KnowledgeBaseRecord[] = [];
  for (const product of selected) {
    const draft = buildKnowledgeFromProduct(product);
    const item = await createKnowledgeBase({ ...draft, origin: "product", positionId });
    if (item) created.push(item);
  }
  return ok({ items: created, count: created.length }, { status: 201 });
}
