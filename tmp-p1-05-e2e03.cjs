/* eslint-disable @typescript-eslint/no-require-imports -- 临时取证脚本：Node CommonJS 入口只能用 require */

/**
 * CI-P1-05 阶段 2 / E2E-03：视频（任务查询 → 产物读取 → Range → 失败状态）
 *
 * 授权口径：使用 `web-data/videos` 中已标记的测试素材（`render-*` / `video-*`），**全部只读**，
 * 不启动 worker、不新上传、不重跑渲染。目的：确认「字节副本 ≠ 重新编码」并明确标注
 * 当前适配器为 pass-through（`existing-video-package`，`encoded: false`，见 `src/lib/videos/video-renderer.ts`）。
 *
 * 用法：node tmp-p1-05-e2e03.cjs
 * 证据：tmp-p1-05-e2e03.log.json
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createClient } = require("@libsql/client");

const BASE = process.env.COOLPILOT_BASE_URL || "http://127.0.0.1:3000";
const ROOT = __dirname;
const VIDEOS = path.join(ROOT, "web-data", "videos");
const LOG_FILE = path.join(ROOT, "tmp-p1-05-e2e03.log.json");

const evidence = { case: "E2E-03", base: BASE, mode: "read-only", startedAt: new Date().toISOString(), steps: [] };
const record = (step, data) => evidence.steps.push({ step, at: new Date().toISOString(), ...data });
const short = (value, max = 400) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text && text.length > max ? `${text.slice(0, max)}…(${text.length} chars)` : text;
};
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** `resultUrl` is a serving address (`/api/videos?file=…`), so the file name comes from `file=`. */
function fileNameFromUrl(url) {
  if (!url) return "";
  return new URL(url, "http://coolpilot.local").searchParams.get("file") ?? "";
}

async function call(method, url, headers = {}, timeoutMs = 60000) {
  const res = await fetch(`${BASE}${url}`, { method, headers, signal: AbortSignal.timeout(timeoutMs) });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString("utf8"));
  } catch {
    /* binary or non-JSON */
  }
  return {
    status: res.status,
    json,
    bytes: buf,
    contentType: res.headers.get("content-type"),
    contentRange: res.headers.get("content-range"),
    acceptRanges: res.headers.get("accept-ranges"),
    contentLength: res.headers.get("content-length"),
  };
}

const db = createClient({ url: "file:web-data/social-auto-post.db" });
async function rows(sql) {
  const r = await db.execute(sql);
  return r.rows.map((row) => JSON.parse(JSON.stringify(row)));
}

function videoFiles() {
  return fs.readdirSync(VIDEOS).sort();
}

async function main() {
  const filesOnDisk = videoFiles();
  const hashes = Object.fromEntries(
    filesOnDisk.map((name) => {
      const buf = fs.readFileSync(path.join(VIDEOS, name));
      return [name, { bytes: buf.length, sha256: sha(buf).slice(0, 16), encoded: null }];
    }),
  );
  record("0-files-on-disk", { filesOnDisk, hashes });

  // ---------- 步骤 1：统一任务查询（video_render 的 run → TaskView）----------
  const tasksAll = await call("GET", "/api/tasks?kind=playbook&limit=200");
  const renders = (tasksAll.json?.data?.tasks ?? []).filter((task) => task.type === "video_render");
  const badKind = await call("GET", "/api/tasks?kind=e2e05-bogus");
  record("1-task-query", {
    status: tasksAll.status,
    totalTasks: tasksAll.json?.data?.total ?? null,
    renderTasks: renders,
    statusHistogram: renders.reduce((acc, task) => ({ ...acc, [task.status]: (acc[task.status] ?? 0) + 1 }), {}),
    unknownKind: { status: badKind.status, error: badKind.json?.error ?? null },
  });
  console.log("[1] tasks:", tasksAll.status, "total =", tasksAll.json?.data?.total, "video_render =", renders.length,
    JSON.stringify(renders.map((t) => `${t.status}/${t.rawStatus}`)), "| bogus kind =", badKind.status);

  // ---------- 步骤 2：每个渲染任务的详情与产物核对 ----------
  const details = [];
  for (const task of renders) {
    const detail = await call("GET", `/api/tasks/${task.id}`);
    const resultUrl = detail.json?.data?.task?.resultUrl ?? "";
    const fileName = fileNameFromUrl(resultUrl);
    details.push({
      id: task.id,
      status: detail.json?.data?.task?.status ?? null,
      rawStatus: detail.json?.data?.task?.rawStatus ?? null,
      error: detail.json?.data?.task?.error ?? null,
      progress: detail.json?.data?.task?.progress ?? null,
      resultUrl,
      resultFileExists: fileName ? fs.existsSync(path.join(VIDEOS, fileName)) : false,
      resultFileSha: fileName && fs.existsSync(path.join(VIDEOS, fileName)) ? hashes[fileName]?.sha256 ?? null : null,
      logCount: (detail.json?.data?.logs ?? []).length,
      firstLog: (detail.json?.data?.logs ?? [])[0] ?? null,
      lastLog: (detail.json?.data?.logs ?? []).slice(-1)[0] ?? null,
    });
  }
  record("2-task-details", details);
  for (const entry of details) {
    console.log("[2]", entry.id, entry.status, entry.rawStatus, "| result:", entry.resultUrl || "(none)", "| file exists:", entry.resultFileExists, "| logs:", entry.logCount);
  }


  // ---------- 步骤 3：视频库列表 + 逐文件全量读取与 Range ----------
  const library = await call("GET", "/api/videos");
  const listed = library.json?.data?.videos ?? [];
  const reads = [];
  for (const video of listed) {
    const full = await call("GET", `/api/videos?file=${encodeURIComponent(video.fileName)}`);
    const rangeHead = await call("GET", `/api/videos?file=${encodeURIComponent(video.fileName)}`, { Range: "bytes=0-99" });
    const rangeTail = await call("GET", `/api/videos?file=${encodeURIComponent(video.fileName)}`, { Range: `bytes=${video.size + 10}-` });
    reads.push({
      fileName: video.fileName,
      size: video.size,
      full: { status: full.status, contentType: full.contentType, bytes: full.bytes.length, acceptRanges: full.acceptRanges, sha256: sha(full.bytes).slice(0, 16) },
      rangeFirst100: {
        status: rangeHead.status,
        contentRange: rangeHead.contentRange,
        contentLength: rangeHead.contentLength,
        bytes: rangeHead.bytes.length,
        matchesPrefix: full.bytes.subarray(0, rangeHead.bytes.length).equals(rangeHead.bytes),
      },
      rangeBeyondEnd: { status: rangeTail.status, contentRange: rangeTail.contentRange, bytes: rangeTail.bytes.length },
      bytesMatchDisk: sha(full.bytes).slice(0, 16) === hashes[video.fileName]?.sha256,
    });
  }
  record("3-video-reads", {
    libraryStatus: library.status,
    listedCount: listed.length,
    listedNames: listed.map((v) => v.fileName),
    reads,
  });
  for (const read of reads) {
    console.log("[3]", read.fileName, "full =", read.full.status, read.full.contentType, read.full.bytes, "bytes",
      "| range 0-99 =", read.rangeFirst100.status, read.rangeFirst100.contentRange,
      "| range beyond end =", read.rangeBeyondEnd.status, read.rangeBeyondEnd.contentRange,
      "| bytes match disk =", read.bytesMatchDisk);
  }

  // ---------- 步骤 4：失败/边界路径（缺失文件、路径穿越、非视频扩展名）----------
  const sidecars = filesOnDisk.filter((name) => !name.toLowerCase().endsWith(".mp4"));
  const missing = await call("GET", "/api/videos?file=e2e05-missing.mp4");
  const traversal = await call("GET", "/api/videos?file=..%2Fsocial-auto-post.db");
  const sidecarProbe = sidecars[0]
    ? await call("GET", `/api/videos?file=${encodeURIComponent(sidecars[0])}`)
    : null;
  const noFile = await call("GET", "/api/videos");
  record("4-failure-paths", {
    missingFile: { status: missing.status, body: short(missing.bytes.toString("utf8"), 40) },
    pathTraversal: { status: traversal.status, body: short(traversal.bytes.toString("utf8"), 40) },
    sidecarViaVideosRoute: sidecarProbe
      ? { fileName: sidecars[0], status: sidecarProbe.status, body: short(sidecarProbe.bytes.toString("utf8"), 40) }
      : null,
    listWithoutFile: { status: noFile.status, count: (noFile.json?.data?.videos ?? []).length },
  });
  console.log("[4] failures: missing =", missing.status, "| traversal =", traversal.status,
    "| sidecar(", sidecars[0], ") =", sidecarProbe?.status, "| list(no file) =", noFile.status, (noFile.json?.data?.videos ?? []).length);

  // ---------- 步骤 5：字节副本取证（同一 sha256 分组 + 渲染清单 encoded:false）----------
  const byHash = {};
  for (const [name, meta] of Object.entries(hashes)) (byHash[meta.sha256] ??= []).push(name);
  const manifestFiles = filesOnDisk.filter((name) => name.endsWith(".json"));
  const manifestName = manifestFiles[0] ?? null;
  const manifest = manifestName ? JSON.parse(fs.readFileSync(path.join(VIDEOS, manifestName), "utf8")) : null;
  const mp4Files = filesOnDisk.filter((name) => name.endsWith(".mp4"));
  const manifests = manifestFiles.map((name) => {
    const data = JSON.parse(fs.readFileSync(path.join(VIDEOS, name), "utf8"));
    const videoRef = data.artifacts?.video;
    const outputName = typeof videoRef === "string" ? fileNameFromUrl(videoRef) || path.basename(videoRef) : videoRef?.fileName ?? "";
    const sourceName = data.materials?.video?.fileName ?? "";
    return {
      manifestFile: name,
      taskId: data.taskId ?? null,
      template: data.template ?? null,
      renderer: data.renderer ?? null,
      outputName,
      sourceName,
      outputSha256_16: hashes[outputName]?.sha256 ?? null,
      sourceSha256_16: hashes[sourceName]?.sha256 ?? null,
      outputIsByteCopyOfSource:
        Boolean(outputName && sourceName) && hashes[outputName]?.sha256 === hashes[sourceName]?.sha256,
      subtitles: data.artifacts?.subtitles ?? null,
      cover: data.artifacts?.cover ?? null,
    };
  });
  record("5-byte-copy-evidence", {
    identicalGroups: byHash,
    allMp4Identical: new Set(mp4Files.map((name) => hashes[name].sha256)).size === 1,
    manifestFile: manifestName,
    manifest,
    manifests,
  });
  console.log("[5] sha256 groups:", JSON.stringify(byHash), "| all mp4 identical =", new Set(mp4Files.map((n) => hashes[n].sha256)).size === 1);
  for (const entry of manifests) {
    console.log("[5]", entry.manifestFile, "renderer =", JSON.stringify(entry.renderer), "| output", entry.outputName,
      "sha =", entry.outputSha256_16, "| source", entry.sourceName, "sha =", entry.sourceSha256_16,
      "| byte copy =", entry.outputIsByteCopyOfSource);
  }

  // ---------- 步骤 6：数据库侧 runs 记录（只读）----------
  const runRows = await rows(
    "select id, playbook_id, status, result_message, artifact_path, params_json, started_at, finished_at from runs where playbook_id='video_render' order by created_at",
  );
  record("6-runs-db", runRows);
  for (const row of runRows) {
    console.log("[6]", row.id, row.status, "| artifact:", row.artifact_path, "| msg:", short(row.result_message, 100));
  }

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

