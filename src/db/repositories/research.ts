import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, ensureDatabase } from "@/db/client";
import { researchMaterials } from "@/db/schema";
import { isResearchMaterialKind, isResearchMaterialStatus, derivedResearchStatus } from "@/lib/research";
import {
  parseResearchExtraction,
  parseResearchExtractionHistory,
  researchExtractionHistoryWith,
  researchExtractionRecordSchema,
  type ResearchExtractionRecord,
} from "@/lib/research-extraction/extraction";
import { parseTranscriptMetadata, transcriptMetadataSchema } from "@/lib/transcription/transcription";
import type { ResearchMaterialRecord } from "@/lib/types";

/**
 * Research materials (研究素材, CI-P3-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The same shape as `@/db/repositories/topics` and `@/db/repositories/knowledge-base`: a small local
 * table with four verbs and no service layer. Two decisions are worth naming:
 *
 * - `recordResearchFetch` is a separate write from `updateResearchMaterial`, because it is not an edit a
 *   user makes: it is what reading a source actually produced (content, status, why, `og:image`,
 *   `fetchedAt`). Keeping it apart is what makes it hard to write a status the reading did not reach.
 * - `status` is never derived here either. Whatever the caller read, it is stored as it came - an empty
 *   `content` with `status: "ready"` stays exactly that, and the two are not allowed to overwrite each
 *   other's meaning.
 */

function now() {
  return Date.now();
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toResearchMaterial(row: typeof researchMaterials.$inferSelect): ResearchMaterialRecord {
  return {
    id: row.id,
    title: row.title,
    kind: isResearchMaterialKind(row.kind) ? row.kind : "text",
    content: row.content,
    sourceUrl: row.sourceUrl,
    status: isResearchMaterialStatus(row.status) ? row.status : "draft",
    statusMessage: row.statusMessage,
    imageUrl: row.imageUrl,
    fileName: row.fileName,
    tags: parseTags(row.tagsJson),
    fetchedAt: row.fetchedAt ?? null,
    // A row written by another build, or one that never came from a transcription, reads back as `null`
    // rather than as a half-parsed object.
    transcript: parseTranscriptMetadata(row.transcriptJson),
    // The distillation (CI-P3-03) reads back the same way a transcript does: a row written by another
    // build - or one nobody has distilled - is `null` / `[]` rather than a half-parsed object.
    extraction: parseResearchExtraction(row.extractionJson),
    extractionHistory: parseResearchExtractionHistory(row.extractionHistoryJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type ResearchMaterialInput = {
  title: string;
  kind?: ResearchMaterialRecord["kind"];
  content?: string;
  sourceUrl?: string;
  status?: ResearchMaterialRecord["status"];
  statusMessage?: string;
  imageUrl?: string;
  fileName?: string;
  tags?: string[];
  fetchedAt?: number | null;
  /**
   * What a transcription recorded about this material (CI-P3-02), already serialised by the caller that
   * ran the engine. `""` (the default) means "this material is not a transcript", which is the state of
   * every material created by CI-P3-01's import paths.
   */
  transcriptJson?: string;
};

/** Serialises the structured transcript a caller can hand in, so a bad one is refused at the door. */
function transcriptJsonValue(transcript: ResearchMaterialRecord["transcript"]): string {
  return transcript ? JSON.stringify(transcriptMetadataSchema.parse(transcript)) : "";
}

export async function listResearchMaterials() {
  await ensureDatabase();
  return (await db.select().from(researchMaterials).orderBy(desc(researchMaterials.updatedAt))).map(
    toResearchMaterial,
  );
}

export async function getResearchMaterial(id: string) {
  await ensureDatabase();
  const [row] = await db.select().from(researchMaterials).where(eq(researchMaterials.id, id)).limit(1);
  return row ? toResearchMaterial(row) : null;
}

export async function createResearchMaterial(input: ResearchMaterialInput) {
  await ensureDatabase();
  const id = nanoid();
  const createdAt = now();
  // A record nobody has read yet is `draft`; a record with text is `ready`. Nothing is ever created
  // `failed` or `empty`: those are outcomes of a read, and a create is not one.
  const status = input.status ?? derivedResearchStatus(input.content ?? "");
  await db.insert(researchMaterials).values({
    id,
    title: input.title,
    kind: input.kind ?? "text",
    content: input.content ?? "",
    sourceUrl: input.sourceUrl ?? "",
    status,
    statusMessage: input.statusMessage ?? "",
    imageUrl: input.imageUrl ?? "",
    fileName: input.fileName ?? "",
    tagsJson: JSON.stringify(input.tags ?? []),
    fetchedAt: input.fetchedAt ?? null,
    transcriptJson: input.transcriptJson ?? "",
    createdAt,
    updatedAt: createdAt,
  });
  return getResearchMaterial(id);
}

export async function updateResearchMaterial(
  id: string,
  // `extraction` / `extractionHistory` are left out on purpose: they are written by
  // `saveResearchExtraction()` (a run's result) and `updateResearchExtraction()` (the user's edit of it),
  // and no general edit may move them - the same separation `recordResearchFetch()` keeps for a read.
  patch: Partial<Omit<ResearchMaterialRecord, "id" | "createdAt" | "extraction" | "extractionHistory">>,
) {
  await ensureDatabase();
  await db
    .update(researchMaterials)
    .set({
      title: patch.title,
      kind: patch.kind,
      content: patch.content,
      sourceUrl: patch.sourceUrl,
      status: patch.status,
      statusMessage: patch.statusMessage,
      imageUrl: patch.imageUrl,
      fileName: patch.fileName,
      tagsJson: patch.tags ? JSON.stringify(patch.tags) : undefined,
      fetchedAt: patch.fetchedAt,
      // An edit that says nothing about the transcript leaves the stored one alone; saying `null` clears
      // it, which is how a material stops being a transcript without being deleted. (A caller that wants
      // to store raw JSON without parsing it uses `recordResearchFetch`, which is the engine's own entry.)
      transcriptJson: patch.transcript === undefined ? undefined : transcriptJsonValue(patch.transcript),
      updatedAt: now(),
    })
    .where(eq(researchMaterials.id, id));
  return getResearchMaterial(id);
}

export async function deleteResearchMaterial(id: string) {
  await ensureDatabase();
  await db.delete(researchMaterials).where(eq(researchMaterials.id, id));
}

/**
 * Records what reading a source produced. Answers `null` for a material that is gone instead of creating
 * one: a read that outlived its row must not resurrect it (the same rule `linkTopicContentItem` follows).
 */
export async function recordResearchFetch(
  id: string,
  result: {
    status: ResearchMaterialRecord["status"];
    content?: string;
    statusMessage?: string;
    imageUrl?: string;
    sourceUrl?: string;
    fetchedAt?: number | null;
    /**
     * What the transcription recorded (CI-P3-02), as JSON. Present means "replace the stored transcript
     * with this one", because a second recognition of the same file must not leave two sets of segments
     * on one material.
     */
    transcriptJson?: string;
  },
) {
  await ensureDatabase();
  const current = await getResearchMaterial(id);
  if (!current) return null;
  await db
    .update(researchMaterials)
    .set({
      content: result.content ?? current.content,
      status: result.status,
      statusMessage: result.statusMessage ?? "",
      imageUrl: result.imageUrl ?? current.imageUrl,
      sourceUrl: result.sourceUrl ?? current.sourceUrl,
      // A successful read stamps when it happened; a failed one is not allowed to move it.
      fetchedAt: result.fetchedAt ?? current.fetchedAt,
      // Not `?? current`: a caller that ran a transcription replaces the stored segments, and a caller
      // that did not mention a transcript leaves the existing one untouched.
      transcriptJson: result.transcriptJson === undefined ? undefined : result.transcriptJson,
      updatedAt: now(),
    })
    .where(eq(researchMaterials.id, id));
  return getResearchMaterial(id);
}

/**
 * Stores what a distillation run produced (CI-P3-03).
 *
 * Two rules are the whole of this entry:
 *
 * - **A new version replaces without erasing.** The version that was current is pushed into the history
 *   by `researchExtractionHistoryWith()`, so "第 2 版替换了第 1 版" is readable afterwards instead of
 *   being an event nobody kept. A regeneration therefore always *adds* to the record; nothing is lost.
 * - **Only the extraction columns move.** `content`, `status`, `statusMessage`, `fetchedAt` and
 *   `transcript_json` are not in the update at all, which is what makes 「原始正文和转录分段不会被摘要覆盖」
 *   a property of the code rather than a promise in a comment.
 *
 * Answers `null` for a material that is gone instead of creating one - a run that outlived its row must
 * not resurrect it (the same rule `recordResearchFetch()` follows).
 */
export async function saveResearchExtraction(materialId: string, extraction: ResearchExtractionRecord) {
  await ensureDatabase();
  const current = await getResearchMaterial(materialId);
  if (!current) return null;
  const history = researchExtractionHistoryWith(current.extraction, current.extractionHistory, extraction.revision);
  await db
    .update(researchMaterials)
    .set({
      // Validated at the door: a half-formed record is refused here rather than stored and misread.
      extractionJson: JSON.stringify(researchExtractionRecordSchema.parse(extraction)),
      extractionHistoryJson: JSON.stringify(history),
      updatedAt: now(),
    })
    .where(eq(researchMaterials.id, materialId));
  return getResearchMaterial(materialId);
}

/** The fields a user owns in a stored extraction; everything else is the run's own record. */
export type ResearchExtractionEdit = Partial<
  Pick<ResearchExtractionRecord, "summary" | "keyPoints" | "facts" | "quotes" | "topicSuggestions">
>;

/**
 * Saves the user's edit of the *current* version (P3-03-05).
 *
 * What an edit may not do is equally the point: it cannot change `revision`, `taskId`, `model` or
 * `generatedAt`, because those say which run produced this version and no edit produced one. It stamps
 * `editedAt` instead, so "AI 写的" and "人改过的" stay two facts of the same record. A material with no
 * extraction (or none any more) answers `null`: there is nothing to edit, and inventing a version from a
 * patch would be exactly the kind of phantom result this card refuses.
 */
export async function updateResearchExtraction(materialId: string, patch: ResearchExtractionEdit) {
  await ensureDatabase();
  const current = await getResearchMaterial(materialId);
  if (!current?.extraction) return null;
  const next = researchExtractionRecordSchema.parse({
    ...current.extraction,
    ...patch,
    editedAt: now(),
  });
  await db
    .update(researchMaterials)
    .set({ extractionJson: JSON.stringify(next), updatedAt: now() })
    .where(eq(researchMaterials.id, materialId));
  return getResearchMaterial(materialId);
}
