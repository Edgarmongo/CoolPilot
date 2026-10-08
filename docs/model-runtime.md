# AI Runtime (Model Gateway) — implementation notes

Implementation status of the model layer described in `model-layer-spec.md`, and the
concrete shape the code took. Read this together with `model-gateway.md` (product view)
and `model-layer-spec.md` (layer contracts).

Model management in 系统 / 模型管理 is the UI of this runtime. Data in this app is
disposable: the runtime seeds itself from the vendor registry and the bundled gateway
snapshot on first use.

## 1. Layer → file map

| Layer (spec §) | Code |
| --- | --- |
| Vocabulary, capability / protocol enums, intents | `src/features/ai-runtime/contracts.ts` |
| Provider + endpoint registry, seeding, routing candidates | `src/features/ai-runtime/registry.ts` |
| Protocol adapters (OpenAI-compatible, Gemini) + factory | `src/features/ai-runtime/adapters.ts` |
| Vendor payload → `NormalizedModel` | `src/features/ai-runtime/normalizers.ts` |
| Capability detection (4 layers) | `src/features/ai-runtime/capability.ts` |
| Capability probe (layer 3) | `src/features/ai-runtime/probe.ts` |
| Catalog sync (provider → registry) | `src/features/ai-runtime/sync.ts` |
| Unified call surface (`chat`, `chatStructured`, `generateImage`) | `src/features/ai-runtime/runtime.ts` |
| Persistence | `src/db/repositories/ai-runtime.ts` |
| Credential store (vault + env, multi-key) | `src/lib/credentials.ts` |
| Key pool: rotation, cooldowns, failover | `src/features/ai-runtime/key-pool.ts` |
| Schema / DDL | `src/db/schema.ts`, `src/db/client.ts` |
| UI: registry, providers, local config | `src/components/system/model-registry-panel.tsx`, `model-provider-panel.tsx`, `model-config-panel.tsx` |

Call flow: **UI / feature → `aiRuntime.chat()` → router → registry → adapter → vendor**.
Nothing above the runtime names a vendor.

## 2. Data model

```
ai_model_providers   vendor (openai, qwen, deepseek …, gateway)
ai_model_endpoints   one callable base URL + protocol + credential_ref   (per provider)
ai_models            one model id reachable through an endpoint
ai_model_capabilities  capability rows per model, each with a source
ai_model_preferences   the default model per capability ("用户默认模型")
ai_sync_records        catalog sync history
ai_probe_results       capability probe history
ai_credential_keys     per-key health: fingerprint, masked tail, status, cooldown, usage
```

Decisions worth remembering:

- **The protocol belongs to the endpoint, not the provider.** The same vendor can expose
  an OpenAI-compatible endpoint and a native one; the registry is the only place that
  knows the difference.
- **`endpoint_id` is `''`, never `NULL`.** SQLite treats NULLs as distinct inside a UNIQUE
  index, so `UNIQUE(provider_id, endpoint_id, model_id)` would not deduplicate otherwise.
  `''` is the "catalog only, no endpoint" marker.
- Model row ids are deterministic (`provider:endpoint:model`), so a re-sync updates a row
  instead of creating a copy.
- The database never stores a key, only `credential://<vendor>/<name>`.
- The dead `ai_providers` table (zero references) was removed with its DDL.

## 3. Capability detection (4 layers, highest priority wins)

| Priority | Source | Written by |
| --- | --- | --- |
| 4 | `USER_OVERRIDE` | 模型管理 → capability chip / probe result the user accepts |
| 3 | `PROBE_TEST` | `POST /api/ai/models/probe` — one real request per capability |
| 2 | `PROVIDER_METADATA` | sync: Gemini `supportedGenerationMethods`, OpenRouter modality + `supported_parameters` |
| 1 | `MODEL_CATALOG` | curated rules in `capability.ts` applied to the model id (confidence < 1) |

A sync replaces only the rows it owns (`MODEL_CATALOG`, `PROVIDER_METADATA`); probes and
user overrides survive. The UI shows the source as a letter on every capability chip, so a
guess is never presented as vendor metadata.

## 4. Routing

`resolveRoute(requirement)` returns the pick, the ordered alternatives **and the
requirement it actually enforced** (`route.requirement`). Order:

1. pinned model (`requirement.model` / `ChatRequest.model`)
2. the user's default for the entry capability (`capability-default`)
3. **soft provider preference** (`preferProviderId`, defaulting to the legacy text provider)
4. provider `sort_order`, then endpoint `is_default`
5. `model_type` matching the intent, then model id (`capability-match`)

Tiers 1-2 *choose*; tier 3 only orders. A pinned `providerId` is a filter (the candidate
chain shrinks to that provider), a `preferProviderId` is a hint (every other candidate stays
in the chain, so failover keeps working) — that distinction is what the legacy
`generateText({ provider })` argument needs, since it always meant "prefer, then fall through".
`loadPreferredProviderId()` reads `LocalAgentSettings.textProvider` live, so switching the
provider in 系统 / 模型配置 reorders routing without a re-seed.

Candidates are filtered by: model enabled, endpoint bound **and** enabled, provider
enabled, `min_context_window`, and a resolvable credential.

`aiRuntime.chat()` starts with the strict requirement (`chat` + `structured_output` for
`json: true` + `tool_calling` for `tools[]` + `vision` for image messages) and falls back
to the entry capability alone, recording the relaxed requirement in `route.requirement`.
No silent downgrade: the caller can see exactly what was enforced.

Failures name the last bottleneck (`CapabilityFailureReason`):
`no-models-synced` · `model-not-found` · `provider-filtered` · `endpoint-disabled` ·
`provider-disabled` · `credential-missing` · `capability-missing` ·
`context-window-too-small`.

### 4.1 Structured output and the legacy bridge

`chatStructured({ messages, schema, ... })` is the structured-output entry point: it embeds
the JSON schema in the prompt (`z.toJSONSchema`), calls `chat({ json: true })`, validates,
retries **once** with the model's own answer plus a correction note, merges the usage of both
attempts, and reports `retried` plus a two-entry `attempts` trail. A retry is a fresh routed
call, not a replay, so a key that just cooled down is replaced instead of reused.

`importLegacyAiSettings()` (`registry.ts`) is the one-time bridge from the pre-runtime
configuration: for every legacy provider it enables the model configured in
`LocalAgentSettings` or `process.env.*_MODEL`, creates the row (with name-rule capabilities,
`source: "legacy-settings"`) when the catalog never saw that id, and makes the preferred
provider's chat model and the image provider's image model the capability defaults — never
overwriting a default the user already set. It runs inside `ensureModelRuntimeSeeded()`
(`seedVersion = 2`), so it happens once per install and reports `kept` on every later run.
Without it, a user who had `GEMINI_MODEL=gemini-2.5-pro` would silently be routed to whatever
the registry happens to prefer.

## 5. Credentials

`src/lib/credentials.ts` resolves `credential://<vendor>/<name>` from, in order:

1. the encrypted vault — `<data>/credential-vault.json` (AES-256-GCM, key in
   `<data>/credential-vault.key`, mode 0600);
2. the environment / `.env.local`, variable `<VENDOR>_API_KEYS` or `<VENDOR>_API_KEY`
   (this is why keys configured through the legacy settings form keep working).

**Several keys per credential.** One credential holds a list, because providers rate-limit
per key. Keys are separated by newlines, commas or semicolons, duplicates collapse, and
`readCredentialKeys` returns them in rotation order (first key first). The vault stores the
list as one newline-joined, encrypted blob; `readCredential()` still returns the first key
for callers that just need "a key". `describeCredential()` reports `keyCount` and
`maskedKeys`.

**Honest limitation:** the `os-encrypted` backend (Windows DPAPI / macOS Keychain) is not
implemented - `keytar` is not a dependency - so the UI says so instead of implying
keychain protection. The vault protects against accidental sharing (backups, screenshots,
support bundles), not against a local attacker.

### 5.1 Key pool and health state machine

`src/features/ai-runtime/key-pool.ts` owns "which key do I use now, and is it still valid"
(spec §5.2). Health is persisted in **`ai_credential_keys`**, one row per
`(credential_ref, fingerprint)` where the fingerprint is a SHA-256 of the key: the runtime
remembers cooldowns and failure history without ever storing the key itself.

| status | set when | leaves rotation |
| --- | --- | --- |
| `unknown` | a key is first registered (pasted, or found in the environment) | no |
| `ok` | a call, probe or catalog list succeeded | no |
| `invalid` | upstream 401 (or `MODEL_CREDENTIAL_INVALID`) | yes, until reset |
| `forbidden` | upstream 402/403 | yes, until reset |
| `rate_limited` | upstream 429 → `cooldownUntil = now + Retry-After` (default 60 s) | while cooling |
| `disabled` | the user pressed 停用 | yes, until re-enabled |

Selection order (§5.2): drop `disabled` → drop cooling `rate_limited` → drop
`invalid`/`forbidden` → sort the rest by `useCount`, then `lastUsedAt` (so calls spread
across the key set instead of hammering the first one). Every `runWithCredentialKey()` call
counts the attempt, reports the outcome, and rotates on the **next** key for 401/403/429,
timeouts and 5xx. It does *not* rotate for a rejected request shape (400/404/422): another
key would answer exactly the same, so the runtime stops and says so. If every key is out,
the error is `MODEL_CREDENTIAL_UNAVAILABLE` with `details.reasons` and one entry per key —
"cooling down" is never reported as "no key configured".

Two failure layers in `aiRuntime.chat()`, both visible to the caller:

1. **key rotation inside one model** — the `credentialLabel` names the masked key that
   signed the call;
2. **candidate failover across models** — up to 3 ranked candidates, recorded in
   `attempts[]` (`{ providerId, modelId, credentialLabel, error }`). A pinned `model` or
   `providerId` narrows the chain to exactly one candidate, so an explicit choice is never
   silently downgraded; a fatal error (400-class) stops immediately.

Probes and catalog syncs go through the same pool, so a cooling key does not make a working
model look broken, and `MODEL_CREDENTIAL_FORBIDDEN` / `MODEL_RATE_LIMITED` /
`MODEL_CREDENTIAL_INVALID` (tagged by the adapters, `Retry-After` honoured) feed straight
back into the state machine.

Manual lifecycle (`POST /api/ai/providers`, `action: "key"`): `reset` clears a cooldown or
a rejection (back to `unknown`), `disable` / `enable` take a key out of or into rotation.
The provider form accepts a multi-line key box and shows every key with its masked tail,
status, usage count and those buttons.

## 6. HTTP surface

| Route | Purpose |
| --- | --- |
| `GET /api/ai/runtime` | providers + endpoints + credential state, per-capability 可见/可调 counts, defaults, recent syncs |
| `GET /api/ai/providers` | provider list for the management page |
| `POST /api/ai/providers` | `save` (provider + endpoint + key), `test` (pull the live catalog), `delete` |
| `GET /api/ai/providers/catalog` | live catalog preview of one provider, nothing persisted |
| `GET /api/ai/models` | registry list with filters (`providerId`, `keyword`, `enabled`, `limit`) |
| `PATCH /api/ai/models` | enable/disable models, override one capability, set the capability default |
| `POST /api/ai/models/sync` | catalog sync for one provider |
| `POST /api/ai/models/probe` | capability probe (layer 3) |
| `POST /api/ai/chat` | the unified chat call; returns text, tool calls, usage and the route taken |

New error codes (translated in en / zh-cn / zh-hk): `MODEL_PROVIDER_NOT_FOUND`,
`MODEL_ENDPOINT_INVALID`, `MODEL_PROTOCOL_UNSUPPORTED`, `MODEL_CREDENTIAL_MISSING`,
`MODEL_CREDENTIAL_UNAVAILABLE`, `MODEL_CREDENTIAL_INVALID`, `MODEL_CREDENTIAL_FORBIDDEN`,
`MODEL_RATE_LIMITED`, `MODEL_CAPABILITY_UNAVAILABLE`, `MODEL_NOT_CONFIGURED`,
`MODEL_SYNC_FAILED`, `MODEL_PROBE_FAILED`, `MODEL_UPSTREAM_FAILED`,
`MODEL_UPSTREAM_NO_CONTENT`.

## 7. UI (系统 / 模型管理)

Four tabs: **可用模型** (bundled/gateway catalog browsing, unchanged) · **模型注册表**
(what the runtime knows, per-capability defaults, enable/disable, capability chips that
probe on click, recent syncs) · **供应商与密钥** (provider, protocol, base URL, key, test
connection) · **模型配置** (the existing local provider form, provider status, cloud card,
manual gateway sync).

Seeding walks the vendor registry: vendors with an OpenAI-compatible endpoint get their own
provider **and** endpoint (so 通义千问 no longer means "point your OpenAI key at a different
base URL"), vendors without one (Anthropic, Midjourney) stay visible but unroutable, and
the bundled gateway snapshot is imported as catalog knowledge only — 420 models, none of
them callable until a provider is configured.

## 8. Verification

```
node_modules\.bin\tsc.cmd --noEmit
node_modules\.bin\eslint.cmd .
node_modules\.bin\vitest.cmd run
```

`tsx scripts/ai-runtime-smoke.ts` creates a throwaway database, runs the seed and prints
what the registry holds plus how a few requirements route - useful to see the whole layer
without the UI. Pass a directory (`tsx scripts/ai-runtime-smoke.ts ./web-data`) to inspect
the real app data instead.

Note for a long-running `next dev`: `ensureDatabase()` memoizes its DDL run for the process
lifetime, so a server started before this change has to be restarted once before the new
tables exist.

Tests: `src/features/ai-runtime/{normalizers,capability,runtime,key-pool}.test.ts` (normalization
contract, capability priority, seeding, sync, credential gating, default-based routing,
relaxed requirements, probe rows, upstream failures, key rotation and cooldown state machine,
candidate failover) and `src/lib/credentials.test.ts` (vault round-trip without plaintext on
disk, multi-key parsing/order/deduplication, masked-placeholder handling, env fallback).

## 9. Deliberately not done yet

- **`@/lib/ai/generate.ts` still uses its own provider loop.** It resolves the same keys and
  endpoints but calls providers directly instead of `aiRuntime.chat()`. The migration is
  planned phase by phase in `docs/generate-migration.md` (inventory, parity matrix, gaps,
  and the decision that runtime provider identity is `providerId`). Prerequisites already in
  place: the key pool rotates several keys with cooldowns (P1, this doc §5.1),
  `preferProviderId` reproduces the legacy "prefer, still fail over" semantics,
  `chatStructured()` owns the JSON-schema retry loop, and `importLegacyAiSettings()` brings
  `LocalAgentSettings` / `*_MODEL` into the registry once so a configured model stays the
  one that answers.
- Streaming (`streamChat`) — no consumer yet, so no SSE plumbing was added.
- **Cost routing / `ai_model_pricing`**: no writer and no consumer, so the table was not
  created. Add it together with the price sync that fills it.
- Anthropic adapter: the protocol is declared and only selectable once implemented; the
  factory throws `MODEL_PROTOCOL_UNSUPPORTED` today.
- Video / audio job adapters: the capabilities exist and are detected, but only
  `openai-compatible` and `gemini` adapters implement `chat` and `generateImage`.
- The OS keychain credential backend (see §5).
