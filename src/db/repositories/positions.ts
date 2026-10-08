import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, ensureDatabase } from "@/db/client";
import { positions } from "@/db/schema";
import { normalizePositionDraft } from "@/lib/positions";
import type { PositionDraft, PositionRecord } from "@/lib/types";

const FALLBACK_NAME = "未命名定位";

function now() {
  return Date.now();
}

function parseDraft(valueJson: string): PositionDraft {
  try {
    return normalizePositionDraft(JSON.parse(valueJson));
  } catch {
    return normalizePositionDraft({});
  }
}

function toPosition(row: typeof positions.$inferSelect): PositionRecord {
  return {
    id: row.id,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...parseDraft(row.dataJson),
  };
}

export async function listPositions(): Promise<PositionRecord[]> {
  await ensureDatabase();
  const rows = await db
    .select()
    .from(positions)
    .orderBy(desc(positions.isDefault), desc(positions.updatedAt));
  return rows.map(toPosition);
}

export async function getPosition(id: string): Promise<PositionRecord | null> {
  await ensureDatabase();
  const [row] = await db.select().from(positions).where(eq(positions.id, id)).limit(1);
  return row ? toPosition(row) : null;
}

export async function getDefaultPosition(): Promise<PositionRecord | null> {
  await ensureDatabase();
  const [row] = await db
    .select()
    .from(positions)
    .orderBy(desc(positions.isDefault), desc(positions.updatedAt))
    .limit(1);
  return row ? toPosition(row) : null;
}

export async function createPosition(input: Partial<PositionDraft> = {}): Promise<PositionRecord | null> {
  await ensureDatabase();
  const draft = normalizePositionDraft({ ...input, name: input.name ?? "" });
  const id = nanoid();
  const createdAt = now();
  const existing = await db.select({ id: positions.id }).from(positions).limit(1);
  await db.insert(positions).values({
    id,
    name: draft.name || FALLBACK_NAME,
    isDefault: existing.length === 0,
    dataJson: JSON.stringify(draft),
    createdAt,
    updatedAt: createdAt,
  });
  return getPosition(id);
}

export async function updatePosition(id: string, patch: Partial<PositionDraft>): Promise<PositionRecord | null> {
  await ensureDatabase();
  const current = await getPosition(id);
  if (!current) return null;
  const merged = normalizePositionDraft({
    ...current,
    ...patch,
    store: { ...current.store, ...(patch.store ?? {}) },
  });
  await db
    .update(positions)
    .set({ name: merged.name || FALLBACK_NAME, dataJson: JSON.stringify(merged), updatedAt: now() })
    .where(eq(positions.id, id));
  return getPosition(id);
}

export async function setDefaultPosition(id: string): Promise<PositionRecord | null> {
  await ensureDatabase();
  const target = await getPosition(id);
  if (!target) return null;
  await db.update(positions).set({ isDefault: false }).where(eq(positions.isDefault, true));
  await db.update(positions).set({ isDefault: true, updatedAt: now() }).where(eq(positions.id, id));
  return getPosition(id);
}

export async function deletePosition(id: string): Promise<void> {
  await ensureDatabase();
  const [row] = await db.select().from(positions).where(eq(positions.id, id)).limit(1);
  if (!row) return;
  await db.delete(positions).where(eq(positions.id, id));
  if (row.isDefault) {
    const [next] = await db.select({ id: positions.id }).from(positions).orderBy(desc(positions.updatedAt)).limit(1);
    if (next) await db.update(positions).set({ isDefault: true }).where(eq(positions.id, next.id));
  }
}

/** Seeds the "默认定位" record on first load so the console always has an active positioning. */
export async function ensureDefaultPosition(): Promise<PositionRecord | null> {
  await ensureDatabase();
  const [row] = await db.select({ id: positions.id }).from(positions).limit(1);
  if (row) return getDefaultPosition();
  return createPosition({ name: "默认定位" });
}

export async function listPublishedPositions(): Promise<PositionRecord[]> {
  const all = await listPositions();
  return all.filter((position) => position.store.status === "published");
}
