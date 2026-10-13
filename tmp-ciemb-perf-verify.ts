/**
 * CI-EMB-01 §5: performance measurement for the knowledge index, on a local throwaway database.
 *
 * What is measured, and how:
 *  1. cold load - how long it takes to read every stored chunk of a workspace with a few thousand records
 *     (`listKnowledgeChunksFor` over the whole base), which is what one recall query pays.
 *  2. query latency - how long one end-to-end `selectSemanticKnowledgeReferences` call takes over those rows,
 *     including the cosine scans, repeated until the median settles.
 *  3. batch embedding time - how long one run of the index task takes over the same synthetic base, with the
 *     provider stubbed to a deterministic vector (so no network and no cost).
 *  4. peak memory - `process.memoryUsage().heapUsed` sampled around the load, since Node is what the Electron
 *     main process runs.
 *
 * The numbers below are facts about *this machine, this database and this stub*; they are not a vendor
 * benchmark. Everything synthetic is labelled as such.
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const RECORDS = 3000;
const VECTOR_DIMENSIONS = 1536;
const QUERY_REPEATS = 25;

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "ciemb-perf-"));
  process.env.SOCIAL_AUTO_POST_DATA_DIR = dir;
  process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dir, "perf.db").replace(/\\/g, "/")}`;

  const { ensureDatabase } = await import("@/db/client");
  await ensureDatabase();
  const { replaceKnowledgeChunks } = await import("@/db/repositories/knowledge-embeddings");
  const { chunkKnowledgeBody } = await import("@/lib/knowledge-embedding/embedding");
  const { knowledgeSourceHash, knowledgeChunkHash } = await import("@/lib/knowledge-embedding/source");
  const models = await import("@/lib/knowledge-base");

  const ms = (from: number) => Number((performance.now() - from).toFixed(1));
  const mb = (bytes: number) => Number((bytes / 1024 / 1024).toFixed(1));

  const knowledge = await import("@/db/repositories/knowledge-base");
  const knowledgeIds: string[] = [];
  const sources: { id: string; sourceHash: string; chunks: string[] }[] = [];
  const buildFrom = performance.now();
  for (let record = 0; record < RECORDS; record += 1) {
    const created = await knowledge.createKnowledgeBase({
      title: `合成知识 ${record}`,
      content: `第 ${record} 条合成知识：完播率的口径是看到最后的人数，前五秒的钩子决定留存。`,
    });
    if (!created) throw new Error("the synthetic record could not be created");
    knowledgeIds.push(created.id);
    // The real hashes, so the staged index is genuinely "ready": a query must then score the vectors instead
    // of dismissing them as stale, and the index task has to skip them instead of re-embedding them.
    sources.push({
      id: created.id,
      sourceHash: knowledgeSourceHash(created),
      chunks: chunkKnowledgeBody(created.content),
    });
    if ((record + 1) % 500 === 0) console.log(`  … ${record + 1}/${RECORDS} seeded (${ms(buildFrom)} ms)`);
  }
  console.log(`seeded ${RECORDS} knowledge records in ${ms(buildFrom)} ms`);

  const providerId = "gateway";
  const modelId = "text-embedding-3-small";
  const target = { providerId, modelId };
  const vector = (seed: number) =>
    Array.from({ length: VECTOR_DIMENSIONS }, (_, index) => ((index * seed) % 97) / 97 - 0.5);

  const writeFrom = performance.now();
  for (const source of sources) {
    const writes = source.chunks.map((text, chunkIndex) => ({
      chunkIndex,
      text,
      chunkHash: knowledgeChunkHash(text),
      sourceHash: source.sourceHash,
      dimensions: VECTOR_DIMENSIONS,
      vector: vector(chunkIndex + 1),
    }));
    await replaceKnowledgeChunks(source.id, target, writes);
  }
  const writeMs = ms(writeFrom);
  const totalChunks = sources.reduce((count, source) => count + source.chunks.length, 0);
  const dbBytes = statSync(path.join(dir, "perf.db")).size;
  console.log(
    `wrote ${totalChunks} chunks x ${VECTOR_DIMENSIONS} dims in ${writeMs} ms (${mb(dbBytes)} MB on disk)`,
  );

  // ---- 1. cold load ------------------------------------------------------------
  const embeddings = await import("@/db/repositories/knowledge-embeddings");
  const loadBefore = process.memoryUsage().heapUsed;
  const loadFrom = performance.now();
  const loaded = await embeddings.listKnowledgeChunksFor(knowledgeIds);
  const loadMs = ms(loadFrom);
  const loadPeak = process.memoryUsage().heapUsed;
  console.log(
    `cold load: ${loaded.length} rows in ${loadMs} ms, heap ${mb(loadBefore)} -> ${mb(loadPeak)} MB (+${mb(loadPeak - loadBefore)})`,
  );

  // ---- 2. query latency --------------------------------------------------------
  const chunks = loaded.map((row) => ({
    knowledgeId: row.knowledgeId,
    chunkIndex: row.chunkIndex,
    vector: row.vector,
    sourceHash: row.sourceHash,
    providerId: row.providerId,
    modelId: row.modelId,
  }));
  const entries = await knowledge.listKnowledgeBase();
  const queryVector = vector(1);
  const sourceHashes = new Map(sources.map((source) => [source.id, source.sourceHash]));
  const sourceHashOf = (entry: { id: string }) => sourceHashes.get(entry.id) ?? "";
  const latencies: number[] = [];
  for (let at = 0; at < QUERY_REPEATS; at += 1) {
    const queryFrom = performance.now();
    const selection = models.selectSemanticKnowledgeReferences({
      entries,
      queryVector,
      chunks,
      sourceHashOf,
      target,
      limit: 8,
    });
    latencies.push(performance.now() - queryFrom);
    if (at === 0) {
      console.log(
        `first query: references=${selection.references.length} considered=${selection.diagnostics.considered}`,
      );
    }
  }
  latencies.sort((left, right) => left - right);
  const median = latencies[Math.floor(latencies.length / 2)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  console.log(
    `query latency over ${QUERY_REPEATS} runs: median=${median.toFixed(2)} ms p95=${p95.toFixed(2)} ms min=${latencies[0].toFixed(2)} ms max=${latencies[latencies.length - 1].toFixed(2)} ms`,
  );

  // ---- 3. batch embedding time (stub transport, no network) ---------------------
  const task = await import("@/lib/knowledge-embedding/embedding-task");
  const runtime = await import("@/features/ai-runtime");
  const runtimeRepository = await import("@/db/repositories/ai-runtime");
  const credentials = await import("@/lib/credentials");
  const stubBaseUrl = "http://ciemb-perf-stub.local/v1";
  await runtime.ensureModelRuntimeSeeded();
  await credentials.writeCredential(credentials.credentialRefFor(providerId), "sk-stub-perf");
  await runtimeRepository.upsertModelEndpoint({
    endpointId: `${providerId}/default`,
    providerId,
    protocol: "openai-compatible",
    baseUrl: stubBaseUrl,
    credentialRef: credentials.credentialRefFor(providerId),
  });
  await runtimeRepository.upsertModels({
    providerId,
    endpointId: `${providerId}/default`,
    source: "perf-harness",
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
  if (!callable) throw new Error(`the harness could not bind ${modelId}`);

  await runtime.setModelDefaultForCapability("embedding", callable.id);

  const realFetch = globalThis.fetch;
  let stubbedRequests = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(stubBaseUrl)) {
      return new Response(JSON.stringify({ error: { message: "intercepted by the perf harness" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    stubbedRequests += 1;
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { input?: string[] }) : {};
    const texts = body.input ?? [];
    const data = texts.map((text, index) => ({ index, embedding: vector(index + 1) }));
    return new Response(JSON.stringify({ data, usage: { prompt_tokens: texts.length, total_tokens: texts.length } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    // 3a. the planning + scan of a base that is already current: this is what a scheduled re-run pays.
    const noopFrom = performance.now();
    const noop = await task.createKnowledgeEmbeddingTask({ scope: "stale", batchSize: 32 });
    const noopOutcome = await task.executeKnowledgeEmbeddingTask(noop.run.id);
    console.log(
      `re-run over a current index: ${noopOutcome.kind === "succeeded" ? `${noopOutcome.indexed} indexed / ${noopOutcome.skipped} already current` : noopOutcome.kind} in ${ms(noopFrom)} ms (no provider request sent: ${stubbedRequests === 0 ? "confirmed" : `${stubbedRequests} sent`})`,
    );

    // 3b. the real batch pass: the index is dropped and rebuilt through the stubbed transport, so this is the
    //     full chunk -> request -> vector -> SQLite path, with the network leg short-circuited locally.
    for (const knowledgeId of knowledgeIds) await embeddings.deleteKnowledgeChunks(knowledgeId);
    const rebuildFrom = performance.now();
    const rebuild = await task.createKnowledgeEmbeddingTask({ scope: "rebuild", batchSize: 32 });
    const rebuildOutcome = await task.executeKnowledgeEmbeddingTask(rebuild.run.id);
    const rebuildMs = ms(rebuildFrom);
    console.log(
      `batch rebuild of the whole base: ${rebuildOutcome.kind === "succeeded" ? `${rebuildOutcome.indexed} records / ${rebuildOutcome.chunks} chunks` : rebuildOutcome.kind} in ${rebuildMs} ms over ${stubbedRequests} HTTP request(s) (local stub transport)`,
    );
    console.log(
      `  per record ${(rebuildMs / RECORDS).toFixed(2)} ms, per chunk ${(rebuildMs / totalChunks).toFixed(2)} ms`,
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log(`machine: Windows, i5-13400F, 32 GB RAM, node ${process.version}, tsx, local SQLite file`);
  rmSync(dir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error("ERR", error);
  process.exitCode = 1;
});
