import { describe, expect, it } from "vitest";
import {
  buildContentLifecycleRow,
  collectContentPlans,
  collectContentPublishRecords,
  collectContentRuns,
  contentLifecyclePlatforms,
  emptyPublishRollup,
  matchContentLifecycleFilters,
  resolveContentLifecycleStage,
  runContentItemId,
  runMoment,
  summarizeContentLifecycle,
  summarizeContentPublish,
  type ContentLifecycleSignals,
} from "./content-lifecycle";
import type {
  AccountRecord,
  ContentItem,
  ContentLifecycleFilters,
  PublishRecord,
  RunRecord,
  ScheduleRecord,
} from "./types";

/**
 * CI-P2-04-02 / -06 / -07: the mapping from the four existing status vocabularies to one lifecycle
 * stage, and the publish rollup that keeps "a record exists" apart from "a platform accepted it".
 *
 * Wednesday, 22 April 2026, 12:00 local.
 */
const NOW = new Date(2026, 3, 22, 12, 0, 0).getTime();
const WINDOW = {
  from: new Date(2026, 3, 20, 0, 0, 0).getTime(),
  to: new Date(2026, 3, 25, 23, 59, 59).getTime(),
};

const accounts: Pick<AccountRecord, "id" | "name" | "platform">[] = [
  { id: "acc-1", name: "Main", platform: "知乎" },
  { id: "acc-2", name: "Backup", platform: "小红书" },
];

function content(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-1",
    title: "Launch note",
    body: "body",
    postReadyText: "post",
    sourceUrls: [],
    metadata: { type: "article" },
    status: "ready",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function schedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: "sch-1",
    playbookId: "threads_compose_post",
    accountId: "acc-1",
    enabled: true,
    scheduleTimes: [{ type: "once", at: new Date(2026, 3, 22, 9, 0, 0).toISOString() }],
    params: {},
    status: "scheduled",
    contentItemId: "item-1",
    publishAuthorized: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    playbookId: "threads_compose_post",
    accountId: "acc-1",
    status: "success",
    params: { contentItemId: "item-1" },
    resultMessage: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function record(overrides: Partial<PublishRecord> = {}): PublishRecord {
  return {
    id: "pub-1",
    accountId: "acc-1",
    accountName: "Main",
    platform: "知乎",
    title: "Launch note",
    contentType: "article",
    status: "published",
    url: "https://example.com/p/1",
    method: "scheduled",
    terminal: "local",
    message: "",
    contentItemId: "item-1",
    publishedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    favorites: 0,
    followsDelta: 0,
    metricStatus: "pending",
    ...overrides,
  };
}

const filters = (overrides: Partial<ContentLifecycleFilters> = {}): ContentLifecycleFilters => ({
  stage: "",
  platform: "",
  contentItemId: "",
  ...overrides,
});

describe("content plans", () => {
  it("keeps only content-linked schedules and their occurrences inside the window", () => {
    const plans = collectContentPlans({
      schedules: [
        schedule({ id: "sch-once" }),
        // A playbook plan with no content item is not part of a *content* lifecycle.
        schedule({ id: "sch-playbook", contentItemId: undefined }),
        // Outside the window: a July occurrence is not a plan for this week.
        schedule({
          id: "sch-july",
          scheduleTimes: [{ type: "once", at: new Date(2026, 6, 1, 9, 0, 0).toISOString() }],
        }),
      ],
      accounts,
      window: WINDOW,
    });

    expect([...plans.keys()]).toEqual(["item-1"]);
    expect(plans.get("item-1")).toEqual([
      {
        at: new Date(2026, 3, 22, 9, 0, 0).getTime(),
        scheduleId: "sch-once",
        playbookId: "threads_compose_post",
        accountId: "acc-1",
        accountName: "Main",
        platform: "知乎",
        enabled: true,
        repeating: false,
      },
    ]);
  });

  it("expands a repeating rule, marks it repeating, and keeps a paused plan", () => {
    const plans = collectContentPlans({
      schedules: [
        schedule({
          id: "sch-daily",
          enabled: false,
          scheduleTimes: [{ type: "daily", time: "09:00" }],
        }),
      ],
      accounts,
      window: WINDOW,
    });

    const occurrences = plans.get("item-1") ?? [];
    expect(occurrences).toHaveLength(6);
    expect(occurrences.every((plan) => plan.enabled === false)).toBe(true);
    expect(occurrences.every((plan) => plan.repeating === true)).toBe(true);
    expect(occurrences.map((plan) => plan.at)).toEqual([...occurrences.map((plan) => plan.at)].sort((a, b) => a - b));
  });

  it("names the account and platform, and leaves them empty when the schedule names no account", () => {
    const plans = collectContentPlans({
      schedules: [schedule({ accountId: undefined })],
      accounts,
      window: WINDOW,
    });

    expect(plans.get("item-1")?.[0]).toMatchObject({ accountId: undefined, accountName: "", platform: "" });
  });
});

describe("content runs", () => {
  it("reads the content id from the run's params and windows it by scheduledFor first", () => {
    const runsByContent = collectContentRuns(
      [
        run({ id: "run-scheduled", scheduledFor: new Date(2026, 3, 22, 9, 0, 0).getTime() }),
        // startedAt is inside the window but scheduledFor is not: the calendar's own precedence rules.
        run({
          id: "run-outside",
          scheduledFor: new Date(2026, 6, 1, 9, 0, 0).getTime(),
          startedAt: new Date(2026, 3, 22, 9, 0, 0).getTime(),
        }),
        // A run nobody attributed to a content item is not part of a content lifecycle.
        run({ id: "run-unattributed", params: {} }),
      ],
      WINDOW,
    );

    expect([...runsByContent.keys()]).toEqual(["item-1"]);
    expect(runsByContent.get("item-1")?.map((entry) => entry.id)).toEqual(["run-scheduled"]);
  });

  it("exposes the helpers the route and the calendar share", () => {
    expect(runContentItemId(run({ params: { contentItemId: "  item-9  " } }))).toBe("item-9");
    expect(runContentItemId(run({ params: { contentItemId: 42 } }))).toBe("");
    expect(runMoment(run({ scheduledFor: undefined, startedAt: 5, createdAt: 7 }))).toBe(5);
    expect(runMoment(run({ scheduledFor: undefined, startedAt: undefined, createdAt: 7 }))).toBe(7);
  });
});

describe("publish rollup", () => {
  it("counts every row by status, credits only published rows, and names the latest one", () => {
    const rollup = summarizeContentPublish([
      record({ id: "pub-old", status: "queued", url: "", publishedAt: NOW - 5_000 }),
      record({ id: "pub-failed", status: "failed", url: "", publishedAt: NOW - 4_000, platform: "小红书", accountId: "acc-2", accountName: "Backup" }),
      record({ id: "pub-new", status: "published", publishedAt: NOW }),
    ]);

    expect(rollup.records).toBe(3);
    expect(rollup.byStatus).toMatchObject({ queued: 1, running: 0, published: 1, drafted: 0, failed: 1, cancelled: 0 });
    expect(rollup.hasOnlyUnfinishedRecords).toBe(false);
    expect(rollup.latest).toMatchObject({ id: "pub-new", status: "published", at: NOW, url: "https://example.com/p/1" });
    // One entry per target, newest activity first; only the successful one is credited.
    expect(rollup.platforms.map((platform) => platform.key)).toEqual(["acc-1", "acc-2"]);
    expect(rollup.platforms[0]).toMatchObject({ published: 1, records: 2, lastStatus: "published", platform: "知乎" });
    expect(rollup.platforms[1]).toMatchObject({ published: 0, records: 1, lastStatus: "failed", platform: "小红书" });
  });

  it("says a content item is not published when every row is unfinished", () => {
    const rollup = summarizeContentPublish([
      record({ id: "pub-queued", status: "queued", url: "", publishedAt: undefined }),
      record({ id: "pub-drafted", status: "drafted", url: "", publishedAt: undefined }),
    ]);

    expect(rollup.hasOnlyUnfinishedRecords).toBe(true);
    expect(rollup.platforms.every((platform) => platform.published === 0)).toBe(true);
    expect(rollup.latest?.status).toBe("drafted");
    // A row with no `publishedAt` is placed by its creation time rather than dropped.
    expect(rollup.latest?.at).toBe(NOW);
  });

  it("returns an empty rollup - not a fabricated one - when there are no records", () => {
    expect(summarizeContentPublish([])).toEqual(emptyPublishRollup());
    expect(emptyPublishRollup().latest).toBeNull();
    expect(emptyPublishRollup().platforms).toEqual([]);
  });

  it("groups records with neither account nor platform under the empty key", () => {
    const records = collectContentPublishRecords([
      record({ accountId: undefined, platform: "" }),
      record({ id: "pub-2", accountId: undefined, platform: "", contentItemId: "" }),
    ]);

    expect([...records.keys()]).toEqual(["item-1"]);
    expect(summarizeContentPublish(records.get("item-1") ?? []).platforms[0]).toMatchObject({
      key: "",
      accountId: undefined,
      platform: "",
    });
  });
});

describe("stage mapping (P2-04-02 / P2-04-07)", () => {
  /** A minimal signal set; every case below changes exactly one thing about it. */
  function signals(overrides: Partial<ContentLifecycleSignals> = {}): ContentLifecycleSignals {
    return {
      contentStatus: "ready",
      enabledPlanCount: 0,
      publish: emptyPublishRollup(),
      runs: { inFlight: false, latestStatus: null },
      ...overrides,
    };
  }

  function rollupOf(statuses: PublishRecord["status"][]) {
    return summarizeContentPublish(statuses.map((status, index) => record({ id: `pub-${index}`, status })));
  }

  it("reads a published record as published and a posted content item as published", () => {
    expect(resolveContentLifecycleStage(signals({ publish: rollupOf(["published"]) }))).toBe("published");
    expect(resolveContentLifecycleStage(signals({ contentStatus: "posted" }))).toBe("published");
    // The content item is what it is: a later failed attempt on another platform does not undo it.
    expect(
      resolveContentLifecycleStage(signals({ contentStatus: "posted", publish: rollupOf(["failed"]) })),
    ).toBe("published");
  });

  it("never reads a record that merely exists as a success", () => {
    // The three unfinished statuses, one at a time: queued/running are in the pipeline, drafted is
    // waiting for a human. None of them says a platform accepted the content.
    expect(resolveContentLifecycleStage(signals({ publish: rollupOf(["queued"]) }))).toBe("publishing");
    expect(resolveContentLifecycleStage(signals({ publish: rollupOf(["running"]) }))).toBe("publishing");
    expect(resolveContentLifecycleStage(signals({ publish: rollupOf(["drafted"]) }))).toBe("pending");
    expect(rollupOf(["drafted"]).hasOnlyUnfinishedRecords).toBe(true);
  });

  it("reads an in-flight run as publishing, and a draft stays a draft even when planned", () => {
    expect(resolveContentLifecycleStage(signals({ runs: { inFlight: true, latestStatus: "running" } }))).toBe(
      "publishing",
    );
    expect(resolveContentLifecycleStage(signals({ contentStatus: "draft", enabledPlanCount: 3 }))).toBe("draft");
  });

  it("reads a failure from the content status, the latest record or the latest run", () => {
    expect(resolveContentLifecycleStage(signals({ contentStatus: "failed" }))).toBe("failed");
    expect(resolveContentLifecycleStage(signals({ publish: rollupOf(["failed"]) }))).toBe("failed");
    expect(resolveContentLifecycleStage(signals({ publish: rollupOf(["cancelled"]) }))).toBe("failed");
    expect(resolveContentLifecycleStage(signals({ runs: { inFlight: false, latestStatus: "failed" } }))).toBe("failed");
    expect(resolveContentLifecycleStage(signals({ runs: { inFlight: false, latestStatus: "warning" } }))).toBe("failed");
  });

  it("reads a plan as scheduled only while it is enabled", () => {
    expect(resolveContentLifecycleStage(signals({ enabledPlanCount: 1 }))).toBe("scheduled");
    // A paused plan is not a plan to publish, so the stage falls back to what the content item is.
    expect(resolveContentLifecycleStage(signals({ enabledPlanCount: 0, contentStatus: "ready" }))).toBe("pending");
  });

  it("falls back to pending for a ready item nothing has happened to", () => {
    expect(resolveContentLifecycleStage(signals())).toBe("pending");
    expect(resolveContentLifecycleStage(signals({ contentStatus: null }))).toBe("pending");
  });
});

describe("lifecycle row", () => {
  function plansFor(schedules: ScheduleRecord[]) {
    return collectContentPlans({ schedules, accounts, window: WINDOW }).get("item-1") ?? [];
  }

  it("takes the earliest occurrence as the plan, and counts paused ones separately", () => {
    const row = buildContentLifecycleRow({
      contentItemId: "item-1",
      content: content(),
      plans: plansFor([
        schedule({ id: "sch-later", scheduleTimes: [{ type: "once", at: new Date(2026, 3, 24, 9, 0, 0).toISOString() }] }),
        schedule({ id: "sch-first", scheduleTimes: [{ type: "once", at: new Date(2026, 3, 21, 9, 0, 0).toISOString() }] }),
        schedule({ id: "sch-paused", enabled: false, scheduleTimes: [{ type: "once", at: new Date(2026, 3, 23, 9, 0, 0).toISOString() }] }),
      ]),
      runs: [],
      publishRecords: [],
    });

    expect(row.plan?.scheduleId).toBe("sch-first");
    expect(row.planCount).toBe(3);
    expect(row.enabledPlanCount).toBe(2);
    // Two enabled plans, no publish evidence: the stage is the plan.
    expect(row.stage).toBe("scheduled");
  });

  it("reports a missing content item instead of inventing one", () => {
    const row = buildContentLifecycleRow({
      contentItemId: "item-deleted",
      content: null,
      plans: [],
      runs: [],
      publishRecords: [record({ id: "pub-orphan", contentItemId: "item-deleted", title: "Published title" })],
    });

    expect(row.contentFound).toBe(false);
    expect(row.contentStatus).toBeNull();
    expect(row.createdAt).toBeNull();
    // The title comes from the record: the publish happened, the item is what is gone.
    expect(row.title).toBe("Published title");
    expect(row.stage).toBe("published");
    expect(row.publish.byStatus.published).toBe(1);
  });

  it("summarizes executions and reads the content kind from the item's metadata", () => {
    const row = buildContentLifecycleRow({
      contentItemId: "item-1",
      content: content({ metadata: { type: "video" }, status: "ready" }),
      plans: [],
      runs: [
        run({ id: "run-failed", status: "failed", scheduledFor: new Date(2026, 3, 21, 9, 0, 0).getTime() }),
        run({ id: "run-last", status: "success", scheduledFor: new Date(2026, 3, 22, 9, 0, 0).getTime() }),
      ],
      publishRecords: [],
    });

    expect(row.contentType).toBe("video");
    expect(row.executions).toEqual({
      runs: 2,
      failedRuns: 1,
      lastStatus: "success",
      lastAt: new Date(2026, 3, 22, 9, 0, 0).getTime(),
    });
    // The latest run succeeds, so the earlier failure is not the stage; nothing is planned either.
    expect(row.stage).toBe("pending");
  });
});

describe("lifecycle filters and summary", () => {
  const rows = [
    buildContentLifecycleRow({
      contentItemId: "item-1",
      content: content(),
      plans: collectContentPlans({ schedules: [schedule()], accounts, window: WINDOW }).get("item-1") ?? [],
      runs: [],
      publishRecords: [],
    }),
    buildContentLifecycleRow({
      contentItemId: "item-2",
      content: content({ id: "item-2", status: "posted" }),
      plans: [],
      runs: [],
      publishRecords: [record({ id: "pub-2", contentItemId: "item-2", platform: "小红书", accountId: "acc-2", accountName: "Backup" })],
    }),
    buildContentLifecycleRow({
      contentItemId: "item-3",
      content: content({ id: "item-3", status: "draft" }),
      plans: [],
      runs: [],
      publishRecords: [],
    }),
  ];

  it("matches stage, platform and content id filters independently", () => {
    expect(rows.map((row) => matchContentLifecycleFilters(row, filters()))).toEqual([true, true, true]);
    expect(rows.filter((row) => matchContentLifecycleFilters(row, filters({ stage: "scheduled" }))).length).toBe(1);
    expect(rows.filter((row) => matchContentLifecycleFilters(row, filters({ platform: "小红书" }))).length).toBe(1);
    // item-1 has no publish record at all: its plan's target is what the platform filter matches.
    expect(rows.filter((row) => matchContentLifecycleFilters(row, filters({ platform: "知乎" }))).length).toBe(1);
    expect(
      rows.filter((row) => matchContentLifecycleFilters(row, filters({ contentItemId: "item-3" }))).length,
    ).toBe(1);
    // A filter that matches nothing returns nothing rather than falling back to the whole set.
    expect(rows.some((row) => matchContentLifecycleFilters(row, filters({ platform: "不存在的平台" })))).toBe(false);
  });

  it("counts stages and keeps 'has records' apart from 'was published'", () => {
    const summary = summarizeContentLifecycle(rows);

    expect(summary.byStage).toEqual({
      draft: 1,
      pending: 0,
      scheduled: 1,
      publishing: 0,
      published: 1,
      failed: 0,
    });
    expect(summary.plannedInWindow).toBe(1);
    expect(summary.pausedPlan).toBe(0);
    expect(summary.published).toBe(1);
    expect(summary.unpublishedRecords).toBe(0);

    const withUnfinishedRecord = summarizeContentLifecycle([
      buildContentLifecycleRow({
        contentItemId: "item-4",
        content: content({ id: "item-4" }),
        plans: [],
        runs: [],
        publishRecords: [record({ id: "pub-4", contentItemId: "item-4", status: "queued", url: "" })],
      }),
    ]);
    expect(withUnfinishedRecord.published).toBe(0);
    expect(withUnfinishedRecord.unpublishedRecords).toBe(1);
  });

  it("lists the distinct platforms of an answer, ignoring empty ones", () => {
    const platforms = contentLifecyclePlatforms(rows);
    expect(platforms).toContain("知乎");
    expect(platforms).toContain("小红书");
    expect(platforms).toHaveLength(2);

    // A record that named no platform contributes no filter option.
    const unknownPlatform = buildContentLifecycleRow({
      contentItemId: "item-5",
      content: content({ id: "item-5" }),
      plans: [],
      runs: [],
      publishRecords: [record({ id: "pub-5", contentItemId: "item-5", platform: "", accountId: undefined })],
    });
    expect(contentLifecyclePlatforms([unknownPlatform])).toEqual([]);
  });
});
