import { describe, expect, it } from "vitest";

/**
 * CI-P2-04-03 / -06 / -07 over HTTP: the data channel behind the lifecycle view.
 *
 * The mapping and rollup rules are pinned where they live (`src/lib/content-lifecycle.test.ts`). What
 * only this file can check is what the route is responsible for: which content items the window
 * selects, that a record that merely exists is never reported as a success, that a content item that
 * no longer exists keeps its records, and that an absent parameter stays absent.
 *
 * The harness pins the temp database before anything that reads it loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
await import("@/test/route-harness");

const { GET } = await import("./route");
const { createAccount, createContentItem, createPublishRecord, createRun, createSchedule, deleteContentItem, updateContentItem, updateRunStatus } =
  await import("@/db/repository");

type LifecycleRow = {
  contentItemId: string;
  contentFound: boolean;
  title: string;
  contentStatus: string | null;
  stage: string;
  plan: { at: number; scheduleId: string; platform: string; accountName: string; enabled: boolean } | null;
  planCount: number;
  enabledPlanCount: number;
  executions: { runs: number; failedRuns: number; lastStatus: string; lastAt: number | null };
  publish: {
    records: number;
    byStatus: Record<string, number>;
    hasOnlyUnfinishedRecords: boolean;
    platforms: Array<{ key: string; platform: string; records: number; published: number; lastStatus: string; url: string }>;
    latest: { id: string; status: string; platform: string; url: string } | null;
  };
};

type LifecyclePayload = {
  ok: boolean;
  data?: {
    range: { from: number; to: number; source: string; clamped: boolean };
    filters: { stage: string; platform: string; contentItemId: string };
    scan: {
      limit: number;
      referencedContent: number;
      missingContent: number;
      schedules: number;
      runs: number;
      runsLimit: number;
      publishRecords: number;
      publishRecordsLimit: number;
      truncated: boolean;
    };
    summary: {
      matched: number;
      total: number;
      byStage: Record<string, number>;
      plannedInWindow: number;
      pausedPlan: number;
      published: number;
      unpublishedRecords: number;
    };
    platforms: string[];
    offset: number;
    limit: number;
    hasMore: boolean;
    rows: LifecycleRow[];
  };
};

function dataOf(body: LifecyclePayload) {
  expect(body.ok).toBe(true);
  if (!body.data) throw new Error("payload missing");
  return body.data;
}

async function getLifecycle(query = "") {
  const response = await GET(new Request(`http://localhost/api/content/lifecycle${query}`));
  return { status: response.status, body: (await response.json()) as LifecyclePayload };
}

const dayMs = 24 * 60 * 60 * 1000;

/** One account per case, so a platform filter can never match another case's records by accident. */
async function site(name: string, platform: "知乎" | "小红书") {
  const account = await createAccount({ name, platform });
  if (!account) throw new Error("account not created");
  return account;
}

/** A content item plus one content-linked plan occurrence `hours` from now. */
async function plannedContent(input: {
  title: string;
  accountId: string;
  hours: number;
  status?: "draft" | "ready" | "posted" | "failed";
  enabled?: boolean;
}) {
  const item = await createContentItem({
    title: input.title,
    body: "",
    postReadyText: "",
    metadata: { type: "article" },
    status: input.status ?? "ready",
  });
  const at = Date.now() + input.hours * 60 * 60 * 1000;
  const schedule = await createSchedule({
    playbookId: "threads_compose_post",
    accountId: input.accountId,
    enabled: input.enabled ?? true,
    scheduleTimes: [{ type: "once", at: new Date(at).toISOString() }],
    params: { contentItemId: item.id },
    contentItemId: item.id,
  });
  if (!schedule) throw new Error("schedule not created");
  return { item, schedule, at };
}

/** The single row these cases scope to, so another case's data cannot move a count. */
async function rowFor(contentItemId: string, query = "") {
  const { status, body } = await getLifecycle(`?contentItemId=${contentItemId}${query}`);
  expect(status).toBe(200);
  const data = dataOf(body);
  expect(data.rows.map((row) => row.contentItemId)).toEqual([contentItemId]);
  return { data, row: data.rows[0] };
}

describe("GET /api/content/lifecycle", () => {
  it("links a planned content item to its publish records, per platform", async () => {
    const account = await site("p204-main", "知乎");
    const backup = await site("p204-backup", "小红书");
    const { item, schedule, at } = await plannedContent({
      title: "P2-04 linked content",
      accountId: account.id,
      hours: 2,
    });
    await createPublishRecord({
      accountId: account.id,
      accountName: account.name,
      platform: account.platform,
      title: item.title,
      contentType: "article",
      status: "published",
      url: "https://example.com/p204",
      method: "scheduled",
      terminal: "local",
      contentItemId: item.id,
      publishedAt: Date.now() - 60_000,
    });
    await createPublishRecord({
      accountId: backup.id,
      accountName: backup.name,
      platform: backup.platform,
      title: item.title,
      contentType: "article",
      status: "failed",
      message: "editor refused",
      contentItemId: item.id,
    });

    const { data, row } = await rowFor(item.id);

    expect(row.contentFound).toBe(true);
    // P2-04-07: the content item's own status is reported as it is; it is not rewritten from a record.
    expect(row.contentStatus).toBe("ready");
    expect(row.stage).toBe("published");
    expect(row.plan).toMatchObject({
      at,
      scheduleId: schedule.id,
      platform: "知乎",
      accountName: account.name,
      enabled: true,
    });
    expect(row.planCount).toBe(1);
    expect(row.publish.records).toBe(2);
    expect(row.publish.byStatus).toMatchObject({ published: 1, failed: 1, queued: 0 });
    expect(row.publish.hasOnlyUnfinishedRecords).toBe(false);
    expect(row.publish.latest).toMatchObject({ status: "failed", platform: "小红书" });
    expect(row.publish.platforms.map((platform) => platform.platform)).toEqual(["小红书", "知乎"]);
    expect(row.publish.platforms.find((platform) => platform.platform === "知乎")).toMatchObject({
      published: 1,
      records: 1,
      url: "https://example.com/p204",
    });
    expect(row.publish.platforms.find((platform) => platform.platform === "小红书")).toMatchObject({
      published: 0,
      records: 1,
      lastStatus: "failed",
      url: "",
    });

    expect(data.summary.matched).toBe(1);
    expect(data.summary.published).toBe(1);
    expect(data.platforms).toEqual(expect.arrayContaining(["知乎", "小红书"]));
    expect(data.range.source).toBe("default");
    expect(data.limit).toBe(50);
  });

  it("never reads a record or a run that merely exists as a success", async () => {
    const account = await site("p204-queued", "知乎");
    const { item, at } = await plannedContent({ title: "P2-04 queued content", accountId: account.id, hours: 3 });
    await createPublishRecord({
      accountId: account.id,
      accountName: account.name,
      platform: account.platform,
      title: item.title,
      contentType: "article",
      status: "queued",
      contentItemId: item.id,
    });
    const run = await createRun({
      playbookId: "threads_compose_post",
      accountId: account.id,
      params: { contentItemId: item.id },
      scheduledFor: at,
    });
    if (run) await updateRunStatus(run.id, "running");

    const { data, row } = await rowFor(item.id);

    expect(row.stage).toBe("publishing");
    expect(row.publish.byStatus.queued).toBe(1);
    expect(row.publish.byStatus.published).toBe(0);
    expect(row.publish.hasOnlyUnfinishedRecords).toBe(true);
    expect(row.publish.latest?.status).toBe("queued");
    expect(row.executions).toMatchObject({ runs: 1, failedRuns: 0, lastStatus: "running" });
    // The plan is reported as a plan - it is not evidence that anything was published.
    expect(row.plan?.at).toBe(at);
    expect(data.summary.published).toBe(0);
    expect(data.summary.unpublishedRecords).toBe(1);
    expect(data.summary.byStage.publishing).toBe(1);
  });

  it("keeps a row for a content item that no longer exists", async () => {
    const account = await site("p204-deleted", "知乎");
    const item = await createContentItem({
      title: "P2-04 deleted content",
      body: "",
      postReadyText: "",
      status: "ready",
    });
    await createPublishRecord({
      accountId: account.id,
      accountName: account.name,
      platform: account.platform,
      title: item.title,
      contentType: "article",
      status: "published",
      url: "https://example.com/p204-deleted",
      contentItemId: item.id,
      publishedAt: Date.now(),
    });
    await deleteContentItem(item.id);

    const { data, row } = await rowFor(item.id);

    // The publish happened; the content item is what is gone. Neither the row nor the status is faked.
    expect(row.contentFound).toBe(false);
    expect(row.contentStatus).toBeNull();
    expect(row.title).toBe("P2-04 deleted content");
    expect(row.stage).toBe("published");
    expect(data.scan.missingContent).toBeGreaterThanOrEqual(1);
  });

  it("treats empty and nonsense parameters as absent rather than as zero", async () => {
    const account = await site("p204-params", "知乎");
    const { item } = await plannedContent({ title: "P2-04 params", accountId: account.id, hours: 4 });

    // A bare request: the fallback window and the default page size, not a zero-width window or one row.
    const bare = dataOf((await getLifecycle(`?contentItemId=${item.id}`)).body);
    expect(bare.limit).toBe(50);
    expect(bare.offset).toBe(0);
    expect(bare.range.source).toBe("default");
    expect(bare.range.clamped).toBe(false);
    expect(bare.range.to - bare.range.from).toBe(30 * dayMs);

    // Empty values are absent, nonsense values fall back, and the filter is not invented.
    const empty = dataOf(
      (
        await getLifecycle(
          `?contentItemId=${item.id}&from=&to=&limit=&offset=&stage=bogus&platform=${encodeURIComponent("  知乎  ")}`,
        )
      ).body,
    );
    expect(empty.range).toMatchObject({ source: "default", clamped: false });
    expect(empty.limit).toBe(50);
    expect(empty.offset).toBe(0);
    expect(empty.filters.stage).toBe("");
    expect(empty.filters.platform).toBe("知乎");
    expect(empty.filters.contentItemId).toBe(item.id);
    expect(empty.summary.matched).toBe(1);

    // `limit=0` is still a request for a page; the floor is one row, as the docs say.
    const floored = dataOf((await getLifecycle(`?contentItemId=${item.id}&limit=0&offset=-5`)).body);
    expect(floored.limit).toBe(1);
    expect(floored.offset).toBe(0);
    expect(floored.hasMore).toBe(false);
  });

  it("clamps a window longer than a year and says so", async () => {
    const account = await site("p204-window", "知乎");
    const { item } = await plannedContent({ title: "P2-04 window", accountId: account.id, hours: 5 });
    const from = Date.now() - dayMs;

    const data = dataOf(
      (await getLifecycle(`?contentItemId=${item.id}&from=${from}&to=${from + 10 * 365 * dayMs}`)).body,
    );

    expect(data.range.source).toBe("query");
    expect(data.range.clamped).toBe(true);
    expect(data.range.from).toBe(from);
    expect(data.range.to - data.range.from).toBe(366 * dayMs);
  });

  it("selects content by planned time, and lets the stage filter override the plan", async () => {
    const account = await site("p204-window-scope", "知乎");
    const inside = await plannedContent({ title: "P2-04 inside", accountId: account.id, hours: 6 });
    const outside = await plannedContent({ title: "P2-04 outside", accountId: account.id, hours: 24 * 40 });
    const from = Date.now();
    const to = Date.now() + dayMs;
    const window = `&from=${from}&to=${to}`;

    const scoped = dataOf((await getLifecycle(`?platform=${encodeURIComponent("知乎")}${window}&limit=200`)).body);
    const ids = scoped.rows.map((row) => row.contentItemId);
    expect(ids).toContain(inside.item.id);
    expect(ids).not.toContain(outside.item.id);
    expect(scoped.range).toMatchObject({ source: "query", clamped: false });

    // A draft with a plan is still a draft (P2-04-02 rule 3), and the stage filter selects it by that.
    await updateContentItem(inside.item.id, { status: "draft" });
    const drafts = dataOf((await getLifecycle(`?stage=draft&limit=200`)).body);
    expect(drafts.rows.map((row) => row.contentItemId)).toContain(inside.item.id);
    expect(drafts.summary.byStage.draft).toBeGreaterThanOrEqual(1);
    expect(drafts.rows.every((row) => row.stage === "draft")).toBe(true);
    expect(drafts.filters.stage).toBe("draft");
  });

  it("reports a paused plan without calling it scheduled", async () => {
    const account = await site("p204-paused", "知乎");
    const { item } = await plannedContent({
      title: "P2-04 paused",
      accountId: account.id,
      hours: 7,
      enabled: false,
    });

    const { data, row } = await rowFor(item.id);

    expect(row.planCount).toBe(1);
    expect(row.enabledPlanCount).toBe(0);
    expect(row.plan).toMatchObject({ enabled: false });
    expect(row.stage).toBe("pending");
    expect(data.summary.pausedPlan).toBe(1);
    expect(data.summary.plannedInWindow).toBe(1);
  });
});
