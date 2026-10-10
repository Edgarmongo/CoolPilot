import { listAccounts, listContentItemRefs, listPublishRecords, listRuns, listSchedules } from "@/db/repository";
import { failFromError, ok } from "@/lib/api";
import {
  buildContentLifecycleRow,
  collectContentPlans,
  collectContentPublishRecords,
  collectContentRuns,
  contentLifecyclePlatforms,
  matchContentLifecycleFilters,
  summarizeContentLifecycle,
} from "@/lib/content-lifecycle";
import {
  contentLifecycleStages,
  type ContentLifecycleFilters,
  type ContentLifecyclePayload,
  type ContentLifecycleStage,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 按计划发布时间查询内容 (CI-P2-04-03) with the publish history that belongs to each content item
 * (CI-P2-04-06). Read-only: this route never writes a plan, a record or a content status, so the
 * frozen C2 publish contract is untouched by construction.
 *
 * The rules it follows:
 *
 *  - **one window, one rule.** `?from`/`?to` select content items by *planned publish time*: an
 *    occurrence of a content-linked schedule, or a run of that content, inside the window. The
 *    fallback window is `[now, now + 30 days]` and says so (`range.source: "default"`); a window
 *    longer than a year is shortened and says so (`range.clamped: true`).
 *  - **a publish record is history, not a plan.** Records are not clipped by the plan window: once a
 *    content item is in the answer, every record the scan holds is shown per platform, because
 *    "was this published, to what, when" is exactly what P2-04-06 asks.
 *  - **a plan is a plan.** A schedule occurrence is reported as `plan`, never as evidence that a
 *    publish happened; `contentStatus` is copied from the content item and is never derived from a
 *    record (P2-04-07).
 *  - **absent parameters are absent.** `?from=`/`?to=`/`?limit=`/`?offset=` are checked for
 *    emptiness before any `Number()` call, so a missing value cannot silently become 0 (the defect
 *    the 调用明细 route hit when `Number(null)` clamped a page to one row).
 *  - **nothing is invented.** Ids that no longer resolve keep their row with `contentFound: false`,
 *    and the scan's own ceilings travel in `scan` so a page cannot be mistaken for the whole picture.
 */

/** The fallback plan window, and the longest window a single answer will expand. */
const defaultWindowDays = 30;
const maxWindowDays = 366;
/** Ceilings for the three readers and the page offset; all reported in `scan`. */
const runsLimit = 2000;
const publishRecordsLimit = 2000;
const defaultPageSize = 50;
const maxPageSize = 200;
const maxOffset = 5000;
const dayMs = 24 * 60 * 60 * 1000;

const idPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const platformPattern = /^.{1,64}$/;

/** Epoch ms or ISO; an empty parameter is absent rather than 0. */
function readTimestamp(value: string | null) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readCount(value: string | null, fallback: number, min: number, max: number) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return fallback;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function readStage(value: string | null): ContentLifecycleStage | "" {
  const trimmed = (value ?? "").trim();
  return (contentLifecycleStages as readonly string[]).includes(trimmed)
    ? (trimmed as ContentLifecycleStage)
    : "";
}

function readId(value: string | null) {
  const trimmed = (value ?? "").trim();
  return idPattern.test(trimmed) ? trimmed : "";
}

function readPlatform(value: string | null) {
  const trimmed = (value ?? "").trim();
  return platformPattern.test(trimmed) ? trimmed : "";
}

/** The moment a row is about: its plan, else its latest run, else its latest record, else creation. */
function rowMoment(row: ReturnType<typeof buildContentLifecycleRow>): number {
  return row.plan?.at ?? row.executions.lastAt ?? row.publish.latest?.at ?? row.createdAt ?? 0;
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const now = Date.now();

    const requestedFrom = readTimestamp(params.get("from"));
    const requestedTo = readTimestamp(params.get("to"));
    const hasWindow = requestedFrom !== undefined && requestedTo !== undefined && requestedTo > requestedFrom;
    const from = hasWindow ? requestedFrom : now;
    const requestedSpan = hasWindow ? requestedTo - from : 0;
    const clamped = requestedSpan > maxWindowDays * dayMs;
    const to = hasWindow
      ? clamped
        ? from + maxWindowDays * dayMs
        : requestedTo
      : now + defaultWindowDays * dayMs;
    const range = {
      from,
      to,
      source: hasWindow ? ("query" as const) : ("default" as const),
      clamped,
    };

    const filters: ContentLifecycleFilters = {
      stage: readStage(params.get("stage")),
      platform: readPlatform(params.get("platform")),
      contentItemId: readId(params.get("contentItemId")),
    };
    const limit = readCount(params.get("limit"), defaultPageSize, 1, maxPageSize);
    const offset = readCount(params.get("offset"), 0, 0, maxOffset);

    const [schedules, runs, publishRecords, accounts] = await Promise.all([
      listSchedules(),
      listRuns(runsLimit),
      listPublishRecords(publishRecordsLimit),
      listAccounts(),
    ]);

    const plans = collectContentPlans({ schedules, accounts, window: range });
    const runsByContent = collectContentRuns(runs, range);
    const publishByContent = collectContentPublishRecords(publishRecords);

    const referenced = new Set<string>([...plans.keys(), ...runsByContent.keys()]);
    if (filters.contentItemId) referenced.add(filters.contentItemId);
    const contents = await listContentItemRefs([...referenced]);
    const contentsById = new Map(contents.map((item) => [item.id, item]));

    const rows = [...referenced].map((contentItemId) =>
      buildContentLifecycleRow({
        contentItemId,
        content: contentsById.get(contentItemId) ?? null,
        plans: plans.get(contentItemId) ?? [],
        runs: runsByContent.get(contentItemId) ?? [],
        publishRecords: publishByContent.get(contentItemId) ?? [],
      }),
    );
    rows.sort(
      (left, right) => rowMoment(left) - rowMoment(right) || left.contentItemId.localeCompare(right.contentItemId),
    );

    const matched = rows.filter((row) => matchContentLifecycleFilters(row, filters));
    const page = matched.slice(offset, offset + limit);

    const payload: ContentLifecyclePayload = {
      range,
      filters,
      scan: {
        referencedContent: referenced.size,
        missingContent: referenced.size - contents.length,
        schedules: schedules.length,
        runs: runs.length,
        runsLimit,
        publishRecords: publishRecords.length,
        publishRecordsLimit,
        truncated: runs.length >= runsLimit || publishRecords.length >= publishRecordsLimit,
      },
      summary: {
        matched: matched.length,
        total: rows.length,
        ...summarizeContentLifecycle(matched),
      },
      platforms: contentLifecyclePlatforms(rows),
      offset,
      limit,
      hasMore: offset + page.length < matched.length,
      rows: page,
    };
    return ok(payload);
  } catch (error) {
    return failFromError(error, "UNKNOWN_ERROR", 500);
  }
}
