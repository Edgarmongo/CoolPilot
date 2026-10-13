/* eslint-disable @typescript-eslint/no-require-imports -- 临时取证脚本：Node CommonJS 入口只能用 require */

/**
 * CI-P1-05 阶段 2 / E2E-02 收尾：核对「清空封面」的真实契约并清理自建数据。
 *
 * 目的：E2E-02 步骤 6 的断言 `imagePath === ""` 失败，需分清是产品缺陷还是断言口径问题。
 * 契约（`toContent`：`imagePath: row.imagePath || undefined`）意味着清空后 API 回的是
 * **缺省（undefined）**而不是空串；本脚本用原始响应 + 数据库列双重取证。
 *
 * 清理：删除自建内容（走 API DELETE）、删除自建 artifact 文件、删除临时夹具目录。
 * 用法：node tmp-p1-05-e2e02-cleanup.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@libsql/client");

const BASE = process.env.COOLPILOT_BASE_URL || "http://127.0.0.1:3000";
const ROOT = __dirname;
const ARTIFACTS = path.join(ROOT, "web-data", "artifacts");
const SOURCE = path.join(ROOT, "tmp-p1-05-e2e02.log.json");
const LOG_FILE = path.join(ROOT, "tmp-p1-05-e2e02-cleanup.log.json");

const prior = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const step = (name) => prior.steps.find((entry) => entry.step === name);
const fileName = step("3-upload").body.data.fileName;
const contentId = step("6-editor-reference").contentId;
const fixturePath = step("2-fixture").fixturePath;

const evidence = { case: "E2E-02-cleanup", startedAt: new Date().toISOString(), fileName, contentId, fixturePath, steps: [] };
const record = (name, data) => evidence.steps.push({ step: name, at: new Date().toISOString(), ...data });
const artifactsCount = () => fs.readdirSync(ARTIFACTS).length;
const db = createClient({ url: "file:web-data/social-auto-post.db" });
async function scalar(sql) {
  const r = await db.execute(sql);
  return r.rows[0] ? JSON.parse(JSON.stringify(r.rows[0])) : null;
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
  return { status: res.status, json, text };
}

async function main() {
  const artifactsBeforeCleanup = artifactsCount();
  // 1) 清空封面后的真实状态：数据库列 + 原始响应
  const rowBefore = await scalar(
    `select image_path, metadata_json, status from content_items where id='${contentId}'`,
  );
  const clearAgain = await call("PATCH", `/api/content/${contentId}`, { images: [] });
  record("1-clear-contract", {
    dbRowBefore: rowBefore,
    dbImagePathIsEmptyString: rowBefore?.image_path === "",
    clearStatus: clearAgain.status,
    responseHasImagePathKey: Object.prototype.hasOwnProperty.call(clearAgain.json?.data ?? {}, "imagePath"),
    responseImagePathValue: clearAgain.json?.data?.imagePath ?? null,
    responseMetadataImages: clearAgain.json?.data?.metadata?.images ?? null,
  });

  // 2) 清理自建内容
  const deleted = await call("DELETE", `/api/content/${contentId}`);
  const reread = await call("GET", `/api/content/${contentId}`);
  record("2-delete-content", { deleteStatus: deleted.status, getAfterDeleteStatus: reread.status });

  // 3) 清理自建 artifact（只删本次上传记录的那个文件名）
  let artifactRemoved = false;
  const target = path.join(ARTIFACTS, path.basename(fileName));
  if (fileName.startsWith("upload-") && fs.existsSync(target)) {
    fs.unlinkSync(target);
    artifactRemoved = true;
  }
  record("3-cleanup-artifact", { target: path.basename(target), removed: artifactRemoved, artifactsAfterCleanup: artifactsCount() });

  // 4) 清理临时夹具目录
  try {
    fs.rmSync(path.dirname(fixturePath), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  record("4-cleanup-fixture", { fixtureDir: path.dirname(fixturePath), existsAfter: fs.existsSync(path.dirname(fixturePath)) });

  // 5) 终态核对
  record("5-final", {
    artifactsBeforeCleanup,
    artifactsAfterCleanup: artifactsCount(),
    contentCount: (await scalar("select count(*) as n from content_items")).n,
    leftoverE2E05Content: (await scalar("select count(*) as n from content_items where title like 'E2E05-%'")).n,
    leftoverE2E05Files: fs.readdirSync(ARTIFACTS).filter((name) => name.includes("e2e05")).length,
  });

  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(LOG_FILE, JSON.stringify(evidence, null, 2), "utf8");
  console.log(JSON.stringify(evidence.steps, null, 1));
  console.log(`\n[written] ${path.basename(LOG_FILE)}`);
}

main().catch((error) => {
  evidence.error = String(error?.message ?? error);
  fs.writeFileSync(LOG_FILE, JSON.stringify(evidence, null, 2), "utf8");
  console.error("ERR", error);
  process.exitCode = 1;
});
