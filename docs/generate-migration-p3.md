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
