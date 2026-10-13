import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db, ensureDatabase, sqlite } from "@/db/client";
import { contentItems } from "@/db/schema";
import type { ContentStatus } from "@/lib/types";

/**
 * The two reads 质量与优化 (CI-P7-04) needs that no existing reader answers, and nothing else.
 *
 * They live together because they are the *adoption* half of that tab and they must be read against
 * exactly the same window: the count is the denominator, the id list is what the money is attributed
 * to, and a second window rule between them would let the unit cost divide one window's cost by
 * another window's outputs.
 *
 * Deliberate limits, both of them visible in the answer rather than silent:
 *
 *  - the status count is a **database aggregate**, like the budget's spend read (CI-P7-03-A), so it
 *    cannot hit a row ceiling and cannot report a partial count as a total;
 *  - the id list and the metadata scan *are* row reads, so both take a cap and the caller is told when
 *    it was reached (`qualityAdoptedOutputLimit` / `qualityContentScanLimit`). A window of thousands of
 *    adopted outputs is not what this is built for; a workspace where it happens should see a floor.
 */

/**
 * Every status `content_items.status` may hold, locally spelled out.
 *
 * Not imported from `@/db/repository`, where the same list is module-private: this is a *write-time*
 * vocabulary and the only thing this module does with it is initialize a count. Typing the zeroed
 * record as `Record<ContentStatus, number>` is what keeps this honest - a new status in the union breaks
 * the literal here at compile time instead of being counted out of the picture.
 */
const contentStatusVocabulary = ["draft", "ready", "posted", "failed"] as const satisfies readonly ContentStatus[];

/** How many content items one metadata scan may read before the edit counts become floors. */
export const qualityContentScanLimit = 5000;

function zeroedStatusCounts(): Record<ContentStatus, number> {
  return { draft: 0, ready: 0, posted: 0, failed: 0 };
}

/**
 * How many content items were **created** in `[from, to]`, per status.
 *
 * Created, not updated: 「本窗口产出了多少内容、其中多少被采用」 is a question about outputs, and an
 * item written last month that was published today is not an output of this window in any sense a
 * reader would recognise. The consequence - a month-old draft published this week counts in neither
 * half - is stated on the page instead of being papered over with `updated_at`.
 */
export async function countContentItemsByStatus(input: {
  from: number;
  to: number;
}): Promise<Record<ContentStatus, number>> {
  await ensureDatabase();
  const answer = await sqlite.execute({
    sql: `SELECT status, COUNT(*) AS total FROM content_items WHERE created_at >= ? AND created_at <= ? GROUP BY status`,
    args: [input.from, input.to],
  });
  const counts = zeroedStatusCounts();
  for (const row of answer.rows) {
    const status = String(row.status ?? "");
    if (!(contentStatusVocabulary as readonly string[]).includes(status)) continue;
    counts[status as ContentStatus] = Number(row.total ?? 0);
  }
  return counts;
}

/**
 * The ids of the window's adopted outputs (`status = 'posted'`, created inside the window), so the
 * window's money can be attributed to the calls that named them.
 *
 * Capped by `limit`, and the caller compares the answer's length with the counted `posted` total to
 * decide whether the attribution is complete. Ids only: nothing here reads a title or a body.
 */
export async function listAdoptedContentItemIds(input: {
  from: number;
  to: number;
  limit: number;
}): Promise<string[]> {
  await ensureDatabase();
  const rows = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(
      and(
        gte(contentItems.createdAt, input.from),
        lte(contentItems.createdAt, input.to),
        // The one state that means the item was actually published (`content-lifecycle` maps it to its
        // `published` stage, and the publish-verify path is what writes it).
        eq(contentItems.status, "posted"),
      ),
    )
    .orderBy(asc(contentItems.createdAt))
    .limit(Math.max(1, Math.floor(input.limit)));
  return rows.map((row) => row.id);
}

/**
 * Content items whose own `updated_at` falls inside the window, with their metadata.
 *
 * `updated_at` is the item-level write stamp, and every write through `updateContentItem` bumps it -
 * which is exactly why it is the right *scan* filter and the wrong *measurement*: it cannot say what
 * was written. The measurement is the version's own `updatedAt` inside the metadata, which the caller
 * (`summarizeHumanEdits`) reads; this function only narrows the scan to items something touched.
 */
export async function listContentItemMetadataInRange(input: {
  from: number;
  to: number;
  limit: number;
}): Promise<Array<{ id: string; status: ContentStatus; updatedAt: number; metadata: Record<string, unknown> }>> {
  await ensureDatabase();
  const rows = await db
    .select({
      id: contentItems.id,
      status: contentItems.status,
      updatedAt: contentItems.updatedAt,
      metadataJson: contentItems.metadataJson,
    })
    .from(contentItems)
    .where(and(gte(contentItems.updatedAt, input.from), lte(contentItems.updatedAt, input.to)))
    .orderBy(asc(contentItems.updatedAt))
    .limit(Math.max(1, Math.floor(input.limit)));
  return rows.map((row) => ({
    id: row.id,
    status: (contentStatusVocabulary as readonly string[]).includes(row.status)
      ? (row.status as ContentStatus)
      : "draft",
    updatedAt: row.updatedAt,
    metadata: parseJsonObject(row.metadataJson),
  }));
}

/** Malformed or hand-edited JSON is `{}`, never an exception: a content page must still open. */
function parseJsonObject(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
