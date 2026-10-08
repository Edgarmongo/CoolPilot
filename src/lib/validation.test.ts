import { describe, expect, it } from "vitest";
import { importUrlSchema, runInputSchema, scheduleInputSchema, scheduleTimeSchema } from "./validation";

describe("validation", () => {
  it("rejects non-http URL imports", () => {
    expect(importUrlSchema.safeParse({ url: "not-a-url" }).success).toBe(false);
  });

  it("accepts a Threads run payload", () => {
    const parsed = runInputSchema.parse({
      playbookId: "threads_auto_post",
      accountId: "site_1",
      params: { contentFolder: "C:/tmp/posts", confirmLivePost: false },
    });
    expect(parsed.playbookId).toBe("threads_auto_post");
  });
});

describe("schedule input", () => {
  it("accepts every recurrence rule the calendar can create", () => {
    const parsed = scheduleInputSchema.parse({
      playbookId: "threads_compose_post",
      scheduleTimes: [
        { type: "weekly", time: "09:30", weekdays: [1, 3, 5] },
        { type: "monthly", time: "20:00", days: [1, 15, 31] },
        { type: "interval", everyMinutes: 90 },
      ],
    });
    expect(parsed.scheduleTimes).toHaveLength(3);
    expect(parsed.enabled).toBe(true);
  });

  it("rejects malformed recurrence rules", () => {
    expect(scheduleTimeSchema.safeParse({ type: "weekly", time: "09:30", weekdays: [] }).success).toBe(false);
    expect(scheduleTimeSchema.safeParse({ type: "weekly", time: "09:30", weekdays: [7] }).success).toBe(false);
    expect(scheduleTimeSchema.safeParse({ type: "monthly", time: "20:00", days: [0] }).success).toBe(false);
    expect(scheduleTimeSchema.safeParse({ type: "interval", everyMinutes: 1 }).success).toBe(false);
    expect(scheduleTimeSchema.safeParse({ type: "daily", time: "9:30" }).success).toBe(false);
  });
});
