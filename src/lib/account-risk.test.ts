import { describe, expect, it } from "vitest";
import {
  ACCOUNT_HEALTH_GATE_MS,
  assessAccountRisk,
  findLoginBlock,
  resolveLoginCheckUrl,
  summarizeAccountRisk,
  type AccountLoginCheck,
} from "./account-risk";
import type { AccountRecord, PublishRecord, PublishRecordStatus } from "./types";

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);

function account(patch: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: "acc-1",
    name: "Meow",
    platform: "小红书",
    url: "https://creator.xiaohongshu.com/",
    account: "meow",
    profilePath: "/profiles/acc-1",
    memo: "",
    status: "active",
    preset: {},
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    ...patch,
  };
}

function record(
  patch: Partial<PublishRecord> & { status: PublishRecordStatus } = { status: "published" },
): PublishRecord {
  return {
    id: `rec-${Math.random().toString(36).slice(2)}`,
    accountId: "acc-1",
    accountName: "Meow",
    platform: "小红书",
    title: "t",
    contentType: "post",
    url: "",
    method: "manual",
    terminal: "local",
    message: "",
    createdAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    favorites: 0,
    followsDelta: 0,
    metricStatus: "pending",
    ...patch,
  };
}

function check(patch: Partial<AccountLoginCheck> = {}): AccountLoginCheck {
  return {
    accountId: "acc-1",
    status: "signed_out",
    reason: "login_url",
    url: "https://creator.xiaohongshu.com/login",
    checkedAt: NOW,
    ...patch,
  };
}

describe("account risk", () => {
  it("resolves the page the probe should visit", () => {
    expect(resolveLoginCheckUrl(account(), "https://creator.example.com/publish")).toBe(
      "https://creator.example.com/publish",
    );
    expect(resolveLoginCheckUrl(account(), "")).toBe("https://creator.xiaohongshu.com/");
    expect(resolveLoginCheckUrl(account({ url: "" }), "")).toBe("");
    expect(resolveLoginCheckUrl(account({ url: "not a url" }), "")).toBe("");
  });

  it("flags a detected sign-in wall as dangerous", () => {
    const entry = assessAccountRisk({ account: account(), check: check(), records: [], now: NOW });
    expect(entry.level).toBe("danger");
    expect(entry.score).toBe(35);
    expect(entry.reasons).toContain("signed_out");
  });

  it("stays healthy when the probe signed in and publishing works", () => {
    const entry = assessAccountRisk({
      account: account(),
      check: check({ status: "signed_in", reason: "ok", url: "https://creator.xiaohongshu.com/" }),
      records: [record({ status: "published", publishedAt: NOW - 120_000 })],
      now: NOW,
    });
    expect(entry.level).toBe("healthy");
    expect(entry.score).toBe(100);
    expect(entry.reasons).toEqual([]);
    expect(entry.lastPublishedAt).toBe(NOW - 120_000);
    expect(entry.windowSuccessCount).toBe(1);
  });

  it("reports an expired session from recent failures", () => {
    const entry = assessAccountRisk({
      account: account({ status: "active" }),
      records: [record({ status: "failed", message: "login_required: 请先登录" })],
      now: NOW,
    });
    expect(entry.reasons).toContain("session_expired");
    expect(entry.windowFailureCount).toBe(1);
  });



  it("penalizes repeated failures more than a single one", () => {
    const single = assessAccountRisk({
      account: account(),
      records: [record({ status: "failed", message: "selector not found" })],
      now: NOW,
    });
    const many = assessAccountRisk({
      account: account(),
      records: [
        record({ status: "failed", message: "selector not found" }),
        record({ status: "failed", message: "timeout" }),
        record({ status: "failed", message: "timeout" }),
      ],
      now: NOW,
    });
    expect(single.score).toBe(88);
    expect(many.score).toBe(70);
    expect(many.reasons).toEqual(["publish_failures"]);
  });

  it("ignores records outside the window and other accounts", () => {
    const entry = assessAccountRisk({
      account: account(),
      records: [
        record({ status: "failed", message: "timeout", createdAt: NOW - 40 * 24 * 60 * 60 * 1000 }),
        record({ status: "failed", message: "timeout", accountId: "other" }),
      ],
      now: NOW,
    });
    expect(entry.level).toBe("unknown");
    expect(entry.reasons).toEqual(["idle"]);
  });

  it("adds account-record reasons", () => {
    const entry = assessAccountRisk({
      account: account({ status: "needs_login", profilePath: "" }),
      records: [record({ status: "drafted" })],
      now: NOW,
    });
    expect(entry.reasons).toEqual(["login_unverified", "missing_profile"]);
    expect(entry.score).toBe(60);
    expect(entry.level).toBe("warning");

    const paused = assessAccountRisk({ account: account({ status: "paused" }), records: [], now: NOW });
    expect(paused.reasons).toEqual(["paused"]);
    expect(paused.level).toBe("warning");
  });

  it("summarizes levels and sorts accounts needing attention", () => {
    const danger = assessAccountRisk({
      account: account({ id: "a" }),
      check: check({ accountId: "a" }),
      records: [],
      now: NOW,
    });
    const warning = assessAccountRisk({
      account: account({ id: "b" }),
      records: [record({ accountId: "b", status: "failed", message: "timeout" })],
      now: NOW,
    });
    const healthy = assessAccountRisk({
      account: account({ id: "c" }),
      check: check({ accountId: "c", status: "signed_in", reason: "ok" }),
      records: [],
      now: NOW,
    });

    const summary = summarizeAccountRisk([healthy, warning, danger]);
    expect(summary).toMatchObject({ total: 3, healthy: 1, warning: 1, danger: 1, unknown: 0 });
    expect(summary.attention).toEqual(["a", "b"]);
  });

  it("only blocks publishing on a fresh login-URL probe", () => {
    expect(findLoginBlock([check()], "acc-1", NOW)?.url).toBe("https://creator.xiaohongshu.com/login");
    expect(findLoginBlock([check({ reason: "login_text" })], "acc-1", NOW)).toBeNull();
    expect(findLoginBlock([check({ status: "signed_in", reason: "ok" })], "acc-1", NOW)).toBeNull();
    expect(findLoginBlock([check({ checkedAt: NOW - ACCOUNT_HEALTH_GATE_MS - 1 })], "acc-1", NOW)).toBeNull();
    expect(findLoginBlock([check()], "acc-2", NOW)).toBeNull();
  });
});
