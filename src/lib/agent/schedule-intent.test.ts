import { describe, expect, it } from "vitest";
import { looksLikeScheduleRequest, resolveScheduleIntent } from "./schedule-intent";
import type { AccountRecord } from "@/lib/types";

const site: AccountRecord = { id: "threads-1", name: "Acme", platform: "Threads", url: "", account: "acme", profilePath: "profile", memo: "", status: "active", preset: {}, createdAt: 1, updatedAt: 1 };

describe("schedule intent", () => {
  it("resolves tomorrow at 9pm and a normal-text site", () => {
    const result = resolveScheduleIntent({ message: "post that tmr at 9pm via Acme", accounts: [site], now: new Date(2026, 5, 23, 10) });
    const date = new Date(result.scheduledAt);
    expect([date.getDate(), date.getHours(), date.getMinutes()]).toEqual([24, 21, 0]);
    expect(result.site.id).toBe(site.id);
  });

  it("gives the selected @ site precedence", () => {
    const other = { ...site, id: "threads-2", name: "Other" };
    expect(resolveScheduleIntent({ message: "post that tomorrow at 8am via Acme", accounts: [site, other], selectedSite: other, now: new Date(2026, 5, 23) }).site.id).toBe(other.id);
  });

  it("recognizes localized requests and rejects ambiguity", () => {
    expect(looksLikeScheduleRequest("聽日晚上9點排程發佈")).toBe(true);
    expect(() => resolveScheduleIntent({ message: "post that tmr at 9pm via Acme", accounts: [site, { ...site, id: "2" }], now: new Date(2026, 5, 23) })).toThrow(/More than one/);
  });
});
