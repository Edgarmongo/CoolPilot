# `generate.ts` → `aiRuntime` migration — inventory & matrix

Plan and decision record for moving the last legacy AI path (`src/lib/ai/generate.ts`) onto
the AI runtime. Nothing in here is speculative: every row was read out of the current code.

Companion docs: `docs/model-runtime.md` (what the runtime is),
`docs/model-layer-spec.md` (the layer spec).

## 0. Decisions (fixed before any code changes)

| # | Decision | Why |
| --- | --- | --- |
| D1 | **Runtime Provider Identity is `providerId`** (`qwen`, `zhipu`, `deepseek`, `openai`, …). | The runtime already models provider / endpoint / model / protocol / capability / credential as separate things. `openai-compatible` is a *protocol*, not a provider. |
| D2 | **`usage_records.provider` stores the `providerId` that actually executed the call** — post key-rotation *and* post model-failover. | Usage must answer "which provider consumed the tokens". The `attempts[]` trail already carries the truth; the plan that ran is reported in `route` / `attempts`. |
| D3 | **No protocol → `LocalAIProvider` fallback mapping.** Never write `openai` for `qwen`/`zhipu`/`deepseek`/`moonshot`. | Collapsing them destroys the only per-provider usage breakdown worth having. |
| D4 | **`LocalAIProvider` survives as a legacy compatibility type** (settings form, per-provider model fields, `provider-registry`, `model-config-panel`). It is not the runtime identity and never becomes one. | Removing it has no benefit and would ripple through the settings UI. |
| D5 | **Historical `usage_records` rows are not rewritten.** Old values (`gemini`, `openai`, …) stay valid because the column is a free string. | No data migration risk for zero benefit. |
| D6 | **Credential keys never reach usage or logs.** At most a masked label / fingerprint. | Same boundary the key pool already enforces (DB stores only a SHA-256 fingerprint). |

**Consequence — D2 needs no schema change.** Verified in the current code:

| Layer | Today | Change needed |
| --- | --- | --- |
| SQLite | `usage_records.provider TEXT NOT NULL DEFAULT ''` | none |
| Repository write | `createUsageRecord({ provider?: string })` | none |
| Read type | `UsageRecord.provider: string` | none |
| Summary | `summarizeUsageRecords` groups by `` `${provider}::${model}` `` | none |
| UI response consumers | `provider?: string` in all 5 client payload types | none |
| Worker log | `${generated.provider}/${generated.model}` interpolation | none |
| **`GenerateMeta.provider`** | `LocalAIProvider` (the 4-value union) | **widen to `string`** |

So the provider-identity part of this migration is a *one-line type widening plus filling it
from `ChatResponse.providerId`*, not a data-model project.

## 1. What `generate.ts` actually does today

Split into capabilities, not lines — each row is something the runtime must either cover or
we consciously drop.

| Id | Responsibility | Today | Relied on by |
| --- | --- | --- | --- |
| R1 | Provider order + user preference | `orderedProviders(preferred, settings)` (`aiProviderOrder`: gemini → groq → openai → openrouter) | both entry points via `input.provider` |
| R2 | Model resolution per provider | `resolveFirstAvailableModel({ provider, capability: "text", configuredModel: resolveProviderModel(...) })`; the configured model comes from `LocalAgentSettings` / env | every caller (silently: it decides which model answers) |
| R3 | Key retrieval + rotation | `readProviderKeys(provider)` → **shuffle** all keys → try each | every caller (rate-limit survival) |
| R4 | Provider failover | after every key of a provider failed, move to the next provider in R1 order | every caller |
| R5 | Request shaping | `callOpenAICompatible` / `callGemini` in `providers.ts` | all calls (duplicate of the runtime adapters) |
| R6 | Usage normalization | `normalizeUsage` / `openAIUsage` / `geminiUsage` | 5 routes write usage rows (duplicate of the adapters) |
| R7 | Structured output | `z.toJSONSchema` → instruction → parse → **one retry** → `AI_STRUCTURED_OUTPUT_INVALID`, both attempts' usage merged | 8 call sites |
| R8 | Failure semantics | `MissingAIKeyError` when nothing is configured; otherwise `Error(errors.join(" \| "))` carrying masked keys | `metrics/insights` + `scraper` branch on `MissingAIKeyError`; the rest catch-all and fall back locally |
| R9 | Result metadata | `GenerateMeta = { provider, model, keyLabel, usage }` | all callers (usage rows, item metadata, JSON responses, worker logs) |

## 2. Reference inventory

### 2.1 Direct consumers of `lib/ai`

| # | File | Entry | Capability | Meta used | Failure handling |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/app/api/ai-writing/generate/route.ts` | `generateStructured` | text → post draft | provider, model, usage | catch → 502 |
| 2 | `src/app/api/content/generate/route.ts` | `generateStructured` | text → post draft | provider, model, usage | catch → 502 |
| 3 | `src/app/api/content/mindmap/route.ts` | `generateText` | free text (markdown outline) | text only | `failFromError` |
| 4 | `src/app/api/knowledge-base/ai-parse/route.ts` | `generateStructured` | knowledge item | provider, model, usage | catch → deterministic local fallback |
| 5 | `src/app/api/metrics/insights/route.ts` | `generateStructured` | performance insight | provider, model | `MissingAIKeyError` → 400, else 500 |
| 6 | `src/app/api/positions/generate/route.ts` | `generateStructured` | writing-profile draft | provider, model, usage | catch → deterministic local fallback |
| 7 | `src/lib/agent/chat-thread-title.ts` | `generateStructured` | chat title | none | catch → local title |
| 8 | `src/lib/agent/langgraph-engine.ts` | `generateStructured` | tool plan | none | catch → default single-tool plan |
| 9 | `src/lib/agent/local-tools.ts` | `generateStructured` | image prompt | provider, model (tool output) | propagates |
| 10 | `src/lib/scraper.ts` | `generateStructured` ×2 (`rewriteArticle`, `generateTopicPost`) | rewrite / topic draft | provider, model, usage | rethrows `MissingAIKeyError`, wraps the rest |

### 2.2 Indirect consumers (through `scraper` / `image-generation`)

| # | File | Via | Notes |
| --- | --- | --- | --- |
| 11 | `src/worker/runner.ts` | `generateTopicPost`, `rewriteArticle` | logs `${provider}/${model}` into run events |
| 12 | `src/app/api/content/import-url/route.ts` | `rewriteArticle` | writes a usage row |
| 13 | `src/lib/agent/local-tools.ts` | `generateTopicPost` | tool `generate_post_draft` |
| 14 | `src/lib/agent/image-generation.ts` | own fetch to Gemini `:generateContent` / OpenAI `/images/generations`, plus `resolveFirstAvailableModel` | image path, bypasses `generate.ts` entirely |
| 15 | `src/app/api/images/route.ts` | `generateImageFile` | returns `provider`, `model` |
| 16 | `src/app/api/agent/chat/route.ts` | `generateImageFile` + `LangGraphAgentEngine` + `chat-thread-title` | stores `provider`/`model` on the content item |
| 17 | `src/lib/agent/langgraph-engine.test.ts` | stubs `@/lib/ai` | test double — must keep working while the facade exists |
| 18 | `src/lib/ai/index.ts`, `src/lib/ai/providers.ts` | re-export / provider calls | internal, deleted with the facade |
| 19 | `src/lib/article-images.ts` | `fetchArticleText` only | **not** an AI call — no migration needed |

### 2.3 UI that renders the provider of a generation

`article-ai-dialog.tsx`, `generate-content-panel.tsx`, `ai-writing-step-output.tsx`,
`positioning-ai-dialog.tsx`, `console-metrics-board.tsx` — all declare `provider?: string`
and only interpolate it, so runtime ids (`qwen`) display without any type change. Human
labels are a follow-up (§4 G6), not a blocker.


## 3. Parity matrix (old capability → runtime API)

| Capability (R#) | Legacy implementation | Runtime equivalent | State |
| --- | --- | --- | --- |
| Text generation (R5, R6) | `callOpenAICompatible` / `callGemini` | `aiRuntime.chat()` → `openAICompatibleAdapter` / `geminiAdapter` | ✅ covered |
| Structured output (R7) | schema instruction + retry + merged usage | `chat({ json: true })` + the same retry wrapper | ⚠️ G5 (where the wrapper lives) |
| Provider preference (R1) | `orderedProviders(preferred)` — *prefer*, still fails over | `ChatRequest.providerId` **pins** (`candidateChain` shortens to 1) | ❌ G1 (`preferProviderId`) |
| Model resolution (R2) | `resolveFirstAvailableModel` + `LocalAgentSettings.*Model` + env `*_MODEL` | registry model + `ai_model_preferences` capability default | ⚠️ G2 (settings → registry import) |
| Key rotation (R3) | `shuffle(readProviderKeys())` per call | key pool: `useCount`/`lastUsedAt` order, 429 cooldown, 401 retires a key | ✅ covered (this session) |
| Provider/model failover (R4) | next provider after all its keys fail | ranked candidate chain (≤3) + `attempts[]` trail | ✅ covered; semantics differ by G1 |
| Usage normalization (R6) | `normalizeUsage` variants | adapter-level usage normalization | ✅ covered |
| Usage attribution (R9, D2) | `meta.provider` = `LocalAIProvider` | `ChatResponse.providerId` + `model` + `credentialLabel` + `attempts` | ✅ after the type widening |
| Missing-key error (R8) | `MissingAIKeyError` | `AppError` `MODEL_CREDENTIAL_MISSING` / `MODEL_CREDENTIAL_UNAVAILABLE` / `MODEL_NOT_CONFIGURED` | ⚠️ G4 (2 call sites branch on it) |
| Error text (R8) | `"provider[key]: msg \| provider[key]: msg"` | `AppError.code` + `message` + `details` (status, providerId, endpointId) + `attempts[]` | ✅ covered, better |
| Image generation (§2.2 #14–16) | `generateImageFile` own fetch | `aiRuntime.generateImage()` → `openAICompatibleAdapter.generateImage` / `geminiAdapter.generateImage` | ✅ covered (verified present) |
| Streaming | not used by any legacy caller | `streamChat` not implemented | ➖ no parity requirement yet |
| Per-call temperature/maxTokens | fixed `temperature: 0.7` | `ChatRequest.temperature` / `maxTokens` | ✅ covered |

## 4. Gaps, with the decision for each

| Id | Gap | Decision / work item | Phase |
| --- | --- | --- | --- |
| G1 | `provider` in `generateText`/`generateStructured` means *preference*, `ChatRequest.providerId` means *pin*. Mapping one onto the other would silently drop cross-provider failover. | Add `ChatRequest.preferProviderId`: it only reorders candidates (a soft default ahead of `sort_order`) and never shortens the chain. `providerId` stays an exact pin. `generate.ts` maps `input.provider` → `preferProviderId`. | P1 |
| G2 | `LocalAgentSettings.textProvider` / `geminiModel` / `openAIBaseUrl` / … and env `*_MODEL` are invisible to the registry, so a user with `GEMINI_MODEL=gemini-2.5-pro` would silently get the registry default instead. | One-shot importer (`importLegacyAiSettings()`, guarded by the existing seed marker): `textProvider` → preferred provider, each `*Model` → enable that model row + set it as the capability default, `imageProvider` → image-generation default. Idempotent, never overwrites a user-set default. | P1 |
| G3 | ~~Image path uncovered~~ | Verified: `openAICompatibleAdapter.generateImage` (`adapters.ts:288`) and `geminiAdapter.generateImage` (`adapters.ts:449`) exist. `generateImageFile` becomes a facade over `aiRuntime.generateImage()` + artifact write. | P2 |
| G4 | `metrics/insights` + `scraper` branch on `instanceof MissingAIKeyError`. | Keep the class in the facade for P2, then migrate both call sites to `AppError` codes (→ 400 with the same user-facing meaning) in P3, delete the class in P4. | P2 → P4 |
| G5 | The structured-output retry loop has no home yet. | Move it into the runtime (`chatStructured()` in `runtime.ts`): schema → instruction → parse → one retry → `AppError("AI_STRUCTURED_OUTPUT_INVALID")`. `generate.ts` and future Agent code then share one implementation of R7. | P1 |
| G6 | The UI shows raw ids (`qwen`) where the settings UI used to show 通义千问. | Add `providerDisplayName(providerId)` (registry `name`, falling back to the id) and use it where `provider` is rendered. | P4 (cosmetic) |

Explicitly **not** carried over: `providers.ts` (R5), key shuffling (R3), `LocalAIProvider`
ordering (R1), and the legacy per-provider model fields as a *source of truth* (R2 — they
become import-only input under G2).


## 5. Usage / observability model after the migration (D2, D6)

One row per generation, written by the caller from the runtime's answer:

```
usage_records
  provider  = response.providerId   ← actually executed (post key rotation, post failover)
  model     = response.model        ← actually executed
  inputTokens / outputTokens / totalTokens = response.usage
  status    = "success" | "failed"
```

* `response.route` says how the model was chosen (`capability-default` …) and
  `response.attempts[]` lists the models/keys that failed first — useful for run events,
  not for usage arithmetic.
* `response.credentialLabel` (`****1234`) may go to a run event or a log line; it must
  **never** reach `usage_records`, and the key itself must never reach either. A
  `credential_fingerprint` column can be added later if per-key accounting is ever needed.
* A generation that failed over is recorded against the provider that answered — exactly what
  makes `SELECT provider, SUM(total_tokens) … GROUP BY provider` meaningful again (D3).

## 6. Phases

| Phase | Scope | Files | Done when |
| --- | --- | --- | --- |
| **P0** ✅ | Inventory + matrix (this document) | `docs/generate-migration.md` | reviewed; no code touched — **done** |
| **P1** ✅ | Runtime parity features: G1 `preferProviderId`, G2 `importLegacyAiSettings()`, G5 `chatStructured()` | `contracts.ts`, `registry.ts`, `runtime.ts` (+ `runtime.test.ts` cases) | tsc / eslint / vitest green; new tests pin "prefer ≠ pin" and the import's idempotency — **done, see §6.2** |
| **P2** ✅ | `generate.ts` becomes a thin facade over `aiRuntime` (public API unchanged, `GenerateMeta.provider: string`, `MissingAIKeyError` kept); `generateImageFile` does the same (G3) | `src/lib/ai/generate.ts`, `src/lib/ai/compat.ts` (new), `src/lib/ai/index.ts`, `src/lib/agent/image-generation.ts`; `src/lib/ai/providers.ts` deleted | all 19 call sites compile **without edits**; runtime tests + `langgraph-engine.test.ts` green; smoke script shows runtime routing for a text and an image call — **done, see §6.3** |
| **P3** | Call sites move to the runtime one at a time: `chat()` / `chatForIntent()` / `chatStructured()` / `generateImage()`, and G4's `AppError` codes replace `MissingAIKeyError` (2 files) | the 10 direct + 4 indirect call sites | each route/worker test or smoke check passes; `generate.ts` loses one consumer at a time |
| **P4** | Cleanup: delete the facade, retire the legacy provider loop helpers (`orderedProviders`, `aiProviderOrder` if the settings UI drops them) and `resolveFirstAvailableModel` in `features/ai-settings/model-catalog.ts`, which P2 left with no caller, add G6 display names | `src/lib/ai/*`, `src/lib/ai-settings/*` | `grep` for `@/lib/ai` returns only schemas/types; `LocalAIProvider` remains only in settings/UI code (D4) |

Order matters: **P2 before P3**, so every caller keeps working while the runtime does the
calling, and a regression is attributable to one commit instead of nineteen.

### 6.2 What P1 shipped (as built)

| Item | Implementation | Not in the plan, decided while building |
| --- | --- | --- |
| G1 | `ModelRequirement.preferProviderId` + `ChatRequest.preferProviderId`; a soft sort tier **after** the capability default and **before** `provider.sortOrder`; never filters a candidate, so `candidateChain` keeps the whole chain. `providerId` still pins. | `loadPreferredProviderId()` reads the legacy `textProvider` **live** (no cached copy), so switching the provider in 系统 / 模型配置 reorders routing immediately — and the value is ignored when the provider is unknown to the registry. |
| G2 | `importLegacyAiSettings()`: for each legacy text provider the configured model (`settings.*Model` → env `*_MODEL`) is enabled, created when the catalog never saw it (`source: "legacy-settings"`, capabilities from the name rules), and the preferred provider's chat model plus the image provider's image model become capability defaults **only when no default exists**. Hooked into `ensureModelRuntimeSeeded` with `seedVersion = 2`, so it runs exactly once per install. | **No** fallback to the legacy catalog: `listProviderModels` is a live network call, and importing a guessed list during seeding would create rows the user never asked for. A provider with a key but no configured model is served by the registry's own catalog + the user's default instead (documented difference vs. R2). Also no `LocalAIProvider` dependency left in the registry. |
| G5 | `chatStructured()` in `runtime.ts`: `z.toJSONSchema` → instruction (**appended to the last user turn**, exactly like the legacy prompt) → `chat({ json: true })` → parse → one corrective retry (assistant answer + correction note) → merged usage → `AI_STRUCTURED_OUTPUT_INVALID` with both parse errors. Returns `data`, `text`, `providerId`, `model`, `credentialLabel`, `usage`, `route`, `attempts` (both calls) and `retried`. | The retry is a **fresh routed call**, not a replay on the same model: a key or model that just failed may be gone, and the runtime already knows how to pick another. |

Live evidence (throwaway database, `tsx scripts/ai-runtime-smoke.ts`, no network):

```
# with GEMINI_API_KEYS + GEMINI_MODEL=gemini-2.5-pro set (i.e. a legacy-configured install)
models        421 registered / 1 callable
  gemini       models=   1 callable=   1 gemini+key
route(chat)             gemini/gemini-2.5-pro [capability-default]
legacy import preferred=gemini entries=gemini:gemini-2.5-pro(kept)
legacy defs   chat=gemini-2.5-pro(kept), image_generation=gpt-image-1(kept)   # second run: nothing changes
```

Before P1 the same install reported `route(chat) none - no-models-synced`: the legacy model
choice was invisible to the runtime. That gap is closed.

One test-only lesson worth keeping: `runtime.test.ts`'s old "keeps the key state" case made a
**real** HTTP call, so DashScope's 401 retired the key in the new health table and broke every
later test. Tests must stub the transport; the key pool is stateful by design.

### 6.3 What P2 shipped (as built)

| Item | Implementation | Not in the plan, decided while building |
| --- | --- | --- |
| Text facade | `generateText` / `generateStructured` only shape a request now: legacy arguments → `ChatRequest` / `StructuredChatRequest` → `aiRuntime.chat()` / `chatStructured()`. `GenerateMeta.provider` is `string` and comes from `response.providerId` — the model that **answered**, after key rotation and failover (D2/D3). `keyLabel` is `response.credentialLabel`. | The legacy per-call `provider` argument becomes `preferProviderId` (G1), **not** `providerId`: the old argument only reordered `orderedProviders()`, so pinning it would have silently removed the "preferred provider has no key → try the next" fallback that callers rely on. |
| Compatibility shims (`src/lib/ai/compat.ts`, new) | `MissingAIKeyError` (same class name and `Missing <provider> API key` message) plus `withLegacyCompatibility()`: `MODEL_CREDENTIAL_*` → `MissingAIKeyError`; `MODEL_NOT_CONFIGURED` / `MODEL_CAPABILITY_UNAVAILABLE` → **one** bounded `discoverProviderCatalogs()` pass over the providers the legacy order would have tried, then re-route; if discovery also finds nothing and no key exists anywhere → `MissingAIKeyError`, otherwise the routing error is rethrown untouched. | Discovery is key-gated and runs once per call — never on a successful call, never for a non-routing error. The old code called the provider's model list eagerly on every cold start (G3); the runtime only pays for it when a route is actually missing. Both `MODEL_NOT_CONFIGURED` and `MODEL_CAPABILITY_UNAVAILABLE` are treated as "nothing routable", because from the outside that is the same symptom. |
| Image facade | `generateImageFile` calls `aiRuntime.generateImage({ prompt, providerId, size })` and keeps only what is not model-layer work: the artifacts directory, file naming, mime → extension, and the `MODEL_UPSTREAM_NO_CONTENT` guard for an empty `data[]`. | The image provider is a **pin**, unlike text: the legacy code never fell over from `settings.imageProvider` to the other provider, and `requirementForIntent("image-generation", { providerId })` encodes exactly that. |
| Deleted | `src/lib/ai/providers.ts` — `askGemini`, `askOpenAICompatible`, `resolveFirstAvailableModel` and the provider loop are gone with it. `aiProviderOrder` / `orderedProviders` were **not** touched: they live in `features/ai-settings/provider-registry.ts` and are still used by the model-config UI, the legacy import (G2) and the new compat shims. | `TokenUsage` / `ProviderResult` are still exported (from `generate.ts`), so `index.ts` changed two lines and no call site changed at all. |

**Call-site audit (19 sites, 0 edits).** A `grep` for `@/lib/ai`, `@/lib/ai/generate` and
`@/lib/agent/image-generation` resolves to exactly these symbols, every one of which the new
facade still exports:

| Imported symbol | Sites |
| --- | --- |
| `generateText` (`@/lib/ai`, `@/lib/ai/generate`) | `api/content/mindmap`, `api/content/[id]/rewrite`, `scraper.ts` (indirect) |
| `generateStructured` | `api/ai-writing/generate`, `api/content/generate`, `api/content/[id]/translate`, `api/knowledge-base/ai-parse`, `api/metrics/insights`, `api/positions/generate`, `agent/chat-thread-title`, `agent/langgraph-engine`, `agent/local-tools` |
| `generateImageFile` (`@/lib/agent/image-generation`) | `api/images`, `api/agent/chat`, `article-images`, `agent/local-tools` |
| `MissingAIKeyError` | `api/metrics/insights`, `scraper.ts` |

`tsc --noEmit` is the proof: it type-checks all 19 sites against the new facade without a single
edit, and `vitest run` covers the ones that have tests (`langgraph-engine.test.ts`,
`schedule-intent.test.ts`, `api-client.test.ts`, `metrics-repository.test.ts`).

New tests: `src/lib/ai/generate.test.ts` (7 cases — runtime routing, preference is not a pin,
legacy discovery restores an unconfigured install, structured retry, missing-key contract, image
pin, image failover) and one added case in `features/ai-runtime/runtime.test.ts` (a pinned image
provider does **not** fail over to the other provider).

Live evidence — the P2 block of `tsx scripts/ai-runtime-smoke.ts` on a throwaway database with a
legacy-configured environment (`GEMINI_MODEL`, `OPENAI_IMAGE_MODEL`) and a **stubbed transport**,
so there is no network and no token spend:

```
models        422 registered / 2 callable
legacy import preferred=gemini entries=gemini:gemini-2.5-pro(kept), openai:gpt-image-1(kept)
legacy defs   chat=gemini-2.5-pro(kept), image_generation=gpt-image-1(kept)
route(legacy chat)      gemini/gemini-2.5-pro [capability-default]
route(legacy image)     openai/gpt-image-1 [capability-default]
facade text   gemini/gemini-2.5-pro key=************-key usage={"inputTokens":1,"outputTokens":1,"totalTokens":2} reply="smoke reply"
facade struct gemini/gemini-2.5-pro key=************-key usage={"inputTokens":1,"outputTokens":1,"totalTokens":2} data={"reply":"smoke"}
facade image  openai/gpt-image-1 file=agent-image-1791429671216-wLXgfTGb.png (removed)
```

The two `route(legacy …)` lines are the requirement the facade builds (preference for text, pin for
image); the three `facade …` lines prove that the *old entry points* — not the runtime called
directly — return `providerId` / `model` / `credentialLabel` / usage and write the file. The same
script with no keys at all prints the other half of the contract:

```
route(legacy chat)      none - no-models-synced
facade text   unavailable: Missing gemini API key
facade image  unavailable: Missing openai API key
```

which is the message the pre-runtime code produced for "not one key to try" (G4) — except that it is
now chosen deliberately by `withLegacyCompatibility()` instead of falling out of a loop that never ran.

Two behavioural differences are intentional and worth stating plainly, because callers cannot see them:

* A generation that failed over is recorded against the provider that answered (`GenerateMeta.provider`
  is the answering provider). Before P2 the same field held the provider that was *asked*, so
  `usage_records.provider` becomes truthful rather than aspirational (D3).
* The `MissingAIKeyError` message now names the caller's preferred provider (or the configured text /
  image provider) instead of "the one provider that had no key". Class and message shape are
  unchanged, so both `instanceof` branches keep working until P3 replaces them with `AppError` codes.

**Test-isolation fix found while validating.** Before P2 the suite only passed on a machine with no AI
environment configured: `generate.test.ts` (new here), `runtime.test.ts` (P1) and
`provider-registry.test.ts` all assert "nothing is configured", while the code they exercise reads
`GEMINI_MODEL`, `GEMINI_API_KEYS`, `OPENAI_API_KEY` and friends at runtime. Exporting those four in a
shell — which is exactly what the smoke evidence above needs — made **six** tests fail, two of them
because the G2 import seeded an extra enabled provider. All three files now clear that environment
before anything seeds or routes, so the suite is green with or without it. A test that only passes on
a bare machine is not evidence.


## 7. Risks and rollback

| Risk | Mitigation |
| --- | --- |
| Preference silently becomes a pin (G1) | `preferProviderId` never shortens the candidate chain; a test asserts that a preferred-but-failing provider falls through to the next one. |
| Users with `LocalAgentSettings`/env models get a different model after migration (G2) | The importer runs before the facade switch (P1) and is idempotent; `route.reason` + `model` in every response make the change visible. |
| Structured output regressions (R7) | `chatStructured()` keeps the same instruction, the same single retry and the same merged usage; ported tests cover a valid answer, an answer that needs the retry, and a double failure. |
| `MissingAIKeyError` disappears while callers still branch on it (G4) | The class survives P2; only P3 removes the two `instanceof` branches, and P4 deletes the class. |
| Runtime outage as a single point of failure for all AI features | The legacy loop is only deleted in P4, after every call site runs through the runtime in production runs. |
| Rollback | P2 is one commit over five files (`generate.ts`, `compat.ts`, `index.ts`, `image-generation.ts`, and `providers.ts` deleted) plus its tests, the smoke script and this document; reverting them restores the legacy loop without touching a single call site or the database. |

## 8. Verification

```
node_modules\.bin\tsc.cmd --noEmit
node_modules\.bin\eslint.cmd .
node_modules\.bin\vitest.cmd run
tsx scripts/ai-runtime-smoke.ts        # registry + key rotation, no network
```

Per phase, additionally:

* **P1** — unit tests for `preferProviderId` ordering, `importLegacyAiSettings()` idempotency,
  `chatStructured()` success/retry/failure.
* **P2** — every existing route test plus `langgraph-engine.test.ts` unchanged; a smoke run
  that issues one `generateStructured` and one `generateImageFile` against a stubbed
  transport and prints `providerId` / `model` / `credentialLabel` / `attempts`. **Result:** all four
  commands below run clean, and the smoke prints the text, structured and image facade lines quoted
  in §6.3 (see the two provenance notes that follow).
* **P3** — after each file, exercise its route (or the worker) against a stubbed transport and
  check the response body and the written `usage_records.provider` value.

Baseline after P2 (the numbers to compare P3 against):

```
node_modules\.bin\tsc.cmd --noEmit      -> exit 0 (all 19 call sites type-check unedited)
node_modules\.bin\eslint.cmd src scripts -> exit 0 (0 errors, 1 pre-existing warning in
                                            src/components/agent-chat/chat-conversation.tsx)
node_modules\.bin\vitest.cmd run        -> 58 files / 331 tests passed
                                            (was 57/323 before P2: +generate.test.ts, +1 runtime case)
tsx scripts/ai-runtime-smoke.ts         -> all sections print, including the P2 facade block
```

Three provenance notes so the evidence above can be reproduced and trusted:

* The whole run above was executed with `GEMINI_API_KEYS`, `GEMINI_API_KEY`, `OPENAI_API_KEY`,
  `GEMINI_MODEL` and `OPENAI_IMAGE_MODEL` exported in the shell (the smoke run needs them), so the
  green suite also proves the env-independence described at the end of §6.3.
* The smoke script bridges the legacy entry points with `generateStructured` inside a
  **stubbed `globalThis.fetch`** that answers `/chat/completions`, `:generateContent` and
  `/images/generations` from literals, restoring the real `fetch` in a `finally`. A run therefore
  proves routing, request shaping, parsing and file writing without a network call, a key or a token.
* With `SOCIAL_AUTO_POST_DATA_DIR` / `SOCIAL_AUTO_POST_DB_URL` already present in the environment the
  script reuses that database (a `%TEMP%` smoke directory carried over from P1), which is why the
  second run reports `kept` rather than `created` — the importer being idempotent is exactly what
  §6.2 asserted.


