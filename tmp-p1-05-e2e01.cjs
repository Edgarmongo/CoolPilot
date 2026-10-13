/* eslint-disable @typescript-eslint/no-require-imports -- 临时取证脚本：Node CommonJS 入口只能用 require */

/**
 * CI-P1-05 阶段 2 / E2E-01：文章生成与持久化（真实模型调用 **仅 1 次**）
 *
 * 用法：node tmp-p1-05-e2e01.cjs
 * 证据：tmp-p1-05-e2e01.log.json（完整请求/响应/DB 核对），与 tmp-e2e-baseline-e2e01-*.json 配套。
 *
 * 写操作边界（授权口径）：只写自建的 `E2E05-` 前缀测试内容，跑完自行删除。
 * 不启动 worker、不做真实发布、不触发图片生成（imageStrategy=product 且无产品图 → resolveArticleImages 返回 []）。
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@libsql/client");

const BASE = process.env.COOLPILOT_BASE_URL || "http://127.0.0.1:3000";
const ROOT = __dirname;
const MARK = `E2E05-文章生成-${Date.now()}`;
const LOG_FILE = path.join(ROOT, "tmp-p1-05-e2e01.log.json");

const evidence = { case: "E2E-01", mark: MARK, base: BASE, startedAt: new Date().toISOString(), steps: [] };
function record(step, data) {
  evidence.steps.push({ step, at: new Date().toISOString(), ...data });
}
const short = (value, max = 600) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text && text.length > max ? `${text.slice(0, max)}…(${text.length} chars)` : text;
};

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
  const r = await db.execute(sql);
  return r.rows[0] ? JSON.parse(JSON.stringify(r.rows[0])) : null;
}
async function rows(sql) {
  const r = await db.execute(sql);
  return r.rows.map((row) => JSON.parse(JSON.stringify(row)));
}


async function main() {
  // ---------- 步骤 1：配置检查（只读，不自动修改配置）----------
  const runtime = await call("GET", "/api/ai/runtime", undefined, 30000);
  const settings = await call("GET", "/api/settings/ai", undefined, 30000);
  const d = runtime.json?.data ?? {};
  const openai = (d.providers ?? []).find((p) => p.provider?.providerId === "openai");
  const configCheck = {
    httpStatus: runtime.status,
    defaults: d.defaults ?? null,
    enabledModelCount: (await scalar("select count(*) as n from ai_models where enabled=1")).n,
    enabledModels: await rows(
      "select id, provider_id, endpoint_id, model_id, display_name, model_type, context_window, enabled from ai_models where enabled=1 order by model_id",
    ),
    preferences: await rows("select * from ai_model_preferences"),
    credentialKeyCount: (await scalar("select count(*) as n from ai_credential_keys")).n,
    openaiEndpoint: openai?.endpoints?.[0]
      ? {
          endpointId: openai.endpoints[0].endpointId,
          baseUrl: openai.endpoints[0].baseUrl,
          protocol: openai.endpoints[0].protocol,
          status: openai.endpoints[0].status,
          usableKeyCount: openai.endpoints[0].usableKeyCount,
          modelCount: openai.endpoints[0].modelCount,
          callableCount: openai.endpoints[0].callableCount,
        }
      : null,
    chat: (d.capabilities ?? []).find((c) => c.capability === "chat") ?? null,
    structuredOutput: (d.capabilities ?? []).find((c) => c.capability === "structured_output") ?? null,
    settings: {
      textProvider: settings.json?.data?.textProvider ?? null,
      openAIModel: settings.json?.data?.openAIModel ?? null,
      openAIBaseUrl: settings.json?.data?.openAIBaseUrl ?? null,
    },
  };
  record("1-config-check", configCheck);
  console.log("[1] config:", short({
    chat: configCheck.chat,
    structuredOutput: configCheck.structuredOutput,
    enabledModelCount: configCheck.enabledModelCount,
    enabledModels: configCheck.enabledModels.map((m) => `${m.provider_id}/${m.model_id}`),
    preferences: configCheck.preferences.length,
    openaiEndpoint: configCheck.openaiEndpoint,
    defaults: configCheck.defaults,
    settings: configCheck.settings,
  }, 1200));

  // ---------- 步骤 2：生成前数据库基线 ----------
  const before = {
    content: (await scalar("select count(*) as n from content_items")).n,
    usage: (await scalar("select count(*) as n from usage_records")).n,
    runs: (await scalar("select count(*) as n from runs")).n,
  };
  record("2-db-before", before);
  console.log("[2] db before:", JSON.stringify(before));


  // ---------- 步骤 3：唯一 1 次真实文本模型调用 ----------
  const payload = {
    topic: MARK,
    prompt: "受控端到端测试样本：写一段 120 字以内的中文短文。",
    maxWords: 120,
    languageCode: "zh-CN",
    type: "article",
    articleStyle: "advertorial",
    industry: "general",
    audience: "unlimited",
    imageStrategy: "product",
    imageCount: "few",
    deAi: false,
    knowledgeMode: "position",
    positioningId: "",
  };
  const generated = await call("POST", "/api/content/generate", payload);
  const item = generated.json?.data?.item ?? null;
  record("3-generate", {
    request: payload,
    status: generated.status,
    ms: generated.ms,
    ok: generated.json?.ok ?? false,
    error: generated.json?.error ?? null,
    provider: generated.json?.data?.provider ?? null,
    model: generated.json?.data?.model ?? null,
    images: generated.json?.data?.images ?? null,
    item: item
      ? {
          id: item.id,
          title: item.title,
          status: item.status,
          bodyLength: (item.body ?? "").length,
          postReadyLength: (item.postReadyText ?? "").length,
          imagePath: item.imagePath,
          metadata: item.metadata,
        }
      : null,
    bodyPreview: short(item?.body ?? generated.text, 300),
    rawIfFailed: item ? null : short(generated.text, 800),
  });
  console.log(
    "[3] generate:",
    generated.status,
    generated.json?.ok,
    item
      ? `id=${item.id} title=${item.title} bodyLen=${(item.body ?? "").length} images=${JSON.stringify(generated.json?.data?.images)} provider=${generated.json?.data?.provider} model=${generated.json?.data?.model}`
      : short(generated.text, 600),
  );

  const afterGenerate = {
    content: (await scalar("select count(*) as n from content_items")).n,
    usage: (await scalar("select count(*) as n from usage_records")).n,
  };
  record("4-db-after-generate", {
    ...afterGenerate,
    delta: { content: afterGenerate.content - before.content, usage: afterGenerate.usage - before.usage },
  });
  if (item) {
    record("4b-usage-row", await rows(
      `select provider, model, kind, status, input_tokens, output_tokens, total_tokens, word_count, content_item_id from usage_records where content_item_id='${item.id}'`,
    ));
  }

  if (!item) {
    console.log("[3] 未产出内容条目 → 跳过持久化步骤，按配置问题/产品缺陷归档");
  } else {
    // ---------- 步骤 5：重新打开（GET 读回 + DB 行核对）----------
    const reopened = await call("GET", `/api/content/${item.id}`);
    const dbRow = await scalar(
      `select id, title, body, post_ready_text, image_path, metadata_json, status from content_items where id='${item.id}'`,
    );
    const reopenCheck = {
      status: reopened.status,
      titleMatches: reopened.json?.data?.title === item.title,
      bodyMatches: reopened.json?.data?.body === item.body,
      metadataMatches: JSON.stringify(reopened.json?.data?.metadata) === JSON.stringify(item.metadata),
      postReadyMatches: reopened.json?.data?.postReadyText === `${item.title}\n\n${item.body}`.trim(),
      dbRow,
    };
    record("5-reopen", reopenCheck);
    console.log("[5] reopen:", reopenCheck.status, "title/body/metadata/postReady =", reopenCheck.titleMatches, reopenCheck.bodyMatches, reopenCheck.metadataMatches, reopenCheck.postReadyMatches);
  }

  if (item) {
    // ---------- 步骤 6：修改并再次保存 ----------
    const patch = {
      title: `${MARK}-已修改`,
      body: `${MARK} 正文修改后：这是受控 E2E 编辑步骤写入的内容。`,
    };
    patch.postReadyText = `${patch.title}\n\n${patch.body}`;
    const patched = await call("PATCH", `/api/content/${item.id}`, patch);
    const afterPatch = await call("GET", `/api/content/${item.id}`);
    const patchedRow = await scalar(
      `select title, body, post_ready_text, image_path, status from content_items where id='${item.id}'`,
    );
    const patchCheck = {
      request: patch,
      patchStatus: patched.status,
      patchBody: short(patched.text, 400),
      reopenStatus: afterPatch.status,
      titlePersisted: afterPatch.json?.data?.title === patch.title,
      bodyPersisted: afterPatch.json?.data?.body === patch.body,
      postReadyPersisted: afterPatch.json?.data?.postReadyText === patch.postReadyText,
      dbRow: patchedRow,
    };
    record("6-patch", patchCheck);
    console.log("[6] patch:", patchCheck.patchStatus, "persisted title/body/postReady =", patchCheck.titlePersisted, patchCheck.bodyPersisted, patchCheck.postReadyPersisted);

    // ---------- 步骤 7：失败路径（不存在的 id）----------
    const missing = await call("GET", "/api/content/E2E05-not-a-real-id");
    record("7-failure-404", { status: missing.status, body: short(missing.text, 200) });
    console.log("[7] missing id:", missing.status);

    // ---------- 步骤 8：删除并核对总数回落 ----------
    const deleted = await call("DELETE", `/api/content/${item.id}`);
    const afterDelete = await call("GET", `/api/content/${item.id}`);
    const finalCounts = {
      content: (await scalar("select count(*) as n from content_items")).n,
      usage: (await scalar("select count(*) as n from usage_records")).n,
      runs: (await scalar("select count(*) as n from runs")).n,
      leftoverE2E05: (
        await scalar("select count(*) as n from content_items where title like 'E2E05-%'")
      ).n,
    };
    record("8-delete", {
      deleteStatus: deleted.status,
      deleteBody: short(deleted.text, 200),
      getAfterDeleteStatus: afterDelete.status,
      dbAfter: finalCounts,
      contentBackToBaseline: finalCounts.content === before.content,
    });
    console.log("[8] delete:", deleted.status, "get-after-delete:", afterDelete.status, "content:", before.content, "->", finalCounts.content, "leftover E2E05 rows:", finalCounts.leftoverE2E05);
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

