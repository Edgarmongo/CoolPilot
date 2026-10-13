/* eslint-disable @typescript-eslint/no-require-imports -- 临时取证脚本：Node CommonJS 入口只能用 require */

/**
 * CI-P1-05 阶段 2 / E2E-04：发布（**只做受控失败**——不存在的 accountId）
 *
 * 授权口径：不调用真实平台发布接口、不使用真实账号、不新账号。只验证：
 *   ①不存在的 accountId 会写出 `failed` 发布记录且给出稳定原因；
 *   ②内容项状态**保持不变**（不被误移为 posted）；
 *   ③不产生 run、不新增账号、不落地浏览器 profile。
 *
 * 写操作：建 1 条自建内容（跑完删除）+ 1 条 failed 发布记录（核对后按 id 清除）。
 * 用法：node tmp-p1-05-e2e04.cjs
 * 证据：tmp-p1-05-e2e04.log.json
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@libsql/client");

const BASE = process.env.COOLPILOT_BASE_URL || "http://127.0.0.1:3000";
const ROOT = __dirname;
const LOG_FILE = path.join(ROOT, "tmp-p1-05-e2e04.log.json");
const MARK = `E2E05-发布受控失败-${Date.now()}`;
const BOGUS_ACCOUNT_ID = "e2e05-nonexistent-account";

const evidence = { case: "E2E-04", base: BASE, bogusAccountId: BOGUS_ACCOUNT_ID, mark: MARK, startedAt: new Date().toISOString(), steps: [] };
const record = (step, data) => evidence.steps.push({ step, at: new Date().toISOString(), ...data });

const db = createClient({ url: "file:web-data/social-auto-post.db" });
async function rows(sql) {
  const r = await db.execute(sql);
  return r.rows.map((row) => JSON.parse(JSON.stringify(row)));
}
async function scalar(sql) {
  return (await rows(sql))[0] ?? null;
}
async function call(method, url, body, timeoutMs = 60000) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text: text.slice(0, 600) };
}

async function state() {
  return {
    contentCount: (await scalar("select count(*) as n from content_items")).n,
    contentByStatus: await rows("select status, count(*) as n from content_items group by status order by status"),
    publishCount: (await scalar("select count(*) as n from publish_records")).n,
    publishByStatus: await rows("select status, count(*) as n from publish_records group by status order by status"),
    runCount: (await scalar("select count(*) as n from runs")).n,
    accountCount: (await scalar("select count(*) as n from accounts")).n,
    schedulesCount: (await scalar("select count(*) as n from schedules")).n,
  };
}


async function main() {
  evidence.before = await state();

  // ---------- 步骤 1：自建一条可发布内容（不调用模型）----------
  const created = await call("POST", "/api/content", {
    title: MARK,
    body: `${MARK} 正文：受控 E2E 发布失败样本。`,
    sourceUrls: [],
    images: [],
    type: "article",
  });
  const contentId = created.json?.data?.id ?? null;
  record("1-create-content", {
    status: created.status,
    contentId,
    itemStatus: created.json?.data?.status ?? null,
  });
  console.log("[1] content:", created.status, contentId, "status =", created.json?.data?.status);

  // ---------- 步骤 2：受控失败发布会话（不存在的 accountId）----------
  const publish = await call("POST", "/api/publish", {
    accountIds: [BOGUS_ACCOUNT_ID],
    title: MARK,
    text: `${MARK} 受控发布样本（不得发到真实平台）`,
    contentType: "article",
    method: "manual",
    terminal: "",
    contentItemId: contentId,
  });
  const row = await scalar(
    `select * from publish_records where account_id='${BOGUS_ACCOUNT_ID}' order by created_at desc limit 1`,
  );
  record("2-controlled-failure", {
    httpStatus: publish.status,
    body: publish.json,
    result: publish.json?.data?.results?.[0] ?? null,
    dbRow: row,
    httpSucceededButPublishFailed:
      publish.status === 200 && (publish.json?.data?.results?.[0]?.status ?? "") === "failed",
    dbStatusFailed: row?.status === "failed",
    dbUrlEmpty: row?.url === "",
    dbPublishedAtNull: row?.published_at === null,
    dbContentItemLinked: row?.content_item_id === contentId,
  });
  console.log("[2] publish POST =", publish.status, "| result.status =", publish.json?.data?.results?.[0]?.status,
    "| result.error =", publish.json?.data?.results?.[0]?.error,
    "| db:", row?.status, JSON.stringify(row?.message), "url='' ->", row?.url === "", "published_at ->", row?.published_at);

  // ---------- 步骤 3：入参边界（accountIds 为空 → 400，且不写记录）----------
  const publishCountBeforeInvalid = (await scalar("select count(*) as n from publish_records")).n;
  const invalid = await call("POST", "/api/publish", { accountIds: [], title: MARK, text: "x" });
  const publishCountAfterInvalid = (await scalar("select count(*) as n from publish_records")).n;
  record("3-invalid-payload", {
    status: invalid.status,
    body: invalid.json,
    publishCountBeforeInvalid,
    publishCountAfterInvalid,
    wroteNoRecord: publishCountBeforeInvalid === publishCountAfterInvalid,
  });
  console.log("[3] invalid payload:", invalid.status, JSON.stringify(invalid.json?.error), "| records", publishCountBeforeInvalid, "->", publishCountAfterInvalid);

  // ---------- 步骤 4：内容状态与周边事实核对（是否被误改）----------
  const reread = await call("GET", `/api/content/${contentId}`);
  evidence.afterPublish = await state();
  record("4-no-side-effects", {
    itemStatusAfterPublish: reread.json?.data?.status ?? null,
    itemStatusUnchanged: (reread.json?.data?.status ?? null) === "ready",
    titleUnchanged: (reread.json?.data?.title ?? "") === MARK,
    itemCountDelta: evidence.afterPublish.contentCount - evidence.before.contentCount,
    runCountDelta: evidence.afterPublish.runCount - evidence.before.runCount,
    accountCountDelta: evidence.afterPublish.accountCount - evidence.before.accountCount,
    publishCountDelta: evidence.afterPublish.publishCount - evidence.before.publishCount,
    publishByStatus: evidence.afterPublish.publishByStatus,
    rowsForBogusAccount: await rows(
      `select id, status, url, published_at, message from publish_records where account_id='${BOGUS_ACCOUNT_ID}'`,
    ),
  });
  console.log("[4] after publish: item status =", reread.json?.data?.status, "| runs delta =", evidence.afterPublish.runCount - evidence.before.runCount,
    "| accounts delta =", evidence.afterPublish.accountCount - evidence.before.accountCount,
    "| publish delta =", evidence.afterPublish.publishCount - evidence.before.publishCount);

  // ---------- 步骤 5：清理（内容 → 发布记录按 id 清除）----------
  const deleted = await call("DELETE", `/api/content/${contentId}`);
  const afterContentDelete = {
    publishRowsLeft: (await rows(`select id from publish_records where account_id='${BOGUS_ACCOUNT_ID}'`)).length,
  };
  const publishRowId = row?.id ?? "";
  let publishRowRemoved = false;
  if (afterContentDelete.publishRowsLeft > 0 && publishRowId) {
    await db.execute(`delete from publish_records where id='${publishRowId}'`);
    publishRowRemoved = true;
  }
  evidence.after = await state();
  record("5-cleanup", {
    deleteContentStatus: deleted.status,
    publishRowId,
    publishRowCascadedWithContent: afterContentDelete.publishRowsLeft === 0,
    publishRowRemovedByExplicitDelete: publishRowRemoved,
    after: evidence.after,
    leftoverE2E05Content: (await scalar("select count(*) as n from content_items where title like 'E2E05-%'")).n,
    leftoverBogusAccountRows: (await scalar("select count(*) as n from publish_records where account_id='" + BOGUS_ACCOUNT_ID + "'")).n,
  });
  console.log("[5] cleanup: delete content =", deleted.status, "| publish row cascaded =", afterContentDelete.publishRowsLeft === 0,
    "| explicit delete =", publishRowRemoved, "| publish_records now =", evidence.after.publishCount,
    "| leftover E2E05 content =", (await scalar("select count(*) as n from content_items where title like 'E2E05-%'")).n);

  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(LOG_FILE, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`\n[written] ${path.basename(LOG_FILE)}`);
}

main().catch((error) => {
  evidence.error = { name: error?.name, message: String(error?.message ?? error) };
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(LOG_FILE, JSON.stringify(evidence, null, 2), "utf8");
  console.error("ERR", error);
  process.exitCode = 1;
});
