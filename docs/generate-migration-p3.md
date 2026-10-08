# P3 - taking the business layer off the legacy facade

Execution record for phase P3 of `docs/generate-migration.md`. P2 is closed (commit `2d8e5f8`,
re-measured at `1d1de37`): `src/lib/ai/generate.ts` is a pure facade over `aiRuntime`, and all 19
of its entry points already run on the runtime. P3 moves the *callers* off that facade, P4 deletes
it.

Companion docs: `docs/generate-migration.md` (inventory & matrix),
`docs/model-runtime.md` (what the runtime is).

## 0. Decisions (frozen before any P3 code)

| # | Decision | Consequence |
| --- | --- | --- |
| D-P3-1 | **Cold-start catalog discovery moves to the seed path** (`ensureModelRuntimeSeeded()`), *not* into `resolveRoute()`. Best effort, failure silent. | The request path stays `business -> aiRuntime -> resolveRoute -> registry -> execute`. `resolveRoute()` never produces a network request of its own. |
| D-P3-2 | **`lib/agent/image-generation.ts` survives as a domain service** (prompt -> `aiRuntime.generateImage()` -> artifact file naming/path -> business object), minus its compat dependency. | The runtime keeps to provider/model/credential/rotation/failover/usage; artifact handling stays in the domain. |
| D-P3-3 | **The runtime error vocabulary is accepted as-is.** `MissingAIKeyError` is never re-introduced to preserve an old behaviour. | `api/metrics/insights` and `lib/scraper.ts` branch on `AppError.code` instead of `instanceof`. |
| D-P3-4 | **Batch order `A0 -> A1 -> A2 -> A3 -> B -> C -> D`**, one commit per batch, test-first (the failing test lands in the same commit as the fix). | Any batch can be reverted on its own; the runtime itself is never part of a revert. |
| D-P3-5 | **P3 adds no new runtime capability.** | Only D-P3-1 changes runtime code, and only to replace a gap the facade owns today. |
| D-P3-6 | **P4 gate: `generate.ts` / `compat.ts` are deleted only after a repo-wide search proves 0 production references.** | `LocalAIProvider` is exempt: it stays as the legacy UI identity (D4). |
| D-P3-7 | **Provider keys in tests come from the test, never from the machine** (`src/test/app-env.ts`, registered as a vitest `setupFiles` entry). | A key variable is *neutralised* (`,`, a truthy value that holds no keys) instead of deleted; deleting would hand it straight back to `.env.local`, which the seed now reads (D-P3-1). |

### D-P3-1: where cold start lives (decided: seed path)

```
boot / first request
  -> ensureModelRuntimeSeeded()          (registry.ts)
       -> importLegacyAiSettings()       (G2: <PROVIDER>_MODEL -> registry row)
       -> ensureColdStartCatalogs()      (D-P3-1: credential but nothing callable -> sync)
            best effort, failure silent
  -> resolveRoute()  ... deterministic, no network of its own
  -> execute
```

Why not inside `resolveRoute()`: it is a deterministic routing decision; catalog discovery is model
discovery/sync; a hidden network call inside routing makes tests uncontrollable and would keep the
`compat.ts` gap alive (P4 could not delete it). Why not a renamed bridge module for callers: that is
the same shim under a new name and contradicts "business -> `aiRuntime`".

Cost model, which is what makes the seed the right place:

| Install state | What the pass does |
| --- | --- |
| A callable provider already exists | One `listModels` + one `listModelProviders` read, no vault read, no network. |
| A provider has a key but nothing callable | One catalog sync per such provider - exactly the work the legacy path did (`resolveFirstAvailableModel` / `withLegacyCompatibility`). |
| A provider has no key | Skipped by `discoverProviderCatalogs()` without a network call. |
| The catalog is unreachable | Swallowed; the endpoint records the failure (existing `MODEL_SYNC_FAILED` path). Start-up and the request continue. |

The pass is **awaited** rather than fire-and-forget on purpose: a fresh install answers its *first*
request correctly (G3), which is the guarantee `compat.ts` provides today. An install that is
already callable pays no network call at all, so nothing starts slower. The alternative (kick the
sync off in the background) was rejected because it fails that first request.

Side effect worth knowing: `listProviderViews()` also seeds, and `api/ai/providers` POST calls it
right after storing a key - so pasting a key in 模型管理 now discovers that provider's catalog
immediately. That is the "I added my key, make it work" path `sync.ts` documents, and the UI already
renders the endpoint status/error it produces.

### D-P3-3: the vocabulary the business layer branches on

| Situation | Runtime outcome |
| --- | --- |
| Endpoint has no credential | `MODEL_CREDENTIAL_MISSING` |
| Every key is cooling down / disabled | `MODEL_CREDENTIAL_UNAVAILABLE` |
| One key was rejected | `MODEL_CREDENTIAL_INVALID` (rotates to the next key) |
| One key is not allowed for this endpoint | `MODEL_CREDENTIAL_FORBIDDEN` (rotates) |
| The provider rate-limits the key | `MODEL_RATE_LIMITED` (rotates, cooldown) |
| Nothing is configured / no model fits | `MODEL_NOT_CONFIGURED`, `MODEL_CAPABILITY_UNAVAILABLE` |
| The provider answered with an error | `MODEL_UPSTREAM_FAILED` (after failover through the candidate chain) |

`readProviderKeys()` / `credentialRefFor()` / `aiProviderOrder` are **not** part of this vocabulary:
they are the legacy storage/UI layer and survive P4 (D4).

### D-P3-7: keeping the suite off the developer's key file

`lib/credentials.ts` resolves a credential from `process.env` first and then from `.env.local` in the
repository root - the file setup and the settings screen both write. Vitest never loads it, yet the
runtime reads it directly, so before A0 the file could do no harm in tests only because nothing on
the seed path made a request. With D-P3-1 the seed discovers a catalog for **every provider that
holds a key**, which turned the developer's own `.env.local` into test input: it made `openai`
callable in `runtime.test.ts` (extra routing candidates in 4 cases) and made the first case seed over
the real network until its 5s timeout.

`src/test/app-env.ts` (registered through `test.setupFiles`) gives every provider key variable - the
names `credentialEnvVarNames()` derives for each provider in `aiProviderOrder`, plus any `*_API_KEY` /
`*_API_KEYS` the checked-out env file declares - a defined, keyless value (`,`) before the first test
file runs. `readAppEnvValue()` sees a non-empty value and never falls back to the file, while the
splitter turns `,` into zero keys, so the install is keyless until a test writes a key (vault or
`process.env`), which then wins. Test files therefore **neutralise key variables instead of deleting
them**; `*_MODEL` variables stay deleted, because an empty value is falsy there and the sentinel would
name a model `,` instead.

## 1. Surface being migrated (verified on the current tree)

16 call expressions in 14 files, plus the error branches and the indirect consumers:

| Kind | Sites |
| --- | --- |
| `generateText` (2) | `api/content/mindmap:62`, `api/content/[id]/rewrite:58` |
| `generateStructured` (11) | `api/ai-writing/generate:75`, `api/content/generate:102`, `api/content/[id]/translate:44`, `api/knowledge-base/ai-parse:43`, `api/metrics/insights:38`, `api/positions/generate:38`, `lib/agent/chat-thread-title:67`, `lib/agent/langgraph-engine:164`, `lib/agent/local-tools:191`, `lib/scraper:60`, `lib/scraper:88` |
| `generateImageFile` (3) | `api/images:23`, `lib/article-images:66`, `lib/agent/local-tools:218` (alias `callImageGenerationEndpoint`) |
| `instanceof MissingAIKeyError` (2) | `api/metrics/insights:47`, `lib/scraper:63` |
| Indirect through `lib/scraper.ts` | `api/content/import-url:16` (`rewriteArticle`), `worker/runner.ts:67`, `:97`, `:138` |
| Indirect through `lib/agent/local-tools.ts` | `api/agent/chat` (tool registry) |

Three facts that shape the batches:

1. No production call site passes the legacy `provider` argument (images excepted: `local-tools`
   passes its `provider` enum, which maps to a runtime pin). No preference translation work.
2. `src/app` has **no test file**: the route layer gets tests before it is migrated (A3).
3. `resolveRoute()` -> `ensureModelRuntimeSeeded()` -> `importLegacyAiSettings()` already runs on
   every routing attempt; only the network discovery was missing - that is A0.

## 2. Batches

### P3-A0 - seed-time catalog discovery (prerequisite of A1, D-P3-1)

* `src/features/ai-runtime/registry.ts`: `ensureModelRuntimeSeeded()` runs an
  `ensureColdStartCatalogs()` pass after the one-time seeding, **outside** the seed marker so a key
  added later in the same process is still picked up. Pending = no callable model and no endpoint
  that already synced successfully (`status === "ok"`), so a request never re-syncs a provider the
  user has deliberately switched off, while a provider that failed (or was never reached) is
  retried - pasting a valid key repairs the install on the next request.
* `src/features/ai-runtime/cold-start.test.ts`: a keyless install makes no request and enables
  nothing; a lone key becomes callable during seeding, and routing plus the chat call add no
  catalog read; a discovered provider is not re-synced; an unreachable catalog is swallowed, is
  recorded on the endpoint, and is retried on the next seed.
* Why it precedes A1: A1 removes `compat.ts` from `scraper.ts`, and `compat.ts` is what discovers
  on demand today. Without A0 that would silently break the key-without-models install - a
  regression introduced at A1, not at P4.
* Isolation: A0 is what makes the suite's inputs matter, so key handling moved to `src/test/app-env.ts`
  (D-P3-7); `runtime.test.ts`, `cold-start.test.ts`, `generate.test.ts` and `credentials.test.ts` now
  neutralise key variables instead of deleting them, and `resetRuntime()` clears the env *before* it
  seeds, so the pass sees the blank slate the test describes.
* Verification on this tree: `node_modules\.bin\tsc.cmd --noEmit` clean, `node_modules\.bin\eslint.cmd .`
  0 errors, `node_modules\.bin\vitest.cmd run` = **58 files / 330 tests, all pass**. A0 adds exactly
  1 file / 4 tests on top of the documented 57 / 326, which is the known cross-check.
* The one failure the first full run showed was `src/electron/branding.test.ts`, and it fails on
  `1d1de37` too: `docs/generate-migration.md:311` named the deleted SME provider test with the
  pre-`CoolPilot` product name. Baseline correction, not an A0 regression - fixed in its own commit
  before this one, which is why the suite above is green.

### P3-A1 - `lib/scraper.ts` (2 expressions, 5 consumers)

`rewriteArticle()` and `generateTopicPost()` keep their signatures, so `api/content/import-url`,
`worker/runner.ts` (x3) and `lib/agent/local-tools` inherit the runtime for free.

| Field | Before | After |
| --- | --- | --- |
| Call | `generateStructured({ prompt, schema: postDraftSchema, systemPrompt? })` | `aiRuntime.chatStructured({ messages: [{ role: "user", content: prompt }], systemPrompt, schema: postDraftSchema })` |
| Data | `result.data` -> `toPostDraft()` | `response.data` -> `toPostDraft()` (unchanged) |
| Provider | `result.provider` | `response.providerId` |
| Model | `result.model` | `response.model` |
| Key label | `result.keyLabel` (never persisted, D6) | not read at all |
| Usage | `result.usage` | `response.usage` |
| Credential failure | `instanceof MissingAIKeyError` -> rethrow unchanged | `AppError` `MODEL_CREDENTIAL_*` -> rethrow unchanged |
| Any other failure | `Error("AI rewrite failed: ...")` | same |

Kept: both prompt builders, `toPostDraft()` normalisation, `generateTopicPost()` never wrapping
failures and `rewriteArticle()` wrapping everything except credential failures.

Required cases (`src/lib/scraper.test.ts`), all through a stubbed transport:

1. Success: the request body is the structured-output shape, the prompt still carries the
   article/topic, and `provider`/`model`/`usage` come from the runtime (L1/L2).
2. Key rotation: key A is rejected (401), key B answers, the call succeeds (L3/L4).
3. Model failover: provider A answers 503, provider B answers, the call succeeds (L5).
4. A 400 is not the key's fault: exactly one call, no rotation, the failure surfaces (L4).
5. Credential failure is passed through unwrapped, so consumers see `MODEL_CREDENTIAL_MISSING`
   instead of a message-only `Error` (D-P3-3).

* Verification on this tree: `node_modules\.bin\tsc.cmd --noEmit` clean, `node_modules\.bin\eslint.cmd .`
  0 errors (the single warning is the pre-existing `react-hooks/exhaustive-deps` one in
  `components/agent-chat/chat-conversation.tsx`), `node_modules\.bin\vitest.cmd run` =
  **59 files / 335 tests, all pass** - A0's 58 / 330 plus exactly this batch's 1 file / 5 tests.
* One thing the cases deliberately do not pin is *which* of two keys is tried first.
  `planCredentialKeys()` orders by use count, and the key that ran the catalog sync (`prepareModel()`
  in the test) has already been counted once, so the position of the rejected key is an accounting
  artefact rather than a contract. Case 2 therefore asserts the rotation itself - two different
  `Authorization` values, the second attempt succeeding - while case 4 asserts the other half of L4:
  a 400 produces exactly one call, so neither the second key nor a second model is burned.
* The two generators keep their different error contracts, and the cases show it: `generateTopicPost()`
  surfaces whatever the runtime threw while `rewriteArticle()` wraps everything except the
  `MODEL_CREDENTIAL_*` family, which the last case pins with `instanceof AppError` plus the code.

### P3-A2 - the agent layer's LLM consumers (`lib/agent`, 3 call sites)

`chat-thread-title.ts:67`, `langgraph-engine.ts:164` and `local-tools.ts:191` (the
`generate_image_prompt` tool) are the last text/structured consumers of the facade inside `src/lib`;
after them the only production importers left are the route layer (A3) and `lib/agent/image-generation.ts`
(compat, B) - D-P3-2 gives that one its own design table, so it is not migrated here even though it
sits in the same directory.

| Field | Before | After |
| --- | --- | --- |
| Call | `generateStructured({ prompt, schema, systemPrompt? })` | `aiRuntime.chatStructured({ messages: [{ role: "user", content: prompt }], schema, systemPrompt? })` |
| Data | `result.data` (`.title`, `.steps`, `.prompt`) | `response.data` - unchanged |
| Provider / model | `result.provider`, `result.model` - read once, by `local-tools`, into the tool output `{ prompt, provider, model }` | `response.providerId`, `response.model` |
| Failure | swallowed by the caller's own `try/catch`: `generateChatThreadTitle()` falls back to the local title, `planToolCalls()` to a single draft step | unchanged - the runtime's error vocabulary deliberately never reaches these call sites |
| Schema + type imports | `@/lib/ai` re-export | `@/lib/ai/schemas` (the schemas do not move, only the import path) |

Kept: `chatTitleSchema` / `toolPlanSchema` / `imagePromptSchema`, the "a title never blocks the chat
response" contract, `planToolCalls()`'s empty-plan fallback, and the `generate_image_prompt` output
shape.

Tests - the mocks move with the import, so no case changed its subject:

* `langgraph-engine.test.ts` mocks `@/features/ai-runtime` instead of `@/lib/ai` (spread of the real
  module, so only `chatStructured` is stubbed); its five planning cases are otherwise untouched.
* `chat-thread-title.test.ts` gains three runtime cases: the schema and the numbered chat history go
  in and a normalised `data.title` comes out; a `MODEL_CREDENTIAL_MISSING` `AppError` still falls back
  to the local title; a usable preferred title never calls the runtime at all.
* `local-tools.test.ts` gains an execution case for `generate_image_prompt`: the tool reports the
  provider/model the runtime really used - not a hard-coded pair - and passes `context.systemPrompt` on.

* Verification on this tree: `node_modules\.bin\tsc.cmd --noEmit` clean, `node_modules\.bin\eslint.cmd .`
  0 errors (same single pre-existing `react-hooks/exhaustive-deps` warning),
  `node_modules\.bin\vitest.cmd run` = **59 files / 339 tests, all pass** - A1's 335 plus exactly this
  batch's 4 cases (3 in `chat-thread-title.test.ts`, 1 in `local-tools.test.ts`). No case was deleted
  and no suite changed its subject, which is the check that the mock swap really was a mock swap.

### P3-A3-0 - the route layer's test plumbing (`src/test/route-harness.ts`)

Section 1 recorded the fact that shapes this batch: `src/app` had **no test file**, so the route layer
gets tests before it is migrated. A test that watches a route talk to a provider needs four things that
no file in `src/app` had yet - a database that is not the user's, a transport that is not the network, a
credential pool that is not the machine's key file, and a `Request`. `src/test/route-harness.ts` is
exactly those four, and nothing else: the `lib/scraper.test.ts` preamble from A1 lifted into a module and
made generic.

| Piece | What it hands a route test |
| --- | --- |
| temp SQLite + `SOCIAL_AUTO_POST_DATA_DIR` | the route runs against a throwaway database, pinned *before* `@/db` is imported (the imports below it are `await`s for that reason) |
| `runtime`, `runtimeRepository`, `credentials` | the runtime barrel, the runtime's own tables (providers/endpoints/models/keys) and the credential store |
| `resetRuntime()` | keyless `env`, no vault entry, no callable model, no capability default left over from an earlier case (D-P3-7: key variables are *neutralised*, model variables deleted) |
| `prepareModel()` / `prepareChatModel()` | "this provider and this model really answer"; the second also sets the capability default |
| `stubFetch()` + `jsonResponse` / `qwenCatalog` / `jsonReply` / `unavailable` / ... | a transport that records every call and answers an unplanned one with a loud 404 |
| `jsonRequest()` | the `Request` the app itself would send |
| `chatCalls` / `bodyOf` / `authorizationsOf` | the wire assertions (which model was asked, in which shape) |

It asserts nothing on purpose: a route test keeps its own `await POST(request)` and
`expect(response.status)`, so its HTTP contract stays readable in the file that owns it. `scraper.test.ts`
was left byte-identical - it is A1's evidence and its verification line stays true - so those helpers
exist twice on purpose; the harness is the route layer's copy, and the two move together if this plumbing
ever changes.

### P3-A3-1 - `api/metrics/insights` (the D-P3-3 sample)

The first route, and a deliberate one: section 1 lists this file as one of the two places that branched on
`instanceof MissingAIKeyError`, so it is where D-P3-3 can be shown end to end - runtime code, runtime
status, HTTP answer, no legacy error class anywhere on the path.

| Field | Before | After |
| --- | --- | --- |
| Call | `generateStructured({ prompt, schema: metricInsightSchema })` | `aiRuntime.chatStructured({ messages: [{ role: "user", content: prompt }], schema: metricInsightSchema })` |
| Data | `result.data` | `response.data` - unchanged |
| Provider / model | `result.provider`, `result.model` | `response.providerId`, `response.model` |
| Schema import | `@/lib/ai` re-export | `@/lib/ai/schemas` |
| Credential failure | `instanceof MissingAIKeyError` -> `fail(message, 400)` | `failFromError(error, "AI_PROVIDER_FAILED", 500)` -> 400, code `MODEL_CREDENTIAL_MISSING` |
| Any other failure | `fail(message, 500)`, code `UNKNOWN_ERROR` | `failFromError(...)`: an `AppError` keeps its own code *and* status, a plain `Error` stays a 500 |
| Legacy import | `generateStructured` + `MissingAIKeyError` from `@/lib/ai` | none - the facade is not imported on this path at all |

Kept: the prompt builder (platform, account, title, content type, published-at, views, interactions, both
baselines), `computeBaseline(await listPublishRecords(1000), record)`, the `INVALID_PAYLOAD` 400 and
`Publish record not found` 404 guards, and the response envelope
(`{ publishRecordId, ...insight, provider, model, createdAt }` inside `{ ok: true, data }`).

Nothing here re-implements the runtime: no key reading, no status sniffing, no per-provider branch. The
codes and the statuses are the runtime's (D-P3-3), and they reach HTTP unchanged - which is why this route
has no error taxonomy of its own:

| Runtime outcome | HTTP | Decided in |
| --- | --- | --- |
| `MODEL_CREDENTIAL_MISSING` | 400 | `runtime.ts` / `key-pool.ts` / `adapters.ts` |
| `MODEL_CREDENTIAL_UNAVAILABLE`, every key cooling down | 429 | `key-pool.ts` (`unavailableError`) |
| `MODEL_CREDENTIAL_UNAVAILABLE`, every key rejected / disabled | 400 | same |
| `MODEL_UPSTREAM_FAILED` | 502 | `adapters.ts` |
| `MODEL_RATE_LIMITED` | 429 | `adapters.ts` |
| `MODEL_NOT_CONFIGURED` / `MODEL_CAPABILITY_UNAVAILABLE` | 503 / 409 | `runtime.ts` |
| anything else | 500, code `AI_PROVIDER_FAILED` | this route's fallback |

Tests (`src/app/api/metrics/insights/route.test.ts`, 6 cases - the runtime is *not* mocked, the route
handler is called for real):

1. Success: HTTP 200, `ok: true`, the insight plus the `provider`/`model` the runtime really used, one
   structured call with JSON mode on the wire, and a prompt carrying this record's numbers *and* the
   baseline the route computed from a second row (1200 views against an 800 average over 2 posts).
2. A removed credential: HTTP **400**, code `MODEL_CREDENTIAL_MISSING`, a message that is no longer
   `Missing qwen API key`, and **no** provider call. This is the case the batch exists for - the old route
   answered 400 by recognising a class, the new one by passing a code on.
3. A pool with nothing usable left (one key cooling down, one rejected): HTTP **429**, code
   `MODEL_CREDENTIAL_UNAVAILABLE`, `details.reasons` carrying both reasons, and no provider call: the pool
   refuses before a request exists.
4. A provider 5xx: HTTP **502**, code `MODEL_UPSTREAM_FAILED`, `details.status` = 503 - the upstream status
   is preserved in the details instead of being flattened into this route's own 500.
5. The two guards are untouched: an unknown record is still a 404 `Publish record not found`, and a
   payload without a usable id is still a 400 `INVALID_PAYLOAD`.
6. Neither guard asks a model: the record lookup and the payload validation both come first.

The file's first lines are the other half of the migration evidence: `@/lib/ai`, `@/lib/ai/generate` and
`@/lib/ai/compat` are mocked with factories that **throw**, so the whole suite fails if this route - or
anything it imports - still asked for the legacy facade. After A3-1 the facade's remaining importers are
the seven routes of A3-2/A3-3 and `lib/agent/image-generation.ts` (B); nothing else.

* Verification on this tree: `node_modules\.bin\tsc.cmd --noEmit` exit 0, `node_modules\.bin\eslint.cmd .`
  exit 0 with 0 errors (the single warning is the pre-existing `react-hooks/exhaustive-deps` one in
  `components/agent-chat/chat-conversation.tsx`, unchanged), `node_modules\.bin\vitest.cmd run` =
  **60 files / 345 tests, all pass** - A2's 59 / 339 plus exactly this batch's 1 file / 6 tests. No case
  was deleted anywhere, which is also the check that the harnesses did not disturb the A1 suite.

### P3-A3-2.1 - `api/ai-writing/generate`

The first of the five remaining structured routes, and the richest one: the model call is a small part of a
route that also assembles a prompt from three tables (positioning, product library, knowledge base), copies
the product photo into the artifacts directory, stores the article and books a usage row. Only the call
boundary moved.

| Field | Before | After |
| --- | --- | --- |
| Call | `generateStructured({ prompt, systemPrompt, schema: postDraftSchema })` | `aiRuntime.chatStructured({ messages: [{ role: "user", content: prompt }], systemPrompt, schema: postDraftSchema })` |
| Article | `result.data` -> `title` / `body` | `response.data` - unchanged |
| Provider / model | `result.provider`, `result.model` (item metadata, usage row, response) | `response.providerId`, `response.model` |
| Usage | `result.usage?.inputTokens` / `outputTokens` / `totalTokens` | `response.usage?.*` - unchanged field names |
| Failure | `fail(error.message, 502)` -> 502, code `UNKNOWN_ERROR` | `failFromError(error, "AI_PROVIDER_FAILED", 502)`: an `AppError` keeps the runtime's code *and* status, anything else keeps this route's 502 |
| Legacy import | `generateStructured` from `@/lib/ai/generate` | none - `@/lib/ai/schemas` was already the schema's source |

Kept, because this batch migrates a boundary rather than a business: the positioning lookup
(`config.positioningId ? getPosition(...) : getDefaultPosition()`), the material assembly (the topics, the
products selected from `productIds`, the free text), `selectKnowledgeReferences()` under
`knowledgeMode === "position"`, both prompt builders, `toPositioning()`'s eight fields, the title trim with
its `topics[0]?.title` / free-text / `未命名文章` fallbacks, `resolveArticleImages()` (product photo,
`og:image`, best-effort AI), the `title\n\nbody` post text, the content item's metadata, the usage row, the
201 envelope `{ item, images, provider, model }` and the `INVALID_PAYLOAD` 400.

The one deliberate contract change is the status of an AI exception, and it is D-P3-3's: a missing credential
is no longer a 502 built from `MissingAIKeyError`'s message but a 400 `MODEL_CREDENTIAL_MISSING`, a cooled
down pool a 429, and an upstream 5xx a 502 carrying the upstream status in `details.status`. The fallback for
a non-`AppError` stays this route's long-standing 502; only its code becomes `AI_PROVIDER_FAILED` instead of
`UNKNOWN_ERROR`. The console reads neither:
`components/creation/ai-writing/ai-writing-step-output.tsx` shows one generic failure, so nothing downstream
branches on the difference.

Tests (`src/app/api/ai-writing/generate/route.test.ts`, 5 cases - the runtime is *not* mocked, the route
handler is called for real, and only the transport is stubbed):

1. Success: HTTP 201, the stored item (trimmed title, `title\n\nbody`, `sourceUrls` from the topic URL), the
   product photo really copied into the artifacts directory (`fs.stat` on the returned path, and `imagePath`
   is that copy), `provider`/`model` in the response *and* in the item's metadata, one structured call with
   JSON mode on the wire, a system turn byte-identical to `buildArticleSystemPrompt()` for this positioning,
   and a user turn that starts with the prompt this config/materials/knowledge must produce (rebuilt in the
   test from the same tables, so the case pins the route's *assembly*) plus the schema instruction the
   runtime appends. The usage row carries the runtime's token report and the stored body's character count.
2. A removed credential: HTTP **400**, code `MODEL_CREDENTIAL_MISSING`, a message that is no longer
   `Missing qwen API key`, no provider call, and neither an article nor a usage row written - the failure
   lands before anything is persisted. This is the case the batch exists for.
3. A provider 5xx: HTTP **502**, code `MODEL_UPSTREAM_FAILED`, `details.status` = 503, one attempt, nothing
   stored.
4. The guard is untouched: a payload without `config` and an out-of-range `wordCount` are both 400
   `INVALID_PAYLOAD`, with no request on the wire at all.
5. The runtime's structured contract is live: a first answer that omits `body` is rejected, the route answers
   201 from the *corrected* second answer (four turns on the retry, the route's prompt still the prefix), the
   usage row reports both attempts merged (22 / 14 / 36), and a run that selects no product stores no image.

The file mocks `@/lib/ai` and `@/lib/ai/generate` with throwing factories. `@/lib/ai/compat` is deliberately
left real here, unlike A3-1: this route reaches `lib/agent/image-generation.ts` through
`lib/article-images.ts`, and that module imports compat on purpose until batch P3-B migrates it, so a
throwing factory would fail on a legitimate import rather than on a leftover facade call. The business rows
(one positioning, one knowledge entry, one product with a photo on disk) are created once in `beforeAll`,
because `resetRuntime()` resets the runtime's own tables, not these.

* Verification on this tree: `node_modules\.bin\tsc.cmd --noEmit` exit 0, `node_modules\.bin\eslint.cmd .`
  exit 0 with 0 errors (the same single pre-existing `react-hooks/exhaustive-deps` warning),
  `node_modules\.bin\vitest.cmd run` = **61 files / 350 tests, all pass** - A3-1's 60 / 345 plus exactly this
  batch's 1 file / 5 tests. `git grep "generateStructured" -- src` now finds, in production code, the four
  remaining routes (`content/generate`, `content/[id]/translate`, `knowledge-base/ai-parse`,
  `positions/generate`), the facade itself and its own test - one route per commit, so the count is the
  batch's progress bar.

### P3-A3-2.2 - `api/content/generate`

The article-creation entry point: the same `postDraftSchema` call shape as A3-2.1, but a different set of inputs
in front of it (a writing agent, a knowledge mode, the legacy `language` string) and the same content item /
usage row / 201 envelope behind it. Only the call boundary moved.

| Field | Before | After |
| --- | --- | --- |
| Call | `generateStructured({ prompt, systemPrompt, schema: postDraftSchema })` | `aiRuntime.chatStructured({ messages: [{ role: "user", content: prompt }], systemPrompt, schema: postDraftSchema })` |
| Article | `result.data` -> `title` / `body` | `response.data` - unchanged |
| Provider / model | `result.provider`, `result.model` (item metadata, usage row, 201 envelope) | `response.providerId`, `response.model` |
| Usage | `result.usage?.inputTokens` / `outputTokens` / `totalTokens` | `response.usage?.*` - unchanged field names |
| Failure | `fail(error.message, 502)` -> 502, code `UNKNOWN_ERROR` | `failFromError(error, "AI_PROVIDER_FAILED", 502)`: an `AppError` keeps the runtime's code *and* status, anything else keeps this route's 502 |
| Legacy import | `generateStructured` from `@/lib/ai/generate` | `aiRuntime` from `@/features/ai-runtime` |

Kept, because this batch migrates a boundary rather than a business: the positioning lookup (`positioningId ?
getPosition(...) : getDefaultPosition()`), `guessLanguage()` over the legacy `language` field, the config this
route derives from the payload (`materialSource: "free"`, `wordCount` from `maxWords`, `coreKeywords` from
`keywords`), the material (`{ topics: [], products: [], freeText: topic`, then `prompt }`), the writing agent's
prompt joined with `buildArticleSystemPrompt()` by `"\n\n"`, `buildArticlePrompt()` with the audience and
industry labels, `selectKnowledgeReferences()` under `knowledgeMode === "position"`, `resolveArticleImages()` with
no product photos and no source pages, the title trim with its `data.topic` fallback, the `title\n\nbody` post
text, the metadata (`type`, `topic`, `prompt`, `generationType: "topic"`, the agent's id and name, the
provider/model, `positioningId`, the whole `aiWriting` config), the usage row and the 201 envelope
`{ item, provider, model, images }`.

Two pre-existing asymmetries against A3-2.1 are preserved on purpose, and both are now pinned by a case:

* This route words its own payload guard - `fail("Invalid generation payload", 400, error)` - and that string is
  not an `AppErrorCode`, so it answers 400 with code `UNKNOWN_ERROR` and a human message where
  `api/ai-writing/generate` answers `INVALID_PAYLOAD`.
* A `positioningId` that no longer resolves is not an error at all: no persona is sent,
  `selectKnowledgeReferences()` is called without an id (so it stops filtering and every enabled entry applies),
  the metadata records `positioningId: ""` and `aiWriting.positioningId` keeps the id the console sent.

The status of an AI exception is the same D-P3-3 trade as A3-2.1: a missing credential is a 400
`MODEL_CREDENTIAL_MISSING` instead of a 502 built from `MissingAIKeyError`'s message, a cooled-down pool a 429,
and an upstream 5xx a 502 carrying the upstream status in `details.status`; a non-`AppError` keeps this route's
long-standing 502 (only its code becomes `AI_PROVIDER_FAILED`). Neither console caller branches on any of it:
`components/creation/article-ai-dialog.tsx` shows one generic failure (`awGenerateFailed`), and
`components/generate-content-panel.tsx` prints whatever message `apiPost()` surfaced.

Tests (`src/app/api/content/generate/route.test.ts`, 6 cases - the runtime is *not* mocked, the route handler is
called for real, and only the transport is stubbed):

1. Success: HTTP 201, the stored item (trimmed title, `title\n\nbody`, `status: "ready"`, no source URLs), the
   `"product"` strategy resolving to no image at all (`images: []`, and `imagePath` comes back `undefined`), the
   runtime's `provider`/`model` in the response *and* in the metadata (which is compared against the whole
   `aiWriting` config the route derives), one structured call with JSON mode on the wire, a system turn
   byte-identical to the agent's prompt joined with `buildArticleSystemPrompt()` for this positioning, and a user
   turn that starts with the prompt this config/material/knowledge must produce (rebuilt in the test from the
   same tables, so the case pins the route's *assembly*) plus the schema instruction the runtime appends. The
   usage row carries the runtime's token report and the stored body's character count.
2. The console's older payload: no `languageCode` and no extra instructions - `guessLanguage("English")` and
   `guessLanguage("繁體")` reach the prompt as `English` / `繁體中文（香港）` and the metadata's `aiWriting` as
   `en` / `zh-TW`, `positioningId: ""` resolves through `getDefaultPosition()` (the metadata records the row that
   was found), and the material is the topic alone.
3. A removed credential: HTTP **400**, code `MODEL_CREDENTIAL_MISSING`, a message that is no longer
   `Missing qwen API key`, no provider call, and neither an article nor a usage row written.
4. A provider 5xx: HTTP **502**, code `MODEL_UPSTREAM_FAILED`, `details.status` = 503, one attempt, nothing
   stored.
5. The guard: a body without `topic`, a `maxWords` below the floor, an unknown `articleStyle` and a body that is
   not JSON are all 400 carrying this route's own message and code, with nothing on the wire.
6. Assembly: a chosen writing agent with `knowledgeMode: "off"` sends that agent's prompt and no knowledge
   references, and an unknown `positioningId` sends no persona while both knowledge entries still apply.

The file mocks `@/lib/ai` and `@/lib/ai/generate` with throwing factories and leaves `@/lib/ai/compat` real for
the same reason as A3-2.1 (`lib/article-images.ts` -> `lib/agent/image-generation.ts` until P3-B). The business
rows (one positioning, one knowledge entry tied to it, one entry that applies to every positioning) are created
once in `beforeAll`, because `resetRuntime()` resets the runtime's own tables, not these.

* Verification on this tree: `node_modules\.bin\tsc.cmd --noEmit` exit 0, `node_modules\.bin\eslint.cmd .` exit 0
  with 0 errors (the same single pre-existing `react-hooks/exhaustive-deps` warning),
  `node_modules\.bin\vitest.cmd run` = **62 files / 356 tests, all pass** - A3-2.1's 61 / 350 plus exactly this
  batch's 1 file / 6 tests. `git grep "generateStructured" -- src` now finds, in production code, the three
  remaining routes (`content/[id]/translate`, `knowledge-base/ai-parse`, `positions/generate`), the facade itself
  and its own test - one route per commit, so the count is the batch's progress bar.

### P3-A3-2.3 - `api/content/[id]/translate`

The editor's 翻译 dialog: the first *dynamic* route of the batch. It reads one article by `[id]`, translates its
paragraphs, and writes **nothing** back - the dialog shows a diff and persists through `PATCH /api/content/[id]`
only after the user confirms. Only the call boundary moved.

| Field | Before | After |
| --- | --- | --- |
| Call | `generateStructured({ prompt, systemPrompt, schema: articleTranslationSchema })` | `aiRuntime.chatStructured({ messages: [{ role: "user", content: prompt }], systemPrompt, schema: articleTranslationSchema })` |
| Paragraphs | `result.data.paragraphs` | `response.data.paragraphs` - unchanged |
| Title | `result.data.title` | `response.data.title` - unchanged |
| Provider / model | `result.provider`, `result.model` (usage row and the 200 envelope) | `response.providerId`, `response.model` |
| Usage | `result.usage?.inputTokens` / `outputTokens` / `totalTokens` | `response.usage?.*` - unchanged field names |
| Failure | `fail(error.message, 502)` -> 502, code `UNKNOWN_ERROR` | `failFromError(error, "AI_PROVIDER_FAILED", 502)`: an `AppError` keeps the runtime's code *and* status, anything else keeps this route's 502 |
| Legacy import | `generateStructured` from `@/lib/ai/generate` | `aiRuntime` from `@/features/ai-runtime` |

Kept, because this batch migrates a boundary rather than a business: the `[id]` guard (a missing article is a
404 *before* the payload is parsed), the payload guard (`INVALID_PAYLOAD`), the source assembly
(`parsed.data.title?.trim() || existing.title`, then `parsed.data.text?.trim() || htmlToPlainText(existing.body)`,
capped at `maxTranslateInput = 8000`), `toParagraphs()`, the `EMPTY_CONTENT` guard, the prompt (the language
label, the four instruction lines, `原标题：`, the numbered source paragraphs), the translator system
instruction, the trim/filter over the answer, the `EMPTY_RESULT` guard, the usage row (`kind: "article"`,
`wordCount` of `paragraphs.join("\n")`, `contentItemId`) and the 200 envelope
`{ title, paragraphs, sourceTitle, sourceParagraphs, provider, model }`.

The status of an AI exception is the same D-P3-3 trade as A3-2.1/A3-2.2: a missing credential is a 400
`MODEL_CREDENTIAL_MISSING` instead of a 502 built from `MissingAIKeyError`'s message, a cooled-down pool a 429,
and an upstream 5xx a 502 carrying the upstream status in `details.status`; a non-`AppError` keeps this route's
long-standing 502 (only its code becomes `AI_PROVIDER_FAILED`). Nothing downstream branches on the difference:
`components/creation/article-editor/article-translate-dialog.tsx` shows one generic failure and reads only
`title` / `paragraphs` / `sourceTitle` / `sourceParagraphs` - `provider` and `model` travel in the envelope for
the same reason they always did (the console's usage view), and the dialog ignores them.

Two of this route's own sentences are warts rather than codes, and both are now pinned: `EMPTY_CONTENT` is a 400
whose *code* is `UNKNOWN_ERROR` and whose *message* is that literal, and `EMPTY_RESULT` is a 502 with the same
shape. They looked like that before the migration and the batch deliberately did not tidy them up
(`fail("EMPTY_CONTENT", 400)` passes a string that is not an `AppErrorCode`), so a later cleanup has to notice
the tests.

Tests (`src/app/api/content/[id]/translate/route.test.ts`, 7 cases - the runtime is *not* mocked, the route
handler is called for real, and only the transport is stubbed):

1. Success: HTTP 200, the trimmed title and the ordered paragraphs the model answered, `sourceTitle` /
   `sourceParagraphs` taken from the *editor's* text and title (the stored body and the stored title must not
   reach the prompt at all, and a second article in the database must not be mentioned either), the runtime's
   `provider` / `model`, one structured call with JSON mode on the wire, a system turn byte-identical to the
   translator instruction, and a user turn that starts with the prompt these three inputs must produce (rebuilt
   in the test, so the case pins the route's *assembly*) plus the schema instruction the runtime appends. The
   usage row carries the runtime's token report and the returned text's character count, and the article is
   still byte-identical afterwards.
2. The fallback path: a payload with no `text` and no `title` translates the **stored** article - its HTML is
   flattened, split into paragraphs and cut at the 8000-character cap (the cut lands inside the last paragraph,
   which the case proves against both the same expression the route should have used and the untruncated
   paragraph), and the stored title becomes `sourceTitle`.
3. A removed credential: HTTP **400**, code `MODEL_CREDENTIAL_MISSING`, a message that is no longer
   `Missing qwen API key`, no provider call, no usage row, no article change.
4. The `[id]` guard: an unknown article is a 404 `NOT_FOUND` with nothing on the wire - even when the payload is
   one this route would reject, which pins that the article is read before the body is parsed.
5. The guards it still words itself: a body without `targetLanguage`, a `targetLanguage` that is blank once
   trimmed and a body that is not JSON are all 400 `INVALID_PAYLOAD`, and an article whose body is empty (with a
   `text` that falls back to it) is the 400 with code `UNKNOWN_ERROR` and message `EMPTY_CONTENT` - none of them
   reaching the provider.
6. The post-answer guard: a schema-valid answer whose only paragraph is whitespace is accepted by the runtime on
   the first attempt, emptied by the route's own trim/filter, and answered as a 502 `EMPTY_RESULT` (again code
   `UNKNOWN_ERROR`) with no usage row and no article change - the guard sits before the usage row.
7. The runtime's structured contract is live: a first answer that omits `paragraphs` is rejected, the route
   answers 200 from the *corrected* second answer, the retry call carries four turns with the route's prompt
   still the prefix, and the usage row reports both attempts merged (22 / 14 / 36).

The `[id]` segment is why this file calls the handler the way the framework does -
`POST(jsonRequest(url, body), { params: Promise.resolve({ id }) })` - and never through the URL: the route reads
`(await context.params).id`, so the article a case seeded is the article it must read, which is what case 1 and
case 4 pin from both sides. The file mocks `@/lib/ai`, `@/lib/ai/generate` *and* `@/lib/ai/compat` with throwing
factories; that last one is stronger than A3-2.1/A3-2.2 could be, and possible here for a reason worth
recording: the only production importer of the shim is `lib/agent/image-generation.ts`, and this route reaches
neither it nor `lib/article-images.ts`, so this graph is shim-free and the mock proves it. The four articles
these cases read (the target, a sibling that must stay unmentioned, one long enough to hit the cap, one with an
empty body) are created once in `beforeAll`, because `resetRuntime()` resets the runtime's own tables, not these.

* Verification on this tree: `node_modules\.bin\tsc.cmd --noEmit` exit 0, `node_modules\.bin\eslint.cmd .` exit 0
  with 0 errors (the same single pre-existing `react-hooks/exhaustive-deps` warning),
  `node_modules\.bin\vitest.cmd run` = **63 files / 363 tests, all pass** - A3-2.2's 62 / 356 plus exactly this
  batch's 1 file / 7 tests. `git grep "generateStructured" -- src` now finds, in production code, the two
  remaining routes (`knowledge-base/ai-parse`, `positions/generate`), the facade itself and its own test:
  **4 -> 3 (A3-2.2) -> 2**.

### P3-A3-2.4 - `api/knowledge-base/ai-parse`

The "Smart import" route: one paste in, one knowledge entry out. It is one of the two routes §2.1 lists as
"catch -> deterministic local fallback" (row 4), and that fallback is what shapes this batch - the call boundary
moves, and the catch does not.

| Field | Before | After |
| --- | --- | --- |
| Call | `generateStructured({ prompt, systemPrompt, schema: aiKnowledgeSchema })` | `aiRuntime.chatStructured({ messages: [{ role: "user", content: prompt }], systemPrompt, schema: aiKnowledgeSchema })` |
| Entry | `result.data` -> title / content / category / weight / tags | `response.data` - unchanged |
| Provider / model | `result.provider`, `result.model` (usage row, 201 envelope) | `response.providerId`, `response.model` |
| Usage | `result.usage?.inputTokens` / `outputTokens` / `totalTokens` | `response.usage?.*` - unchanged field names |
| Schema | the route's own local `aiKnowledgeSchema` | unchanged: no import moves here, because `@/lib/ai/schemas` was never this route's source (unlike A3-2.1..2.3) |
| Failure | `catch {}` -> `parseKnowledgeFromRawText()` -> 201 `source: "fallback"` | the same `catch {}` - see below |
| Legacy import | `generateStructured` from `@/lib/ai/generate` | none: this route now imports nothing from `@/lib/ai` at all |

Kept, because this batch migrates a boundary rather than a business: the prompt
(`请把以下原始内容整理成一条知识条目：`) and its 8000-character cap, the six-line `systemPrompt` literal, the payload
guard, the four answer fields, the normalisation chain (`isKnowledgeBaseCategory` or `guessKnowledgeCategory()` of
what the model *did* answer, `isKnowledgeBaseWeight` or `"medium"`,
`data.title.trim() || parseKnowledgeFromRawText(raw).title`, `data.content.trim() || raw.trim()`, tags trimmed and
emptied out and sliced to 8), the `{ ...draft, origin: "ai", positionId }` write, the usage row
(`kind: "knowledge"`, the runtime's tokens, the character count of the answer) and the 201 envelope
`{ item, source: "ai", provider, model }`.

**The deliberate difference from A3-2.1..2.3 is the error contract: this route does not adopt D-P3-3.**

| Runtime outcome | A3-2.1..2.3 | `knowledge-base/ai-parse` |
| --- | --- | --- |
| `MODEL_CREDENTIAL_MISSING` (no usable key) | 400, the runtime's code | **201** `source: "fallback"` |
| `MODEL_CREDENTIAL_UNAVAILABLE` (pool exhausted) | 429 + `details.reasons` | **201** `source: "fallback"` |
| `MODEL_UPSTREAM_FAILED` (provider 5xx) | 502 + `details.status` | **201** `source: "fallback"` |
| `AI_STRUCTURED_OUTPUT_INVALID` (both attempts) | 502 | **201** `source: "fallback"` |
| `MODEL_NOT_CONFIGURED` / `MODEL_CAPABILITY_UNAVAILABLE` | 503 / 409 | **201** `source: "fallback"` |
| `INVALID_PAYLOAD` (this route's own guard) | 400 | 400 - unchanged |

`failFromError` appears nowhere in the file, and the envelope grows no `code`. The dialog
(`components/smart-config/knowledge-base/knowledge-smart-dialog.tsx`) knows only success or `kbSmartFailed`, and the
whole point of the fallback is that a paste never dies with the key: an "AI provider failed" answer would have been a
business change wearing a boundary's clothes. The runtime's vocabulary still buys something - `source` says which path
answered, so a local parse is never mistaken for a model's work - but it is not allowed to decide the HTTP status here.
This is also why losing the legacy shim costs this route nothing: `withLegacyCompatibility()` used to turn an unroutable
install into a key-without-models retry, and D-P3-1 moved that pass into the seed, where it belongs.

Tests (`src/app/api/knowledge-base/ai-parse/route.test.ts`, 9 cases - the runtime is *not* mocked, the route handler is
called for real, and only the transport is stubbed):

1. Success: HTTP 201, `source: "ai"`, an envelope whose keys are exactly `item` / `source` / `provider` / `model`, the
   normalised entry (trimmed title and body, trimmed non-empty tags, `origin: "ai"`, `enabled: true`, the `positionId`
   it was given), the model's title *and not* the paste's first line, the row `getKnowledgeBase(id)` returns, one
   structured call with JSON mode on the wire, a system turn byte-identical to this route's literal, a user turn that
   starts with `请把以下原始内容整理成一条知识条目：` plus the paste and carries the runtime's schema instruction, and
   one usage row holding the runtime's tokens (11/7/18) plus the character count of the *answer* - asserted to differ
   from the paste's.
2. The cap: an 8400-character paste with a marker beyond 8000 - the prompt keeps exactly `slice(0, 8000)`, the marker is
   in neither the prompt nor the stored entry, and the entry is still the model's.
3. A badly-behaved answer is normalised rather than stored verbatim: `category: "misc"`, `weight: "urgent"`, a blank body
   and twelve junk tags become `guessKnowledgeCategory()` of the model's own title (`product`), `medium`, the paste as the
   body and eight trimmed tags; the second answer instead leaves the title blank and answers `faq` / `low` - the
   deterministic local title is used and the vocabulary is kept.
4. Nothing configured: HTTP **201**, `source: "fallback"`, keys exactly `item` / `source`, the entry equal to
   `parseKnowledgeFromRawText(raw)` (first line as title, `origin: "ai"`), exactly one row written, no provider call at
   all and no usage row.
5. A credential revoked after the model was configured (`MODEL_CREDENTIAL_MISSING`, the 400 of every other route in this
   batch): still **201** `source: "fallback"`, no chat call, no usage row, and no `code` anywhere in the body.
6. A provider 5xx: exactly one attempt, then the same 201 fallback, nothing billed, and the stored entry is the local one.
7. An answer `aiKnowledgeSchema` rejects twice: two calls (the runtime's corrective retry), then the fallback, and the
   rejected title is nowhere in the entry.
8. The guards: `{}`, a whitespace-only `content` and a body that is not JSON are all 400 `INVALID_PAYLOAD` /
   `Invalid payload` with an empty transport and no row written. Validation runs before the call, so an unusable payload
   can never reach the fallback - the one answer this route words itself.
9. No capability default: `prepareModel()` (a credential and one enabled model, but no `chat` / `structured_output`
   default) still answers `source: "ai"`, from the capability the runtime infers for `qwen3-max`, in one call.

The file mocks `@/lib/ai`, `@/lib/ai/generate` and `@/lib/ai/compat` with throwing factories. The shim mock is safe for
the same reason as A3-2.3 and was not safe in A3-2.1/A3-2.2: the only production importer of `@/lib/ai/compat` is
`lib/agent/image-generation.ts`, reached through `lib/article-images.ts`, and neither is on this route's graph. No
business fixture is needed at all - the paste comes from the request - and the cases that must prove "nothing was
written" diff the knowledge-base and usage ids instead of counting rows, because the earlier cases' rows are still in
these tables (`resetRuntime()` resets the runtime's own tables, not the business ones).

* Verification on this tree: `node_modules\.bin\tsc.cmd --noEmit` exit 0, `node_modules\.bin\eslint.cmd .` exit 0 with
  0 errors (the same single pre-existing `react-hooks/exhaustive-deps` warning), `node_modules\.bin\vitest.cmd run` =
  **64 files / 372 tests, all pass** - A3-2.3's 63 / 363 plus exactly this batch's 1 file / 9 tests.
  `git grep "generateStructured" -- src` now finds, in production code, **one** remaining route
  (`positions/generate`), the facade itself and its own test: **4 -> 3 (A3-2.2) -> 2 (A3-2.3) -> 1 (A3-2.4)**. One route
  left before the facade has no production caller at all.

### P3-A3-2.5 - `api/positions/generate`

The "AI 生成定位" route: one sentence in, a whole writing profile out (and no row of its own - the dialog saves the
draft through another endpoint). It is the second and last of the two routes §2.1 lists as "catch -> deterministic
local fallback" (row 6), and §2.1's `generateStructured` column ends here: after this batch the legacy facade has **no
production caller at all**.

| Field | Before | After |
| --- | --- | --- |
| Call | `generateStructured({ prompt, systemPrompt, schema: aiPositionSchema })` | `aiRuntime.chatStructured({ messages: [{ role: "user", content: prompt }], systemPrompt, schema: aiPositionSchema })` |
| Entry | `result.data` -> the eight profile fields | `response.data` - unchanged |
| Provider / model | `result.provider`, `result.model` (usage row, response) | `response.providerId`, `response.model` |
| Usage | `result.usage?.inputTokens` / `outputTokens` / `totalTokens` | `response.usage?.*` - unchanged field names |
| Schema | the route's own local `aiPositionSchema` | unchanged: no import moves here either, because `@/lib/ai/schemas` was never this route's source |
| Failure | `catch (error)` -> `buildPositionDraftFromPrompt()` -> 200 `source: "fallback"` + `reason` | the same `catch` - see below |
| Legacy import | `generateStructured` from `@/lib/ai/generate` | none: this route now imports nothing from `@/lib/ai` at all |

Kept, because this batch moves a boundary rather than a business: the prompt (`用户想做这样的账号：`), the six-line
`systemPrompt` literal, the payload guard, the eight answer fields, the whole normalisation chain
(`normalizePositionDraft({ ...emptyPositionDraft(name), ...data })`, which trims every field and clamps it to
`positionFieldLimits`, and which resets `bannedWords` / `antiAiDetection` / `aiFreedom` / `cooldownDays` /
`platformOverrides` / `rssSources` / `store` to their defaults whatever the model answered), the AI path's habit of
storing a blank `name` as blank (deriving one from the sentence is the fallback's job, not the model's), the usage row
(`kind: "profile"`, the runtime's tokens, the character count of the model's `personaRole`) and the response
`{ draft, source: "ai", provider, model }`.

**Like A3-2.4 - and unlike A3-2.1..2.3 - this route does not adopt D-P3-3.**

| Runtime outcome | A3-2.1..2.3 | `positions/generate` |
| --- | --- | --- |
| `MODEL_CREDENTIAL_MISSING` (no usable key) | 400, the runtime's code | **200** `source: "fallback"` + `reason` |
| `MODEL_CREDENTIAL_UNAVAILABLE` (pool exhausted) | 429 + `details.reasons` | **200** `source: "fallback"` + `reason` |
| `MODEL_UPSTREAM_FAILED` (provider 5xx) | 502 + `details.status` | **200** `source: "fallback"` + `reason` |
| `AI_STRUCTURED_OUTPUT_INVALID` (both attempts) | 502 | **200** `source: "fallback"` + `reason` |
| `MODEL_NOT_CONFIGURED` / `MODEL_CAPABILITY_UNAVAILABLE` | 503 / 409 | **200** `source: "fallback"` + `reason` |
| `INVALID_PAYLOAD` (this route's own guard) | 400 | 400 - unchanged |
| `MissingAIKeyError` (the legacy shim) | - | gone: `reason` carries the runtime's own message instead |

`failFromError` appears nowhere in the file, and the envelope grows no `code`. The dialog
(`components/smart-config/positioning-ai-dialog.tsx`) calls `apiPost` and then either applies `result.draft` or shows
`posAiFailed`; it reads neither `source` nor `reason`. The fallback is therefore invisible to it - which is exactly why
the route has to keep answering it instead of an "AI provider failed" error: an install with no key is the normal state
for a first run, and the dialog's whole promise is that a sentence always comes back as a usable draft.

**The one thing this route's body can see change is `reason`**, the third key of the fallback payload - and this is the
concrete form of "P3-C deletes the legacy error abstraction, not the business fallback". The legacy path quoted
`MissingAIKeyError` (`Missing qwen API key`) or a provider error; it now quotes whatever the runtime actually failed
with:

| Failure | `reason` on the wire |
| --- | --- |
| Nothing routable | `No model is configured for this request` |
| Model configured, no usable key | `No configured model has a usable credential for this request` |
| Provider 5xx | `Chat completion HTTP 503: {"error":{"message":"boom"}}` - the adapter's own wording |
| Both answers rejected by the schema | `Structured output validation failed: <the zod issue>...` |

That is the honest text of the failure instead of the shim's guess at it, nothing branches on the string (the dialog
does not read it, and no consumer of this route does), and every one of those values is pinned in the test file - so a
later change to it is a conscious decision rather than a silent one.

Tests (`src/app/api/positions/generate/route.test.ts`, 9 cases - the runtime is *not* mocked, the route handler is
called for real, and only the transport is stubbed):

1. Success: HTTP 200, `source: "ai"`, a payload whose keys are exactly `draft` / `source` / `provider` / `model`, the
   runtime's provider pair, and a draft deep-equal to `{ ...emptyPositionDraft(name), <the model's seven other fields,
   trimmed> }` - every field normalised, and the name is the model's rather than the sentence's first segment the local
   builder would use. On the wire: one structured call with JSON mode (`response_format: { type: "json_object" }`),
   turns `["system", "user"]`, a system turn byte-identical to this route's literal, and a user turn that starts with
   `用户想做这样的账号：` plus the sentence and carries the runtime's schema instruction. One usage row: `kind:
   "profile"`, `qwen` / `qwen3-max`, the runtime's tokens (11/7/18) and `wordCount` = the character count of the
   *model's* `personaRole` - asserted to differ from the sentence's.
2. An overreaching answer (100/600/2400 characters on the clamped fields, plus `bannedWords`, `antiAiDetection`,
   `aiFreedom`, `cooldownDays`, `platformOverrides`, `rssSources` and a `store` claiming `status: "published"`): the
   three oversized fields end exactly at `positionFieldLimits.name` / `.description` / `.personaRole`, `personaSeeds`
   keeps what the model said inside its own field, and every switch `aiPositionSchema` never asks about is at its
   default - a model cannot publish a store listing or switch off the AI-detection guard through this route. A second
   answer with a whitespace-only name stores blank, because deriving a name from the sentence is the fallback's job.
3. Nothing configured: HTTP **200**, `source: "fallback"`, keys exactly `draft` / `reason` / `source`, the draft
   deep-equal to `buildPositionDraftFromPrompt(prompt)`, `reason` = `No model is configured for this request`, no `code`
   anywhere in the body, no provider call at all and no usage row.
4. A credential revoked after the model was configured (`MODEL_CREDENTIAL_MISSING`, the 400 of every other route in this
   batch): still **200** `source: "fallback"`, `reason` = `No configured model has a usable credential for this request`,
   no chat call, no usage row.
5. A provider 5xx: exactly one attempt, then the same 200 fallback, `reason` = the adapter's wording, nothing billed.
6. An answer `aiPositionSchema` rejects twice: two calls (the runtime's corrective retry), then the fallback, `reason`
   starting with `Structured output validation failed`, and the rejected name nowhere in the draft.
7. The guards: `{}`, a whitespace-only `prompt`, 301 characters and a body that is not JSON are all 400
   `INVALID_PAYLOAD` / `Invalid payload` on an empty transport, with nothing billed. Validation runs before the call, so
   an unusable payload can never reach the fallback - the one answer this route words itself.
8. The ceiling: a 300-character sentence padded with spaces is trimmed by `positionGenerateSchema` and pasted in whole
   (`用户想做这样的账号：` + all 300 characters). This route slices nothing - unlike A3-2.4's 8000-character cap, there
   is no second limit for a case to find.
9. No capability default: `prepareModel()` (a credential and one enabled model, no `chat` / `structured_output` default)
   still answers `source: "ai"` in one call.

The file mocks `@/lib/ai`, `@/lib/ai/generate` and `@/lib/ai/compat` with throwing factories. That is what makes this
the file that proves `generateStructured` left this route's graph: a surviving
`import { generateStructured } from "@/lib/ai/generate"` anywhere under the handler - the shape this batch replaced -
would fail here instead of in a packaged build. The shim mock is safe for the same reason as A3-2.3/A3-2.4 and was not
safe in A3-2.1/A3-2.2: the only production importer of `@/lib/ai/compat` is `lib/agent/image-generation.ts`, reached
through `lib/article-images.ts`, and neither is on this route's graph (`@/db/repository`, `@/lib/api`, `@/lib/positions`,
`@/lib/usage`, `@/lib/validation` and the runtime). No business fixture is needed at all - the sentence comes from the
request - and only the usage rows are diffed by id, because `resetRuntime()` resets the runtime's own tables and not the
business ones.

* Verification on this tree: `node_modules\.bin\tsc.cmd --noEmit` exit 0, `node_modules\.bin\eslint.cmd .` exit 0 with
  0 errors (the same single pre-existing `react-hooks/exhaustive-deps` warning),
  `node_modules\.bin\vitest.cmd run` = **65 files / 381 tests, all pass** - A3-2.4's 64 / 372 plus exactly this batch's
  1 file / 9 tests, with no case deleted anywhere. In production code, `git grep "generateStructured" -- src
  ":(exclude)*.test.ts"` now finds only a comment in `features/ai-runtime/runtime.ts`, a comment in `lib/scraper.ts`,
  the facade's own definition and the facade's barrel:
  **4 -> 3 (A3-2.2) -> 2 (A3-2.3) -> 1 (A3-2.4) -> 0 (A3-2.5)** - after this batch the legacy structured-output path
  has no production caller at all, and **P3-A3-2 is complete**. What still imports the facade is `generateText`
  (`api/content/mindmap`, `api/content/[id]/rewrite`) and `generateImageFile` (`api/images` and `lib/article-images`),
  and `lib/agent/image-generation.ts` is still the compat shim's only production importer: the surface the batches
  after this one own, and nothing more.

### P3-A3-3.1 - `api/content/mindmap`

The first of the two `generateText` routes (section 1: `api/content/mindmap:62`) and the smallest migration of the
batch: two lines change, because the answer is free text and the route consumes **one** field of it. It is also the
cleanest statement of the boundary this phase keeps drawing - `aiRuntime` owns the model call, the domain owns the
meaning of the answer - since the route does not interpret the outline at all.

| Field | Before | After |
| --- | --- | --- |
| Call | `generateText({ prompt, systemPrompt })` | `aiRuntime.chat({ messages: [{ role: "user", content: prompt }], systemPrompt })` |
| Answer | `result.text` -> `{ markdown }` | `response.text` - unchanged, byte for byte |
| Provider / model | not read | not read: `providerId` / `model` / `credentialLabel` / `attempts` / `route` stay unused on this path |
| Usage | not read, no usage row written | unchanged - still no usage row, and no `EMPTY_RESULT` guard was added |
| Preference | no `provider` argument | no `preferProviderId`: the runtime's configured text provider applies (this route never asked for a vendor) |
| Failure | `failFromError(error, "UNKNOWN_ERROR", 500)`, which for an unroutable install or a missing key meant a flat 500 carrying `MissingAIKeyError`'s message | the same `failFromError`, now passing the runtime's own code *and* status on |
| Legacy import | `generateText` from `@/lib/ai` | none: `next/server`, `zod`, `@/lib/api` and the runtime |

Kept, because this batch moves a boundary rather than a business: the `{ topic: z.string().trim().min(1) }` guard,
`MINDMAP_SYSTEM_PROMPT` and the `主题：...` prompt in full, `withCors` on every answer, `OPTIONS`'s 204, the
`{ markdown }` envelope with nothing else in it, the trim the schema performs, and the absence of any
post-processing: the route forwards the model's text exactly as it came out of the adapter - a blank completion never
reaches it (`MODEL_UPSTREAM_NO_CONTENT`, 502, raised by the adapter), and a fenced or oddly-wrapped outline is the
client's problem to parse.

That is the boundary this route illustrates best, because the interpretation it does *not* do already lives outside
the server: `markdownToMindMap()` (`src/mindmap/mindmap-markdown.ts`, heading hierarchy -> tree, indentation
fallback, code-fence stripping) runs on the canvas, and the Drawnix whiteboard talks to this same endpoint from a
different origin with its own reader (`src/whiteboard/drawnix/utils/llm.ts`). "Runtime calls the model, domain
interprets the answer" is therefore not a rule this batch obeys - it is what the file already did, which is why the
migration is two lines.

**The error vocabulary is the one contract change**, and §2.1 already listed this route as a `failFromError` one -
the error-propagation family, not the fallback family of `knowledge-base/ai-parse` and `positions/generate`:

| Case | Before | After |
| --- | --- | --- |
| nothing configured | `MissingAIKeyError` -> **500** `UNKNOWN_ERROR`, message `Missing gemini API key` | **503** `MODEL_NOT_CONFIGURED`, `No model is configured for this request` |
| credential missing | `MissingAIKeyError` -> **500** | **400** `MODEL_CREDENTIAL_MISSING`, `No configured model has a usable credential for this request` |
| every key unavailable | `MissingAIKeyError` -> **500** | **429** / 400 `MODEL_CREDENTIAL_UNAVAILABLE` + `details.reasons` |
| provider 5xx | **502** `MODEL_UPSTREAM_FAILED` (the shim never masked this one) | **502** - unchanged, parity |
| blank completion | **502** `MODEL_UPSTREAM_NO_CONTENT` | **502** - unchanged, parity |
| body guard, `INVALID_PAYLOAD` | **400** | **400** - unchanged |
| body that is not JSON | **500** `UNKNOWN_ERROR` | **500** `UNKNOWN_ERROR` - unchanged |
| anything else | 500, code `UNKNOWN_ERROR` | same |

The last two rows are why the fallback code stays `UNKNOWN_ERROR` here instead of becoming an AI-specific one as in
A3-2.1..2.3: this route's `try` also contains its **input** guard (`await request.json()` and `safeParse`), so its
fallback is not an AI-only fallback. That guard is deliberately left exactly where it was - the one place in this
batch where a `parseJson()` cleanup was available and not taken, because "AI call moved off the facade" and "API input
error semantics" are different changes and only the first one is this commit. The test pins today's 500 so a later
cleanup is a visible expectation change rather than a silent behaviour shift.

Tests (`src/app/api/content/mindmap/route.test.ts`, 10 cases - the runtime is *not* mocked, the route handler is
called for real, and only the transport is stubbed):

1. Success: HTTP 200, `ok: true`, `data` holding **exactly** `markdown` and nothing else, and that markdown equal to
   the answer byte for byte - the answer deliberately carries blank lines, CRLF and a ```` ```markdown ```` fence, so
   "the route forwards what it got" is proven rather than assumed (stripping the fence is `markdownToMindMap()`'s job
   on the client). One call on the text channel: the runtime's model, no `response_format`, no tools, no pinned
   provider, the adapter's default `temperature: 0.7`, a system turn byte-identical to this route's literal and a user
   turn equal to `主题：<topic>\n请输出该主题的 Markdown 思维导图大纲。` The usage table is asserted to stay empty.
2. No capability default: `prepareModel()` (a credential and one enabled model, no `chat` default) still answers with
   the model, in one call - the install state most users are in.
3. The whiteboard's preflight: `OPTIONS` -> 204, the three CORS headers, an empty body and **no** provider call, on a
   keyless install. This is the case the batch's only foreign-origin consumer depends on, and it had no test before.
4. The trim: a padded topic produces the trimmed prompt - `z.string().trim()` did the work and the route pasted its
   output in whole (no slice, no second cap, unlike A3-2.4's 8000-character one).
5. The guard: `{}`, `{ topic: "" }`, `{ topic: "   " }` and `{ topic: 42 }` are all 400 `INVALID_PAYLOAD` /
   `Invalid payload` on an empty transport - validation runs before the call, so an unusable payload cannot reach the
   runtime, and the transport proves nobody was asked.
6. A body that is not JSON: 500 `UNKNOWN_ERROR`, carrying the parser's own message. This is the deliberate decision
   above, pinned.
7. Nothing configured: **503** `MODEL_NOT_CONFIGURED`, `No model is configured for this request`, no provider call,
   and neither `Missing` nor `API key` anywhere in the body - the case that shows the legacy error class left this
   route's contract.
8. A credential revoked after the model was configured: **400** `MODEL_CREDENTIAL_MISSING` with the runtime's reason,
   and no chat call at all (the pool refuses before a request exists). The old route answered a flat 500 here.
9. Parity: a provider 5xx is still **502** `MODEL_UPSTREAM_FAILED` with `details.status` 503 after exactly one attempt.
10. Parity: a blank completion is still **502** `MODEL_UPSTREAM_NO_CONTENT` - the adapter refuses it, which is why this
    route needs no `EMPTY_RESULT` guard and no case can put `markdown: ""` in the envelope.

The three CORS headers are additionally asserted on every failure above (cases 5-10, plus the success), because a
failed call is a body the whiteboard *prints*: `generateMindMapMarkdown()` throws
`AI 请求失败 (<status>): <body>` and a cross-origin read without the header would be a browser-level mystery instead
of that message.

The file mocks `@/lib/ai`, `@/lib/ai/generate` and `@/lib/ai/compat` with throwing factories, so a surviving
`import { generateText } from "@/lib/ai"` anywhere under the handler fails the whole file instead of a packaged build.
The shim mock is safe for the same reason as A3-2.3..2.5 and was not safe in A3-2.1/A3-2.2: the only production
importer of `@/lib/ai/compat` is `lib/agent/image-generation.ts`, reached through `lib/article-images.ts`, and neither
is on this route's graph. No business fixture is needed at all - the topic comes from the request - and the usage
table is asserted to stay empty (this endpoint has never booked a row; adding one would be a business change, not this
migration).

* Verification on this tree: `node_modules\.bin\tsc.cmd --noEmit` exit 0, `node_modules\.bin\eslint.cmd .` exit 0 with
  0 errors (the same single pre-existing `react-hooks/exhaustive-deps` warning),
  `node_modules\.bin\vitest.cmd run` = **66 files / 391 tests, all pass** - A3-2.5's 65 / 381 plus exactly this batch's
  1 file / 10 tests, with no case deleted anywhere. `git grep "generateText" -- src/app` now finds **one** production
  call site (`api/content/[id]/rewrite`), so the facade's `generateText` surface went
  **2 -> 1 (A3-3.1)**; `generateImageFile` (3, batch B) is untouched, and `lib/ai/generate.ts` therefore stays -
  it still has a production caller until A3-3.2 lands.


### P3-A3-3.2 - `api/content/[id]/rewrite`

The second and last `generateText` route (section 1: `api/content/[id]/rewrite:58`), and the batch that closes
P3-A3's text surface. It is the article editor's “AI 改写” dialog on the server side: the dialog posts the
article id plus a mode (`polish` / `platform` / `risk` / `tone`) and a handful of optional instructions, reads
`text` / `html` / `provider` / `model` back, shows the user a diff and persists the body itself. So the route owns
real business - reading the article, assembling the source and its cap, the instruction table, the trim, the usage
row - while the model call is the runtime's. It is also the only text route of this batch whose call shape changes
*shape*: `generateText` took a flat `prompt`, `aiRuntime.chat()` takes turns.

| Field | Before | After |
| --- | --- | --- |
| Call | `generateText({ prompt, systemPrompt })` | `aiRuntime.chat({ messages: [{ role: "user", content: prompt }], systemPrompt })` |
| Answer | `result.text` -> trimmed -> `{ text, html }` | `response.text` -> the same trim -> the same envelope | 
| Provider / model | `result.provider` / `result.model` | `response.providerId` / `response.model` - same values, the runtime's own names |
| Usage | `result.usage?.inputTokens` / `outputTokens` / `totalTokens` | `response.usage?.*` - unchanged, the runtime's single report |
| Token spend | the shim's merged total for the whole call | the runtime's report for the one attempt `chat()` makes (no schema, so no corrective retry) |
| Preference | no `provider` argument | no `preferProviderId`: the runtime's configured text model applies (this route never asked for a vendor) |
| Failure | `fail(error.message, 502)` | `fail(error.message, 502)` - **unchanged on purpose**, see below |
| Legacy import | `generateText` from `@/lib/ai/generate` | none: `@/db/repository`, the runtime, `@/lib/ai-writing`, `@/lib/article-themes`, `@/lib/api`, `@/lib/usage`, `@/lib/validation` |

Kept, because this batch moves a boundary rather than a business: the `[id]` read and its 404, the
`contentRewriteSchema` guard and its 400, the `htmlToPlainText(existing.body).slice(0, 8000)` source (cap included)
and the `EMPTY_CONTENT` 400 for an article with nothing in it, the mode/strength tables, `行业领域` / `风格特征` /
`标题需自然包含以下关键词` / `补充要求` / `禁止出现以下词语` and the `filter(Boolean)` that drops the unset ones,
the `你是一位资深中文编辑…` system turn, the trim, the `EMPTY_RESULT` guard, the usage row
(`kind: "article"`, `wordCount: countTextCharacters(bodyText)` - the *answer*, not the source), the
`{ text, html, provider, model }` envelope, and the fact that **nothing is written to the article**: the editor
PATCHes the body after the user confirms the diff.

**This route does not adopt D-P3-3.** A3-2.1..2.3 and A3-3.1 pass the runtime's code *and* status on;
`knowledge-base/ai-parse` and `positions/generate` keep a deterministic fallback. `rewrite` is a third, simpler
choice: the call moves, the error contract does not.

| Runtime outcome | Runtime status | This route answers |
| --- | --- | --- |
| nothing configured (`MODEL_NOT_CONFIGURED`) | 503 | **502** `UNKNOWN_ERROR`, `No model is configured for this request` |
| credential missing (`MODEL_CREDENTIAL_MISSING`) | 400 | **502** `UNKNOWN_ERROR`, the routing reason |
| every key cooling / rejected (`MODEL_CREDENTIAL_UNAVAILABLE`) | 429 / 400 | **502** `UNKNOWN_ERROR`, `No usable credential key for …` |
| provider 5xx (`MODEL_UPSTREAM_FAILED`) | 502 | **502** `UNKNOWN_ERROR`, `… HTTP 503: {…}` |
| blank completion (`MODEL_UPSTREAM_NO_CONTENT`) | 502 | **502** `UNKNOWN_ERROR`, `… returned no text` |
| answer with no text at all (route-level `EMPTY_RESULT`) | - | **502** `UNKNOWN_ERROR`, `EMPTY_RESULT` |

Two consequences are worth stating plainly, because "keep the old behaviour" is only half true here:

1. **The message changes for the two families the shim used to mask.** The old `Missing gemini API key` /
   `Missing qwen API key` text came out of `lib/ai/compat.ts`, whose `MissingAIKeyError` no longer sits on this
   path at all. Status (502) and code (`UNKNOWN_ERROR`) are preserved; the sentence is now the runtime's routing
   explanation, which is strictly more useful. The cases pin both halves, so a future D-P3-3 commit for this route
   is a conscious change rather than a surprise.
2. **`fail()` drops `details`.** The upstream status, the provider id and the retry-after hint the runtime attaches
   are therefore not in the body. That is the price of the flat 502, and it is why the route keeps *its own* two
   guards (404 / 400) worded as before: those are the only answers it still words itself.



`EMPTY_RESULT` stays, and it is not dead code. There are two empty-handling layers and they cover different
shapes: the adapter refuses a completion with neither text nor tool calls (`MODEL_UPSTREAM_NO_CONTENT`, raised
below the route), while a **tool-call-only** answer passes the adapter untouched and arrives as `text: ""`. That
is the one path on which the route's own guard fires, and it must: an empty rewrite must never reach the dialog as
a “diff”. Nothing is recorded on that path either - the guard sits before `createUsageRecord`, exactly where it
was before the migration.

The cold-start question this route raises is answered outside it. Pasting a fresh key into 系统 / 模型管理 still
self-heals the very next request, because `ensureModelRuntimeSeeded()` runs on every routing attempt
(`resolveRoute()` -> registry) and the catalog discovery it performs deliberately sits outside the seed marker -
the property A0 built, and the reason no route needs a retry loop of its own. Nothing in this migration touches
that path.

The file (`src/app/api/content/[id]/rewrite/route.test.ts`) is the batch's largest test file - 1 file / 12 tests,
none deleted - because this is the only A3-3 route with fixtures and a usage row to protect:

1. The 200: the reply is trimmed into `text`, `html` is `plainTextToHtml(text)`, `provider` / `model` come from the
   runtime, and the wire carries `model: qwen3-max`, roles `[system, user]`, the route's literal system turn and a
   user turn *equal* to the prompt rebuilt from the payload (mode, strength, four optional instructions, cap,
   source) - plus the two things that make this the plain channel: no `response_format`, no `JSON schema:`. The
   adapter's `temperature: 0.7` default is asserted, which is how “this route passes no sampling overrides” is
   visible on the wire. One usage row, filed under the article, and the article byte-identical before/after.
2. `[id]` steered the read: the prompt carries this article's flattened body, no `<p>` / `<h1>` survives, the
   neighbouring article is absent, and the stored *title* is absent too - the dialog owns the title.
3. The cap: a body whose flattened form is longer than 8000 characters produces exactly the `slice(0, 8000)` as the
   tail of the prompt - the dropped remainder (“第3段结束。”) is asserted to be gone, while what fits is intact.
4. `wordCount` counts the *answer*: an 8000-character source whose reply came back short records the reply's count,
   asserted not to equal the source's.
5. The 400s this route still words itself: no `mode`, an unknown `mode`, a body that is not JSON, and an article
   with an empty body (`EMPTY_CONTENT`, whose non-`AppErrorCode` code is `UNKNOWN_ERROR` - the long-standing wart,
   pinned so a cleanup stays deliberate). The transport is empty, so nobody was asked.
6. 404 for an unknown article, before the payload is parsed, with no provider call and no usage row.
7. Credential revoked after the model was configured: **502** `UNKNOWN_ERROR` (`MODEL_CREDENTIAL_MISSING` and its
   400 are *not* passed on), the message no longer contains `Missing qwen API key`, `error` mirrors `message`, no
   chat call, no usage row, article untouched.
8. Every stored key out of rotation: the pool's `MODEL_CREDENTIAL_UNAVAILABLE` (a 429 in the runtime) still leaves
   as **502**, with the pool's own words and no `sk-` fragment in the body.
9. Nothing configured: **502**, `No model is configured for this request`, and neither `Missing` nor `API key`
   anywhere in the body.
10. Provider 5xx: **502** with `HTTP 503` in the message after exactly one attempt, and `details` asserted to be
    `undefined` - the counterpart of case 7's D-P3-3 trade on the routes that do pass the runtime on.
11. Blank completion: **502**, `returned no text`, one attempt, no usage row, article untouched.
12. Tool-call-only answer: the route's own **502** `EMPTY_RESULT`, one attempt (no corrective turn - `chat()` has no
    schema to retry against), no usage row, article untouched.

The file mocks `@/lib/ai`, `@/lib/ai/generate` and `@/lib/ai/compat` with throwing factories, so a surviving
`import { generateText } from "@/lib/ai"` anywhere under the handler fails the whole file instead of a packaged
build. The shim mock is safe for the same reason as A3-2.3..3.1: the only production importer of
`@/lib/ai/compat` is `lib/agent/image-generation.ts` (reached through `lib/article-images.ts`), and this route
touches neither.

* Verification on this tree: `node_modules\.bin\tsc.cmd --noEmit` exit 0, `node_modules\.bin\eslint.cmd .` exit 0,
  `node_modules\.bin\vitest.cmd run` = **67 files / 403 tests, all pass** - A3-3.1's 66 / 391 plus exactly this
  batch's 1 file / 12 tests. `git grep "generateText" -- src` finds **no production call site** any more: the
  facade's `generateText` surface went **2 -> 1 (A3-3.1) -> 0 (A3-3.2)**, which closes P3-A3's text half.
  `generateImageFile` is untouched and is batch B's - and its three call sites (`api/images`,
  `lib/article-images`, `lib/agent/local-tools`) import the *domain service* `lib/agent/image-generation.ts`
  rather than the facade. That module is now the compat shim's only production importer, so neither file is
  deleted here (D-P3-4). The facade itself has **no production importer left at all** after this commit: its
  remaining references are its own definition, the `lib/ai/index.ts` barrel and `lib/ai/generate.test.ts`, and
  what keeps it in the tree is the D-P3-4 decision plus that test - not a caller.


### P3-B-1 - `api/images` (frozen, not migrated)

`src/app/api/images/route.ts` had nothing to migrate. It has called `generateImageFile()` from
`lib/agent/image-generation.ts` since P2, and that module *is* the domain service over
`aiRuntime.generateImage()` (D-P3-2) - so the batch freezes the route's contract instead of moving it,
and the route carries a comment saying exactly that:

```
API route                                  HTTP only: payload, envelope, file name -> URL
  -> lib/agent/image-generation.ts         where it lands: artifacts dir, naming, extension
       -> aiRuntime.generateImage()        how it is produced: provider pin, model, key rotation
```

The service underneath was already covered (`src/lib/ai/generate.test.ts`, G3); what had no guard at all
was the route's own half - the 201 envelope, the bytes on disk, the provider that really answered, the
flat 500 it words itself, and the library half (`GET`/`DELETE`) that never touches a provider. That is
what the new file pins, case by case:

| Fact | Where it comes from in production | Case that pins it |
| --- | --- | --- |
| The image provider is a **hard pin**, not a preference: `settings.imageProvider` (default `openai`) reaches the runtime as `providerId`. | `preferredImageProvider()` -> `generateImage({ providerId })` -> `candidateChain()`'s `slice(0, 1)`, so cross-provider failover is structurally impossible. | Gemini configured *and* callable while the settings still name OpenAI: no `:generateContent` call, no images call, `Missing openai API key`. |
| **No caller chooses a model**; the router resolves it (the `image_generation` capability default first, then provider order, default endpoint, `model_type: image`, model id). | `resolveRoute()` + `importLegacyAiSettings()`'s image default. | The 201 case reports `provider` / `model` from the runtime, not from the request. |
| `size` comes from `settings.openAIImageSize` (default `1024x1024`) and **never** from the request. | `imageGenerateSchema` is `{ prompt }`; the service reads the setting. | A request carrying `size: "4096x4096"` still puts `512x512` on the wire after the setting is changed. |
| The gemini adapter has no field for that setting, and the service passes it on this path anyway. | `size` is handed to `generateImage()` for both providers; the gemini body is `contents` + `responseModalities` only. | The gemini case asserts the exact body and that `1024x1024` appears nowhere in it. |
| `prompt` is trimmed by the schema and nothing else from the body reaches the provider. | `z.string().trim().min(1)`, non-strict object. | `"  …  "` plus `quality` / `n` in the body produce a three-key wire body. |
| Every AI failure leaves as **one** shape: 500, `code: "UNKNOWN_ERROR"`, `error` mirroring `message`, `details` dropped. | `fail(error.message, 500)` - the runtime's status and code are not passed on. | Six cases: no credential at all, revoked key, 401, 503, empty `data`, empty base64. |
| The service's own `MODEL_UPSTREAM_NO_CONTENT` guard is reachable, not dead code. | The adapter accepts a link answer whose download is 200 but empty (base64 `""`), so only the service can refuse it. | The message is the service's lowercase `openai returned no image data`, not the adapter's `OpenAI …`, and no file is written. |
| `GET`/`DELETE` are pure filesystem operations. | `lib/image-library.ts` + `artifactImageUrl()`. | Listing filters by extension and sorts by name descending; a delete reduces names to basenames and keeps the whitelist. |

The error mapping this batch freezes, in one table:


| Failure below the route | Runtime status / code | This route answers |
| --- | --- | --- |
| keyless install, nothing routable | `MODEL_NOT_CONFIGURED` (503), then the shim's `MissingAIKeyError` | **500** `UNKNOWN_ERROR`, `Missing openai API key` |
| model configured, credential revoked | `MODEL_CREDENTIAL_MISSING` (400), then `MissingAIKeyError` | **500** `UNKNOWN_ERROR`, `Missing openai API key` |
| provider rejects the key | `MODEL_CREDENTIAL_INVALID` (502) | **500** `UNKNOWN_ERROR`, `Image generation HTTP 401: {…}` |
| provider down | `MODEL_UPSTREAM_FAILED` (502) | **500** `UNKNOWN_ERROR`, `Image generation HTTP 503: {…}` |
| answer without image data (adapter guard) | `MODEL_UPSTREAM_NO_CONTENT` (502) | **500** `UNKNOWN_ERROR`, `OpenAI returned no image data` |
| answer whose download was empty (service guard) | `MODEL_UPSTREAM_NO_CONTENT` (502) | **500** `UNKNOWN_ERROR`, `openai returned no image data` |
| body the schema rejects / not JSON | - | **400** `INVALID_PAYLOAD`, cause in `details` (the `AppError`'s code for a non-JSON body) |

Two things the first test run produced that the write-up has to record, because the tree's behaviour won
the argument in both cases:

1. **A rejected key is remembered by fingerprint, for the life of the process.** The pool stores key health
   in SQLite keyed by SHA-256, and `invalid` has no cooldown, while `resetRuntime()` clears the *vault*
   (`clearCredential`) and not those rows - so a case that lets the provider answer 401 poisons that exact
   key string for every later case in the same file (`prepareModel()` then fails before the route is even
   reached). The 401 case therefore signs with `sk-stub-openai-rejected` of its own. Nothing in production
   changed here; it is a test-isolation fact worth knowing before writing the next key-rotation case.
2. **`deleted` also lists a name that was never there.** `deleteArtifactImageFiles()` calls
   `fs.rm(…, { force: true })`, which does not report a missing file, so the name is echoed back. The case
   pins the envelope as it is (`["gone.jpg", "missing.png"]`) rather than "fixing" a delete contract in a
   batch about the AI boundary.


What is deliberately *not* in this batch:

* **D-P3-3 stays P3-C's.** The flat 500, the dropped `details` and the message change between "the compat
  shim said it" and "the runtime said it" are all frozen as they are - this route is now the third error
  shape of P3 (after A3-2.1..2.3/A3-3.1's pass-through and `rewrite`'s flat 502), and unifying them is one
  conscious commit, not a side effect.
* **`lib/agent/image-generation.ts` is untouched**, because it is already the target boundary; its
  `image-generation.ts -> compat.ts` edge is what P3-B-3 cuts, and changing it here would merge B-1 with B-3.
* `lib/article-images.ts` (B-2), `lib/agent/local-tools.ts` (B-3's second caller), `lib/ai/generate.ts`,
  `lib/ai/compat.ts` and the runtime itself: untouched, so a revert of this commit takes the test file and
  two additive helpers with it and nothing else.
* No observed behaviour was repaired: the trim, the hard pin, the OpenAI-shaped `size` reaching a gemini
  call that ignores it, the `force` delete envelope and the flat 500 are all documented as found.

Counters after this commit: `generateImageFile` still has **3** call sites (`api/images` - frozen here -
plus `lib/article-images` and `lib/agent/local-tools`), `lib/ai/compat.ts` still has exactly **1**
production importer (`lib/agent/image-generation.ts`), and `lib/ai/generate.ts` still has **0**. P3-B is a
three-commit batch precisely so that number only reaches 0 at B-3.

The file (`src/app/api/images/route.test.ts`) is 1 file / 16 tests, and it mocks the two text facades with
throwing factories while leaving `@/lib/ai/compat` alone - the third factory is B-3's edit. Its cases:

1. The 201 contract: the `fileName` shape, `url` = `artifactImageUrl(fileName)`, `provider` / `model` from
   the runtime, the decoded bytes on disk, the artifact directory holding exactly that one file, one signed
   `POST /images/generations` with `{ model, prompt, size }`, and no chat call anywhere.
2. The prompt is trimmed and the extra request fields are dropped - the wire body has three keys.
3. `settings.openAIImageSize` beats a `size` in the request.
4. The pin: gemini callable, settings naming openai -> 500, `Missing openai API key`, no gemini call.
5. The gemini path: `:generateContent?key=…`, the exact gemini body, `.jpg` from the inline mime type, and
   no size on the wire.
6. The three 400s, with an empty transport behind them (nobody was asked).
7. No credential at all -> the flat 500 and the shim's message.
8. Credential revoked after configuration -> the same flat 500.
9. Provider 401 -> 500, `HTTP 401`, one attempt, no `sk-` in the body.
10. Provider 503 -> 500, `HTTP 503`, one attempt.
11. Empty `data` -> 500, `returned no image data`, no file.
12. Link answer with an empty download -> 500, the *service's* guard message, no file.
13. Two identical requests -> two distinct files with their own bytes.
14. `GET` lists images only, newest name first, with the library's URLs.
15. `DELETE` removes the named image, skips a traversal attempt, a non-image and a missing name, and leaves
    the file one directory up alone.
16. The three delete 400s (empty array, blank name, over the 200-name cap).

* Supporting changes: `src/test/route-harness.ts` gained `prepareImageModel()` (the image counterpart of
  `prepareChatModel()`) and one line in `resetRuntime()` clearing the `image_generation` capability default
  - a leftover default outranks the provider order a case reasons about, exactly like the two text
  capabilities already cleared there. Both additive, and the eight existing route files that call
  `resetRuntime()` cannot notice. `src/app/api/images/route.ts` gained a comment naming the three layers
  and nothing else - no line of logic, so the suite above pins behaviour this commit provably leaves alone.
* Verification on this tree: `node_modules\.bin\tsc.cmd --noEmit` exit 0, `node_modules\.bin\eslint.cmd .`
  exit 0 (the one pre-existing `react-hooks/exhaustive-deps` warning in
  `src/components/agent-chat/chat-conversation.tsx` is unchanged), `node_modules\.bin\vitest.cmd run` =
  **68 files / 419 tests, all pass** - A3-3.2's 67 / 403 plus exactly this batch's 1 file / 16 tests.


### P3-B-2 - `lib/article-images.ts` (frozen, not migrated)

The second surface of batch B, and the second one with nothing to migrate. `resolveArticleImages()` walks
three sources and each step already speaks to a domain service - `fs.copyFile` for a stored photo,
`fetchArticleText()` from `lib/scraper.ts` for `og:image`, and `generateImageFile()` from
`lib/agent/image-generation.ts`, which *is* the runtime boundary (D-P3-2). So the batch freezes the
strategy instead of moving it:

```
resolveArticleImages()                      strategy, target, dedupe, budget, best effort
  -> fs.copyFile into artifacts             product: writing-<ts>-<nanoid>.<ext>
  -> lib/scraper.ts fetchArticleText()      web:     the page's og:image, as a remote url
  -> lib/agent/image-generation.ts          ai:      agent-image-<ts>-<nanoid>.<ext>
       -> aiRuntime.generateImage()         how it is produced: provider pin, model, key rotation
```

Why freeze *this* file, and why now: it had **no test file at all**, and its only two callers
(`api/ai-writing/generate`, `api/content/generate`) both hand it `imageStrategy: "product"` from their
fixtures - so the two routes that do exercise it can only ever reach the first stage. The `web` stage,
the `ai` stage, `maxGeneratedArticleImages` and the best-effort rule at the bottom of the loop were
completely unguarded, and the `ai` stage is exactly what P3-B-3 cuts next. The facts this file pins:

| Fact | Where it comes from in production | Case that pins it |
| --- | --- | --- |
| `product` is the only stage that writes a file: a stored photo is **copied** into the artifacts dir as `writing-<ts>-<nanoid>.<ext>`, extension lower-cased, `.png` when the path has none. | `copyIntoArtifacts()`: `fs.mkdir` + `fs.copyFile`, name from `Date.now()` + `nanoid(8)`. | The copy case (name shape, bytes, source still in place, directory holds exactly that file) and the extension case (`.JPG` -> `.jpg`, extensionless -> `.png`). |
| A product photo that is not on disk is skipped and the loop continues; a blank entry is skipped before the filesystem is asked. | `try { add(await copyIntoArtifacts(path)) } catch {}` and `if (!imagePath) continue`. | The missing-photo case still returns the *next* photo; the blank-entry case returns one image out of two entries. |
| `target` is an upper bound, never a floor, and the sources are spent in the order the caller gave them. | `add()` refuses past `target`; every stage re-tests `images.length < input.target`. | Three photos with `target: 2` return the first two photos - asserted by **bytes**, because the generated names cannot show which source won. |
| Each stage is gated by the strategy: `product` never reads a page, `web`/`ai` never copy a product photo. | `strategy === "product" \|\| strategy === "mixed"`, and so on for the other two. | A `product` run with a *working* page in `sourceUrls` fetches nothing; a `web` run with a real photo leaves artifacts empty. |
| `web` reads **at most three** source urls, and `og:image` becomes the article's image *as the remote URL it is* - no download, no copy. | `input.sourceUrls.slice(0, 3)` + `add((await fetchArticleText(url)).imageUrl)`. | Five urls return three, in url order, and the fourth and fifth were never fetched; artifacts stays empty. |
| An ignored page does not end the loop: a down page and a page without `og:image` are skipped and the next url is still read. | `try { … } catch { /* ignore unreachable pages */ }` plus truthiness in `add()`. | The dead / image-less / good case reads all three pages and keeps only the third's image. |
| The same image is added once, whoever produced it. | `!images.includes(value)` inside `add()`. | Two pages sharing one `og:image` produce one entry. |
| Generation is a **budget**, not a target: at most `maxGeneratedArticleImages` (3) per run, and only as many as `target` still leaves open. | `const remaining = Math.min(input.target - images.length, maxGeneratedArticleImages)`. | `target: 6` + a callable provider = three calls, three files, three *distinct* names; `mixed` + one product photo + `target: 2` = one call. |
| Generated files are `agent-image-*` in the same artifacts dir, and the prompt names the article title. | `generateImageFile({ prompt: \`为文章《${input.title}》…\` })` and `writeBase64Image()` in the domain service. | The generation case pins the name shape, the decoded bytes, and the wire body: the runtime's model, the title inside `prompt`, `settings.openAIImageSize`, one `POST /images/generations`, no chat call. |
| The image provider stays **pinned** to `settings.imageProvider`; a callable other provider is never used as a fallback. | `generateImageFile()` -> `preferredImageProvider(undefined)` -> `generateImage({ providerId })` (G3). | Gemini configured *and* callable while the settings still name OpenAI: no `:generateContent`, no images call, no images - and no throw. |
| The whole AI stage is **best effort**: any failure ends it quietly, the images already collected survive, and the promise never rejects. | `for (…) { try { … } catch { break } }` - `break`, not `continue`, and no rethrow. | Four cases: provider 503 (exactly **one** call, so a failure is not retried three times), a rejected key after the product copy (the article keeps its cover), a keyless install (no call at all), and the pinned-provider case above. |

The two decisions that most deserve prose, because a refactor would break them quietly:

* **The AI budget is not the target.** `target` arrives as `imageCountValues[config.imageCount]` (`few: 1`,
  `standard: 3`, `many: 6`), so `strategy: "ai"` with `many` asks for six images and gets three: the cap is
  `min(target - filled, maxGeneratedArticleImages)`, per run. `maxGeneratedArticleImages` is exported and,
  after this commit, its only reader outside the module's own body is this test file - so what protects the
  budget is the **call count** assertion (three `POST /images/generations`), not `images.length <= target`,
  which a `for (let i = 0; i < target; i++)` rewrite would still satisfy.
* **Best effort is the contract, not the error handling.** Both callers await this function inside a 201
  they then return to the UI, so a reject would cost them the whole generated article. The `break` (rather
  than `continue`) is part of the same decision: one provider failure is a verdict on the provider, not on
  the remaining images, so the stage stops after one call instead of paying the timeout three times.

What is deliberately *not* in this batch:

* **No production line changed.** `lib/article-images.ts` is untouched, so the suite above pins behaviour
  this commit provably leaves alone; `lib/agent/image-generation.ts`, `lib/ai/compat.ts`, `lib/scraper.ts`
  and the runtime are untouched with it.
* **The compat edge is still there.** `resolveArticleImages` -> `generateImageFile()` -> `compat.ts` ->
  `aiRuntime`, exactly as in B-1. What B-2 adds is the net that edge is cut with: once B-3 removes the shim,
  these cases are what would notice a changed `MissingAIKeyError` wording, a lost cold-start resync, or a
  failure that stops being swallowed at all. The two throwing factories on `@/lib/ai` and `@/lib/ai/generate`
  are already legal here - `lib/ai/compat.ts` imports the runtime, the settings repository, the provider
  registry and `lib/secrets`, never the facade - which is what makes B-3 a *cut* rather than a rewrite.
* **D-P3-3 stays P3-C's**: this module words no error to anyone. Its whole error vocabulary is "fewer
  images", so there is nothing here for a later commit to unify.
* **`lib/scraper.ts`'s HTML reading is not re-tested.** The `web` stage is pinned for the three rules *this*
  module owns - the three-url cap, the `slice` order and skip-and-continue - not for `cheerio`'s
  `og:image` parsing, which A1 already froze for the generator path.

Counters after this commit: `generateImageFile` still has **3** call sites (`api/images`, frozen in B-1,
plus `lib/article-images`, frozen here, and `lib/agent/local-tools`, which is B-3's second caller),
`lib/ai/compat.ts` still has exactly **1** production importer (`lib/agent/image-generation.ts`), and
`lib/ai/generate.ts` still has **0**. P3-B is a three-commit batch precisely so that number only reaches 0
at B-3.

The file (`src/lib/article-images.test.ts`) is 1 file / 20 tests in four groups - the product stage (6),
the web stage (5), the AI stage (8) and the order they are spent in (1) - and it mocks the two text facades
with throwing factories while leaving `@/lib/ai/compat` alone, exactly like B-1. Its cases:

1. A product photo is copied into artifacts as `writing-*`, byte-identical, with the source left where the
   product keeps it and nothing else in the directory.
2. The copy keeps the source extension, lower-cased (`shot-lid.JPG` -> `.jpg`), and falls back to `.png` for
   a path that has none.
3. A product photo that is not on disk is skipped, and the loop still copies the next one.
4. A blank product entry is skipped instead of being asked of the filesystem.
5. `target` caps the product stage and the photos are spent in selection order - asserted by bytes, because
   the generated names cannot show which source won.
6. `product` never reads a source page, even when the page in `sourceUrls` would have answered.
7. A `web` run stores `og:image` verbatim as the remote url it is, and writes no file.
8. A `web` run ignores the product photos entirely.
9. `web` reads at most the first three urls: three images in url order, and the fourth and fifth were never
   fetched.
10. A page that is down (503) or carries no `og:image` is skipped and the next url is still read - all three
    were fetched.
11. Two pages sharing one `og:image` produce one entry.
12. The AI stage generates the missing image: `agent-image-*` in artifacts, the decoded bytes on disk, one
    `POST /images/generations` carrying the runtime's model, the title inside `prompt` and
    `settings.openAIImageSize`, and no chat call anywhere.
13. The provider stays pinned (G3): gemini configured *and* callable while the settings still name openai ->
    `[]`, no `:generateContent`, no images call.
14. A provider that answers 503 -> `[]`, **one** generation call (`break`, not `continue`) and no file.
15. A keyless install -> `[]`, with no call at all.
16. A rejected key after the product copy -> the article keeps its cover, and the copy is the only file in
    artifacts.
17. `target: 6` with a callable provider -> exactly three calls, three files, three distinct names
    (`maxGeneratedArticleImages`).
18. `mixed`, `target: 2`, one product photo -> one generation, two images, the copy first.
19. `mixed`, `target: 2`, two product photos -> the callable provider is never asked.
20. The full order: copy, then `og:image`, then generation - and the page is read before the generation on
    the wire.

* Supporting changes: `src/test/route-harness.ts` is **comment-only** - the header now names the two files
  that call `prepareImageModel()` and the `resetRuntime()` note names both files that clear the
  `image_generation` default; no export and no line of code, and no third helper was needed. The one piece
  of plumbing this module does need - an HTML `Response` with `.text()`, which the harness's `jsonResponse()`
  does not have - lives in the new file, because this is the only branch in the app that reads HTML.
  `src/lib/article-images.ts` and `src/lib/agent/image-generation.ts` are untouched.
* Verification on this tree: `node_modules\.bin\tsc.cmd --noEmit` exit 0, `node_modules\.bin\eslint.cmd .`
  exit 0 (the same one pre-existing `react-hooks/exhaustive-deps` warning in
  `src/components/agent-chat/chat-conversation.tsx` is unchanged), `node_modules\.bin\vitest.cmd run` =
  **69 files / 439 tests, all pass** - B-1's 68 / 419 plus exactly this batch's 1 file / 20 tests.

### P3-B-3 - `lib/agent/image-generation.ts` (the compat cut)

The third surface of batch B, and the first one that actually moves code. `generateImageFile()` has been a
facade over `aiRuntime.generateImage()` since P2 - but it reached the runtime *through* the legacy shim:

```
before                                        after
generateImageFile()                           generateImageFile()
  -> compat.preferredImageProvider(arg)         -> aiRuntime.generateImage({
       (a second settings read)                       providerId, size, prompt })
  -> compat.withLegacyCompatibility({ ... })
       run:   -> aiRuntime.generateImage(...)
       catch: MissingAIKeyError("Missing
              openai API key"), or one
              on-demand discovery pass
```

Two `compat.ts` exports leave this path (`preferredImageProvider`, `withLegacyCompatibility`), the pin is
inlined where it was, and the facade now calls the runtime the way every other domain service does. Neither
shim file is deleted: `lib/ai/generate.ts` (the text facade) still needs compat, and deleting it is P4's job.

Both removals are deliberate, and both follow from one principle the batches have applied throughout: **the
runtime owns routing, and a request never starts a sync.** The facts this cut pins, with the caller audit
behind them:

| Behaviour | Before (shim) | After (runtime, P3-B-3) | Who consumed it |
| --- | --- | --- | --- |
| A keyless install | `MissingAIKeyError` -> `Missing openai API key` | `No model is configured for this request` (`MODEL_NOT_CONFIGURED`; the route still flattens its 503) | Nobody that branches. `api/images` only words the envelope, `lib/article-images.ts` treats generation as best effort. The two `instanceof MissingAIKeyError` consumers (`lib/scraper.ts`, `api/metrics/insights`) are on the **text** path and keep the shim. |
| A configured model whose key was revoked | the same `MissingAIKeyError` | `No configured model has a usable credential for this request` (`MODEL_CREDENTIAL_MISSING`) | as above |
| A key pasted with no catalog row behind it | one bounded discovery pass inside the failed request (read `/models`, enable what it found, route again) -> 201 | still not routable: the request is **not made at all** | Nobody: that cold start is what `ensureModelRuntimeSeeded` (D-P3-1) owns, at seed time, for every provider that already holds a key |

What the cut does **not** change is the product decision underneath: the provider is still a hard pin, never
a preference. `input.provider ?? settings?.imageProvider ?? "openai"` is what `preferredImageProvider()`
computed character for character - same settings field, same `openai` default - so the value handed to the
runtime as `providerId` is unchanged and the candidate chain stays one provider wide (D-P3-2, G3). The one
mechanical side effect is one fewer `getLocalAgentSettings()` read per generated image.

Test-side changes - five files, all of them guards this cut makes possible:

1. `src/lib/ai/generate.test.ts` (7 tests; the G3 case rewritten): `generateImageFile` now rejects with an
   `AppError` carrying `MODEL_NOT_CONFIGURED` and the runtime's sentence instead of `MissingAIKeyError` /
   `Missing openai API key`, and the case pins `calls.length` to the count `prepareModel` left behind - which
   is how it proves the pinned provider's catalog was never read a second time. The header now says the two
   facades are "not equally legacy any more", so the file cannot be misread as P4's inventory.
2. `src/app/api/images/route.test.ts` (17 tests, was 16): the pinned-provider case asserts the runtime's
   routing sentence plus `not.toContain("Missing")` and `calls.length === prepared` (no post-routing fetch),
   the keyless case asserts the same sentence with `calls.length` 0 (no catalog read either), and the
   revoked-key case asserts `MODEL_CREDENTIAL_MISSING`'s sentence - all three still arriving as the same flat
   500 with `UNKNOWN_ERROR`, because flattening is a route decision D-P3-3 has not touched.
3. `src/app/api/images/route.test.ts`, the new case: a credential is written and nothing else, so the
   provider has an endpoint and a key but no catalog row. The route answers 500 with `calls.length` 0 - the
   exact state the shim's discovery pass used to rescue, and the case that turns "discovery is gone" from a
   comment into an assertion.
4. `@/lib/ai/compat` gains the third throwing factory in the four files that reach the image path:
   `api/images`, `lib/article-images.test.ts`, `api/content/generate` and `api/ai-writing/generate`. That
   factory was impossible before this batch - the domain service *was* the shim's only production importer,
   which is precisely the edge being cut - so in each file it is the cut's own proof and costs nothing.
5. `src/lib/ai/compat.ts` is **comment-only**: the header now records that the image facade is no longer a
   caller, that `withLegacyCompatibility()` is text-path-only, and that `preferredImageProvider()` has no
   caller left anywhere in the repo (a P4 deletion candidate, not a live behaviour).

* Importer status after this batch (`git grep`, production code only): `@/lib/ai/compat` **0** importers,
  `from "./compat"` -> `lib/ai/generate.ts` only, `@/lib/ai/generate` **0**, the barrel `@/lib/ai` **0**.
  Both shim files stay on disk on purpose: P4 deletes them, this batch only makes them unreachable from the
  image path.
* Verification on this tree: `node_modules\.bin\tsc.cmd --noEmit` exit 0, `node_modules\.bin\eslint.cmd .`
  exit 0 (the same one pre-existing `react-hooks/exhaustive-deps` warning in
  `src/components/agent-chat/chat-conversation.tsx` is unchanged), `node_modules\.bin\vitest.cmd run` =
  **69 files / 440 tests, all pass** - B-2's 439 plus exactly this batch's 1 new case.

