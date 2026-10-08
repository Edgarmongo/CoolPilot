# P5-C3 - Generation Service read-only audit

Read-only audit of the one seam C0 predicted would be written twice for as long as it lives: the two
HTTP entries that turn a creator's intent into a **stored article** - `POST /api/ai-writing/generate`
(智能创作 wizard) and `POST /api/content/generate` (文章创作 → AI 生成). C0 found the duplication
(F-C0-1 of `docs/creator-workflow-audit.md`) and already decided the shape it must take - *one generation
service, two thin routes, the two entries keep their own payloads, guards, envelopes and UI meaning*
(§6.2 of the same doc). This audit does not re-open that decision. It pins what the duplication *is*,
line by line, derives the smallest service that removes it, and proposes the first cut.

No product code was changed to produce this audit, and no generation was run. Every claim carries a
`file:line` reference so it can be re-checked; §9 lists what this audit deliberately did not do.

Companion docs: `docs/creator-workflow-audit.md` (C0: the finding and the decision),
`docs/generate-migration-p3.md` (the AI runtime boundary this service must not re-cross),
`docs/generate-migration.md`.

## 0. Method

- Question driven, one business act: **a creator asks for an article and gets a stored one.**
- Walked both entries forwards (guard → config → positioning → knowledge → prompt → model call →
  title/body → images → content item → usage row → envelope), then sideways into their callers and
  their two test files.
- Static analysis only: file reads, import and call-site greps, `file:line` references. No live
  generation, no AI spend, no database inspection, no product change.
- The two route tests are treated as the contract the cut has to keep green, because C0 named them the
  pin: `src/app/api/ai-writing/generate/route.test.ts`, `src/app/api/content/generate/route.test.ts`.

## 1. The two entries as they exist today

| | 智能创作 wizard | 文章创作 → AI 生成 |
| --- | --- | --- |
| Route | `POST /api/ai-writing/generate` | `POST /api/content/generate` |
| File | `ai-writing/generate/route.ts`, 137 lines | `content/generate/route.ts`, 165 lines |
| Guard schema | `aiWritingGenerateSchema` (`validation.ts:138`): nested `config` (13 fields, 3 defaults) + `topics[]` + `productIds[]` + `freeText` | `contentGenerateSchema` (`validation.ts:81`): flat `topic` + legacy writing fields + extended config fields; every field but `topic` defaulted |
| Guard's answer | `fail("INVALID_PAYLOAD", 400, parsed.error)` (`:52`) → `code: INVALID_PAYLOAD` | `fail("Invalid generation payload", 400, parsed.error)` (`:65`) → `code: UNKNOWN_ERROR`, message kept |
| UI caller | wizard step 3, `ai-writing-step-output.tsx:60-65` | `article-ai-dialog.tsx:99-115`; plus the dead `generate-content-panel.tsx:46-54` via `content-type-workspace.tsx` (imported by nothing, F-C0-7) |
| Caller sends | `{config, topics, productIds, freeText}` | extended config fields only, `type: "article"`, no `agentId` |
| Legacy caller sends | - | `{topic, keywords, maxWords, language, prompt, type, agentId}` |
| Position | `config.positioningId ? getPosition : getDefaultPosition` (`:55`) | same expression (`:68`) |
| Writing agent | none | `getWritingAgent(data.agentId)` (`:88`), prepended to the system prompt (`:95-100`) |
| Material | topics + products + freeText (records) | topic + prompt (free text only) |
| Response | `ok({item, images, provider, model}, 201)` (`:131`) | `ok({item, provider, model, images}, 201)` (`:159`) |
| Route config | `runtime = "nodejs"`, `dynamic = "force-dynamic"` (`:23-24`) | `runtime = "nodejs"` (`:25`) |
| Failure | `failFromError(error, "AI_PROVIDER_FAILED", 502)` (`:135`) | same (`:163`) |
| Test | `route.test.ts` (pins the prompt, the item, the usage row, the 400/502 answers) | `route.test.ts` (pins the writing agent, the knowledge mode, the prompt, the item, the usage row, the 201 envelope) |

The two responses carry the same four keys in a different order. That is the whole audit in one line:
one result shape, written twice.

## 2. The chain both entries walk

Nine steps, same order, in both files:

| # | Step | ai-writing | content | Identical? |
| --- | --- | --- | --- | --- |
| 1 | positioning resolved | `:55` | `:68` | yes, character for character |
| 2 | knowledge selected | `:72-73` | `:86-87` | yes, character for character |
| 3 | system prompt | `:75` | `:95-100` | same builder; content prefixes the writing agent's prompt |
| 4 | user prompt | `:76-82` | `:101-107` | same builder, same five arguments |
| 5 | model call | `:85-89` | `:110-114` | identical: `aiRuntime.chatStructured` + `postDraftSchema` |
| 6 | title/body trimmed | `:90-91` | `:115-116` | same trimming, different title fallback |
| 7 | images resolved | `:94-100` | `:117-123` | same call, different sources |
| 8 | content item written | `:102-117` | `:125-145` | same write and invariants, different `metadata` |
| 9 | usage row written | `:119-129` | `:147-157` | identical |

Plus `toPositioning()` defined twice, byte for byte (`:26-38` and `:36-48`), and the same
`catch → failFromError(error, "AI_PROVIDER_FAILED", 502)` closing both.

Call-site counts measured while writing this (they are the C3 evidence, and the target is to change
each one):

| Symbol | Today | After the cut |
| --- | --- | --- |
| `resolveArticleImages(` in production | 2 (these two routes) | 1 (the service) |
| `createContentItem(` / `createUsageRecord(` in the two routes | 1 each per route | 0 |
| `toPositioning(` defined | 2 | 1 |
| `aiRuntime.chatStructured(` in these routes | 2 | 1 (inside the service) |
| Entry points | 2 (one real caller each + 1 dead panel) | 2, unchanged - by decision §6.2 of C0 |

## 3. Findings

Each finding states what is true today, where it lives, and what it constrains in the cut. None is a
bug report; they are the seams the service will be built on.

### F-C3-1 - The tail is one implementation stored twice

Steps 5-9 above are the duplication: the model call, the trim, the image resolution, the content item
write and the usage row write. `resolveArticleImages(` has exactly two production callers - these two
routes (`ai-writing/generate/route.ts:94`, `content/generate/route.ts:117`) - and the `createContentItem`
+ `createUsageRecord` pair appears once per route with only `metadata` differing. Consequence: every
change to generation has to land twice, and the two copies have already drifted in what they store
(F-C0-1: `aiWriting: {...}` in one, `topic`/`generationType`/`agentName` in the other) and in how they
word a guard (`INVALID_PAYLOAD` vs `UNKNOWN_ERROR`).

### F-C3-2 - `toPositioning()` is a byte-identical copy

`ai-writing/generate/route.ts:26-38` and `content/generate/route.ts:36-48` map the same eight
`PositionRecord` fields into the same `AiWritingPositioning`. It is the only *pure* duplication outside
the tail, and it is what makes "the two routes lose 8 lines each" true rather than rhetorical.

### F-C3-3 - The title fallback is entry policy, not business

`ai-writing`: `data.title.trim() || topics[0]?.title || freeText.slice(0, 20) || "未命名文章"` (`:90`).
`content`: `data.title.trim() || data.topic` (`:115`). Both are legitimate, and they disagree because the
two entries know different things about their input. A service that invents one fallback for both would
change a stored title; the fallback therefore has to be an **input**.

### F-C3-4 - `metadata` is where the two entries are *supposed* to differ

`ai-writing` writes `{type: "article", images, aiWriting: {...config, topics: [titles], productIds},
positioningId, provider, model}` (`:108-115`); `content` writes `{type: data.type, images, prompt, topic,
generationType: "topic", agentId, agentName, provider, model, positioningId, aiWriting: {...config}}`
(`:131-143`). These blobs are how 内容中心 and the next workflow know where an item came from, and F-C0-8
already complains that the worker's items have none. The service must **take the entry's blob** and add
only the parts it owns (`provider`, `model`, `positioningId`, `images`) - normalizing it would delete
provenance the product is trying to keep.

### F-C3-5 - In the article dialog two image strategies cannot fire

The dialog's initial state is `imageStrategy = "product"` (`article-ai-dialog.tsx:85`), and the route
passes `productImagePaths: []` and `sourceUrls: []` (`content/generate/route.ts:120-121`) because a
flat payload has no material behind it and the dialog never sends one. So 产品图 and 网页图 resolve
nothing there and the user silently gets an article without images; only `ai` and `mixed` can produce
one. The wizard is the opposite: it is the only entry that *has* product images and source URLs
(`ai-writing/generate/route.ts:97-98`). The service therefore cannot own "where images come from" - the
sources are material-derived and belong to the caller. Whether the dialog's default strategy should even
be `product` is a product question, not this slice's.

### F-C3-6 - A generation failure still writes nothing at all

Both routes write `status: "success"` usage rows only after a successful call (`:119-129`, `:147-157`),
so a failed generation leaves no `usage_records` row and no content item - the same "unreachable part of
the vocabulary" shape F-C0-6 found in content statuses. `createUsageRecord(` has seven route callers
(`ai-writing/generate`, `content/generate`, `content/import-url`, `content/[id]/rewrite`,
`content/[id]/translate`, `knowledge-base/ai-parse`, `positions/generate`); the service owns *the
generation run's success row*, not the table. Writing a `failed` row would spend a credential and change
the panel's error story, so it is explicitly **not** part of the first cut.

### F-C3-7 - There is a third topic → article pipeline, and it must stay reachable

`src/lib/scraper.ts:100` `generateTopicPost()` builds its own prompt, calls the same
`aiRuntime.chatStructured` with the same `postDraftSchema`, and returns `{...toPostDraft(...), provider,
model, usage}` **without** writing a content item or a usage row - the worker writes those itself
(`src/worker/runner.ts`, playbooks `topic_article_generator` / `topic_search_writer`). C3 does not merge
it, and does not have to: the input shape below can carry it (a caller-supplied system prompt and a
caller-supplied provenance blob are already in the signature), which is exactly what C5 needs so that
the fourth pipeline is never written.

### F-C3-8 - The guard, the envelope and the route config are the entries' own contract

`fail("INVALID_PAYLOAD", ...)` and `fail("Invalid generation payload", ...)` answer with different
`code`/`message` pairs (`lib/api.ts:16-24`: a string that is not an `AppErrorCode` becomes
`UNKNOWN_ERROR` with the string as message), only one route declares `dynamic = "force-dynamic"`, and
both tests pin what *their* route answers. The service must therefore take no `Request`, return no
`Response`, import nothing from `@/lib/api`, and leave the wording alone in this slice - unifying it is
a breaking client change with no user-visible gain, and §6.2 of C0 keeps the two envelopes anyway.

## 4. The minimal input and the minimal output

Derived from the table in §2 - every field below exists because exactly one of the nine steps reads it,
and nothing is in it "because it might be useful".

```ts
export type ArticleGenerationRequest = {
  /** Both entries resolve the same way: this id, or the default position. */
  positioningId?: string;
  /** The writing config both entries already converge on (`AiWritingConfig`, 13 fields). */
  config: AiWritingConfig;
  /** Material: topics and products are records, free text is raw. Both entries build one of these. */
  material: AiWritingMaterial;
  /** The writing agent's prompt, prefixed to the system prompt. Entry B only today. */
  systemPromptPrefix?: string;
  /** Entry A: `"未命名文章"`. Entry B: the topic. Never invented by the service (F-C3-3). */
  titleFallback: string;
  /** Material-derived, so the caller assembles it (F-C3-5). Entry B passes two empty lists. */
  imageSources: { productImagePaths: string[]; sourceUrls: string[] };
  /** The entry's provenance blob; the service adds only what it owns (F-C3-4). */
  provenance: Record<string, unknown>;
};

export type ArticleGenerationResult = {
  item: ContentItem | null;
  images: string[];
  provider: string;
  model: string;
};
```

What is deliberately **not** in the input: `title` (the model produces it, the fallback is policy),
`status` (the service always writes `ready`), `postReadyText` (`${title}\n\n${body}` is an invariant),
`knowledge` and `knowledgeMode` (identical selection in both entries, so the service does it),
`positioning` (an object both entries would have to map identically - the id is the fact), the weights
of the call (`messages`/`schema`), and the HTTP anything.

`ArticleGenerationResult` is not a new shape: it is the `item + images + provider + model` that both
entries already answer with, which is also the shape the wizard's `AiWritingResult` and the dialog's
`GenerateResponse` already declare client-side. The service returns the *stored* item, which is what
makes C1's hand-off possible without the service knowing that an editor exists.

## 5. Boundaries - what the service is not

**Not a router (audit question 4).** C1's hand-off is `articleEditorHref(locale, item.id)`
(`src/lib/editor-link.ts:26`), built client-side by the wizard (`ai-writing-step-output.tsx:119`). The
service's entire contribution to it is returning a stored item that has an `id`. It must not import
`next/link`, `next/navigation`, `@/lib/i18n-config` or `@/lib/editor-link`, and must not name
`/creation/articles`. Stated as a rule: *the service may know that a content item exists; it may not know
that a screen does.*

**Not an image implementation (question 5).** Images stay where they are: `resolveArticleImages()` in
`src/lib/article-images.ts`, whose AI stage crosses the domain boundary exactly once, through
`generateImageFile()` in `src/lib/agent/image-generation.ts`. The service *calls* `resolveArticleImages`
and stores `images[0] ?? ""` as `imagePath`, exactly as both routes do today. It must not call
`aiRuntime.generateImage`, must not fetch an image itself, must not touch the artifacts directory
(`ensureArtifactsRoot`, `copyIntoArtifacts` are the image layer's), and must not re-shape
`metadata.images` - F-C0-5's three-kinds-of-value problem is C4's, so C3 passes the list through
untouched.

**Not the owner of more facts than it writes (question 6).** Seven things live near this seam; two
tables are the service's:

| Fact | Today | After C3 |
| --- | --- | --- |
| the `content_items` row for a generation | both routes | **the service**, once: `status: "ready"`, `postReadyText = title + "\n\n" + body` |
| the `usage_records` success row | both routes | **the service**, once: `kind: "article"`, `wordCount = countTextCharacters(body)`, `contentItemId = item.id` |
| `provider` / `model` / `positioningId` provenance | both routes | **the service** - it is the only layer that has them |
| the entry's own provenance keys (`aiWriting`, `topic`, `prompt`, `agentId`, `generationType`) | each route | **the route** (F-C3-4) |
| the item's content afterwards (PATCH, theme, status) | editor | unchanged: the service's job ends at the row |
| `publish_records` and the `posted` move | C2's `recordPublishSuccess` | unchanged, and unreachable from here |
| image identity (local path vs remote URL vs bare file name) | four clients re-derive it | unchanged (C4) |

One asymmetry is worth stating, because extracting the tail makes it visible rather than fixes it: both
routes write the content item **before** the usage row (`:102` then `:119`, and `:125` then `:147`), so a
failure between them leaves an item with no usage row. That is the same "record first" ordering C2 chose
on purpose (the thing the user can see is written first). C3 keeps the order - in one place instead of
two.

## 6. The interface

```ts
// src/lib/article-generation.ts
export async function generateArticle(request: ArticleGenerationRequest): Promise<ArticleGenerationResult>;
```

Why this and not `generate({ title, prompt, text, image, ... })`:

- **The input is the business the two entries already share** - a writing config, material, and where the
  request came from - not the fields of one screen. `title` is absent because the model writes it and the
  fallback is the caller's policy (F-C3-3). `image` is absent because images are *resolved*, not passed
  (F-C3-5). `text` is absent because the material already carries text in the three shapes the product
  has.
- **The output is the shape both envelopes already carry** (`item`, `images`, `provider`, `model`), so
  wiring a route to it is `return ok(result, { status: 201 })` and nothing else. It is also already the
  client-side shape (`AiWritingResult` in the wizard, `GenerateResponse` in the dialog), so C1's
  hand-off and both panels are untouched.
- **Placement follows C2's precedent** (`src/lib/publish-facts.ts` = one module per domain-fact seam): a
  server-side `src/lib/article-generation.ts` beside `article-images.ts` and `ai-writing.ts`, with
  `AiWritingConfig` / `AiWritingMaterial` staying in `lib/ai-writing.ts` because they are shared
  vocabulary rather than service internals.
- **Naming is a decision to confirm, not a fact (D-C3-A).** `article-generation.ts` / `generateArticle()`
  matches `article-images.ts` and what both entries actually produce; `generation-service.ts` would match
  the slice's own name in C0 §5. Proposed: `src/lib/article-generation.ts` + `generateArticle()`.

## 7. The first cut

Two cuts are possible. The audit's job is to say which one the facts support.

**Cut A - the tail (recommended).**

```
route                                   service
─────                                   ───────
guard (own schema, own wording)    ──▶
payload → AiWritingConfig               positioning resolved, knowledge selected
payload → AiWritingMaterial             system prompt (prefix + builder)
payload → systemPromptPrefix            user prompt (builder)
payload → titleFallback                 aiRuntime.chatStructured + postDraftSchema
payload → imageSources                  resolveArticleImages
payload → provenance                    createContentItem (+ its invariants)
                                        createUsageRecord (the success row)
                                   ◀──  { item, images, provider, model }
ok(result, 201)
```

Both routes become: guard → derive the four entry-specific inputs → `generateArticle` → `ok(result, 201)`,
inside the same `try/catch` that keeps `failFromError(error, "AI_PROVIDER_FAILED", 502)`. Each route loses
roughly 35 of its lines, `toPositioning()` moves into the service, and both entries keep exactly what C0
§6.2 said they keep: their payloads, their guards, their envelopes, their UI meaning.

**Cut B - the whole pipeline (not now).** It would additionally absorb the guard→config mapping
(`content`'s flat fields, `guessLanguage`, the `AiWritingConfig` construction) and the material
derivation. It deletes more lines, but it forces the service to learn entry semantics - "a flat topic
becomes free text", "some entries have an agent" - so the interface stops being the shared business and
becomes the union of two screens' inputs. It also swallows the guards, which is where the two entries
answer differently on purpose (F-C3-8). Rejected for the first cut; Cut A does not prevent it later.

**D-C3-B: the first cut is Cut A** - the smallest change that removes the duplication, with no route
schema, envelope or client change, and with both existing route tests staying green as written. That last
property is the whole point: it is the only cheap proof that behaviour did not change. Evidence that it
worked, all greppable:

| Check | Expect |
| --- | --- |
| `resolveArticleImages(` under `src/app` | 0 |
| `createContentItem(` / `createUsageRecord(` in the two generate routes | 0 / 0 |
| `aiRuntime.chatStructured(` in the two generate routes | 0 |
| `toPositioning(` definitions in `src` | 1 |
| `src/app/api/*/generate/route.test.ts` | unmodified, green |
| new unit test file | `src/lib/article-generation.test.ts` |

## 8. What will pin it

The route tests already pin the contract - the prompt a caller gets, the stored item, the usage row, the
envelope, the failure status. C3 leaves them untouched and adds the layer beneath them, following the C2
pattern (where `lib/publish-facts.ts` gained a unit test of its own while the route test stayed
HTTP-level):

- `src/lib/article-generation.test.ts` - the service called directly, through the existing harness
  (`src/test/route-harness.ts` pins the temp database and a keyless env before anything that reads them
  loads). Cases: one success writes exactly one item (`status: "ready"`, `postReadyText`) and exactly one
  usage row (`kind: "article"`, `contentItemId`); the provenance blob survives verbatim and gains only
  `provider` / `model` / `positioningId` / `images`; `images` is passed through with
  `imagePath = images[0] ?? ""`; the caller's `titleFallback` is the one used when the model returns an
  empty title; a runtime failure keeps the runtime's own error and status and leaves no item and no usage
  row.
- `src/app/api/ai-writing/generate/route.test.ts` and `src/app/api/content/generate/route.test.ts` -
  unchanged, as the regression net proving the extraction preserved behaviour.

## 9. What this audit did not do

- No generation was run and no AI credit was spent: this is static analysis of two routes, two schemas,
  their four callers and their two test files.
- No decision on `metadata.images`' identity problem (F-C0-5) - C4 owns it and C3 must not pre-empt it.
- No merge of the worker's `generateTopicPost` pipeline (F-C3-7) - that is C5's landing point; C3 only
  guarantees the service can carry it.
- No change to either guard's wording, either response envelope, or `contentGenerateSchema`'s legacy
  fields (`language`, `agentId`): removing them is a client-facing decision nothing here depends on.
- No product answer on F-C3-5's default image strategy in the article dialog.
- No touch of P5-B0/B1, 内容中心 (`/content/library`), the C1 hand-off, C2's publish facts, or the
  database schema.

