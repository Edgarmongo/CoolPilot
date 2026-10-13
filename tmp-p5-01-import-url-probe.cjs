/* eslint-disable @typescript-eslint/no-require-imports -- 临时取证脚本：Node CommonJS 入口只能用 require */

/**
 * CI-P5-01 / P5-01-08 定向取证：`POST /api/content/import-url` 对**远程 og:image** 的处理。
 *
 * 基线（`docs/e2e-baseline-inventory.md` §8 第 3 条）声称「远程导入不本地化远程图（写远程 URL，
 * artifacts 不增）」。本脚本用**真实路由**复现/推翻它，且不依赖外网、不调用模型：
 *   1. 本机起一个只服务一页 HTML 的 http server，页面带 `<meta property="og:image">`（指向远程 https 图）；
 *   2. 真实调用 `POST /api/content/import-url`（`rewrite:false` → 不触发模型）；
 *   3. 核对 `imagePath` / `metadata.images` / `artifacts` 目录文件数与基线的关系（before/after）。
 *
 * 数据边界：只写 1 条 `E2E05-` 前缀内容，跑完删除。不写 artifacts、不写用量、不跑模型。
 * 用法：node tmp-p5-01-import-url-probe.cjs
 * 证据：tmp-p5-01-import-url.log.json
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const BASE = process.env.COOLPILOT_BASE_URL || "http://127.0.0.1:3000";
const ROOT = __dirname;
const LOG_FILE = path.join(ROOT, "tmp-p5-01-import-url.log.json");
const ARTIFACTS = path.join(ROOT, "web-data", "artifacts");
const MARK = `E2E05-远程封面-${Date.now()}`;
const REMOTE_IMAGE = "https://example.com/e2e05-remote-cover.png";
const PORT = 34567;

const evidence = { card: "CI-P5-01/P5-01-08", mark: MARK, base: BASE, checks: [] };
const check = (name, ok, detail) => {
  evidence.checks.push({ name, ok: Boolean(ok), detail: detail === undefined ? "" : detail });
  if (!ok) evidence.failed = true;
};
const short = (value, max = 400) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text && text.length > max ? `${text.slice(0, max)}…(${text.length} chars)` : text;
};

async function call(method, url, body, timeoutMs = 120000) {
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

const pageHtml = [
  "<html><head>",
  `<meta property="og:title" content="${MARK}" />`,
  `<meta property="og:image" content="${REMOTE_IMAGE}" />`,
  "</head><body><article><p>受控导入正文：这一页只用于证明导入侧如何保存来源页的封面图引用。</p></article></body></html>",
].join("");

async function main() {
  const artifactsBefore = fs.readdirSync(ARTIFACTS).length;
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(pageHtml);
  });
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

  let itemId = "";
  try {
    const localUrl = `http://127.0.0.1:${PORT}/e2e05-page`;
    const imported = await call("POST", "/api/content/import-url", { url: localUrl, rewrite: false, maxWords: 200 });
    const item = imported.json?.data?.item ?? null;
    itemId = item?.id ?? "";
    evidence.imported = { status: imported.status, itemId, imagePath: item?.imagePath ?? null, images: item?.metadata?.images ?? null };
    check("真实路由：import-url 201 且写出内容", imported.status === 201 && Boolean(itemId), short(imported.json));

    check("P5-01-08 导入标题取自页面 og:title", item?.title === MARK, String(item?.title));
    check(
      "P5-01-08 来源页 og:image 被写成 imagePath（远程 URL，原样）",
      item?.imagePath === REMOTE_IMAGE,
      String(item?.imagePath),
    );
    check(
      "P5-01-08 metadata 不含任何本地化图片引用（只有 sourceTitle/provider/model 等）",
      !Array.isArray(item?.metadata?.images) || item.metadata.images.length === 0,
      short(item?.metadata ?? null),
    );
    const artifactsAfter = fs.readdirSync(ARTIFACTS).length;
    check("P5-01-08 artifacts 目录文件数未增（远程图未落盘）", artifactsAfter === artifactsBefore, `${artifactsBefore} → ${artifactsAfter}`);
    evidence.artifacts = { before: artifactsBefore, after: artifactsAfter };
    evidence.verdict =
      item?.imagePath === REMOTE_IMAGE && artifactsAfter === artifactsBefore
        ? "已复现基线 §8 第 3 条：导入侧保留远程 URL，未本地化"
        : "与基线不一致，需要人工复核";
    check("结论与基线一致（远程封面不本地化）", evidence.verdict.startsWith("已复现"), evidence.verdict);
    evidence.followUp = {
      publishDropsRemoteCover: "src/lib/publish.ts 的 resolveLocalImagePath 对 http(s) 返回 \"\" → 发布侧会静默丢弃该封面（属 CI-P5-03 / 审计 C4 决策项，本卡不改）",
    };
  } finally {
    if (itemId) {
      const removed = await call("DELETE", `/api/content/${itemId}`);
      evidence.cleanup = { itemId, status: removed.status };
    }
    await new Promise((resolve) => server.close(resolve));
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(LOG_FILE, JSON.stringify(evidence, null, 2));
  }

  const passed = evidence.checks.filter((entry) => entry.ok).length;
  console.log(`CI-P5-01 import-url probe ${evidence.failed ? "FAILED" : "PASSED"} — ${passed}/${evidence.checks.length}`);
  for (const entry of evidence.checks) console.log(`${entry.ok ? "  ok  " : " FAIL "} ${entry.name}${entry.ok ? "" : ` → ${entry.detail}`}`);
  console.log(`verdict: ${evidence.verdict}`);
}

void main().catch((error) => {
  evidence.fatal = String(error?.stack ?? error);
  fs.writeFileSync(LOG_FILE, JSON.stringify(evidence, null, 2));
  console.error(`probe fatal: ${evidence.fatal}`);
  process.exitCode = 1;
});
