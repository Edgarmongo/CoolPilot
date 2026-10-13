/* eslint-disable @typescript-eslint/no-require-imports -- 临时取证脚本：Node CommonJS 入口只能用 require */

/**
 * CI-P5-01 定向取证：`PATCH /api/content/[id]` 的封面语义（`images` → `imagePath` 镜像）。
 *
 * 起因：主脚本里「PATCH images:[] 清空封面」一条未按预期通过（读到 undefined）。本脚本用**真实路由**
 * 逐字段打印 4 次请求/响应，判断是「路由真的没清空」还是「我的断言写错」。不调用模型、不写 artifacts。
 * 数据边界：自建 1 条 `E2E05-` 内容，跑完删除。
 *
 * 用法：node tmp-p5-01-images-probe.cjs
 * 证据：tmp-p5-01-images-probe.log.json
 */
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.COOLPILOT_BASE_URL || "http://127.0.0.1:3000";
const LOG_FILE = path.join(__dirname, "tmp-p5-01-images-probe.log.json");
const MARK = `E2E05-封面语义-${Date.now()}`;
const evidence = { card: "CI-P5-01/P5-01-05/08", mark: MARK, exchanges: [] };

async function call(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
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

async function main() {
  let itemId = "";
  try {
    const created = await call("POST", "/api/content", { title: MARK, type: "article" });
    itemId = created.json?.data?.id ?? "";
    evidence.exchanges.push({ step: "create", status: created.status, id: itemId, imagePath: created.json?.data?.imagePath, images: created.json?.data?.metadata?.images });

    const set = await call("PATCH", `/api/content/${itemId}`, { images: ["E2E05-cover.png"] });
    evidence.exchanges.push({ step: "patch-set", status: set.status, imagePath: set.json?.data?.imagePath, images: set.json?.data?.metadata?.images });

    const readSet = await call("GET", `/api/content/${itemId}`);
    evidence.exchanges.push({ step: "get-after-set", status: readSet.status, imagePath: readSet.json?.data?.imagePath, images: readSet.json?.data?.metadata?.images });

    const clear = await call("PATCH", `/api/content/${itemId}`, { images: [] });
    evidence.exchanges.push({ step: "patch-clear", status: clear.status, imagePath: clear.json?.data?.imagePath, imagePathType: typeof clear.json?.data?.imagePath, images: clear.json?.data?.metadata?.images, raw: clear.json ?? clear.text });

    const readClear = await call("GET", `/api/content/${itemId}`);
    evidence.exchanges.push({ step: "get-after-clear", status: readClear.status, imagePath: readClear.json?.data?.imagePath, imagePathType: typeof readClear.json?.data?.imagePath, images: readClear.json?.data?.metadata?.images });

    // 再恢复一次，证明「清空后还能设回来」（编辑器换封面/重设封面的路径）
    const restore = await call("PATCH", `/api/content/${itemId}`, { images: ["E2E05-cover.png"] });
    evidence.exchanges.push({ step: "patch-restore", status: restore.status, imagePath: restore.json?.data?.imagePath, images: restore.json?.data?.metadata?.images });
  } finally {
    if (itemId) {
      const removed = await call("DELETE", `/api/content/${itemId}`);
      evidence.cleanup = { itemId, status: removed.status };
    }
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(LOG_FILE, JSON.stringify(evidence, null, 2));
  }
  for (const entry of evidence.exchanges) {
    console.log(`${entry.step}: HTTP ${entry.status} imagePath=${JSON.stringify(entry.imagePath)} (${entry.imagePathType ?? "string"}) images=${JSON.stringify(entry.images)}`);
  }
  console.log(`log: ${path.relative(__dirname, LOG_FILE)}`);
}

void main().catch((error) => {
  evidence.fatal = String(error?.stack ?? error);
  fs.writeFileSync(LOG_FILE, JSON.stringify(evidence, null, 2));
  console.error(`probe fatal: ${evidence.fatal}`);
  process.exitCode = 1;
});
