import { describe, expect, it } from "vitest";

/**
 * CI-P2-04-05 over HTTP: the write the 修改計劃發佈時間 dialog performs.
 *
 * The dialog sends exactly `{ scheduleTimes: [{ type: "once", at }] }`, so this file pins that
 * payload: the plan's moment moves, the schedule's content link and account survive, `nextRunAt` is
 * recomputed from the new rule, and an invalid rule list is refused instead of quietly kept.
 *
 * The harness pins the temp database before anything that reads it loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
await import("@/test/route-harness");

const { PATCH } = await import("./route");
const { createAccount, createContentItem, createSchedule, getSchedule } = await import("@/db/repository");

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/schedules/sch-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/schedules/[id] (CI-P2-04-05)", () => {
  it("moves a content-linked plan to a new single occurrence", async () => {
    const account = await createAccount({ name: "reschedule", platform: "知乎" });
    if (!account) throw new Error("account not created");
    const item = await createContentItem({
      title: "Reschedule target",
      body: "",
      postReadyText: "",
      status: "ready",
    });
    const original = Date.now() + 6 * 60 * 60 * 1000;
    const schedule = await createSchedule({
      playbookId: "threads_compose_post",
      accountId: account.id,
      enabled: true,
      scheduleTimes: [{ type: "weekly", time: "09:00", weekdays: [1, 3, 5] }],
      params: { contentItemId: item.id },
      contentItemId: item.id,
    });
    if (!schedule) throw new Error("schedule not created");

    const response = await PATCH(
      patchRequest({ scheduleTimes: [{ type: "once", at: new Date(original).toISOString() }] }),
      context(schedule.id),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data?: { scheduleTimes: unknown[]; nextRunAt?: number } };
    expect(body.ok).toBe(true);
    expect(body.data?.scheduleTimes).toEqual([{ type: "once", at: new Date(original).toISOString() }]);
    // The schedule recalculates its own next run from the new rule rather than keeping the old one.
    expect(body.data?.nextRunAt).toBe(original);

    const stored = await getSchedule(schedule.id);
    // The change is a plan edit and nothing else: the content link, account and authorisation survive.
    expect(stored).toMatchObject({
      contentItemId: item.id,
      accountId: account.id,
      enabled: true,
      publishAuthorized: false,
    });
  });

  it("refuses a rule list the schedule schema does not allow", async () => {
    const schedule = await createSchedule({
      playbookId: "threads_compose_post",
      enabled: true,
      scheduleTimes: [{ type: "daily", time: "09:00" }],
    });
    if (!schedule) throw new Error("schedule not created");

    const response = await PATCH(patchRequest({ scheduleTimes: [] }), context(schedule.id));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; code?: string; error?: string };
    expect(body.ok).toBe(false);
    // This route hands `fail()` a sentence rather than an `AppErrorCode`, so `code` is the generic
    // `UNKNOWN_ERROR` and the sentence rides in `error`/`message`. That is pre-existing behaviour
    // (other routes pass a code); this case pins what the endpoint really answers today.
    expect(body.error).toBe("Invalid schedule payload");

    // The rejected request left the rule list exactly as it was.
    const stored = await getSchedule(schedule.id);
    expect(stored?.scheduleTimes).toEqual([{ type: "daily", time: "09:00" }]);
  });
});
