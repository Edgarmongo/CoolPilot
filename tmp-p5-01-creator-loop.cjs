/* eslint-disable @typescript-eslint/no-require-imports -- 临时取证脚本：Node CommonJS 入口只能用 require */

/**
 * CI-P5-01「创作业务闭环」真实验证（真实 HTTP + 真实 Chromium + **真实模型调用 1 次**）
 *
 * 验收条目 → 本脚本步骤
 *   P5-01-01 创建选题        step1 topic create/readback
 *   P5-01-02 选择品牌资料    step1 brand create/readback + step2 UI 选择品牌
 *   P5-01-03 添加研究素材/摘要 step1 material create/readback + step2 UI 由素材库进入（?researchMaterialId=）
 *   P5-01-04 调用 AI 生成文章 step2 UI「生成文章」→ POST /api/content/generate（真实模型 1 次）
 *   P5-01-05 生成/选择图片与封面 step3 上传图片 → 指定封面 → 重开页面确认被画出（生成分支单独取证）
 *   P5-01-06 保存文章并重新打开 step4 深链 ?edit=<id> 重开
 *   P5-01-07 修改文章并再次保存 step4 编辑器内改标题 → 存草稿 → API 复核
 *   P5-01-08 正文/图片/关联一致 step5 断言（标题/正文/图片引用/品牌·素材·选题关联）
 *   后续工作流衔接            step6 去发布对话框 + 平台版本派生 + 生命周期读模型
 *
 * 数据边界（授权口径）：只写自建 `E2E05-` 前缀的选题/品牌/研究素材/内容/图片，跑完逐条删除并核对计数回落。
 * 不启动 worker、不做真实发布点击、不改配置、不删既有数据（既有 19 条内容 / 37 个 artifacts 一律不动）。
 *
 * 用法：node tmp-p5-01-creator-loop.cjs
 * 证据：tmp-p5-01-creator-loop.log.json（完整请求/响应/断言），前置指纹 tmp-e2e-baseline-p5-01-before.json
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@libsql/client");
const { chromium } = require("playwright");

const BASE = process.env.COOLPILOT_BASE_URL || "http://127.0.0.1:3000";
const ROOT = __dirname;
const LOG_FILE = path.join(ROOT, "tmp-p5-01-creator-loop.log.json");
const ARTIFACTS = path.join(ROOT, "web-data", "artifacts");
const LOCALE = "zh-cn";
const STAMP = Date.now();
const MARK = `E2E05-创作闭环-${STAMP}`;
const PNG_ONE_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

const evidence = { card: "CI-P5-01", mark: MARK, base: BASE, locale: LOCALE, startedAt: new Date().toISOString(), checks: [], steps: [] };
const record = (step, data) => evidence.steps.push({ step, at: new Date().toISOString(), ...data });
function check(name, ok, detail) {
  evidence.checks.push({ name, ok: Boolean(ok), detail: detail === undefined ? "" : detail });
  if (!ok) evidence.failed = true;
  return Boolean(ok);
}
const short = (value, max = 400) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text && text.length > max ? `${text.slice(0, max)}…(${text.length} chars)` : text;
};

/** Any item a generation response created is remembered, so cleanup never has to guess by title. */
function rememberItem(response, kind) {
  const id = response?.json?.data?.item?.id;
  if (!id) return "";
  evidence.createdIds = [...new Set([...(evidence.createdIds ?? []), id])];
  if (kind === "unexpected") evidence.unexpectedItems = [...(evidence.unexpectedItems ?? []), id];
  return id;
}

async function call(method, url, body, timeoutMs = 240000) {
  const started = Date.now();
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
    /* non-JSON body */
  }
  return { status: res.status, ms: Date.now() - started, json, text };
}

const db = createClient({ url: "file:web-data/social-auto-post.db" });
async function scalar(sql) {
  const result = await db.execute(sql);
  return result.rows[0] ? JSON.parse(JSON.stringify(result.rows[0])) : null;
}
async function counts() {
  const one = async (table) => (await scalar(`select count(*) as n from ${table}`)).n;
  return {
    content_items: await one("content_items"),
    topics: await one("topics"),
    brands: await one("brands"),
    research_materials: await one("research_materials"),
    schedules: await one("schedules"),
    publish_records: await one("publish_records"),
    runs: await one("runs"),
    usage_records: await one("usage_records"),
    ai_usage_ledger: await one("ai_usage_ledger"),
    artifactsFiles: fs.existsSync(ARTIFACTS) ? fs.readdirSync(ARTIFACTS).length : null,
  };
}

const articleEditorHref = (id) => `/${LOCALE}/creation/articles?edit=${encodeURIComponent(id)}`;
const articlesHref = `/${LOCALE}/creation/articles`;
const libraryHref = `/${LOCALE}/content/library`;

/**
 * Clicks a real button by its accessible name. The console dialogs are taller than the default
 * 720p viewport, so Playwright can refuse the click ("element is outside of the viewport") even after
 * scrolling: this waits for the element, scrolls it into view, and only if the native click is still
 * refused dispatches the DOM click on the very same element (React's handler runs; nothing is faked).
 */
async function clickButton(page, name, exact = false) {
  const button = page.getByRole("button", { name, exact });
  await button.waitFor({ timeout: 60_000 });
  await button.scrollIntoViewIfNeeded().catch(() => undefined);
  try {
    await button.click({ timeout: 30_000 });
    record("click", { name, strategy: "native" });
  } catch (error) {
    await button.dispatchEvent("click");
    record("click", { name, strategy: "dispatchEvent", reason: String(error?.message ?? error).split("\n")[0] });
  }
}

async function main() {
  const runStartedAtMs = Date.now();
  const before = await counts();
  record("0-before-counts", { before, runStartedAtMs, runStartedAt: new Date(runStartedAtMs).toISOString() });
  const runtime = await call("GET", "/api/ai/runtime", undefined, 30000);
  const capabilities = (runtime.json?.data?.capabilities ?? []).find((entry) => entry.capability === "chat");
  record("0-runtime", { chat: capabilities ?? null, defaults: runtime.json?.data?.defaults ?? null });

  // ---------- step1：素材输入三方建档（选题 / 品牌资料 / 研究素材） ----------
  const topicRes = await call("POST", "/api/topics", {
    title: `${MARK}-选题`,
    description: "E2E05 受控测试选题：桌面收纳与换季整理。",
    keywords: ["收纳", "整理"],
    source: "manual",
    status: "active",
  });
  const brandRes = await call("POST", "/api/brands", {
    name: `${MARK}-品牌`,
    description: "E2E05 受控测试品牌资料：主打可复用的塑料收纳箱。",
    targetAudience: "一线城市租房青年",
    tone: "克制、给步骤、不夸张",
    keywords: ["可堆叠", "透明箱体"],
    bannedWords: ["最便宜"],
  });
  const materialRes = await call("POST", "/api/research", {
    title: `${MARK}-素材`,
    content:
      "受控测试素材正文：先清空台面，再按使用频率分三区；常用物品放在腰线高度，重物下沉，视觉噪音上收。",
    tags: ["E2E05", "收纳"],
  });
  const topic = topicRes.json?.data ?? null;
  const brand = brandRes.json?.data ?? null;
  const material = materialRes.json?.data ?? null;
  record("1-fixtures", {
    topic: { status: topicRes.status, id: topic?.id ?? null, title: topic?.title ?? null },
    brand: { status: brandRes.status, id: brand?.id ?? null, name: brand?.name ?? null, updatedAt: brand?.updatedAt ?? null },
    material: { status: materialRes.status, id: material?.id ?? null, kind: material?.kind ?? null, materialStatus: material?.status ?? null },
  });
  check("P5-01-01 创建选题 201 + 读回字段一致", topicRes.status === 201 && topic?.title === `${MARK}-选题`, short(topicRes.json));
  check("P5-01-02 创建品牌资料 201 + 读回字段一致", brandRes.status === 201 && brand?.name === `${MARK}-品牌`, short(brandRes.json));
  check(
    "P5-01-03 创建研究素材 201 + kind=text/status=ready",
    materialRes.status === 201 && material?.kind === "text" && material?.status === "ready",
    short(materialRes.json),
  );
  if (!topic?.id || !brand?.id || !material?.id) throw new Error("fixtures missing");

  const topicRead = await call("GET", `/api/topics/${topic.id}`);
  const brandRead = await call("GET", `/api/brands/${brand.id}`);
  const materialRead = await call("GET", `/api/research/${material.id}`);
  check(
    "P5-01-01/02/03 建档后逐条读回（GET 单条 200）",
    topicRead.status === 200 && brandRead.status === 200 && materialRead.status === 200,
    JSON.stringify({ topic: topicRead.status, brand: brandRead.status, material: materialRead.status }),
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 2000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  const artifactsBefore = new Set(fs.existsSync(ARTIFACTS) ? fs.readdirSync(ARTIFACTS) : []);

  try {
    // ---------- step2：真实 UI 创作入口（素材库 → 文章创作 → AI 生成） ----------
    await page.goto(`${BASE}${articlesHref}?researchMaterialId=${encodeURIComponent(material.id)}`, {
      waitUntil: "domcontentloaded",
    });
    const dialogOpened = await page
      .waitForFunction(() => document.body.innerText.includes("AI 生成文章"), undefined, { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    check("P5-01-03 UI：?researchMaterialId= 打开生成对话框", dialogOpened, `url=${page.url()} errors=${pageErrors.join(" | ") || "none"}`);

    const materialSelect = page.locator('label:has-text("从素材库选择") select').first();
    await materialSelect.waitFor({ timeout: 30_000 });
    await page
      .waitForFunction((id) => Array.from(document.querySelectorAll("select")).some((node) => node.value === id), material.id, {
        timeout: 30_000,
      })
      .catch(() => undefined);
    const preselectedMaterial = await materialSelect.inputValue();
    check("P5-01-03 UI：素材已被预选（id 与建档一致）", preselectedMaterial === material.id, preselectedMaterial);

    const topicSelect = page.locator('label:has-text("从选题库选择") select').first();
    await topicSelect.selectOption({ value: topic.id });
    const brandSelect = page.locator('label:has-text("品牌资料") select').first();
    await brandSelect.selectOption({ value: brand.id });
    const topicInput = page.locator('input[placeholder*="八爪鱼"]').first();
    const prefilledTopic = await topicInput.inputValue();
    check("P5-01-01 UI：选中选题后主题被预填", prefilledTopic === topic.title, prefilledTopic);
    const brandValue = await brandSelect.inputValue();
    check("P5-01-02 UI：品牌资料可选并选中", brandValue === brand.id, brandValue);
    record("2-ui-form", { dialogOpened, preselectedMaterial, prefilledTopic, brandValue });

    // ---------- step2 续：真实生成（本轮唯一一次模型调用） ----------
    const generatedAt = Date.now();
    await clickButton(page, "生成文章", true);
    const generated = await page
      .waitForFunction(() => document.body.innerText.includes("文章ID:"), undefined, { timeout: 300_000 })
      .then(() => true)
      .catch(() => false);
    const uiFailureNotice = await page
      .locator("text=生成失败")
      .first()
      .isVisible()
      .catch(() => false);
    check(
      "P5-01-04 UI：真实生成后进入编辑器（文章ID 标记出现）",
      generated,
      `generated=${generated} failureNotice=${uiFailureNotice} errors=${pageErrors.join(" | ") || "none"}`,
    );
    if (!generated) throw new Error(`generation did not open the editor (failureNotice=${uiFailureNotice})`);

    const editorTitle = await page.locator('input[placeholder*="八爪鱼"]').first().inputValue();
    const editorBodyText = (await page.locator('div[contenteditable="true"]').first().innerText()).replace(/\s+/g, " ").trim();
    record("2-ui-generated", { editorTitle, bodyChars: editorBodyText.length, generationMs: Date.now() - generatedAt });
    check("P5-01-04 生成文章标题非空", editorTitle.trim().length > 0, editorTitle);
    check("P5-01-04 编辑器正文非空", editorBodyText.length > 20, `chars=${editorBodyText.length}`);

    const listed = await call("GET", "/api/content?pageSize=5");
    const item = (listed.json?.data?.items ?? []).find((entry) => entry.title === editorTitle) ?? null;
    check("P5-01-04 生成结果已落库（内容库首屏可见）", Boolean(item), short(listed.json?.data ?? null));
    if (!item) throw new Error("generated item not found in /api/content");
    const itemId = item.id;
    evidence.itemId = itemId;
    evidence.createdIds = [itemId];

    const stored = await call("GET", `/api/content/${itemId}`);
    const storedItem = stored.json?.data ?? {};
    const meta = storedItem.metadata ?? {};
    check("P5-01-06 保存：GET /api/content/<id> 200", stored.status === 200, `status=${stored.status}`);
    check("P5-01-04 生成文章正文非空", typeof storedItem.body === "string" && storedItem.body.trim().length > 20, `bodyChars=${(storedItem.body ?? "").length}`);
    check("P5-01-04 生成记录 provider/model", Boolean(meta.provider) && Boolean(meta.model), `${meta.provider}/${meta.model}`);
    check(
      "P5-01-02 品牌关联（metadata.brandId/brandVersion）",
      meta.brandId === brand.id && Number(meta.brandVersion) === Number(brand.updatedAt),
      JSON.stringify({ brandId: meta.brandId, brandVersion: meta.brandVersion, expectVersion: brand.updatedAt }),
    );
    check(
      "P5-01-03 研究素材关联（metadata.researchMaterialId/Version）",
      meta.researchMaterialId === material.id && Number(meta.researchMaterialVersion) === Number(material.updatedAt),
      JSON.stringify({ id: meta.researchMaterialId, version: meta.researchMaterialVersion, expectVersion: material.updatedAt }),
    );
    check("P5-01-01 选题关联（metadata.topicId）", meta.topicId === topic.id, String(meta.topicId));
    const topicAfter = await call("GET", `/api/topics/${topic.id}`);
    check(
      "P5-01-01 选题回写产出文章（topic.contentItemId）",
      topicAfter.json?.data?.contentItemId === itemId,
      String(topicAfter.json?.data?.contentItemId ?? ""),
    );
    record("2-persisted", {
      itemId,
      title: storedItem.title,
      status: storedItem.status,
      provider: meta.provider,
      model: meta.model,
      meta: short({ ...meta, aiWriting: undefined }, 700),
    });

    // ---------- step3：图片与封面（P5-01-05） ----------
    const form = new FormData();
    form.append("file", new Blob([PNG_ONE_PIXEL], { type: "image/png" }), "E2E05-cover.png");
    const uploadRes = await fetch(`${BASE}/api/images/upload`, { method: "POST", body: form });
    const uploadJson = await uploadRes.json().catch(() => null);
    const fileName = uploadJson?.data?.fileName ?? "";
    const coverUrl = `/api/agent/artifacts?file=${encodeURIComponent(fileName)}`;
    check("P5-01-05 上传图片 201 且回答存储形态 URL", uploadRes.status === 201 && uploadJson?.data?.url === coverUrl, short(uploadJson));
    const coverPatch = await call("PATCH", `/api/content/${itemId}`, { images: [fileName] });
    check(
      "P5-01-05 PATCH images → imagePath 镜像一致",
      coverPatch.status === 200 && coverPatch.json?.data?.imagePath === fileName && JSON.stringify(coverPatch.json?.data?.metadata?.images) === JSON.stringify([fileName]),
      short({ imagePath: coverPatch.json?.data?.imagePath, images: coverPatch.json?.data?.metadata?.images }),
    );
    const coverCleared = await call("PATCH", `/api/content/${itemId}`, { images: [] });
    const clearedImages = coverCleared.json?.data?.metadata?.images;
    const clearedPath = coverCleared.json?.data?.imagePath;
    const clearedColumn = await scalar(`select image_path as p from content_items where id='${itemId}'`);
    check(
      "P5-01-08 PATCH images:[] 清空图片列表与封面（存储列 image_path 为 ''）",
      coverCleared.status === 200 &&
        Array.isArray(clearedImages) &&
        clearedImages.length === 0 &&
        !clearedPath &&
        clearedColumn?.p === "",
      short({
        images: clearedImages,
        imagePath: clearedPath,
        dbImagePath: clearedColumn?.p,
        note: "API 以「键缺失」表达空封面（src/db/repository.ts:121 `row.imagePath || undefined`），存储列仍为 ''",
      }),
    );
    const coverRestored = await call("PATCH", `/api/content/${itemId}`, { images: [fileName] });
    check("P5-01-05 封面可恢复", coverRestored.json?.data?.imagePath === fileName, String(coverRestored.json?.data?.imagePath));

    // ---------- step4：保存并重新打开（深链）+ 修改并再次保存（UI） ----------
    await page.goto(`${BASE}${articleEditorHref(itemId)}`, { waitUntil: "domcontentloaded" });
    const reopened = await page
      .waitForFunction(() => document.body.innerText.includes("文章ID:"), undefined, { timeout: 90_000 })
      .then(() => true)
      .catch(() => false);
    check("P5-01-06 深链 ?edit=<id> 重新打开编辑器", reopened, `url=${page.url()}`);
    if (!reopened) throw new Error("deep link did not reopen the editor");

    const reopenedTitle = await page.locator('input[placeholder*="八爪鱼"]').first().inputValue();
    const reopenedBody = (await page.locator('div[contenteditable="true"]').first().innerText()).replace(/\s+/g, " ").trim();
    check("P5-01-06 重开后标题与落库一致", reopenedTitle === storedItem.title, reopenedTitle);
    const storedBodyText = String(storedItem.body ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const bodyProbe = storedBodyText.slice(0, 12);
    check("P5-01-06 重开后正文与落库一致（前缀比对）", bodyProbe.length > 0 && reopenedBody.includes(bodyProbe), `probe="${bodyProbe}"`);
    const coverPainted = await page
      .waitForFunction(
        (url) => {
          const image = Array.from(document.images).find((entry) => entry.getAttribute("src") === url);
          return Boolean(image && image.complete && image.naturalWidth > 0);
        },
        coverUrl,
        { timeout: 90_000 },
      )
      .then(() => true)
      .catch(() => false);
    check("P5-01-05 重开编辑器后封面真被画出（naturalWidth>0）", coverPainted, coverUrl);

    const editedTitle = `${reopenedTitle}-已编辑`;
    await page.locator('input[placeholder*="八爪鱼"]').first().fill(editedTitle);
    await clickButton(page, "存草稿");
    const saved = await page
      .waitForFunction(() => document.body.innerText.includes("已储存"), undefined, { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    check("P5-01-07 UI 存草稿得到「已储存」回执", saved, `url=${page.url()}`);

    const afterEdit = await call("GET", `/api/content/${itemId}`);
    const editedItem = afterEdit.json?.data ?? {};
    check("P5-01-07 再次保存后标题已更新", editedItem.title === editedTitle, `${editedItem.title}`);
    check("P5-01-07 再次保存后正文仍在（未被清空）", String(editedItem.body ?? "").trim().length > 20, `bodyChars=${(editedItem.body ?? "").length}`);
    check(
      "P5-01-08 再次保存后图片引用/封面仍一致",
      editedItem.imagePath === fileName && JSON.stringify(editedItem.metadata?.images) === JSON.stringify([fileName]),
      JSON.stringify({ imagePath: editedItem.imagePath, images: editedItem.metadata?.images }),
    );
    check(
      "P5-01-08 再次保存后关联数据未变（品牌/选题/素材）",
      editedItem.metadata?.brandId === brand.id &&
        editedItem.metadata?.topicId === topic.id &&
        editedItem.metadata?.researchMaterialId === material.id,
      JSON.stringify({ brandId: editedItem.metadata?.brandId, topicId: editedItem.metadata?.topicId, researchMaterialId: editedItem.metadata?.researchMaterialId }),
    );
    record("4-reopen-edit-save", { reopenedTitle, editedTitle, status: editedItem.status, updatedAt: editedItem.updatedAt });

    // ---------- step5：内容库管理（真实页面） ----------
    await page.goto(`${BASE}${libraryHref}`, { waitUntil: "domcontentloaded" });
    const inLibrary = await page
      .waitForFunction((title) => document.body.innerText.includes(title), editedTitle, { timeout: 90_000 })
      .then(() => true)
      .catch(() => false);
    check("P5-01-06 内容库列表出现该文章（真实页面渲染）", inLibrary, `url=${page.url()} errors=${pageErrors.join(" | ") || "none"}`);
    const libraryCoverPainted = await page
      .waitForFunction(
        (url) => {
          const image = Array.from(document.images).find((entry) => entry.getAttribute("src") === url);
          return Boolean(image && image.complete && image.naturalWidth > 0);
        },
        coverUrl,
        { timeout: 90_000 },
      )
      .then(() => true)
      .catch(() => false);
    check("P5-01-05 内容库卡片封面真被画出", libraryCoverPainted, coverUrl);

    // ---------- step6：后续工作流衔接（发布入口 / 平台版本 / 生命周期） ----------
    const publishBefore = await scalar("select count(*) as n from publish_records");
    await page.goto(`${BASE}${articleEditorHref(itemId)}`, { waitUntil: "domcontentloaded" });
    await page
      .waitForFunction(() => document.body.innerText.includes("文章ID:"), undefined, { timeout: 90_000 })
      .catch(() => undefined);
    await clickButton(page, "去发布");
    const publishDialog = await page
      .waitForFunction(() => document.body.innerText.includes("选择发布帐号"), undefined, { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    check("后续衔接 UI：编辑器「去发布」打开发布对话框（未点击发布）", publishDialog, `url=${page.url()}`);
    const publishAfter = await scalar("select count(*) as n from publish_records");
    check("后续衔接 未执行真实发布：publish_records 计数未变", publishBefore.n === publishAfter.n, `${publishBefore.n} → ${publishAfter.n}`);

    const platformVersion = await call("POST", `/api/content/${itemId}/platform-versions`, { platform: "头条号", mode: "derive" });
    check(
      "后续衔接 API：平台版本派生（POST /api/content/[id]/platform-versions）",
      platformVersion.status === 200 || platformVersion.status === 201,
      short(platformVersion.json),
    );
    const lifecycle = await call("GET", `/api/content/lifecycle?contentItemId=${encodeURIComponent(itemId)}`);
    const lifecycleRow = (lifecycle.json?.data?.rows ?? []).find((row) => row.contentItemId === itemId) ?? null;
    check(
      "后续衔接 API：生命周期读模型含该内容（GET /api/content/lifecycle）",
      lifecycle.status === 200 && Boolean(lifecycleRow),
      short(lifecycleRow ?? lifecycle.json?.data?.scan ?? null),
    );
    record("6-seams", { publishDialog, platformVersionStatus: platformVersion.status, lifecycleRow: short(lifecycleRow, 400) });

    // ---------- step7：失败场景（均不消耗模型额度） ----------
    const missingGet = await call("GET", "/api/content/e2e05-missing-content", undefined, 30000);
    const missingDelete = await call("DELETE", "/api/content/e2e05-missing-content", undefined, 30000);
    check("失败场景：未知内容 GET/DELETE → 404", missingGet.status === 404 && missingDelete.status === 404, `${missingGet.status}/${missingDelete.status}`);
    const imageGen = await call("POST", "/api/images", { prompt: "E2E05 生成分支探测：桌面收纳箱" }, 60000);
    const imageGenCode = imageGen.json?.error?.code ?? imageGen.json?.code ?? "";
    const imageGenMessage = imageGen.json?.error?.message ?? imageGen.json?.message ?? imageGen.text;
    check(
      "失败场景：图片生成诚实失败（无可用模型，非模拟成功）",
      imageGen.status >= 400 &&
        ["MODEL_CAPABILITY_UNAVAILABLE", "MODEL_NOT_CONFIGURED", "MODEL_CREDENTIAL_MISSING", "MODEL_CREDENTIAL_INVALID"].includes(imageGenCode),
      `${imageGen.status} ${imageGenCode} ${short(imageGenMessage, 160)}`,
    );
    // 契约差异（实测记录，不作为失败）：`topicId` 是「主题提示」，按其路由文档缺失/未知时由调用方的主题行
    // 接管，因此未知 topicId 不 404（上一轮实测 201，并真的发生了一次模型调用）。`researchMaterialId` 是
    // 素材本身，未知 id 必须 404 ——用它做「未知行」的失败场景（该分支在模型调用前返回，不消耗额度）。
    const missingMaterial = await call("POST", "/api/content/generate", { topic: "E2E05-缺失素材", researchMaterialId: "e2e05-missing-material" }, 30000);
    check(
      "失败场景：未知 researchMaterialId → 404 NOT_FOUND（不静默降级）",
      missingMaterial.status === 404 && (missingMaterial.json?.code ?? missingMaterial.json?.error?.code) === "NOT_FOUND",
      short(missingMaterial.json),
    );
    rememberItem(missingMaterial, "unexpected");
    evidence.notes = [
      "未知 topicId 不 404：route.ts 把 topic 定义为「主题提示」（getTopic 返回 null 即沿用调用方主题行，见 §附录 B-10 之前的 P2-03 契约），实测 201 且消耗一次模型调用；与 researchMaterialId 的 404 契约不同，属既有设计而非本轮缺陷。",
      "PATCH images:[] 后 API 响应省略 imagePath 键（src/db/repository.ts:121 `row.imagePath || undefined`），存储列仍为 ''；语义上封面已清空，属类型契约的宽松表达（ContentItem.imagePath 声明为 string）。",
    ];
    record("7-negatives", {
      missingMaterial: { status: missingMaterial.status, code: missingMaterial.json?.code ?? missingMaterial.json?.error?.code },
      imageGen: { status: imageGen.status, code: imageGenCode, upstream: imageGen.json?.error?.details?.upstreamCode ?? imageGen.json?.details?.upstreamCode ?? null },
    });
  } finally {
    // ---------- step8：自建自删（只删 E2E05- 前缀；既有 19 条内容与既有 artifacts 一律不动） ----------
    const cleanupSteps = [];
    // 生成出来的文章标题由模型自己写，**不带** E2E05- 前缀 → 只能按「本次运行记录下来的 id」删，
    // 不按标题前缀猜（上一轮就是按前缀删，导致两条自建内容残留，已人工核对后用 DELETE 逐条清除）。
    for (const id of [...new Set(evidence.createdIds ?? [])]) {
      const res = await call("DELETE", `/api/content/${id}`);
      cleanupSteps.push({ table: "content_items", id, status: res.status, matchedBy: "recorded-id" });
    }
    // 兜底：仍以 E2E05- 前缀扫一遍（只可能命中自建的受控内容），并把命中写进证据。
    const listContent = await call("GET", "/api/content?pageSize=50");
    for (const entry of listContent.json?.data?.items ?? []) {
      if (!String(entry.title ?? "").startsWith("E2E05-")) continue;
      const res = await call("DELETE", `/api/content/${entry.id}`);
      cleanupSteps.push({ table: "content_items", id: entry.id, status: res.status, matchedBy: "E2E05-prefix" });
    }
    for (const [route, table] of [["/api/topics", "topics"], ["/api/brands", "brands"], ["/api/research", "research_materials"]]) {
      const list = await call("GET", route);
      for (const entry of list.json?.data ?? []) {
        if (!String(entry.title ?? entry.name ?? "").startsWith("E2E05-")) continue;
        const res = await call("DELETE", `${route}/${entry.id}`);
        cleanupSteps.push({ table, id: entry.id, status: res.status });
      }
    }
    const nowFiles = fs.existsSync(ARTIFACTS) ? fs.readdirSync(ARTIFACTS) : [];
    const addedFiles = nowFiles.filter((name) => !artifactsBefore.has(name));
    if (addedFiles.length) {
      const res = await call("DELETE", "/api/images", { fileNames: addedFiles });
      cleanupSteps.push({ table: "artifacts", files: addedFiles, status: res.status, deleted: res.json?.data?.deleted ?? null });
    }
    record("8-cleanup", { cleanupSteps });
    await browser.close();
  }

  const after = await counts();
  const delta = Object.fromEntries(Object.keys(before).map((key) => [key, after[key] - before[key]]));
  record("9-after-counts", { after, delta });

  // 残留扫描：本次运行开始后新建的内容，一条都不应该留下（生成文章的标题由模型写，不能靠前缀判断）。
  const residual = await db.execute(`select id, title, status from content_items where created_at >= ${runStartedAtMs}`);
  const residualRows = residual.rows.map((row) => ({ id: String(row.id), title: String(row.title).slice(0, 40), status: String(row.status) }));
  record("9-residual-scan", { residualRows });
  check("本次运行期间新建的内容已全部清除（残留扫描为空）", residualRows.length === 0, short(residualRows));
  check("未发生计划外的模型调用（无意外生成）", (evidence.unexpectedItems ?? []).length === 0, short(evidence.unexpectedItems ?? []));
  check("清理后 content_items 回落基线", after.content_items === before.content_items, `${before.content_items} → ${after.content_items}`);
  check(
    "清理后 topics/brands/research 回落基线",
    after.topics === before.topics && after.brands === before.brands && after.research_materials === before.research_materials,
    short({ topics: [before.topics, after.topics], brands: [before.brands, after.brands], research: [before.research_materials, after.research_materials] }),
  );
  check(
    "清理后 publish_records / runs / schedules 未变",
    after.publish_records === before.publish_records && after.runs === before.runs && after.schedules === before.schedules,
    short({ publish: [before.publish_records, after.publish_records], runs: [before.runs, after.runs], schedules: [before.schedules, after.schedules] }),
  );
  check("清理后 artifacts 文件数回落基线", after.artifactsFiles === before.artifactsFiles, `${before.artifactsFiles} → ${after.artifactsFiles}`);
  check("写入面只有账本/用量计数增长（其余表零漂移）", delta.usage_records >= 1 && delta.ai_usage_ledger >= 1, short(delta));

  evidence.finishedAt = new Date().toISOString();
  evidence.pageErrors = pageErrors;
  fs.writeFileSync(LOG_FILE, JSON.stringify(evidence, null, 2));
  const passed = evidence.checks.filter((entry) => entry.ok).length;
  console.log(`CI-P5-01 ${evidence.failed ? "FAILED" : "PASSED"} — ${passed}/${evidence.checks.length} checks`);
  for (const entry of evidence.checks) {
    console.log(`${entry.ok ? "  ok  " : " FAIL "} ${entry.name}${entry.ok ? "" : ` → ${entry.detail}`}`);
  }
  console.log(`log: ${path.relative(ROOT, LOG_FILE)}  itemId=${evidence.itemId ?? "-"}`);
  if (evidence.failed) process.exitCode = 1;
}

void main().catch((error) => {
  evidence.fatal = String(error?.stack ?? error);
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(LOG_FILE, JSON.stringify(evidence, null, 2));
  console.error(`CI-P5-01 fatal: ${evidence.fatal}`);
  console.error(`log: ${path.relative(ROOT, LOG_FILE)}`);
  process.exitCode = 1;
});
