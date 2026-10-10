import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, ensureDatabase } from "@/db/client";
import { topics } from "@/db/schema";
import type { TopicRecord, TopicStatus } from "@/lib/types";

/**
 * Topics (选题, CI-P2-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The same shape as `@/db/repositories/products`: a small local table with four verbs, no service
 * layer, because nothing here is worth one. Two decisions are worth naming:
 *
 * - Keywords are stored as a JSON array like `products.keywords_json`, so the column set stays
 *   identical to the module this one is modelled on.
 * - `linkTopicContentItem` is a separate write from `updateTopic`, because it is not an edit the user
 *   makes: it is what the generation entry records *after* an article exists (P2-01-05). It
 *   overwrites the previous link on purpose - regenerating from the same topic names the newest
 *   article, which is the one the topic list should offer to open.
 */

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

function toTopic(row: typeof topics.$inferSelect): TopicRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    keywords: parseKeywords(row.keywordsJson),
    source: row.source,
    sourceUrl: row.sourceUrl,
    status: row.status as TopicStatus,
    contentItemId: row.contentItemId ?? null,
    // CI-P3-03: which material a distilled suggestion came from; `""` is "the user's own idea".
    researchMaterialId: row.researchMaterialId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listTopics() {
  await ensureDatabase();
  return (await db.select().from(topics).orderBy(desc(topics.updatedAt))).map(toTopic);
}

export async function getTopic(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(topics).where(eq(topics.id, id)).limit(1);
  return row ? toTopic(row) : null;
}

export async function createTopic(input: {
  title: string;
  description?: string;
  keywords?: string[];
  source?: string;
  sourceUrl?: string;
  status?: TopicStatus;
  /**
   * The research material a distilled suggestion came from (CI-P3-03). Optional, and empty for every
   * caller that is not turning a 选题建议 into a topic - which is why a topic created here and one
   * created by the topic dialog are the same kind of row.
   */
  researchMaterialId?: string;
}) {
  await ensureDatabase();
  const id = nanoid();
  const createdAt = now();
  await db.insert(topics).values({
    id,
    title: input.title,
    description: input.description ?? "",
    keywordsJson: JSON.stringify(input.keywords ?? []),
    source: input.source ?? "manual",
    sourceUrl: input.sourceUrl ?? "",
    status: input.status ?? "active",
    contentItemId: null,
    researchMaterialId: input.researchMaterialId ?? "",
    createdAt,
    updatedAt: createdAt,
  });
  return getTopic(id);
}

export async function updateTopic(id: string, patch: Partial<Omit<TopicRecord, "id" | "createdAt">>) {
  await ensureDatabase();
  await db
    .update(topics)
    .set({
      title: patch.title,
      description: patch.description,
      keywordsJson: patch.keywords ? JSON.stringify(patch.keywords) : undefined,
      source: patch.source,
      sourceUrl: patch.sourceUrl,
      status: patch.status,
      contentItemId: patch.contentItemId,
      // A user may not move a topic's origin by editing it: the material link is written once, when the
      // topic is created from a suggestion, and `updateTopic` deliberately does not take it.
      updatedAt: now(),
    })
    .where(eq(topics.id, id));
  return getTopic(id);
}

export async function deleteTopic(id: string) {
  await ensureDatabase();
  await db.delete(topics).where(eq(topics.id, id));
}

/**
 * Records the article a topic produced. Answers `null` for a topic that is gone instead of creating
 * one: a generation that outlived its topic must not resurrect it.
 */
export async function linkTopicContentItem(topicId: string, contentItemId: string) {
  await ensureDatabase();
  const current = await getTopic(topicId);
  if (!current) return null;
  await db
    .update(topics)
    .set({ contentItemId, updatedAt: now() })
    .where(eq(topics.id, topicId));
  return getTopic(topicId);
}
