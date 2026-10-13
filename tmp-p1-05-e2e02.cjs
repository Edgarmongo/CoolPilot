/* eslint-disable @typescript-eslint/no-require-imports -- 临时取证脚本：Node CommonJS 入口只能用 require */

/**
 * CI-P1-05 阶段 2 / E2E-02：图片与媒体（**不调用**图片生成能力）
 *
 * 授权口径：只验证可达的「媒体列表读取 → 上传登记 → 产物读取（字节一致）→ 编辑器引用」链路，
 * 并区分①模型不可用（已在 §7.1 取证，不重跑）②媒体读取失败 ③引用错误。
 * 写操作：上传 1 个自建小 PNG（跑完删除）+ 建 1 条 E2E05- 内容（跑完删除）。
 *
 * 用法：node tmp-p1-05-e2e02.cjs
 * 证据：tmp-p1-05-e2e02.log.json
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require("@libsql/client");

const BASE = process.env.COOLPILOT_BASE_URL || "http://127.0.0.1:3000";
const ROOT = __dirname;
const ARTIFACTS = path.join(ROOT, "web-data", "artifacts");
const LOG_FILE = path.join(ROOT, "tmp-p1-05-e2e02.log.json");
const MARK = `E2E05-图片-${Date.now()}`;
// 1x1 透明 PNG（67 字节）——字节一致比对用
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const evidence = { case: "E2E-02", mark: MARK, base: BASE, startedAt: new Date().toISOString(), steps: [] };
const record = (step, data) => evidence.steps.push({ step, at: new Date().toISOString(), ...data });
const short = (value, max = 400) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text && text.length > max ? `${text.slice(0, max)}…(${text.length} chars)` : text;
};
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
const artifactsCount = () => fs.readdirSync(ARTIFACTS).length;

async function call(method, url, body, timeoutMs = 60000) {
  const started = Date.now();
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString("utf8"));
  } catch {
    /* non-JSON */
  }
  return { status: res.status, ms: Date.now() - started, json, bytes: buf, contentType: res.headers.get("content-type") };
}

const db = createClient({ url: "file:web-data/social-auto-post.db" });
async function scalar(sql) {
  const r = await db.execute(sql);
  return r.rows[0] ? JSON.parse(JSON.stringify(r.rows[0])) : null;
}

async function main() {
  const artifactsBefore = artifactsCount();
  const contentBefore = (await scalar("select count(*) as n from content_items")).n;

  // ---------- 步骤 1：统一媒体列表（可达读取）----------
  const list = await call("GET", "/api/media/assets");
  const assets = list.json?.data?.assets ?? [];
  const byRoot = {};
  for (const asset of assets) byRoot[asset.root] = (byRoot[asset.root] ?? 0) + 1;
  const sampleArtifact = assets.find((a) => a.root === "artifacts") ?? null;
  const byRef = sampleArtifact
    ? await call("GET", `/api/media/assets?ref=${encodeURIComponent(sampleArtifact.value ?? "")}`)
    : null;
  const badRoot = await call("GET", "/api/media/assets?ref=x&root=bogus");
  const rootIgnored = await call("GET", "/api/media/assets?root=videos");
  record("1-media-list", {
    status: list.status,
    total: assets.length,
    byRoot,
    sample: sampleArtifact,
    byRef: byRef ? { status: byRef.status, asset: byRef.json?.data?.asset ?? null } : null,
    unknownRoot: { status: badRoot.status, body: short(badRoot.json ?? badRoot.bytes.toString("utf8"), 200) },
    rootWithoutRef: { status: rootIgnored.status, total: (rootIgnored.json?.data?.assets ?? []).length },
  });
  console.log("[1] media assets:", list.status, "total =", assets.length, JSON.stringify(byRoot),
    "| byRef =", byRef?.status, "| unknownRoot =", badRoot.status, "| root=videos(no ref) total =", (rootIgnored.json?.data?.assets ?? []).length);

  // ---------- 步骤 2：自建小 PNG 夹具 ----------
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "coolpilot-e2e02-"));
  const fixturePath = path.join(fixtureDir, "e2e05-fixture.png");
  const png = Buffer.from(PNG_BASE64, "base64");
  fs.writeFileSync(fixturePath, png);
  record("2-fixture", { fixturePath, bytes: png.length, sha256_16: sha(png) });
  console.log("[2] fixture:", fixturePath, png.length, "bytes sha =", sha(png));

  // ---------- 步骤 3：上传登记（POST /api/images/upload）----------
  const form = new FormData();
  form.append("file", new File([png], "e2e05-fixture.png", { type: "image/png" }));
  const uploadRes = await fetch(`${BASE}/api/images/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const upload = { status: uploadRes.status, json: JSON.parse(await uploadRes.text()) };
  const fileName = upload.json?.data?.fileName ?? "";
  const stored = fileName ? fs.readFileSync(path.join(ARTIFACTS, fileName)) : null;
  const artifactsAfterUpload = artifactsCount();
  record("3-upload", {
    status: upload.status,
    body: upload.json,
    artifactsBefore,
    artifactsAfterUpload,
    storedBytes: stored?.length ?? null,
    storedSha256_16: stored ? sha(stored) : null,
    bytesIdentical: stored ? sha(stored) === sha(png) : false,
  });
  console.log("[3] upload:", upload.status, fileName, upload.json?.data?.url, "artifacts", artifactsBefore, "->", artifactsAfterUpload, "byte-identical =", stored ? sha(stored) === sha(png) : false);

  let contentId = null;
  if (fileName) {
    // ---------- 步骤 4：产物读取（HTTP 200 + 字节一致）----------
    const fetchBack = await call("GET", upload.json.data.url);
    record("4-artifact-read", {
      url: upload.json.data.url,
      status: fetchBack.status,
      contentType: fetchBack.contentType,
      bytes: fetchBack.bytes.length,
      sha256_16: sha(fetchBack.bytes),
      bytesIdentical: sha(fetchBack.bytes) === sha(png),
    });
    console.log("[4] artifact read:", fetchBack.status, fetchBack.contentType, fetchBack.bytes.length, "bytes byte-identical =", sha(fetchBack.bytes) === sha(png));

    // ---------- 步骤 5：读取失败/引用错误分支（不重跑"模型不可用"，见 §7.1）----------
    const missing = await call("GET", "/api/agent/artifacts?file=e2e05-does-not-exist.png");
    const traversal = await call("GET", "/api/agent/artifacts?file=..%2Fsocial-auto-post.db");
    const badExt = await call("GET", "/api/agent/artifacts?file=e2e05.txt");
    const missingRef = await call("GET", "/api/media/assets?ref=e2e05-does-not-exist.png");
    record("5-read-failures", {
      missingArtifact: { status: missing.status, body: short(missing.bytes.toString("utf8"), 60) },
      pathTraversal: { status: traversal.status, body: short(traversal.bytes.toString("utf8"), 60) },
      nonImageExtension: { status: badExt.status },
      missingRefResolved: { status: missingRef.status, asset: missingRef.json?.data?.asset ?? null },
    });
    console.log("[5] read failures: missing =", missing.status, "traversal =", traversal.status, "badExt =", badExt.status, "| ref-not-exist =", missingRef.status, JSON.stringify(missingRef.json?.data?.asset));

    // ---------- 步骤 5b：上传侧的非法输入分支 ----------
    const txtForm = new FormData();
    txtForm.append("file", new File([Buffer.from("e2e05 not an image")], "e2e05.txt", { type: "text/plain" }));
    const txtRes = await fetch(`${BASE}/api/images/upload`, { method: "POST", body: txtForm, signal: AbortSignal.timeout(60000) });
    const txtJson = JSON.parse(await txtRes.text());

    const emptyForm = new FormData();
    emptyForm.append("file", new File([Buffer.alloc(0)], "e2e05-empty.png", { type: "image/png" }));
    const emptyRes = await fetch(`${BASE}/api/images/upload`, { method: "POST", body: emptyForm, signal: AbortSignal.timeout(60000) });
    const emptyJson = JSON.parse(await emptyRes.text());

    const noFileRes = await fetch(`${BASE}/api/images/upload`, { method: "POST", body: new FormData(), signal: AbortSignal.timeout(60000) });
    const noFileJson = JSON.parse(await noFileRes.text());

    record("5b-upload-failures", {
      unsupportedExtension: { status: txtRes.status, body: txtJson },
      emptyFile: { status: emptyRes.status, body: emptyJson },
      noFileField: { status: noFileRes.status, body: noFileJson },
      artifactsAfterFailures: artifactsCount(),
    });
    console.log("[5b] upload failures: .txt =", txtRes.status, JSON.stringify(txtJson.error), "| empty =", emptyRes.status, JSON.stringify(emptyJson.error), "| no-file =", noFileRes.status, JSON.stringify(noFileJson.error), "| artifacts =", artifactsCount());

    // ---------- 步骤 6：编辑器引用（上传 → 封面 → 读回 → 清空）----------
    const editorUrl = upload.json.data.url;
    const created = await call("POST", "/api/content", {
      title: MARK,
      body: `![](${editorUrl})\n\n${MARK} 正文：受控 E2E 图片引用样本。`,
      images: [fileName],
      type: "article",
    });
    contentId = created.json?.data?.id ?? null;
    const reread = contentId ? await call("GET", `/api/content/${contentId}`) : null;
    const cleared = contentId ? await call("PATCH", `/api/content/${contentId}`, { images: [] }) : null;
    record("6-editor-reference", {
      createStatus: created.status,
      contentId,
      coverIsFileName: created.json?.data?.imagePath === fileName,
      metadataImages: created.json?.data?.metadata?.images ?? null,
      rereadStatus: reread?.status ?? null,
      rereadCoverMatches: reread?.json?.data?.imagePath === fileName,
      bodyCarriesEditorUrl: (reread?.json?.data?.body ?? "").includes(editorUrl),
      clearPatchStatus: cleared?.status ?? null,
      coverClearedAfterEmptyImages: cleared?.json?.data?.imagePath === "",
      metadataImagesAfterClear: cleared?.json?.data?.metadata?.images ?? null,
    });
    console.log("[6] editor reference: create =", created.status, "cover =", created.json?.data?.imagePath === fileName,
      "| reread =", reread?.status, "| clear patch =", cleared?.status, "| cover cleared =", cleared?.json?.data?.imagePath === "");
  }

  evidence.dbAfter = {
    contentBefore,
    contentAfter: (await scalar("select count(*) as n from content_items")).n,
  };
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(LOG_FILE, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`\n[written] ${path.basename(LOG_FILE)}`);
  console.log(`[cleanup-pending] contentId=${contentId} fileName=${fileName} fixture=${fixturePath} artifactsBefore=${artifactsBefore} contentBefore=${contentBefore}`);
}

main().catch((error) => {
  evidence.error = { name: error?.name, message: String(error?.message ?? error) };
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(LOG_FILE, JSON.stringify(evidence, null, 2), "utf8");
  console.error("ERR", error);
  process.exitCode = 1;
});

