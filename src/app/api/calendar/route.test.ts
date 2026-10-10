import { describe, expect, it } from "vitest";

/**
 * CI-P2-04-04 / -06 over HTTP: the month view now says *which content* a plan or a publish belongs
 * to. Everything else about this route (the three sources, the best-time slots) is pre-existing and
 * unchanged; what this file pins is the content linkage and its ceiling.
 *
 * The harness pins the temp database before anything that reads it loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
await import("@/test/route-harness");

const { GET } = await import("./route");
const { createAccount, createContentItem, createPublishRecord, createRun, createSchedule, deleteContentItem } =
  await import("@/db/repository");

type CalendarEntry = {
  id: string;
  kind: string;
  at: number;
  title: string;
  contentItemId?: string;
  contentTitle?: string;
  scheduleId?: string;
  runId?: string;
};

type CalendarPayload = {
  ok: boolean;
  data?: {
    range: { from: number; to: number };
    entries: CalendarEntry[];
    accounts: Array<{ id: string; name: string; platform: string }>;
    contentTitles: { requested: number; resolved: number; budget: number; capped: boolean };
  };
};

async function getCalendar(query = "") {
  const response = await GET(new Request(`http://localhost/api/calendar${query}`));
  expect(response.status).toBe(200);
  const body = (await response.json()) as CalendarPayload;
  if (!body.data) throw new Error("payload missing");
  return body.data;
}

const hourMs = 60 * 60 * 1000;

describe("GET /api/calendar (CI-P2-04 content linkage)", () => {
  it("names the content item a plan occurrence belongs to", async () => {
    const account = await createAccount({ name: "calendar-content", platform: "知乎" });
    if (!account) throw new Error("account not created");
    const item = await createContentItem({
      title: "Calendar linked title",
      body: "",
      postReadyText: "",
      metadata: { type: "article" },
      status: "ready",
    });
    const at = Date.now() + 2 * hourMs;
    const schedule = await createSchedule({
      playbookId: "threads_compose_post",
      accountId: account.id,
      enabled: true,
      scheduleTimes: [{ type: "once", at: new Date(at).toISOString() }],
      params: { contentItemId: item.id },
      contentItemId: item.id,
    });
    if (!schedule) throw new Error("schedule not created");

    const data = await getCalendar(`?from=${at - hourMs}&to=${at + hourMs}`);

    const entry = data.entries.find((candidate) => candidate.scheduleId === schedule.id);
    expect(entry).toMatchObject({
      kind: "planned",
      at,
      contentItemId: item.id,
      contentTitle: "Calendar linked title",
    });
    expect(data.contentTitles.resolved).toBeGreaterThanOrEqual(1);
    expect(data.contentTitles.capped).toBe(false);
  });

  it("keeps the run's own content id, and leaves the title unset when the item is gone", async () => {
    const account = await createAccount({ name: "calendar-run", platform: "小红书" });
    if (!account) throw new Error("account not created");
    const item = await createContentItem({
      title: "Calendar run title",
      body: "",
      postReadyText: "",
      status: "ready",
    });
    const at = Date.now() + 3 * hourMs;
    const run = await createRun({
      playbookId: "threads_compose_post",
      accountId: account.id,
      params: { contentItemId: item.id },
      scheduledFor: at,
    });
    if (!run) throw new Error("run not created");
    await deleteContentItem(item.id);
    await createPublishRecord({
      accountId: account.id,
      accountName: account.name,
      platform: account.platform,
      title: "Calendar run title",
      contentType: "article",
      status: "published",
      contentItemId: item.id,
      publishedAt: at,
    });

    const data = await getCalendar(`?from=${at - hourMs}&to=${at + hourMs}`);

    const runEntry = data.entries.find((candidate) => candidate.runId === run.id);
    expect(runEntry?.contentItemId).toBe(item.id);
    // The id is reported as it was recorded; no title is invented for a deleted item.
    expect(runEntry?.contentTitle).toBeUndefined();

    const publishEntry = data.entries.find((candidate) => candidate.kind === "publish");
    expect(publishEntry?.contentItemId).toBe(item.id);
    expect(publishEntry?.contentTitle).toBeUndefined();
    expect(data.contentTitles.requested).toBeGreaterThanOrEqual(1);
    expect(data.contentTitles.resolved).toBeLessThan(data.contentTitles.requested);
  });
});
