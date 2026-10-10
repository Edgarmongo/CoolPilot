import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, ensureDatabase } from "@/db/client";
import { brands } from "@/db/schema";
import type { BrandRecord } from "@/lib/types";

/**
 * Brands (品牌资料, CI-P2-02 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The same shape as `@/db/repositories/topics` and `@/db/repositories/products`: a small local table
 * with four verbs and no service layer. Two decisions are worth naming:
 *
 * - Two list columns, both stored as JSON arrays like `products.keywords_json`, because the card's six
 *   fields are 关键词 *and* 禁用表达 - the first is what the article should say, the second what it
 *   must not.
 * - `updatedAt` is the row's version, not decoration: the generation entry copies it into the
 *   article's `metadata.brandVersion`, so an article can be told apart from a later edit of the brand
 *   it was written with (P2-02-04).
 *
 * This table is deliberately *not* `app_settings["brand"]`: that singleton is the console/agent brand
 * (logo, colors, the local agent's system prompt), it holds exactly one record, and P2-02 needs a
 * selectable library of several. See the appendix B-6 note in the integration plan.
 */

function now() {
  return Date.now();
}

function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toBrand(row: typeof brands.$inferSelect): BrandRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    targetAudience: row.targetAudience,
    tone: row.tone,
    keywords: parseList(row.keywordsJson),
    bannedWords: parseList(row.bannedWordsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listBrands() {
  await ensureDatabase();
  return (await db.select().from(brands).orderBy(desc(brands.updatedAt))).map(toBrand);
}

export async function getBrand(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(brands).where(eq(brands.id, id)).limit(1);
  return row ? toBrand(row) : null;
}

export async function createBrand(input: {
  name: string;
  description?: string;
  targetAudience?: string;
  tone?: string;
  keywords?: string[];
  bannedWords?: string[];
}) {
  await ensureDatabase();
  const id = nanoid();
  const createdAt = now();
  await db.insert(brands).values({
    id,
    name: input.name,
    description: input.description ?? "",
    targetAudience: input.targetAudience ?? "",
    tone: input.tone ?? "",
    keywordsJson: JSON.stringify(input.keywords ?? []),
    bannedWordsJson: JSON.stringify(input.bannedWords ?? []),
    createdAt,
    updatedAt: createdAt,
  });
  return getBrand(id);
}

export async function updateBrand(id: string, patch: Partial<Omit<BrandRecord, "id" | "createdAt">>) {
  await ensureDatabase();
  await db
    .update(brands)
    .set({
      name: patch.name,
      description: patch.description,
      targetAudience: patch.targetAudience,
      tone: patch.tone,
      keywordsJson: patch.keywords ? JSON.stringify(patch.keywords) : undefined,
      bannedWordsJson: patch.bannedWords ? JSON.stringify(patch.bannedWords) : undefined,
      updatedAt: now(),
    })
    .where(eq(brands.id, id));
  return getBrand(id);
}

export async function deleteBrand(id: string) {
  await ensureDatabase();
  await db.delete(brands).where(eq(brands.id, id));
}
