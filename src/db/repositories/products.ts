import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, ensureDatabase } from "@/db/client";
import { products } from "@/db/schema";
import type { ProductRecord, ProductStatus } from "@/lib/types";

function now() {
  return Date.now();
}

function parseKeywords(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toProduct(row: typeof products.$inferSelect): ProductRecord {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    description: row.description,
    category: row.category,
    keywords: parseKeywords(row.keywordsJson),
    price: row.price,
    imagePath: row.imagePath,
    linkUrl: row.linkUrl,
    status: row.status as ProductStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listProducts() {
  await ensureDatabase();
  return (await db.select().from(products).orderBy(desc(products.updatedAt))).map(toProduct);
}

export async function getProduct(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return row ? toProduct(row) : null;
}

export async function createProduct(input: {
  name: string;
  brand?: string;
  description?: string;
  category?: string;
  keywords?: string[];
  price?: string;
  imagePath?: string;
  linkUrl?: string;
  status?: ProductStatus;
}) {
  await ensureDatabase();
  const id = nanoid();
  const createdAt = now();
  await db.insert(products).values({
    id,
    name: input.name,
    brand: input.brand ?? "",
    description: input.description ?? "",
    category: input.category ?? "",
    keywordsJson: JSON.stringify(input.keywords ?? []),
    price: input.price ?? "",
    imagePath: input.imagePath ?? "",
    linkUrl: input.linkUrl ?? "",
    status: input.status ?? "active",
    createdAt,
    updatedAt: createdAt,
  });
  return getProduct(id);
}

export async function updateProduct(id: string, patch: Partial<Omit<ProductRecord, "id" | "createdAt">>) {
  await ensureDatabase();
  await db
    .update(products)
    .set({
      name: patch.name,
      brand: patch.brand,
      description: patch.description,
      category: patch.category,
      keywordsJson: patch.keywords ? JSON.stringify(patch.keywords) : undefined,
      price: patch.price,
      imagePath: patch.imagePath,
      linkUrl: patch.linkUrl,
      status: patch.status,
      updatedAt: now(),
    })
    .where(eq(products.id, id));
  return getProduct(id);
}

export async function deleteProduct(id: string) {
  await ensureDatabase();
  await db.delete(products).where(eq(products.id, id));
}
