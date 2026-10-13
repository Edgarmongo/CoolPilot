/**
 * CI-EMB-01 verification harness - section 3 of the acceptance round (2026-10-11).
 *
 * WHAT THIS IS: an **algorithm / plumbing** verification of the semantic recall. It runs the *real* code
 * (`createKnowledgeEmbeddingTask` -> `executeKnowledgeEmbeddingTask` -> `replaceKnowledgeChunks` ->
 * `recallKnowledgeForArticle` -> `selectSemanticKnowledgeReferences`) against a **temp SQLite database**, with a
 * deterministic local embedding function standing in for the provider (a hand-built concept vector). The ranking
 * it produces is therefore a statement about the *algorithm*, the storage and the fallbacks - never a statement
 * about a real model's semantic quality. Every line it prints says which of the two it is.
 *
 * WHAT THIS IS NOT: a real-Provider verification. No key is read, no network call is made (the transport below is
 * the only `fetch`, and it refuses any URL that is not the stub's own host).
 *
 * Run: npx tsx tmp-ciemb-recall-verify.ts
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const startedAt = new Date().toISOString();
const dataDir = mkdtempSync(path.join(tmpdir(), "ciemb-recall-"));
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "recall.db").replace(/\\/g, "/")}`;

/**
 * The whole point of the isolation: this process must not be able to reach a real provider even by accident.
 * `@/test/app-env` is the repository's own neutraliser - it gives every provider key variable a value that
 * holds no keys, so `readAppEnvValue()` never falls back to `.env.local` in the repository root. It is a
 * static import because a module body runs before the imports of the file that pulls it in: by the time
 * anything below resolves a credential, no install key can be seen.
 */
import "@/test/app-env";

const providerId = "gateway";
const modelId = "text-embedding-3-small";
const otherModelId = "text-embedding-3-large";
const stubBaseUrl = "http://ciemb-stub.local/v1";
const positioningId = "pos-a";
const foreignPositionId = "pos-b";
const logFile = path.join(process.cwd(), "tmp-ciemb-recall-verify.log");

const lines: string[] = [];
function out(line = "") {
  lines.push(line);
  console.log(line);
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  out(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` :: ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// The stand-in embedding function: one dimension per product concept
// ---------------------------------------------------------------------------

const concepts: Array<{ id: string; keywords: string[] }> = [
  { id: "completion", keywords: ["完播率", "完播", "看到最后", "留存率", "留存", "钩子", "前五秒"] },
  { id: "growth", keywords: ["涨粉", "粉丝增长", "起号", "账号权重", "关注量", "破播放"] },
  { id: "livestream", keywords: ["直播", "带货", "话术", "憋单", "下单转化"] },
  { id: "editing", keywords: ["剪辑", "剪映", "时间线", "调色", "转场", "素材库"] },
  { id: "tax", keywords: ["财税", "报税", "发票", "增值税", "汇算清缴"] },
  { id: "baby", keywords: ["母婴", "辅食", "育儿", "奶粉"] },
  { id: "travel", keywords: ["酒店", "民宿", "行程", "亲子房"] },
];

function countOccurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

/**
 * A text -> vector: how many times each concept's words occur, then L2-normalised. Deterministic by
 * construction, and *idealised* on purpose: words that share no characters ("完播" in a record, "看到最后" in a
 * query) land on the same dimension, so the plumbing can be exercised on a true paraphrase. A real model is not
 * needed for that claim - and a real model is not what this file is measuring.
 */
function encode(text: string): number[] {
  const vector = concepts.map((concept) =>
    concept.keywords.reduce((sum, keyword) => sum + countOccurrences(text, keyword), 0),
  );
  const norms = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norms === 0 ? vector : vector.map((value) => value / norms);
}

// ---------------------------------------------------------------------------
// The transport: the only `fetch` in this process
// ---------------------------------------------------------------------------

type RecordedCall = { url: string; body: unknown; authorization: string };

const calls: RecordedCall[] = [];
const intercepted: Array<{ url: string; authorization: string }> = [];
const providerFailure: string | null = null;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  const authorization = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
  // The transport refuses to leave the stub host, so "no real call happened" is a property of this file
  // rather than a promise: the attempt is recorded and answered locally, never sent.
  if (!url.startsWith(stubBaseUrl)) {
    intercepted.push({ url, authorization });
    return jsonResponse({ error: { message: "intercepted by the verification harness" } }, 400);
  }
  calls.push({ url, body, authorization });
  if (providerFailure) return jsonResponse({ error: { message: providerFailure } }, 500);
  const texts = (body as { input?: string[] } | null)?.input ?? [];
  return jsonResponse({
    data: texts.map((text, index) => ({ index, embedding: encode(text) })),
    usage: { prompt_tokens: texts.join(" ").length, total_tokens: texts.join(" ").length },
  });
}) as typeof fetch;

const fallbackLog: string[] = [];
const realWarn = console.warn;
console.warn = (...args: unknown[]) => {
  fallbackLog.push(args.map(String).join(" "));
  realWarn(...args);
};

// ---------------------------------------------------------------------------
// The runtime, on a temp database and a stub credential
// ---------------------------------------------------------------------------

async function bootstrap() {
  const { ensureDatabase } = await import("@/db/client");
  await ensureDatabase();
  const runtime = await import("@/features/ai-runtime");
  const runtimeRepository = await import("@/db/repositories/ai-runtime");
  const credentials = await import("@/lib/credentials");
  const settings = await import("@/db/repositories/settings");

  await runtime.ensureModelRuntimeSeeded();
  await credentials.writeCredential(credentials.credentialRefFor(providerId), "sk-stub-ciemb-verify");
  await runtimeRepository.upsertModelEndpoint({
    endpointId: `${providerId}/default`,
    providerId,
    protocol: "openai-compatible",
    baseUrl: stubBaseUrl,
    credentialRef: credentials.credentialRefFor(providerId),
  });
  const models = await runtimeRepository.listModels({ providerId, limit: 500 });
  const target = models.find((model) => model.modelId === modelId);
  if (!target) throw new Error(`the gateway snapshot does not hold ${modelId}`);
  // The snapshot's rows carry no endpoint (`endpoint_id` is empty, exactly as in a fresh install), and the
  // router refuses a model that resolves to no endpoint - so the catalog is applied to *this* endpoint first,
  // which is what a real sync does (`upsertModels` keys on provider + endpoint).
  await runtimeRepository.upsertModels({
    providerId,
    endpointId: `${providerId}/default`,
    source: "verification-harness",
    enableNew: true,
    models: [
      {
        modelId,
        displayName: modelId,
        modelType: "embedding",
        contextWindow: null,
        capabilities: [{ capability: "embedding", supported: true, source: "USER_OVERRIDE", confidence: 1 }],
      },
    ],
  });
  const scoped = await runtimeRepository.listModels({ providerId, endpointId: `${providerId}/default`, limit: 50 });
  const callable = scoped.find((model) => model.modelId === modelId);
  if (!callable) throw new Error(`the harness could not bind ${modelId} to its endpoint`);
  await runtime.setModelDefaultForCapability("embedding", callable.id);
  return { runtime, runtimeRepository, credentials, settings, target: callable };
}

// ---------------------------------------------------------------------------
// Fixtures: a controlled local knowledge base
// ---------------------------------------------------------------------------

/** Long enough that one body of it crosses the 800-character chunk ceiling. */
function repeat(count: number, text: string) {
  return Array.from({ length: count }, () => text).join("");
}

const decoyEditing = repeat(
  17,
  "剪辑时先把时间线对齐，再用剪映的调色面板统一色温，转场只保留两种，素材库按项目分文件夹。",
);
const completionFacts = repeat(
  10,
  "完播的胜负在前五秒：钩子要直接给出结果或冲突，第二条再补完播率的数据，用曲线的斜率判断观众注意力。",
);
const growthFacts = repeat(3, "涨粉靠起号阶段的账号权重，破播放之后再集中做关注量转化。");
const livestreamFacts = repeat(3, "直播带货话术先憋单再下单转化，话术要跟着节奏走。");
const editingFacts = repeat(3, "剪辑工具对比看剪映与专业时间线的差异，调色与转场决定成片质感。");
const babyFacts = repeat(3, "母婴辅食周计划按奶粉阶段安排，育儿节奏比食谱本身更重要。");
const taxFacts = repeat(2, "财税汇算清缴要把增值税发票与报税口径对齐。");

/** The body a record is edited to in the "stale vector" case: the hash moves, the vectors do not. */
const editedCompletion = repeat(2, "完播率的口径改了：只看看到最后的人数，不再看前五秒的钩子。");

async function seedRecords(repository: typeof import("@/db/repositories/knowledge-base")) {
  const created = {
    completion: await repository.createKnowledgeBase({
      title: "短视频完播率提升清单",
      content: decoyEditing + completionFacts,
      category: "reference",
      weight: "medium",
      tags: ["短视频"],
      positionId: positioningId,
    }),
    growth: await repository.createKnowledgeBase({
      title: "账号涨粉的五个动作",
      content: growthFacts,
      category: "other",
      weight: "high",
      tags: ["涨粉"],
      positionId: positioningId,
    }),
    livestream: await repository.createKnowledgeBase({
      title: "直播带货话术模板",
      content: livestreamFacts,
      category: "formula",
      weight: "low",
      tags: ["直播"],
      positionId: positioningId,
    }),
    editing: await repository.createKnowledgeBase({
      title: "剪辑工具对比",
      content: editingFacts,
      category: "reference",
      weight: "medium",
      tags: ["剪辑"],
      positionId: positioningId,
    }),
    disabled: await repository.createKnowledgeBase({
      title: "完播率速成课（已停用）",
      content: completionFacts,
      category: "reference",
      weight: "high",
      tags: ["完播率"],
      positionId: positioningId,
      enabled: false,
    }),
    foreignPosition: await repository.createKnowledgeBase({
      title: "完播率进阶（另一套定位）",
      content: completionFacts,
      category: "reference",
      weight: "high",
      tags: ["完播率"],
      positionId: foreignPositionId,
    }),
    unrelatedTopic: await repository.createKnowledgeBase({
      title: "财税与报税口径速查",
      content: taxFacts,
      category: "other",
      weight: "medium",
      tags: ["财税"],
      positionId: positioningId,
    }),
  };
  return created;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  const { runtime, runtimeRepository, settings, target } = await bootstrap();
  const knowledge = await import("@/db/repositories/knowledge-base");
  const embeddings = await import("@/db/repositories/knowledge-embeddings");
  const task = await import("@/lib/knowledge-embedding/embedding-task");
  const recallModule = await import("@/lib/knowledge-embedding/recall");
  const selectors = await import("@/lib/knowledge-base");
  const pure = await import("@/lib/knowledge-embedding/embedding");
  const source = await import("@/lib/knowledge-embedding/source");
  const runRepository = await import("@/db/repository");

  out("=== CI-EMB-01 section 3: semantic recall verification (ALGORITHM / PLUMBING TEST) ===");
  out(`started            : ${startedAt}`);
  out(`temp database      : ${process.env.SOCIAL_AUTO_POST_DB_URL}`);
  out(`temp data dir      : ${dataDir}`);
  out(`embedding stand-in : deterministic concept vector, ${concepts.length} dimensions (NOT a real model)`);
  out(`target route       : ${providerId}/${target.modelId} via stub host ${stubBaseUrl}`);
  out();

  await seedRecords(knowledge);
  const entriesBefore = await knowledge.listKnowledgeBase();
  out(`--- fixtures: chunk shape (character ceiling = ${pure.knowledgeChunkMaxCharacters}) ---`);
  for (const entry of entriesBefore) {
    const chunks = pure.chunkKnowledgeBody(entry.content);
    const sizes = chunks.map((chunk) => chunk.length).join(", ");
    out(`  ${entry.title} (weight=${entry.weight}, enabled=${entry.enabled}, position=${entry.positionId || "-"}) chunks=${chunks.length} sizes=[${sizes}]`);
    check(
      `every chunk of "${entry.title}" fits the ceiling`,
      chunks.every((chunk) => chunk.length > 0 && chunk.length <= pure.knowledgeChunkMaxCharacters),
    );
  }
  out();

  const indexCallsBefore = calls.length;
  const created = await task.createKnowledgeEmbeddingTask({
    scope: "stale",
    batchSize: 4,
    providerId,
    model: modelId,
  });
  const indexOutcome = await task.executeKnowledgeEmbeddingTask(created.run.id);
  const indexCalls = calls.length - indexCallsBefore;
  const batchSizes = calls
    .slice(indexCallsBefore)
    .map((call) => ((call.body as { input?: string[] }).input ?? []).length);
  out("--- indexing run ---");
  out(`  run=${created.run.id} reused=${created.reused} outcome=${indexOutcome.kind}`);
  if (indexOutcome.kind === "succeeded") {
    out(`  indexed=${indexOutcome.indexed} skipped=${indexOutcome.skipped} chunks=${indexOutcome.chunks} providerRequests=${indexCalls} batchSizes=[${batchSizes.join(",")}]`);
    check("the index run embedded every record in the base", indexOutcome.indexed === 7, `indexed=${indexOutcome.indexed}`);
    check("every request carried at most the requested batch size", batchSizes.every((size) => size <= 4));
  } else {
    check("the index run succeeded", false, JSON.stringify(indexOutcome));
  }
  const storedRows = await embeddings.countKnowledgeChunks();
  out(`  chunk rows stored: ${storedRows}`);
  check("the chunk rows are stored in knowledge_embeddings", storedRows > 0, `rows=${storedRows}`);

  const late = await knowledge.createKnowledgeBase({
    title: "母婴辅食周计划",
    content: babyFacts,
    category: "other",
    weight: "medium",
    tags: ["母婴"],
    positionId: positioningId,
  });
  out(`  late record without vectors: ${late?.title} (id=${late?.id})`);
  out();

  // ---- the query machinery -------------------------------------------------
  const titlesOf = (references: string[]) =>
    references.map((reference) => reference.slice(1, reference.indexOf("】")));

  async function probe(label: string, queryText: string) {
    const entries = await knowledge.listKnowledgeBase();
    const chunks = await embeddings.listKnowledgeChunksFor(entries.map((entry) => entry.id));
    const selection = selectors.selectSemanticKnowledgeReferences({
      entries,
      positioningId,
      queryVector: encode(queryText),
      chunks: chunks.map((chunk) => ({
        knowledgeId: chunk.knowledgeId,
        chunkIndex: chunk.chunkIndex,
        vector: chunk.vector,
        sourceHash: chunk.sourceHash,
        providerId: chunk.providerId,
        modelId: chunk.modelId,
      })),
      sourceHashOf: (entry) => source.knowledgeSourceHash(entry),
      target: { providerId, modelId },
    });
    const similarityOf = new Map(selection.matches.map((match) => [match.entry.title, match.similarity]));
    const chunkOf = new Map(selection.matches.map((match) => [match.entry.title, match.chunkIndex]));
    const callsBefore = calls.length;
    const embeddingBefore = calls.filter((call) => call.url.includes("/embeddings")).length;
    const outcome = await recallModule.recallKnowledgeForArticle({ entries, positioningId, queryText });
    const embeddingCalls = calls.filter((call) => call.url.includes("/embeddings")).length - embeddingBefore;
    const positionReferences = selectors.selectKnowledgeReferences(entries, positioningId);
    out(`--- ${label} ---`);
    out(`  query          : ${queryText || "(empty)"}`);
    out(`  semantic       : source=${outcome.source} compared=${outcome.compared ?? "-"} reason=${outcome.fallbackReason || "-"}`);
    out(`                   ${rankLine(outcome.references, similarityOf, chunkOf)}`);
    out(`  position mode  : ${positionsOf(positionReferences)}`);
    out(`  diagnostics    : considered=${selection.diagnostics.considered} withoutVectors=${selection.diagnostics.withoutCompatibleVectors} incompatible=${selection.diagnostics.incompatibleVectors} stale=${selection.diagnostics.staleVectors} unrelated=${selection.diagnostics.unrelated}`);
    out(`  provider calls : embedding=${embeddingCalls} (any other request is the runtime's own catalog discovery)`);
    out();
    return {
      outcome,
      diagnostics: selection.diagnostics,
      matches: selection.matches,
      positionReferences,
      titles: titlesOf(outcome.references),
      chunkOf,
      calls: calls.length - callsBefore,
      embeddingCalls,
    };
  }

  // ---- Q_A ... Q_E: the effect matrix --------------------------------------
  out("=== Q_A...Q_E: recall effect (semantic ranking vs position ranking) ===");
  // A hold-taking budget: policy `block` with a stated ceiling is what makes the gate take a hold and settle it,
  // so the ledger rows below can be checked for their reservation link. An unpriced call is admitted because
  // `unknownCostPolicy` is `allow` (the shipped default) - a refusal is exercised separately in Q_J.
  await settings.updateAiBudgetSettings({ policy: "block", monthlyLimit: 100, currency: "CNY", unknownCostPolicy: "allow" });
  const queryA = await probe("Q_A exact wording (the record's own title)", "短视频完播率提升清单");
  check("Q_A: the relevant record is rank 1", queryA.titles[0] === "短视频完播率提升清单", positionsOf(queryA.outcome.references));
  check(
    "Q_A: it matched through its *second* chunk (chunk-level best match, D2=b)",
    queryA.chunkOf.get("短视频完播率提升清单") === 1,
    `chunk=${String(queryA.chunkOf.get("短视频完播率提升清单"))}`,
  );
  check("Q_A: the index answered in semantic mode", queryA.outcome.source === "semantic" && queryA.outcome.fallbackReason === "", `${queryA.outcome.source}/${queryA.outcome.fallbackReason}`);
  check("Q_A: the disabled record is not a candidate", !queryA.titles.includes("完播率速成课（已停用）"), positionsOf(queryA.outcome.references));
  check("Q_A: the foreign-positioning record is not a candidate", !queryA.titles.includes("完播率进阶（另一套定位）"), positionsOf(queryA.outcome.references));

  const queryB = await probe(
    "Q_B paraphrase (the record's own words do not occur in the query)",
    "怎样让观众把视频看到最后一秒并把留存率做上去",
  );
  check("Q_B: the paraphrase still ranks the relevant record 1st", queryB.titles[0] === "短视频完播率提升清单", positionsOf(queryB.outcome.references));
  check("Q_B: the paraphrase and the exact query agree on rank 1", queryB.titles[0] === queryA.titles[0]);
  {
    const recordWords = ["完播", "完播率", "前五秒", "钩子"];
    const shared = sharedCharacters("怎样让观众把视频看到最后一秒并把留存率做上去", completionFacts);
    check(
      "Q_B: none of the record's own concept words occur in the query",
      recordWords.every((word) => !"怎样让观众把视频看到最后一秒并把留存率做上去".includes(word)),
    );
    out(`  Q_B evidence   : characters shared with the matched chunk = ${JSON.stringify(shared)} (generic characters only)`);
    check("Q_B: the two texts share at most five characters", shared.length <= 5, shared);
  }

  const queryC = await probe("Q_C unrelated query (a topic no record covers)", "亲子房酒店怎么选行程更省钱");
  check("Q_C: an unrelated query returns no references", queryC.titles.length === 0, positionsOf(queryC.outcome.references));
  check("Q_C: 'found nothing' is not reported as a fallback (D9 rule 4)", queryC.outcome.source === "semantic" && queryC.outcome.fallbackReason === "", `${queryC.outcome.source}/${queryC.outcome.fallbackReason}`);
  check("Q_C: every comparable record is counted as unrelated", queryC.diagnostics.unrelated === 5, `unrelated=${queryC.diagnostics.unrelated}`);
  check("Q_C: position mode ignored the query entirely (its list is unchanged)", positionsOf(queryC.positionReferences) === positionsOf(queryA.positionReferences), positionsOf(queryC.positionReferences));
  check("Q_C: the un-embedded record is counted as withoutVectors", queryC.diagnostics.withoutCompatibleVectors === 1, `withoutVectors=${queryC.diagnostics.withoutCompatibleVectors}`);

  const queryD = await probe("Q_D two concepts in one query", "短视频完播率和直播带货怎么一起做");
  check("Q_D: both relevant records are returned", queryD.titles.includes("短视频完播率提升清单") && queryD.titles.includes("直播带货话术模板"), positionsOf(queryD.outcome.references));
  check("Q_D: the best match is ranked first", queryD.titles[0] === "短视频完播率提升清单", positionsOf(queryD.outcome.references));

  const queryE = await probe("Q_E empty query text", "");
  check("Q_E: an empty query falls back to position mode by name", queryE.outcome.source === "position" && queryE.outcome.fallbackReason === "empty-query", `${queryE.outcome.source}/${queryE.outcome.fallbackReason}`);
  check("Q_E: the fallback spent no embedding call", queryE.embeddingCalls === 0, `embedding calls=${queryE.embeddingCalls}`);
  check("Q_E: the fallback is the position selection itself", positionsOf(queryE.outcome.references) === positionsOf(queryE.positionReferences));

  // ---- Q_F ... Q_J: the index state matrix ---------------------------------
  out("=== Q_F...Q_J: stale / incompatible / unavailable / budget ===");
  const completionTitle = "短视频完播率提升清单";
  const completionRecord = (await knowledge.listKnowledgeBase()).find((entry) => entry.title === completionTitle);
  if (!completionRecord) throw new Error("the completion fixture is missing");
  await knowledge.updateKnowledgeBase(completionRecord.id, { content: editedCompletion });
  const queryF = await probe("Q_F the record was edited after indexing (its vectors are now stale)", completionTitle);
  check("Q_F: the stale record is dropped from the semantic ranking", !queryF.titles.includes(completionTitle), positionsOf(queryF.outcome.references));
  check("Q_F: the drop is counted as staleVectors", queryF.diagnostics.staleVectors === 1, `stale=${queryF.diagnostics.staleVectors}`);
  check("Q_F: the index still *answered* (a stale record is not a fallback)", queryF.outcome.source === "semantic", `${queryF.outcome.source}/${queryF.outcome.fallbackReason}`);
  check(
    "Q_F: position mode still lists it (it never reads a vector)",
    queryF.positionReferences.some((reference) => reference.includes(completionTitle)),
  );

  const reindex = await task.createKnowledgeEmbeddingTask({ scope: "stale", batchSize: 4, providerId, model: modelId });
  const reindexOutcome = await task.executeKnowledgeEmbeddingTask(reindex.run.id);
  const queryRestored = await probe("Q_A' after re-indexing the edited record", completionTitle);
  check(
    "Q_A': re-indexing brings the record back",
    queryRestored.titles[0] === completionTitle && queryRestored.diagnostics.staleVectors === 0,
    `${positionsOf(queryRestored.outcome.references)} stale=${queryRestored.diagnostics.staleVectors}`,
  );
  check("Q_A': the re-index run touched only what was stale", reindexOutcome.kind === "succeeded" && reindexOutcome.skipped === 6, JSON.stringify(reindexOutcome));

  // A record whose vectors belong to *another* model, at another dimension.
  const growthTitle = "账号涨粉的五个动作";
  const growthRecord = (await knowledge.listKnowledgeBase()).find((entry) => entry.title === growthTitle);
  if (!growthRecord) throw new Error("the growth fixture is missing");
  const growthChunks = pure.chunkKnowledgeBody(growthRecord.content);
  await embeddings.replaceKnowledgeChunks(
    growthRecord.id,
    { providerId, modelId: otherModelId },
    growthChunks.map((text, chunkIndex) => ({
      chunkIndex,
      text,
      chunkHash: source.knowledgeChunkHash(text),
      sourceHash: source.knowledgeSourceHash(growthRecord),
      dimensions: 3,
      vector: encode(text).slice(0, 3),
    })),
  );
  await embeddings.replaceKnowledgeChunks(growthRecord.id, { providerId, modelId }, []);
  const growthRows = await embeddings.listKnowledgeChunks(growthRecord.id);
  out(`  growth record rows by model: ${growthRows.map((row) => `${row.providerId}/${row.modelId}(${row.dimensions}d)`).join(", ") || "(none)"}`);
  const queryG = await probe("Q_G the record's vectors belong to another model at another dimension", growthTitle);
  check("Q_G: the record is dropped", !queryG.titles.includes(growthTitle), positionsOf(queryG.outcome.references));
  check("Q_G: the drop is counted as incompatibleVectors", queryG.diagnostics.incompatibleVectors === 1, `incompatible=${queryG.diagnostics.incompatibleVectors}`);
  check(
    "Q_G: the other model's rows are still stored (D4: a migration keeps the old index)",
    growthRows.some((row) => row.modelId === otherModelId) && !growthRows.some((row) => row.modelId === modelId),
  );

  await runtime.setModelDefaultForCapability("embedding", null);
  await runtimeRepository.setModelsEnabled([target.id], false);
  const queryH = await probe("Q_H no embedding model is configured (capability unavailable)", completionTitle);
  check(
    "Q_H: it falls back with the named reason",
    queryH.outcome.source === "position" && queryH.outcome.fallbackReason === "provider-unavailable",
    `${queryH.outcome.source}/${queryH.outcome.fallbackReason}`,
  );
  check("Q_H: no embedding call was made", queryH.embeddingCalls === 0, `embedding calls=${queryH.embeddingCalls}`);
  check("Q_H: the degradation is logged, not silent", fallbackLog.some((line) => line.includes("provider-unavailable")));
  await runtimeRepository.setModelsEnabled([target.id], true);
  await runtime.setModelDefaultForCapability("embedding", target.id);

  for (const entry of await knowledge.listKnowledgeBase()) {
    if (entry.content) await knowledge.updateKnowledgeBase(entry.id, { content: `${entry.content}\n\n补充：口径更新。` });
  }
  const queryI = await probe("Q_I every candidate's vectors are stale (nothing comparable is left)", completionTitle);
  check(
    "Q_I: it falls back with the named reason no-compatible-vectors",
    queryI.outcome.source === "position" && queryI.outcome.fallbackReason === "no-compatible-vectors",
    `${queryI.outcome.source}/${queryI.outcome.fallbackReason}`,
  );
  check("Q_I: the reason's detail names the counts", fallbackLog.some((line) => line.includes("no-compatible-vectors") && line.includes("stale")));
  const rebuild = await task.createKnowledgeEmbeddingTask({ scope: "stale", batchSize: 8, providerId, model: modelId });
  const rebuildOutcome = await task.executeKnowledgeEmbeddingTask(rebuild.run.id);
  check("Q_I: re-indexing the whole base restores the index", rebuildOutcome.kind === "succeeded" && rebuildOutcome.indexed === 8, JSON.stringify(rebuildOutcome));

  const ledgerBeforeRefusal = (await runRepository.listAiUsageLedgerEntries({ limit: 500 })).length;
  const embeddingBeforeRefusal = calls.filter((call) => call.url.includes("/embeddings")).length;
  await settings.updateAiBudgetSettings({ policy: "block", monthlyLimit: 0, currency: "CNY", unknownCostPolicy: "block" });
  let refusalCode = "";
  try {
    await recallModule.recallKnowledgeForArticle({
      entries: await knowledge.listKnowledgeBase(),
      positioningId,
      queryText: completionTitle,
    });
  } catch (error) {
    refusalCode = String((error as { code?: string }).code ?? "");
  }
  check("Q_J: a budget refusal travels out of the recall (D9: no fallback)", refusalCode === "AI_BUDGET_EXCEEDED", `code=${refusalCode}`);
  check(
    "Q_J: the refusal spent no embedding call",
    calls.filter((call) => call.url.includes("/embeddings")).length === embeddingBeforeRefusal,
    `embedding calls=+${calls.filter((call) => call.url.includes("/embeddings")).length - embeddingBeforeRefusal}`,
  );
  check(
    "Q_J: a refused call wrote no ledger row (nothing was sent, nothing is billed)",
    (await runRepository.listAiUsageLedgerEntries({ limit: 500 })).length === ledgerBeforeRefusal,
  );
  await settings.updateAiBudgetSettings({ policy: "off", monthlyLimit: null, currency: "CNY", unknownCostPolicy: "allow" });

  const longMaterial = {
    topics: [{ title: "完播率的三个误区", source: "", url: "" }],
    products: [{ name: "折叠收纳箱", brand: "", category: "", keywords: [], description: "", linkUrl: "" }],
    freeText: "很长的素材".repeat(200),
  };
  const queryText = recallModule.knowledgeQueryText({ material: longMaterial, titleFallback: "完播率" });
  out("--- Q_K the query text (D8) ---");
  out(`  length=${queryText.length} (cap ${recallModule.knowledgeQueryMaxCharacters}) lines=${queryText.split("\n").length}`);
  check("Q_K: the query text is capped", queryText.length <= recallModule.knowledgeQueryMaxCharacters, `len=${queryText.length}`);
  check("Q_K: the title survives the cut", queryText.startsWith("标题：完播率"), queryText.slice(0, 24));
  out();

  // ---- Q_L: what the gate does for an embedding call -----------------------
  out("=== Q_L: the gate and the ledger for a *priced* embedding call ===");
  // Q_J restored the shipped default (off) at the end of its own case, so the gate is switched back on here.
  await settings.updateAiBudgetSettings({ policy: "block", monthlyLimit: 100, currency: "CNY", unknownCostPolicy: "allow" });
  const holdsBefore = await runRepository.listAiBudgetReservations({ limit: 500 });
  const decisionsBefore = await runRepository.listAiBudgetDecisions({ limit: 500 });
  await runRepository.createAiModelPrice({
    providerId,
    modelId,
    meteredKind: "embedding",
    currency: "CNY",
    // A rate that makes the arithmetic visible without being a claim about any vendor's list price.
    inputPerMillion: 1,
    outputPerMillion: 0,
    priceVersion: "ciemb-verify",
    source: "manual",
    notes: "verification-harness price, not a vendor price",
    effectiveFrom: Date.now() - 1000,
  });
  const priced = await probe("Q_L the same query now that the embedding dimension has a price", completionTitle);
  const holdsAfter = await runRepository.listAiBudgetReservations({ limit: 500 });
  const newHolds = holdsAfter.filter((hold) => !holdsBefore.some((before) => before.id === hold.id));
  const newDecisions = (await runRepository.listAiBudgetDecisions({ limit: 500 })).filter(
    (decision) => !decisionsBefore.some((before) => before.id === decision.id),
  );
  const decision = newDecisions[0];
  const pricedRow = (await runRepository.listAiUsageLedgerEntries({ limit: 500 })).find(
    (row) => row.purpose === "knowledge" && !row.runId && row.costSource === "computed",
  );
  out(`  gate decision: status=${decision?.status ?? "?"} estimateKind=${decision?.estimateKind ?? "?"} reasons=${JSON.stringify(decision?.reasons ?? [])} reservation=${decision?.reservationId ? "set" : "empty"}`);
  out(`  hold rows created by this call: ${newHolds.length}`);
  out(`  ledger row: cost=${pricedRow?.costAmount ?? "?"} ${pricedRow?.costCurrency ?? ""} source=${pricedRow?.costSource ?? "?"} completeness=${pricedRow?.completeness ?? "?"} reservation=${pricedRow?.budgetReservationId ? "set" : "empty"}`);
  check("Q_L: the call was admitted, not refused", priced.outcome.source === "semantic", `${priced.outcome.source}/${priced.outcome.fallbackReason}`);
  check("Q_L: the gate recorded its decision", newDecisions.length >= 1, `decisions=${newDecisions.length}`);
  check(
    "Q_L: a priced embedding call takes a hold",
    newHolds.length === 1 && (decision?.reservationId ?? "") !== "",
    `holds=${newHolds.length}`,
  );
  check("Q_L: the hold is settled, not left outstanding", newHolds.every((hold) => hold.status === "settled"), newHolds.map((hold) => hold.status).join(","));
  check(
    "Q_L: the ledger row links exactly that hold",
    pricedRow?.budgetReservationId === newHolds[0]?.id,
    `${pricedRow?.budgetReservationId} vs ${newHolds[0]?.id}`,
  );
  check("Q_L: the decision says the call is within the limit", decision?.status === "allowed", String(decision?.status));
  check(
    "Q_L: the cost is computed afterwards from the price on file",
    pricedRow?.costSource === "computed" && (pricedRow?.costAmount ?? 0) > 0,
    `${pricedRow?.costSource}/${pricedRow?.costAmount}`,
  );
  out();

  out("=== ledger and budget holds (the money side of an embedding call) ===");
  const ledger = await runRepository.listAiUsageLedgerEntries({ limit: 500 });
  const embeddingRows = ledger.filter((row) => row.meteredKind === "embedding");
  const queryRows = embeddingRows.filter((row) => row.purpose === "knowledge" && !row.runId);
  const indexRows = embeddingRows.filter((row) => row.runId);
  out(`  ledger rows: total=${ledger.length} embedding=${embeddingRows.length} (query=${queryRows.length}, index=${indexRows.length})`);
  for (const row of queryRows.slice(0, 3)) {
    out(`    query row: outcome=${row.outcome} provider=${row.providerId} model=${row.modelId} kind=${row.meteredKind} completeness=${row.completeness} cost=${row.costAmount === null ? "NULL" : row.costAmount} costSource=${row.costSource} reservation=${row.budgetReservationId ? "set" : "empty"} tokens=${row.tokens.totalTokens}`);
  }
  for (const row of indexRows.slice(0, 3)) {
    out(`    index row: outcome=${row.outcome} provider=${row.providerId} model=${row.modelId} kind=${row.meteredKind} completeness=${row.completeness} cost=${row.costAmount === null ? "NULL" : row.costAmount} costSource=${row.costSource} reservation=${row.budgetReservationId ? "set" : "empty"} run=${row.runId.slice(0, 8)}… tokens=${row.tokens.totalTokens}`);
  }
  check("every query embedding row is metered as `embedding`", queryRows.length > 0 && queryRows.every((row) => row.meteredKind === "embedding"));
  check(
    "the query rows carry the usage the provider reported",
    queryRows.length > 0 && queryRows.every((row) => row.completeness === "reported" && row.tokens.totalTokens > 0),
    queryRows.map((row) => `${row.completeness}/${row.tokens.totalTokens}`).join(", "),
  );
  const unpricedRows = queryRows.filter((row) => row.costSource === "unpriced");
  const pricedRows = queryRows.filter((row) => row.costSource === "computed");
  check(
    "a call whose price is unknown stores NULL and takes no hold",
    unpricedRows.length > 0 && unpricedRows.every((row) => row.costAmount === null && row.budgetReservationId === ""),
    `unpriced=${unpricedRows.length}`,
  );
  check(
    "a priced call states its computed amount",
    pricedRows.length > 0 && pricedRows.every((row) => (row.costAmount ?? 0) > 0 && row.budgetReservationId !== ""),
    `priced=${pricedRows.length}`,
  );
  check("every index row is attributed to its run", indexRows.length > 0 && indexRows.every((row) => row.runId !== ""));

  const reservations = await runRepository.listAiBudgetReservations({ limit: 500 });
  const held = reservations.filter((row) => row.status === "held");
  out(`  budget reservations: total=${reservations.length} settled=${reservations.filter((row) => row.status === "settled").length} expired=${reservations.filter((row) => row.status === "expired").length} still-held=${held.length}`);
  check("no hold is left outstanding after the calls finished", held.length === 0, `held=${held.length}`);
  check("every hold the gate took ended settled", reservations.length > 0 && reservations.every((row) => row.status === "settled"));
  check(
    "the priced call's hold is the one its ledger row links",
    reservations.some((row) => row.id === pricedRows[0]?.budgetReservationId),
  );
  out();

  out("=== transport evidence ===");
  const keys = [...new Set(calls.map((call) => call.authorization))];
  out(`  provider requests: ${calls.length} (every one to ${stubBaseUrl})`);
  out(`  authorization headers seen: ${keys.length} -> ${keys.map((key) => `${key.slice(0, 10)}…(${key.length})`).join(", ")}`);
  check("every request carried the stub credential, never a real one", keys.length === 1 && keys[0] === "Bearer sk-stub-ciemb-verify", keys.join(" / "));
  const interceptedHosts = [...new Set(intercepted.map((entry) => new URL(entry.url).host))];
  out(`  intercepted (never sent, answered by this harness): ${intercepted.length} -> ${interceptedHosts.join(", ") || "(none)"}`);
  out(`  of those, embedding calls: ${intercepted.filter((entry) => entry.url.includes("/embeddings")).length}`);
  check(
    "no embedding call was aimed at a host other than the stub",
    intercepted.every((entry) => !entry.url.includes("/embeddings")),
  );
  const interceptedCredentials = intercepted.filter((entry) => entry.authorization !== "" && entry.authorization !== "Bearer ");
  out(`  intercepted calls that carried a credential: ${interceptedCredentials.length} (value never printed)`);
  check(
    "the only credential this harness presents is its own stub key",
    interceptedCredentials.length === 0 && keys.every((key) => key === "Bearer sk-stub-ciemb-verify"),
    `intercepted=${interceptedCredentials.length}`,
  );
  out();

  out("=== summary ===");
  out(`checks: ${failures === 0 ? "all passed" : `${failures} FAILED`}`);
  out("degradations reported (never silent, D9):");
  for (const line of fallbackLog) out(`  ${line}`);
  out("real provider calls: 0 (the transport refused any non-stub host)");
  out(`real semantic quality: NOT measured here - the vectors came from a hand-built concept map`);
  writeFileSync(logFile, `${lines.join("\n")}\n`, "utf8");
  out(`log written to ${logFile}`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("ERR", error);
    process.exitCode = 1;
  })
  .finally(() => {
    globalThis.fetch = realFetch;
  });


function rankLine(references: string[], similarityOf: Map<string, number>, chunkOf: Map<string, number>) {
  if (references.length === 0) return "(no references)";
  return references
    .map((reference) => {
      const title = reference.slice(1, reference.indexOf("】"));
      const similarity = similarityOf.get(title);
      const chunk = chunkOf.get(title);
      const score = similarity === undefined ? "  -  " : similarity.toFixed(3);
      const at = chunk === undefined ? "" : ` chunk=${chunk}`;
      return `#${references.indexOf(reference) + 1} ${title} sim=${score}${at}`;
    })
    .join(" | ");
}

function positionsOf(references: string[]) {
  return references.map((reference) => reference.slice(1, reference.indexOf("】"))).join(" > ") || "(none)";
}

/** Which distinct characters two texts have in common - the evidence a "paraphrase" claim needs. */
function sharedCharacters(left: string, right: string) {
  const rightCharacters = new Set(right);
  return [...new Set(left)].filter((char) => rightCharacters.has(char)).join("");
}
