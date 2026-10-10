# Assisted Publishing Engine - the product model, and the C2-1 slice

Status: **shipped**. §1-§9 are the design; §10 records what the C2-1 slice delivered - C2-1a to C2-1d,
measured against a real 小红书 publish - so the two can be read against each other. It is the companion
to `docs/creator-workflow-audit.md` (the C0 audit; C1 and C2 shipped, C3 sliced) and answers a narrower
question than that audit does: *what is the assisted-publish feature actually selling, and what must the
code therefore be a fact about?*

---

## 1. The failure that forced this document

Measured, not hypothesised. `smoke2.db`, between 02:57 and 03:24: **two** `publish_records` rows with
`status = 'published'` for notes that do not exist, written with two *different* URLs and the same
`message`:

| record | `url` | `contentItemId` | verdict |
| --- | --- | --- | --- |
| `Pwv6r3_bAN7OvkDMFYcIh` | `https://creator.xiaohongshu.com/publish/publish?from=menu&target=video` | `SJgUewb8eMXIMHukfIkSp` | false - that **is** the editor URL |
| `LOHQAgUF2_s_GECxtnWyn` | `https://creator.xiaohongshu.com/new/home` | `8N9KmupCc2X1fFnQl1_tY` | false - that is 小红书's creator home |

Both items were moved to `posted` on the strength of those rows. Both rows have since been retracted
through the product's own `DELETE /api/publish-records/[id]`, and both items were returned to `ready`.

Read together, the two rows say one thing: **a single predicate - "the live page is no longer the draft's
editor URL" - authorized a fact in two different worlds.** In the first, the page never left the editor
(`looksLikeEditorUrl` did not match 小红书's editor path, now fixed in `leftDraftPage`). In the second, the
page left for the creator home - and that one is not fixable *as a predicate*, because leaving the editor
is exactly what a successful publish does, and also what dropping a draft, idling out, clicking the
platform's own home button, closing the cover dialog and being navigated away all do. Nothing in the
observation distinguishes them; only the platform's own statement does.

Supporting measurements from the same runs:

- `/api/publish/draft` never writes to the database. The row came from the run panel's own 2.5 s
  `/api/publish/verify` poll (`publish-run-panel.tsx`), i.e. from the app's normal loop, not from the
  smoke driver.
- Both rows were written within about a second of a navigation the app did not perform. The session owns
  **one** page and that page is repointable by several actors that all pass through it: `activatePage`,
  `getReadySitePage`, every `runSiteBrowserTool` call, and the author's own forwarded input
  (`/api/browser-profiles/[id]/input`). Which one moved it in run C could not be recovered after the fact
  - the session had been torn down - which is itself a finding (§6, C2-1c).
- The claim landed in exactly one place, with the heuristic recorded in `message`. The row is the only
  trace; there is no attempt record to compare it against.

## 2. The product statement

> **一篇内容 → 平台适配 → 自动准备 → 人工最终确认 → 多平台发布 → 统一验证 → 统一记录**

What is being sold is not "AI clicked 发布 for you". It is that the author prepares once and then knows,
per platform, what actually happened. Two consequences the code has to honour:

1. **The last click stays human.** Assisted publishing is local-first and human-in-the-loop on purpose;
   the automation is preparation, adaptation and verification, not the irreversible act.
2. **A record is a fact, not a guess.** 发布记录 / 内容日历 / metrics are worth paying for only if a row
   means a note exists. One guessed row makes every row suspect - which is precisely the state §1
   produced, and why two items silently became un-publishable (`posted` removes an item from
   `findNextReadyContentItem`).

## 3. Vocabulary that already exists

The fact layer and the platform layer already exist and are tested. What is missing is everything
between them.

| concept | today | where |
| --- | --- | --- |
| the publish fact (the two writes that must not drift) | `recordPublishSuccess` | `src/lib/publish-facts.ts` |
| draft identity + where it was created | `PublishDraftReceipt`, `rememberPublishDraft`, `takePublishReceipt` | `src/lib/browser-preview-shared.ts`, `browser-preview-session.ts` |
| verification | `checkPublishResult` -> `PublishVerification { published: boolean; url; evidence }` | `src/lib/browser-preview-session.ts` |
| execution + per-platform DOM knowledge | `runSiteBrowserTool` + `PlatformPublishProfile` | `src/lib/browser-preview-session.ts`, `src/lib/publish-profiles.ts` |
| UI state | `RunStatus = queued / preparing / editing / published / discarded / failed` | `src/components/creation/publish-run-panel.tsx` |
| storage | `publish_records` (`status` defaults to `queued`), `content_items.status` (`draft / ready / posted / failed`) | `src/db/client.ts`, `src/lib/types.ts` |

Missing:

1. **No outcome vocabulary.** `PublishVerification.published` is binary and the verify route turns
   `true` into a `publish_records` row. There is no way for the server to say "something moved but I
   cannot tell you a post exists".
2. **A prepared draft carried no evidence that anything was prepared** - closed by C2-1a (§10). The
   configured path returned `drafted: true` for any run that did not throw, and the 小红书-named tool
   computed `drafted = Boolean(titleInput || bodyInput)`, so "the editor is open" and "the draft is
   filled" were the same thing to everyone downstream. Measured: on 小红书 the prefill matched neither
   the title nor the content field (`(none)` for both in the run's own log) and the run still handed the
   author a 待编辑发布 tab to finish.
3. **No attempt record.** A failed or discarded assisted run leaves no trace (audit §7, accepted
   asymmetry 2). Accepted here too, for C2-1.

## 4. States

```
                  verify: strong signal
ready ──► draft_prepared ──► waiting_user ──► published   (fact written)
              │                    │
              │                    └──► verify_unknown    (nothing written)
              └──► draft_failed    (author sees it; nothing written)
```

Mapped onto what the panel has today: `preparing` -> `draft_prepared` (its evidence is the receipt),
`editing` -> `waiting_user`, `published` -> written fact, `discarded`/`failed` -> `draft_failed`.
The evidence for `draft_prepared` is concrete since C2-1a (§10): the prefill's per-field
`PublishDraftEvidence` decides it, and a run whose page took nothing is `failed` in the panel rather than
an editor offered to the author - which is the first thing this diagram promised and the first thing the
code did not do.
`verify_unknown` is **new** and is the state that did not exist when §1 happened: the page moved, the
server has no strong signal, so the run stays in front of the author instead of writing a row.

Deliberately **not** built in C2-1: `PublishJob` as a stored object. A job is a session+UI concept for
now. The two fields a future job needs - the verification outcome and the draft-preparation evidence -
are introduced in this slice, so storing them later is additive rather than a rewrite.

## 5. Evidence: what authorizes a fact

| signal | strength | authorizes |
| --- | --- | --- |
| the page left the draft page | weak | `unknown` - reported, never written |
| the platform's own confirmation, seen live or **captured the moment it appeared** | strong | `published` |
| a URL that is itself a statement - a success screen, or a permalink namespace (`/post/<id>`, `/explore/<id>`, `/video/<id>`…) | strong | `published` |

Rules:

- strong signal -> write the fact (and the record carries the signal verbatim in `message`, as C2/D5
  already requires).
- weak signal only -> `verify_unknown`, **write nothing**, leave the author in control.
- no signal -> keep waiting.

The bias is one-sided on purpose. A false negative costs one row and one retry while the note still
exists; a false positive corrupts 发布记录, the content calendar, metric matching by title, and the
item's own status - and it is invisible, because the record looks exactly like a real one. §1 is what a
false positive costs, measured.

**Open no longer (§10, measured).** 小红书's publish left the author on
`https://creator.xiaohongshu.com/publish/success?source&bind_status=not_bind&__debugger__=&proxy=`, and the
record that landed names that page's own confirmation as its evidence (`success confirmation visible at
<that url>`) - signal 1 in §C2-1b, checked before the URL branch. The URL branch had the same answer
available: `/publish/success` matches `SUCCESS_URL_PATTERN`, so it is a success screen by signal 2 as well.
What `/new/home` is, is the *failure* landing page - the two are different pages, which is exactly the
question this paragraph could not answer before the run. 小红书 therefore needs no special case in the
URL branch, and the branch's list stays as narrow as it was.

**The other claim a run makes needs evidence too (C2-1a).** "Prepared" is not a fact about the world, but
it is a claim the panel shows and it used to be unfalsifiable: `drafted` was true for any prefill that did
not throw. It is now the page's answer *per piece of the draft*, so the three outcomes can be told apart:

| outcome | means | example |
| --- | --- | --- |
| `filled` | the page took what it was handed | the title input accepted the title |
| `empty` | the page was there and had nothing that could take it | 小红书's page matched no title field |
| `not_offered` | there was nothing to hand over | a text-only post has no video to upload |

A draft counts as prepared when the page took something **or** there was nothing to hand over at all. The
second half is the part worth stating: a media-only draft offers no title or text, so `not_offered` across
the board must not read as a failure, while an image the page refused (`media: empty`) must - it is a
draft the author has to finish by hand, and the panel now says so instead of showing an empty editor.

## 6. The C2-1 slice

The smallest change set that makes the model above true for 小红书, with no schema change and no new
route.

| # | change | files | pinned by |
| --- | --- | --- | --- |
| **C2-1a** | draft preparation reports evidence: `runConfiguredCreatePost` answers per piece of the draft (`DraftFieldOutcome = filled / empty / not_offered`), `draftPrepared` turns those into `drafted`; the receipt stores `drafted` + `evidence`; `/api/publish/draft` returns `drafted` / `evidence` / `loginRequired`; the panel fails a run whose page took nothing (`publishDraftEmpty`) or that needs a log-in, and shows the offered fields as chips beside the editor | `browser-preview-shared.ts`, `browser-preview-session.ts`, `api/publish/draft/route.ts`, `publish-run-panel.tsx`, locale resources | `api/publish/draft/route.test.ts`, `browser-preview-shared.test.ts`, `browser-preview-session.test.ts` |
| **C2-1b** | outcome vocabulary: `PublishVerification` gains `outcome: "waiting" / "published" / "unknown"` beside `evidence`; the verify route writes **only** on `published`; the panel renders `unknown` as its own chip and keeps polling | `browser-preview-session.ts`, `api/publish/verify/route.ts`, `publish-run-panel.tsx`, locale resources | `api/publish/verify/route.test.ts`, `browser-preview-session.test.ts` |
| **C2-1c** | navigation journal: the session records every `framenavigated` on the bound page with a timestamp and a cause tag (`boot` / `activate` / `tool:<name>` / `draft` / `user`), keeps the last N; `evidence` reports the window | `browser-preview-session.ts` | `browser-preview-session.test.ts` |
| **C2-1d** | teardown guard: `liveRuns` / `runTeardownNeedsConfirm` over the shared `RunLifecycleStatus`; the panel routes its 关闭 through `onRequestClose` and reports its tab statuses up; the dialog asks before abandoning a live run (`publishCloseConfirm` / `publishCloseStay` / `publishCloseAbandon`) and stays the only place that deletes a draft | `src/lib/publish-run-teardown.ts` (new), `publish-run-panel.tsx`, `content-publish-dialog.tsx`, locale resources | `src/lib/publish-run-teardown.test.ts` |

C2-1c has two jobs, and the second is why it is in this slice rather than filed as nice-to-have: it pins
the `/new/home` navigator on the next run (run C's artifacts cannot), **and** it is the "navigation
evidence" the model wants to store - so the record can answer "why did you think so" with an actual
sequence instead of one URL.

## 7. What this slice deliberately does not build

No `PublishJob` table, no `PublishAdapter` interface, no multi-platform fan-out, no automatic publish,
no schema change, no new route, no user-facing documentation (nothing public has shipped). The adapter
seam is worth extracting when a *second* platform's preparation differs in a way `PlatformPublishProfile`
cannot express; writing the interface before that would encode 小红书's shape into it - the same mistake
that put 小红书's editor path outside `looksLikeEditorUrl` in the first place.

## 8. Acceptance: the C2 smoke, intent unchanged

Baseline after the §1 repair: **0** `publish_records` rows, four content items `ready`. Then:

1. Drive one content item to `waiting_user` with a genuine 小红书 video draft (title + body + media
   evidence true, per C2-1a).
2. A human clicks 发布 inside the live preview.
3. Assert, from the database: `publish_records` **0 -> 1**; the new row's `contentItemId` is the item the
   run used; its `url` is neither the editor URL nor `/new/home`; its `message` names the strong signal
   that authorized it; the item is `posted`.
4. Negative half, same session: a run that walks away from the editor writes nothing and, after C2-1b,
   reports `unknown` where the pre-C2-1 code would have reported `published`.

**Measured (§10).** Items 2 and 3 were run against 小红书 for a real post: `publish_records` went 0 -> 1,
the row (`chLJV5Wyo9qrUh7Af9GpQ`) belongs to the item that run used (`jGFZ4CJpqpD9WEd2f0hMD`, which then
went `posted`), its `url` is the platform's success screen and its `message` is `success confirmation
visible at <that url>` - neither the editor URL nor `/new/home`, and a message that names the signal. Two
differences from the *letter* of item 3 are worth keeping rather than smoothing over: the run used a
different content item than the id written down here when the smoke was planned, and 小红书 hands back a
success screen, not a note permalink - so "not the editor and not `/new/home`" is the assertion that
survives, while "a post URL" would have failed a run the model calls correct. Item 4 was pinned in the
harness (`api/publish/verify/route.test.ts`) rather than measured live; the live negative half is the next
smoke's job.

## 9. Evidence index

- The false facts and their messages: `publish_records` in the smoke workspace (`smoke2.db`), retracted;
  `message = "session left the editor URL at <url>"` on both.
- The live run that replaced them, same table: the single row `chLJV5Wyo9qrUh7Af9GpQ`
  (`content_item_id = jGFZ4CJpqpD9WEd2f0hMD`, `status = published`, `url` = the platform's success screen,
  `message = "success confirmation visible at <that url>"`), beside five content items - four `ready` and
  that one `posted`.
- The draft evidence: `src/lib/browser-preview-shared.ts` (`DraftFieldOutcome`, `PublishDraftEvidence`,
  `draftPrepared`, `offeredDraftFields`, `NO_DRAFT_HANDED_OVER`), pinned by
  `src/lib/browser-preview-shared.test.ts`.
- The teardown guard: `src/lib/publish-run-teardown.ts` (`RunLifecycleStatus`, `liveRuns`,
  `runTeardownNeedsConfirm`), pinned by `src/lib/publish-run-teardown.test.ts`.
- The predicate under repair: `src/lib/browser-preview-session.ts` (`leftDraftPage`,
  `checkPublishResult`, `notPublishedEvidence`, `runConfiguredCreatePost`, `runXiaohongshuCreatePost`,
  `activatePage`, `getReadySitePage`, `runSiteBrowserTool`).
- The fact layer: `src/lib/publish-facts.ts`; its decisions D1-D5 in `docs/creator-workflow-audit.md` §7.
- The routes: `src/app/api/publish/draft/route.ts`, `src/app/api/publish/verify/route.ts`,
  `src/app/api/publish-records/[id]/route.ts` (the retraction primitive used in §1).
- The UI state machine and its poll: `src/components/creation/publish-run-panel.tsx` (`RunStatus`,
  `setInterval(..., 2500)`), `src/components/creation/content-publish-dialog.tsx`.
- Harness: `vitest.config.ts` is `environment: "node"`, `include: ["src/**/*.test.ts"]` - no component
  test environment, which is why C2-1d's guard must be a pure function.

## 10. Shipped: the C2-1 slice

Implemented in two batches, because an outcome vocabulary is only as good as the evidence behind it, and a
per-field vocabulary is only as good as the guard that stops throwing the draft away.

**The outcome vocabulary (C2-1b).** `PublishVerification` now carries `outcome: "waiting" | "published" |
"unknown"` beside `published`, and `published` means exactly `outcome === "published"` - the field every
existing reader already asks for, so no caller had to change to keep working. `checkPublishResult`
answers in this order:

1. a confirmation the page is showing → `published` (`success confirmation visible at <url>`);
2. a page that left the draft for a statement-URL → `published`
   (`session left the editor URL at <url> (success page|post URL)`);
3. a confirmation captured inside this draft's window → `published`
   (`success confirmation "<text>" seen at <url> and captured when it appeared`);
4. a page that left the draft with none of the above → **`unknown`**
   (`left the draft page for a page that is not a post: <url> (navigation only: no platform confirmation)`);
5. anything else → `waiting`, with the evidence strings C2 already used.

The verify route writes only on `published`. The run panel gained the chip (`Unconfirmed` / 待确认 /
待確認), a line explaining it, and keeps polling: the live view, the typing controls and "discard & clear
draft" all stay available, because only the *claim* is withheld, not the author's session. The post-URL
list is the narrowest useful one and can only withhold a fact, never grant one - a landing URL that does
not match is `unknown`.

**The navigation journal (C2-1c).** Every main-frame navigation of a session page is recorded
(`{at, url, cause, detail, bodyExcerpt}`) and attributed to whoever announced it: `boot` / `activate` /
`draft:configured_create_post` / `tool:collect_metrics` / `user:key` / `platform` (the default for a
navigation nobody asked for). The journal is bounded (20 entries), is copied into the preview snapshot so
the smoke can read the trace, and reports two things at once:

- *what the page said while it was saying it*: an excerpt taken just after each navigation, plus a
  witness installed in the page itself (throttled `innerText` scans on DOM activity) that keeps the
  moment a confirmation appeared. This is what makes a two-second toast visible to a 2.5 s poll, and what
  makes "小红书 showed nothing" distinguishable from "our poll missed it" on the next run;
- *who moved the page*: the question run C's artifacts could not answer, because the session was gone.

**The draft evidence (C2-1a).** `runConfiguredCreatePost` now answers per piece of the draft instead of
once for the run: `DraftFieldOutcome = filled / empty / not_offered`, with `PublishDraftEvidence` over the
title, the text and the media (`DRAFT_FIELD_ORDER` is the order the prefill hands them over, and is what
both the panel's chips and the test suite read). `draftPrepared` sums those into the single `drafted`
boolean, which is what makes it a function rather than `some(filled)`: the page taking something *or*
nothing having been offered both count as prepared, and a run that offered content and had all of it
refused does not. The receipt (`PublishDraftReceipt`) carries `drafted` and `evidence` beside the
`editorUrl` C2 fix A added, so the record of what was prepared does not depend on the panel having read the
response. `/api/publish/draft` returns `drafted` / `evidence` / `loginRequired`, and the panel acts on
them: a log-in wall fails the run with `publishDraftLoginRequired`, `drafted === false` fails it with
`publishDraftEmpty` - the state the smoke measured as 待编辑发布 over an empty draft - and a prepared run
shows the offered fields as chips (`✗` for a piece the platform refused) right above the editor it is
asking the author to finish. `not_offered` pieces are left out of the chips rather than shown as failures;
`offeredDraftFields` is what does that filtering, so the panel has no policy of its own.

**The teardown guard (C2-1d).** `src/lib/publish-run-teardown.ts` holds the status vocabulary the panel
used to keep privately (`RunLifecycleStatus`, now including C2-1b's `unknown`) plus two pure predicates:
`liveRuns` counts preparing / editing / unknown tabs, and `runTeardownNeedsConfirm` asks whether that count
is nonzero. Settled runs (`published` / `discarded` / `failed`) and `queued` never need a question - there
is no session to lose, or nothing left to lose in it. The panel's 关闭 now goes through `onRequestClose` and
reports its statuses up via `onStatusesChange`; the dialog owns the decision, so `ContentPublishDialog`
shows `publishCloseConfirm` with `publishCloseStay` / `publishCloseAbandon` and stays the only place that
deletes a draft and stops the sessions. The helper being pure is not decoration: `vitest.config.ts` is
`environment: "node"` with `include: ["src/**/*.test.ts"]`, so a guard written inside the panel's JSX could
not be pinned at all.

**The real run.** With all four in, one assisted 小红书 run was driven end to end against a real post: the
prefill prepared the draft, the author published from the live view, and the verify wrote exactly one row -
`chLJV5Wyo9qrUh7Af9GpQ`, `status = published`, `url` = 小红书's success screen, `message = success
confirmation visible at <that url>` - while the content item went `ready` -> `posted`. That is §8 items 2
and 3: `publish_records` 0 -> 1, a row whose `contentItemId` is the item the run used, a URL that is
neither the editor nor `/new/home`, and a message that names the signal which authorized it.

**Pinned by** `src/app/api/publish/verify/route.test.ts` (a post URL and a success URL still publish; a
moved page with no statement is `unknown` and writes nothing; a confirmation captured in the journal and
one captured by the witness both publish; the editor, the tab switch and the `/new/home` landing keep
writing nothing; and every seeded receipt now carries the `drafted` / `evidence` a real one would),
`src/lib/browser-preview-shared.test.ts` (cause attribution and consumption, the bounded journal, the
copied snapshot, and the draft evidence: `draftPrepared` true on any `filled` or on all-`not_offered`,
false when everything offered was refused, `NO_DRAFT_HANDED_OVER` as the empty case, and
`offeredDraftFields` filtering and ordering), `src/app/api/publish/draft/route.test.ts` (the receipt keeps
`drafted` / `evidence` and the response reports them), and `src/lib/publish-run-teardown.test.ts` (live
statuses need confirm, settled and queued ones do not, and `liveRuns` counts them). Suite at the C2-1
freeze: 574 tests / 88 files, `tsc --noEmit` clean, `eslint .` at 0 errors and one warning - a
`react-hooks/exhaustive-deps` in `src/components/agent-chat/chat-conversation.tsx` that predates this
batch (`git status` has not touched that file).

**Still open**: the per-platform post-URL shapes (the adapter seam, §7), and one located twin deliberately
left alone - `verifyPublishResult` in `browser-preview-session.ts`, which serves the *automatic*
`publish: true` path and still reads "the URL changed" as published. It belongs to `/api/publish`'s own
contract and gets the same treatment when that path is sliced, rather than being changed silently here.
§8 item 4's negative half (a run that walks away from the editor) is pinned in the harness but has not been
measured live; that, and C4's asset identity, are the next slices.
