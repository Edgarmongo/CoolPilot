# P5-C0 - Creator Workflow read-only audit

Read-only audit of the product's first user-facing promise: **a creator opens CoolPilot, writes one
article with AI, adds media, edits it, saves it, publishes it to an account they own, and can see that
it was published.** The audit reads code paths; it changes none of them. Every claim below carries a
`file:line` reference so it can be re-checked, and the last section lists what this audit deliberately
did *not* do.

Companion docs: `docs/generate-migration.md` and `docs/generate-migration-p3.md` (what the AI runtime
is and how the business layer converged onto it), `docs/model-runtime.md`, `docs/tech-stack.md`.

Frozen context: P5-B0 (Workspace foundation: `paths` -> `manifest` -> `/api/workspace/manifest` ->
Workspace Overview) is closed and is **not** reopened by anything here. The Workspace answers "what is
on disk"; this audit asks "what can a creator actually do".

## 0. Method

- Question driven, one user task: **create one article and publish it.**
- Walked forwards along the user's actions (create -> content -> AI writing -> images -> editor -> save
  -> publish -> record), then backwards along the writes (which table/file each step lands in).
- Static analysis only: file reads, imports, call-site greps. No live run, no database inspection, no
  product change. The slices proposed in §5 are the ones that will need runtime verification.

## 1. The chain as it exists today

```
idea ──> create ──> AI writing ──> images ──> editor ──> save ──> publish ──> record
                        │                                  │
                        └── aiRuntime (chatStructured)      └── Playwright (runSiteBrowserTool)
```

| Step | Where the user does it | Screen | Route | Storage written |
| --- | --- | --- | --- | --- |
| Create (manual) | 文章创作 | `/creation/articles` | `POST /api/content` | `content_items`, status `ready` |
| Create (AI, topic dialog) | 文章创作 → AI 生成 | `/creation/articles` | `POST /api/content/generate` | `content_items` + `metadata.images` + `usage_records` + artifacts files |
| Create (AI, wizard) | 智能创作 | `/creation/ai-writing` | `POST /api/ai-writing/generate` | same as above |
| Create (URL import) | 内容中心 → 新增 | `/content/library` | `POST /api/content/import-url` | `content_items` (+ `usage_records` only when rewriting) |
| Create (agent) | 对话 | `/chatroom` | tool `generate_social_post_draft` | `content_items` |
| Create (worker) | 计划 / 运行队列 | `/schedules/list`, `/runs/queue` | playbooks in `src/worker/runner.ts` | `content_items` |
| Read / list | 文章创作, 内容中心 | `/creation/articles`, `/content/library` | `GET /api/content` | reads `content_items` |
| Edit | 文章创作 → 编辑器 | `/creation/articles` | `PATCH /api/content/[id]` | `content_items` |
| Images | 编辑器 → 插入/封面 | `/creation/articles` | `/api/images`, `/api/images/search`, `/api/images/from-url`, `/api/images/upload` | artifacts files + `metadata.images` |
| Save draft | 编辑器 → 存为草稿 | `/creation/articles` | `PATCH /api/content/[id]` (`status: draft`) | `content_items.status` |
| Publish (assisted) | 文章创作 / 编辑器 | dialog → run panel | `POST /api/publish/draft` + `POST /api/publish/verify` | **nothing** |
| Publish (automatic) | 动态发布 / 视频发布 | `/creation/posts`, `/creation/videos` | `POST /api/publish` | `publish_records` |
| Publish (legacy worker) | 计划 | worker playbook `threads_auto_post` | `lib/threads.ts` | `content_items.status = posted` |
| Records | 发布记录 | `/publishing/records` | `GET /api/publish-records` | reads `publish_records` |
| Metrics | 数据中心 | `/data-center` | `/api/metrics/*` | reads `publish_records` |

## 2. What each step actually does

**Create.** Two shapes exist. `ArticlesWorkspace` posts a title-only item and immediately opens the
editor on it (`articles-workspace.tsx:93-102`); the item is created with status `ready`, so an empty
article is born publishable. The other shape is generation (below). Nothing creates a `draft`.

**AI writing.** Two endpoints build the same product:

- `POST /api/content/generate` (166 lines) - topic + writing config, used by the 文章创作 AI dialog
  (`article-ai-dialog.tsx:94`) and by the 内容中心 新增 dialog (`content/library/page.tsx:105`).
- `POST /api/ai-writing/generate` (138 lines) - the 智能创作 wizard's material/config payload
  (`ai-writing-step-output.tsx:59`).

Both resolve positioning (`getPosition` / `getDefaultPosition`), both select knowledge references, both
call `buildArticlePrompt` + `buildArticleSystemPrompt`, both call `aiRuntime.chatStructured` with
`postDraftSchema`, both call `resolveArticleImages`, both call `createContentItem` then
`createUsageRecord` (`content/generate/route.ts:101-159` vs `ai-writing/generate/route.ts:76-131`). The
differences are the payload shape and the fallback title. The model call itself is already converged:
provider order, model choice, key rotation, failover and structured-output validation live in
`src/features/ai-runtime` (`aiRuntime.chatStructured`), and the routes keep only prompt + post-call work.

**Images.** `resolveArticleImages` (`src/lib/article-images.ts:26-76`) walks `product` -> `web` -> `ai`
under the chosen strategy, is failure tolerant at every step, caps AI generation at 3
(`maxGeneratedArticleImages`), copies product photos into the artifacts dir, and takes the source page's
`og:image` as-is (a remote URL). The editor's picker is a separate path: library (`GET /api/images`),
online search (`/api/images/search`), remote fetch (`/api/images/from-url`), local upload
(`/api/images/upload`), all through `ImageSourcePicker`. Image generation itself has one domain service
(`lib/agent/image-generation.ts` -> `aiRuntime.generateImage()`, D-P3-2) with three callers: the library
route, `article-images.ts`, and the agent tool `generate_image_file`.

**Editor.** One full-page editor (`article-editor.tsx`): title, `contentEditable` body, themes
(`lib/article-themes`), cover + inline image insertion, image resize, rewrite, translate, copy HTML,
publish. The body is written as **HTML** in `content_items.body` and the plain text in `postReadyText`
(`article-editor.tsx:271-288`); images go to `metadata.images` (first entry = cover) and the cover is
mirrored into `imagePath`, merged - not replaced - by `mergeContentMetadata`
(`src/lib/content-images.ts:24-32`, `repository.ts:471`).

**Save.** Explicit only: 存为草稿 (`save("draft")`, `article-editor.tsx:521-529`) and the implicit save
that runs before opening the publish dialog (`openPublish`, `article-editor.tsx:290-293`). There is no
autosave; the hint next to the saving indicator is about typesetting, not about persistence
(`aeAutoHint`).

**Publish.** Two semantics, three routes:

1. **Assisted (the editor's and the article list's path).** `ContentPublishDialog` -> `PublishRunPanel`
   opens the account's browser profile, calls `POST /api/publish/draft` to prefill the platform editor
   (`publish-run-panel.tsx:119`), hands the live frame to the human, polls `POST /api/publish/verify`
   every 2.5s (`publish-run-panel.tsx:167-186`), and offers `POST /api/publish/discard` on abandon.
   `lib/publish.preparePublishDraft` never clicks publish.
2. **Automatic.** `POST /api/publish` calls `publishToSite(..., publish: true)` (Playwright clicks
   publish) and writes one `publish_records` row per account, including the login-health pre-check
   (`api/publish/route.ts:26-90`). Only the 动态发布 and 视频发布 composers use it
   (`posts-composer.tsx:88-105`, `videos-composer.tsx:310-320`).
3. **Legacy worker.** The `threads_auto_post` playbook posts the next `ready` item through
   `lib/threads.ts` and marks it `posted` (`lib/threads.ts:126`) - the only writer of that status.

**Record.** `/publishing/records` reads `publish_records`; the metric collector also reads it
(`lib/metric-*.ts`). The assisted path writes neither.

## 3. Findings

Each finding states what is true today, where it lives, and why it matters for the vertical slice. None
of them is a bug report; they are the seams the slice will be built on.

### F-C0-1 - The generate tail is implemented twice

`api/content/generate/route.ts:101-159` and `api/ai-writing/generate/route.ts:76-131` are the same
pipeline with different inputs. `resolveArticleImages(` has exactly two production callers - these two
routes - and `createUsageRecord` is duplicated in both tails. Consequence: every Creator Workflow change
has to land twice, and the two entry points can drift in what they store (`ai-writing` writes
`metadata.aiWriting` with topic titles + product ids, while `content/generate` writes `topic`, `prompt`
and `generationType: "topic"`).

### F-C0-2 - The publish a user performs is the publish that writes nothing

`createPublishRecord(` appears in production only in `api/publish/route.ts`. `api/publish/draft/route.ts`
(28 lines) and `api/publish/verify/route.ts` (24 lines) contain no database write at all, and
`markContentItemPosted(` is called only from `lib/threads.ts:126`. So the article the user publishes
through the editor is absent from 发布记录, invisible to the content calendar, invisible to the metric
collector, and stays `ready`/`draft` forever. The outcome of the publish exists only in the run panel's
React state, which the dialog drops on close.

### F-C0-3 - Two publish semantics are exposed side by side

The same product offers "assisted" (the human clicks publish on the platform page; `/api/publish/draft`)
and "automatic" (`publish: true`; `/api/publish`). Which one a user gets depends on the *screen*, not on
a setting: 文章创作 is assisted, 动态发布/视频发布 are automatic. A vertical slice needs one publishing
contract with the automation level as a parameter, otherwise the two can never share a record shape.

### F-C0-4 - Generation never hands off to editing

The wizard's only continuation is a link to the **read-only** 内容中心
(`ai-writing-step-output.tsx:116-121` -> `/content/library`), while editing lives in 文章创作. Nothing in
the product takes the freshly created item and opens it in the editor: the AI dialog closes and refreshes
the list (`articles-workspace.tsx:298-305`), the wizard renders the body as text, and the 内容中心
details dialog is a viewer. The item the user just created is the one they most want to open, and there
is no link to it.

### F-C0-5 - `metadata.images` holds three kinds of value and four clients re-derive it

The stored list can contain absolute local artifact paths (`article-images.ts:16,43`, the
`ai-writing/generate` metadata), remote `og:image` URLs (`article-images.ts:54`), and bare file names
(the editor's picker stores `image.fileName`, `article-editor.tsx:172-174`). Four client helpers turn
those into a URL (`articles-workspace.tsx:54-59`, `ai-writing-step-output.tsx:28-33`,
`article-editor.tsx:42-47`, `posts-composer.tsx:17-20`) while the server already owns one
(`lib/artifact-image-url.ts`). Publishing only ships the cover and silently drops a remote one
(`lib/publish.ts:26-32` returns `""` for `http`), which is exactly the case URL import creates
(`api/content/import-url/route.ts` sets `imagePath` to the page's `og:image`).

### F-C0-6 - Half of the status vocabulary is unreachable

`ready` is written by every creation path; `draft` only by the editor's 存为草稿; `posted` only by
`lib/threads.ts`; `failed` by nothing. The 文章创作 status filter offers all four
(`articles-workspace.tsx:22-36`). A status a user cannot cause is a status a user cannot trust.

### F-C0-7 - Two orphaned creation surfaces still carry the old shape

`src/components/content-type-workspace.tsx` (full list + `GenerateContentPanel` + `ContentPublishDialog`)
is imported by no file in `src`; `src/components/generate-content-panel.tsx` is imported only by that
orphan. Both duplicate today's 文章创作 surface, including their own AI panel call to
`/api/content/generate`. They are dead weight in the exact area the slice will touch.

### F-C0-8 - The same act has different histories depending on who performs it

"Topic -> article" exists three times: `api/content/generate`, `api/ai-writing/generate`, and
`lib/scraper.generateTopicPost` (used by the worker playbooks `topic_article_generator` and
`topic_search_writer`, `worker/runner.ts:61-154`). "URL -> article" exists twice: `api/content/import-url`
(with usage rows) and `worker/runner.ts:85-121` (without). The worker's items carry no
`generationType`/`provider` metadata, so 内容中心 shows them as blanks. One product outcome, several
provenances, two of which cannot be traced.

### F-C0-9 - What the creator chose as material is not stored as data

The wizard sends hot topics and product ids, and the route stores only their titles
(`ai-writing/generate/route.ts:111`: `aiWriting: { ...config, topics: [...titles], productIds }`). The
link between a generated article and the product or topic record it came from is therefore a string in a
JSON blob rather than a reference - which is the connection an Agent/Workflow/Template layer will later
need.

## 4. Can a creator walk the chain today?

Yes, in one route only: **文章创作 -> 新建 / AI 生成 -> 编辑器 -> 发布**. Walking it end to end exposes
four breaks:

1. **From AI writing to the editor** (F-C0-4): the wizard leaves the user in a read-only inventory.
2. **At publish** (F-C0-2): the publish succeeds on the platform and leaves no trace inside CoolPilot.
3. **With a cover** (F-C0-5): an imported or web-sourced cover is displayed but not shipped.
4. **After publish** (F-C0-6): the item keeps saying 待发佈 / Ready, so the user cannot tell published
   from prepared by looking at the list.

Nothing else in the chain is missing. Every step has a screen, a route, a service and a storage location,
and the three boundaries the product already froze hold: one AI front door (`aiRuntime`), one browser
automation seam (`runSiteBrowserTool` behind `lib/publish`), one image domain service
(`lib/agent/image-generation`), one content table (`content_items`).

## 5. Proposed vertical slice

Definition of done: *one article, produced by AI, illustrated, edited, saved, published to a real
account, and visible as published inside CoolPilot - verifiable in three locales.* The smallest sequence
that reaches it, each step independently shippable and revertable:

| Slice | Work | Why this order | Ends in |
| --- | --- | --- | --- |
| **C1** | Join the ends: what a generator just produced opens in the editor. Shipped as the deep link `?edit=<id>` on 文章创作 (wizard result link + the article AI dialog handing its stored item over); no route, schema or 内容中心 change. | Biggest user-visible gain, smallest blast radius, no route or schema change. | 想法 -> AI 生产 -> 编辑 |
| **C2** | One publish contract that records: the assisted run writes a `publish_records` row when the platform confirms (`/api/publish/verify`), abandons on discard, and moves the content item to `posted`. *Shipped in §7 as the success contract: the record and the `posted` move land; a discard or failure still writes nothing (D2).* | Makes publish a fact instead of UI state; unblocks 发布记录 / 内容日历 / metrics. | 编辑 -> 发布 -> 记录 |
| **C3** | One generation service: extract the shared tail of the two generate routes into `src/lib` (behind both request schemas, or behind one), keeping the existing route tests as the pin. | Stops every later slice from being written twice. | one entry point for AI writing |
| **C4** | One image identity: a single client+server resolver for an image reference, one stored shape, cover = first entry, and remote covers either fetched into the artifacts dir at creation or explicitly marked remote. | The cover is the one image publishing actually ships. | 图片 -> 发布 |
| **C5** | Reuse: point the agent tool layer and the (static) app-store catalog at the C3 service, so Agent/Workflow/Template share one pipeline instead of a fourth copy. | Only meaningful once C3 exists; this is where the Agent/Workflow story gets its landing point. | 复用 |

Explicitly **not** in this slice: Workspace changes (B0 stays frozen), a workspace cleanup / backup /
export surface, image or video library redesign beyond the cover path, Marketplace, and any new AI
runtime capability. C1 and C2 are the two that change what a creator can accomplish; C3 and C4 are the
two that make the next ten features cheaper.

## 6. Decisions, and what is still open

Answered by the product owner before C1, and recorded here because C2..C5 are designed against them:

1. **Publish semantics: assisted.** The Creator Workflow publishes the way the editor dialog does today -
   the human confirms, CoolPilot executes, `verify` reports, the record is written. Automatic publishing
   is not rejected, it is *later* and belongs to the same Publish Domain: the fact that something was
   published is the publish layer's business, not the screen's, so C2 puts the `publish_records` write and
   the `posted` transition in one place a future Workflow trigger can also call. What it must not become
   is "the button writes the record".
2. **The wizard keeps its own endpoint.** C3 is therefore "one generation service, two thin routes" -
   the duplicated *tail* (prompt -> AI -> images -> content item -> usage) collapses into a service, while
   the two HTTP entries keep their own payloads, guards, response envelopes and UI meaning. The audit's
   finding was duplicated business implementation, not a surplus entry point.
3. **An image reference should own a workspace identity.** Direction given for C4: an external asset (a
   remote `og:image`) is brought into the workspace at creation time (`fetch` -> `artifacts/` ->
   content image reference), so Content and the publish layer only ever see a local path. This is the
   local-first rule applied to images; the work itself stays in C4.

Still open:

4. **Does 内容中心 become an editing entry, or stay the read-only inventory?** Unanswered, so C1 does not
   touch `/content/library` at all: the hand-off below runs from the two generators to the editor inside
   文章创作, and the library keeps the shape F-C0-4 describes - read-only, linked from the wizard, not
   part of the editing loop yet.

## 7. What has shipped since this audit

### P5-C1 - the generator hands its item to the editor

The first slice, implemented and verified in the C1 batch:

- **The hand-off is a URL, not a second screen.** `?edit=<content id>` on the 文章创作 route
  (`src/lib/editor-link.ts`) is produced by the wizard's own result
  (`src/components/creation/ai-writing/ai-writing-step-output.tsx`: 在编辑器中打开) and consumed by the
  workspace (`src/components/creation/articles-workspace.tsx`), which reads that one item
  (`GET /api/content/[id]`) and renders the editor in place of the list. The parameter is an *entry*, not
  state: closing the editor drops it, so a reload lands on the list. (The route therefore needs a
  `Suspense` boundary around `useSearchParams` - see `src/app/[locale]/(console)/creation/articles/page.tsx`.)
  Dropping it is `window.history.replaceState`, not `router.replace`: measured against a production build
  of this batch, a `replace` whose pathname is already the current one never commits on this route - the
  router re-fetches the *current* URL three times and the address bar keeps `?edit=`, while the native
  History API (which Next documents as syncing `useSearchParams`) updates it and the page follows.
- **The other generator no longer ends in a toast.** `ArticleAiDialog` hands the stored item back
  (`src/components/creation/article-ai-dialog.tsx:118`) instead of its title, so 新增 / AI 生成 also opens
  the editor on what was just written rather than leaving the creator to find it by title in a list.
- **A link that cannot be opened says so** - `arEditorOpenFailed` in all three locales - instead of
  landing on an empty list.
- **Pinned by**: `src/lib/editor-link.test.ts` (the URL contract itself),
  `src/app/api/content/[id]/route.test.ts` (the read the editor depends on: the item, or a 404),
  `scripts/creator-editor-link-smoke.ts` (a real browser: the built link opens the item, leaving drops the
  parameter, a deleted item reports itself). The smoke needs a running server and does not click 生成 -
  that costs a real model call - so it navigates to exactly the href the wizard's JSX builds.
- **Untouched**: `/content/library` (question 4 above), the publish paths C2 did not take, the two generate
  routes (C3), the image resolver (C4), and everything in P5-B0.

### P5-C2 - assisted publish becomes a fact

The second slice. It closes the half of F-C0-2 / F-C0-8 that says the publish a creator performs writes
nothing, and that the same act has different histories depending on who performs it. Before this batch a
verified success existed only in `publish-run-panel`'s tab state: the `publish_records` row came from
`/api/publish` (a different flow, one-shot) and `content.status = posted` only from the threads worker, so
"the author published" and "the database knows" were unrelated events.

- **The fact lands at the completion of verify, and the identity is server-owned.** `/api/publish/draft`
  already *received* `contentItemId`/`contentType`/`method`/`terminal` from the panel - the schema accepted
  them and the destructure discarded them - so it now remembers them as a receipt on the session that
  performed the draft (`rememberPublishDraft`). `/api/publish/verify` is the only reader, and reading is
  taking (`takePublishReceipt`): the first verify that reports success consumes the receipt, and the polls
  that repeat while the dialog is still advancing find nothing left to record.
- **Two conditions, neither of them the client's word**: the check has to report success, *and* this
  process has to still hold the receipt of the draft that produced it. A success the server cannot
  attribute to a content item is reported to the dialog and writes nothing - the client may claim
  "published", it just cannot create a fact.
- **One module, two writes, no service.** `src/lib/publish-facts.ts` exports a single
  `recordPublishSuccess({ account, receipt, url, evidence, publishedAt })` that writes the
  `publish_records` row and then moves the item to `posted`. It does not open a browser, decide whether a
  publish happened, look an account up or know that a session exists; the layer order is Browser -> fact ->
  database, never fact -> browser. Title and type come from the draft receipt rather than a re-read of the
  item, because metric sync matches a platform post back to a record *by title* (`src/lib/metric-sync.ts`).
  The record is written first: it *is* the fact and `posted` is its consequence, so a failure in the
  second write leaves a record without a status move. A content item deleted between the draft and the
  verify keeps its record for the same reason - the publish still happened.
- **The row explains itself (D5).** The check is a heuristic - a URL that left the editor, or a success
  phrase - so `checkPublishResult` now also returns `evidence`, and the record's `message` stores it
  verbatim: `session left the editor URL at <url>` / `success confirmation visible at <url>`. The database
  answers "why does this row say published" with the observation, instead of "the button said so".
- **Decisions taken for this slice**: **D1** the idempotency is the consumed receipt, not a unique index
  (single process, single user - the receipt's lifetime *is* the session's), which is *at-most-once per
  in-memory receipt*, said that way on purpose: taking before writing means a failed write loses the fact
  instead of duplicating it, and the alternative (peek, write, take) would need a unique index or a
  transactional claim to stay idempotent, which is a Publish Service question and not this slice's.
  **D2** a failed or discarded assisted run writes nothing; C2 establishes the success fact only.
  **D3** `posted` still removes an item from `findNextReadyContentItem`, which is the intended
  consequence. **D4** the threads worker is not wired in. **D5** the heuristic is accepted, with its
  evidence stored.
- **`contentItemId` is required for fact recording, and its absence fails safe.** A draft that names no
  content item still opens the editor and still returns 200, but leaves no receipt, so no verify can turn
  it into a fact: the caller that never had a content item stays untracked rather than acquiring a
  misleading record. Silent by design in C2 (no UI change) - a future non-library publish (a one-off post
  that belongs to no content item) is where this becomes a product question.
- **Known, accepted asymmetries after C2**: (1) the threads worker still reaches `posted` through
  `sleep(4000)` with no record - a weak signal that must not become a domain fact, so it waits for the
  automatic-workflow slice; (2) an assisted run that fails or is discarded leaves no trace at all, unlike
  the one-shot `/api/publish`, which writes `failed` rows; (3) that the heuristic can read a page the
  author navigated to as a success is now *visible* in the record it writes.
- **Pinned by**: `src/app/api/publish/verify/route.test.ts` (one success = exactly one record plus
  `posted`; a repeated poll adds nothing; a failed check writes nothing and does not spend the receipt;
  success without a receipt writes nothing; no session writes nothing; an item deleted after the draft
  keeps its record and loses only the status move) and
  `src/app/api/publish/draft/route.test.ts` (the receipt is remembered, only for a draft that names a
  content item, and only once). Both drive a fake session (`src/test/browser-session-fixture.ts`) instead
  of Playwright: the check reads a URL and a body text, and the receipt lives on the session object, so no
  browser, account or network is needed.
- **Untouched**: the database schema, every client component (the verify response gains one field and the
  request keeps its shape - `evidence` is additive, and the panel reads only `published` and `url`),
  `/api/publish` and its one-shot semantics, `src/lib/threads.ts`, the platform profiles, and all three
  locales.

## 8. Evidence index

- Generation: `src/app/api/content/generate/route.ts`, `src/app/api/ai-writing/generate/route.ts`,
  `src/app/api/content/import-url/route.ts`, `src/lib/scraper.ts`, `src/lib/ai-writing.ts`,
  `src/lib/ai/schemas.ts`.
- Writing UI: `src/components/creation/articles-workspace.tsx`,
  `src/components/creation/article-ai-dialog.tsx`, `src/components/creation/ai-writing/*`,
  `src/app/[locale]/(console)/content/library/page.tsx`.
- Idle duplicates: `src/components/content-type-workspace.tsx`,
  `src/components/generate-content-panel.tsx`.
- Images: `src/lib/article-images.ts`, `src/lib/image-library.ts`, `src/lib/artifact-image-url.ts`,
  `src/lib/agent/image-generation.ts`, `src/app/api/images/*`,
  `src/components/creation/image-source-picker.tsx`.
- Editing and saving: `src/components/creation/article-editor/*`, `src/lib/article-themes.ts`,
  `src/lib/content-images.ts`, `src/db/repository.ts:455-500`.
- Publishing: `src/lib/publish.ts`, `src/lib/browser-preview.ts`, `src/lib/account-health.ts`,
  `src/app/api/publish/*`, `src/components/creation/publish-run-panel.tsx`,
  `src/components/creation/content-publish-dialog.tsx`, `src/lib/threads.ts`, `src/worker/runner.ts`.
- The publish fact and its pins (added by C2, §7): `src/lib/publish-facts.ts`,
  `src/lib/browser-preview-session.ts` (`rememberPublishDraft` / `takePublishReceipt` /
  `checkPublishResult`), `src/app/api/publish/draft/route.test.ts`,
  `src/app/api/publish/verify/route.test.ts`, `src/test/browser-session-fixture.ts`.
- Records and metrics: `src/app/api/publish-records/route.ts`,
  `src/db/repositories/publish-records.ts`, `src/lib/metric-*.ts`, `src/lib/metrics.ts`.
- Reuse surfaces (the future Agent/Workflow/Template callers): `src/lib/agent/local-tools.ts`,
  `src/lib/agent/tool-registry.ts`, `src/lib/app-store-catalog.ts`, `src/app/api/app-store/route.ts`.

## 9. What this audit did not do

Sections 0-5 and 8 are the read-only audit: no product code, schema, API, translation or test was
written or changed by it; the only file that batch added is this document. No live publish was attempted
and no workspace was touched. Nothing in P5-B0 (`src/lib/workspace/*`, `/api/workspace/manifest`,
Workspace Overview) was reopened, and none of the findings above is scheduled by the audit itself - they
are inputs to the C-series decision, not a backlog.

§6 and §7 came after it and are the opposite kind of writing: the product owner's answers, and the C1
batch they unblocked. From here on this document is a decision record as well as an audit - re-read it
before assuming what the next slice is.
