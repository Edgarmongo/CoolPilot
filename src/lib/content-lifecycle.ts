import { expandScheduleTimes } from "./schedule";
import {
  publishRecordStatuses,
  type AccountRecord,
  type ContentItem,
  type ContentLifecycleFilters,
  type ContentLifecyclePlan,
  type ContentLifecyclePlanSummary,
  type ContentLifecyclePlatform,
  type ContentLifecyclePublishRollup,
  type ContentLifecycleRow,
  type ContentLifecycleStage,
  type ContentStatus,
  type PublishRecord,
  type PublishRecordStatus,
  type RunRecord,
  type ScheduleRecord,
} from "./types";

/**
 * 内容生命周期与日历 (CI-P2-04) - the read model that turns the four existing status vocabularies
 * into one lifecycle stage without adding a column, a table or a migration (P2-04-01).
 *
 * What already exists and is reused verbatim:
 *
 * | fact            | source                                                                       |
 * | --------------- | ---------------------------------------------------------------------------- |
 * | content state   | `content_items.status` (`draft` / `ready` / `posted` / `failed`)              |
 * | plan to publish | `schedules.content_item_id` + its recurrence rules (+ `enabled`)              |
 * | execution       | `runs.params_json.contentItemId` + `runs.status`                              |
 * | publish result  | `publish_records.content_item_id` + `account_id` / `platform` / `status`      |
 *
 * A plan is *a plan*: nothing here reads a schedule as evidence that something was published, and a
 * publish row that merely exists is never counted as success (P2-04-07).
 */

/** How many occurrences one schedule may contribute to a single answer. */
export const maxPlanOccurrencesPerSchedule = 200;

/** A run counts as "in flight" while the worker has not finished with it. */
const inFlightRunStatuses = ["queued", "running"] as const;

export function zeroPublishStatusCounts(): Record<PublishRecordStatus, number> {
  return publishRecordStatuses.reduce(
    (counts, status) => ({ ...counts, [status]: 0 }),
    {} as Record<PublishRecordStatus, number>,
  );
}

export function emptyPublishRollup(): ContentLifecyclePublishRollup {
  return {
    records: 0,
    byStatus: zeroPublishStatusCounts(),
    platforms: [],
    latest: null,
    hasOnlyUnfinishedRecords: false,
  };
}

/**
 * Occurrences of a content-linked schedule inside `[from, to]`.
 *
 * A schedule that names no content item yields nothing: without a content item there is no content
 * lifecycle to report, only a playbook plan (the calendar view already shows those).
 */
export function contentPlanOccurrences(
  schedule: ScheduleRecord,
  window: { from: number; to: number },
  limit = maxPlanOccurrencesPerSchedule,
): number[] {
  if (!schedule.contentItemId) return [];
  return expandScheduleTimes(schedule.scheduleTimes, {
    from: new Date(window.from),
    to: new Date(window.to + 1),
    limit,
  }).filter((at) => at >= window.from && at <= window.to);
}

/** Every content-linked plan occurrence in the window, grouped by content item and time ordered. */
export function collectContentPlans(input: {
  schedules: ScheduleRecord[];
  accounts: Pick<AccountRecord, "id" | "name" | "platform">[];
  window: { from: number; to: number };
}): Map<string, ContentLifecyclePlan[]> {
  const accountsById = new Map(input.accounts.map((account) => [account.id, account]));
  const plans = new Map<string, ContentLifecyclePlan[]>();

  for (const schedule of input.schedules) {
    const contentItemId = typeof schedule.contentItemId === "string" ? schedule.contentItemId.trim() : "";
    if (!contentItemId) continue;
    const occurrences = contentPlanOccurrences(schedule, input.window);
    if (occurrences.length === 0) continue;
    const account = schedule.accountId ? accountsById.get(schedule.accountId) : undefined;
    const list = plans.get(contentItemId) ?? [];
    for (const at of occurrences) {
      list.push({
        at,
        scheduleId: schedule.id,
        playbookId: schedule.playbookId,
        accountId: schedule.accountId,
        accountName: account?.name ?? "",
        platform: account?.platform ?? "",
        enabled: schedule.enabled,
        repeating: occurrences.length > 1,
      });
    }
    plans.set(contentItemId, list);
  }

  for (const list of plans.values()) list.sort((left, right) => left.at - right.at);
  return plans;
}

/** The content item a run belongs to - the worker stores it in the run's free-form params. */
export function runContentItemId(run: RunRecord): string {
  const value = run.params.contentItemId;
  return typeof value === "string" ? value.trim() : "";
}

/** When a run is placed on the calendar; the same precedence `buildCalendarEntries` uses. */
export function runMoment(run: RunRecord): number {
  return run.scheduledFor ?? run.startedAt ?? run.createdAt;
}

/** Runs of a content item whose moment falls inside the window, grouped by content item. */
export function collectContentRuns(
  runs: RunRecord[],
  window: { from: number; to: number },
): Map<string, RunRecord[]> {
  const byContent = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const contentItemId = runContentItemId(run);
    if (!contentItemId) continue;
    const at = runMoment(run);
    if (at < window.from || at > window.to) continue;
    const list = byContent.get(contentItemId) ?? [];
    list.push(run);
    byContent.set(contentItemId, list);
  }
  return byContent;
}

export function collectContentPublishRecords(records: PublishRecord[]): Map<string, PublishRecord[]> {
  const byContent = new Map<string, PublishRecord[]>();
  for (const record of records) {
    const contentItemId = typeof record.contentItemId === "string" ? record.contentItemId.trim() : "";
    if (!contentItemId) continue;
    const list = byContent.get(contentItemId) ?? [];
    list.push(record);
    byContent.set(contentItemId, list);
  }
  return byContent;
}

/**
 * One rollup per content item: how many rows, of which status, against which targets.
 *
 * `published` is counted from the rows themselves, so a content item whose only rows are `queued` /
 * `running` / `drafted` reports `hasOnlyUnfinishedRecords: true` and no platform is credited.
 */
export function summarizeContentPublish(records: PublishRecord[]): ContentLifecyclePublishRollup {
  if (records.length === 0) return emptyPublishRollup();

  const byStatus = zeroPublishStatusCounts();
  const byPlatform = new Map<string, ContentLifecyclePlatform>();
  let latest: { record: PublishRecord; at: number } | null = null;

  for (const record of records) {
    byStatus[record.status] += 1;
    const at = record.publishedAt ?? record.createdAt;
    const key = record.accountId?.trim() || record.platform.trim();
    const entry =
      byPlatform.get(key) ??
      ({
        key,
        accountId: record.accountId,
        accountName: record.accountName,
        platform: record.platform,
        records: 0,
        published: 0,
        lastStatus: record.status,
        lastAt: at,
        url: record.url,
      } satisfies ContentLifecyclePlatform);

    entry.records += 1;
    if (record.status === "published") entry.published += 1;
    if (at >= entry.lastAt) {
      entry.lastAt = at;
      entry.lastStatus = record.status;
      entry.accountName = record.accountName || entry.accountName;
      entry.platform = record.platform || entry.platform;
      if (record.status === "published" && record.url) entry.url = record.url;
    }
    byPlatform.set(key, entry);

    if (!latest || at >= latest.at) latest = { record, at };
  }

  const platforms = [...byPlatform.values()].sort(
    (left, right) => right.lastAt - left.lastAt || left.key.localeCompare(right.key),
  );

  return {
    records: records.length,
    byStatus,
    platforms,
    latest: latest
      ? {
          id: latest.record.id,
          status: latest.record.status,
          at: latest.at,
          platform: latest.record.platform,
          accountName: latest.record.accountName,
          url: latest.record.url,
          title: latest.record.title,
        }
      : null,
    hasOnlyUnfinishedRecords: byStatus.published === 0,
  };
}

/** Everything the stage mapping is allowed to look at. No clock, no queue, no hidden state. */
export type ContentLifecycleSignals = {
  /** `content_items.status`, or `null` when the item no longer exists. */
  contentStatus: ContentStatus | null;
  /** Occurrences from *enabled* schedules only: a paused plan is not going to run. */
  enabledPlanCount: number;
  publish: Pick<ContentLifecyclePublishRollup, "byStatus" | "latest">;
  runs: {
    inFlight: boolean;
    latestStatus: string | null;
  };
};

/**
 * The status mapping rules (P2-04-02), first match wins:
 *
 * 1. **published** - the content item itself is `posted`, or at least one publish row is `published`.
 *    A row counts here only when its own status says a platform accepted the content.
 * 2. **publishing** - a publish row or a run is still in the pipeline (`queued` / `running`).
 * 3. **draft** - the content item is a draft; a plan does not make a draft publishable.
 * 4. **failed** - the content item is `failed`, or its most recent publish row is `failed` /
 *    `cancelled`, or its most recent run is `failed` / `warning`.
 * 5. **scheduled** - an enabled content-linked schedule has an occurrence inside the window.
 * 6. **pending** - the most recent publish row is `drafted` (someone typed it into a platform editor
 *    and never confirmed), or nothing has happened at all to a `ready` item.
 */
export function resolveContentLifecycleStage(signals: ContentLifecycleSignals): ContentLifecycleStage {
  const latestPublishStatus = signals.publish.latest?.status ?? null;
  const inFlightPublish = signals.publish.byStatus.queued + signals.publish.byStatus.running > 0;

  if (signals.contentStatus === "posted" || signals.publish.byStatus.published > 0) return "published";
  if (inFlightPublish || signals.runs.inFlight) return "publishing";
  if (signals.contentStatus === "draft") return "draft";
  if (
    signals.contentStatus === "failed" ||
    latestPublishStatus === "failed" ||
    latestPublishStatus === "cancelled" ||
    signals.runs.latestStatus === "failed" ||
    signals.runs.latestStatus === "warning"
  ) {
    return "failed";
  }
  if (signals.enabledPlanCount > 0) return "scheduled";
  if (latestPublishStatus === "drafted") return "pending";
  return "pending";
}

function contentTypeOf(content: ContentItem | null): string {
  const type = content?.metadata.type;
  return typeof type === "string" ? type.trim() : "";
}


/**
 * Assembles one row from facts that were read elsewhere. Nothing is invented: a content item that no
 * longer exists keeps its row (`contentFound: false`) because its publish records are still facts,
 * and a row with no plan says `plan: null` rather than borrowing a neighbouring occurrence.
 */
export function buildContentLifecycleRow(input: {
  contentItemId: string;
  content: ContentItem | null;
  plans: ContentLifecyclePlan[];
  runs: RunRecord[];
  publishRecords: PublishRecord[];
}): ContentLifecycleRow {
  const plans = [...input.plans].sort((left, right) => left.at - right.at);
  const runs = [...input.runs].sort((left, right) => runMoment(left) - runMoment(right));
  const enabledPlanCount = plans.filter((plan) => plan.enabled).length;
  const publish = summarizeContentPublish(input.publishRecords);
  const lastRun = runs[runs.length - 1] ?? null;

  return {
    contentItemId: input.contentItemId,
    contentFound: Boolean(input.content),
    title: input.content?.title || publish.latest?.title || "",
    contentType: contentTypeOf(input.content),
    contentStatus: input.content?.status ?? null,
    stage: resolveContentLifecycleStage({
      contentStatus: input.content?.status ?? null,
      enabledPlanCount,
      publish,
      runs: {
        inFlight: runs.some((run) => (inFlightRunStatuses as readonly string[]).includes(run.status)),
        latestStatus: lastRun?.status ?? null,
      },
    }),
    createdAt: input.content?.createdAt ?? null,
    updatedAt: input.content?.updatedAt ?? null,
    plan: plans[0] ?? null,
    planCount: plans.length,
    enabledPlanCount,
    executions: {
      runs: runs.length,
      failedRuns: runs.filter(
        (run) => run.status === "failed" || run.status === "cancelled" || run.status === "warning",
      ).length,
      lastStatus: lastRun?.status ?? "",
      lastAt: lastRun ? runMoment(lastRun) : null,
    },
    publish,
  };
}

/** Stage / platform / content filters, each one optional and each one exact. */
export function matchContentLifecycleFilters(
  row: ContentLifecycleRow,
  filters: ContentLifecycleFilters,
): boolean {
  if (filters.contentItemId && row.contentItemId !== filters.contentItemId) return false;
  if (filters.stage && row.stage !== filters.stage) return false;
  if (filters.platform) {
    // A platform filter asks "where is this content going, or where did it go": the plan's target
    // counts as much as a publish record's, and a row that only has a plan on that platform is still
    // a match.
    const where = [
      ...row.publish.platforms.map((entry) => entry.platform),
      row.plan?.platform ?? "",
    ];
    if (!where.includes(filters.platform)) return false;
  }
  return true;
}

export function summarizeContentLifecycle(
  rows: ContentLifecycleRow[],
): { byStage: Record<ContentLifecycleStage, number> } & ContentLifecyclePlanSummary {
  const byStage = {
    draft: 0,
    pending: 0,
    scheduled: 0,
    publishing: 0,
    published: 0,
    failed: 0,
  } satisfies Record<ContentLifecycleStage, number>;

  let plannedInWindow = 0;
  let pausedPlan = 0;
  let published = 0;
  let unpublishedRecords = 0;

  for (const row of rows) {
    byStage[row.stage] += 1;
    if (row.planCount > 0) plannedInWindow += 1;
    if (row.planCount > 0 && row.enabledPlanCount === 0) pausedPlan += 1;
    if (row.publish.byStatus.published > 0) published += 1;
    else if (row.publish.records > 0) unpublishedRecords += 1;
  }

  return { byStage, plannedInWindow, pausedPlan, published, unpublishedRecords };
}

/** Distinct platforms across rows, for a view's own filter. Empty values are not a platform. */
export function contentLifecyclePlatforms(rows: ContentLifecycleRow[]): string[] {
  const platforms = new Set<string>();
  for (const row of rows) {
    for (const entry of row.publish.platforms) if (entry.platform.trim()) platforms.add(entry.platform);
    if (row.plan?.platform.trim()) platforms.add(row.plan.platform);
  }
  return [...platforms].sort((left, right) => left.localeCompare(right));
}
