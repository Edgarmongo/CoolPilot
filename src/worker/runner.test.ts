import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `worker/runner.ts` at the *step* boundary (CI-P7-03), where the per-call gate cannot reach - with the
 * answer CI-P7-03-B settled on: a refusal at a step *pauses* the run on a checkpoint instead of failing it.
 *
 * A playbook's request does not exist when the run starts - `topic_article_generator` builds its prompt
 * inside `generateTopicPost()`, an import builds one per URL - so there is nothing to estimate and
 * nothing to hold. The question this gate answers is the only one that is true at that moment: does this
 * period still have budget at all. The cases below pin what that boundary promises:
 *
 *  1. an AI playbook is refused **before** its first request is built, and the refusal is recorded as the
 *     run's own pause: `status: "paused"`, no `finishedAt`, no `error` event, and one `warn` event
 *     carrying the checkpoint in the run's own log. A run that is going to continue is not a run that
 *     failed (`RunStatus.paused`), and the failure wording is the one thing a resume could not retract.
 *     Zero transport calls is the proof, and it is why the assertion is on the wire rather than on a mock.
 *  2. the gate is per *step*, not per *run*: `article_scraper_rewriter` with `rewrite: true` is refused
 *     at the head of its URL iteration (before the page is even fetched) with *that URL* as its
 *     checkpoint, while `rewrite: false` - an import that spends nothing - completes under the very same
 *     refusing budget. A run refused for a budget it never touches would be this gate inventing a rule.
 *  3. the checkpoint is what a resume consumes: the two writes `POST /api/runs/[id]/resume` makes put the
 *     run back in the claimer's queue, and `processRun` re-enters at the recorded step, so the URL the
 *     pause had already finished is neither fetched nor imported a second time.
 *  4. the failure path is untouched - an error that is *not* a refusal still fails the run, with an
 *     `error` event and a `finishedAt`, exactly as it did before the pause existed.
 *
 * The chain under test is the worker's own - `createRun` -> `processRun` -> `beginAiBudgetNode` -> the
 * playbook - so no route is involved and this file imports no `Request` helper. Only the transport is
 * stubbed. Nothing here asserts that a mock was called.
 */
const { allowEveryAiBudgetCall, refuseEveryAiBudgetCall, resetRuntime, stubFetch } = await import("@/test/route-harness");
const { processRun } = await import("./runner");
const {
  appendRunEvent,
  createRun,
  getRun,
  listContentItems,
  listRunEvents,
  markRunPaused,
  updateRunStatus,
} = await import("@/db/repository");
const {
  budgetPauseEventData,
  budgetPauseMessage,
  budgetPauseOf,
  budgetResumeEventData,
  budgetResumeMessage,
  readBudgetPauseMarker,
} = await import("@/lib/run-budget-pause");

/** The runner's own sentence when the *step* gate refuses: the run stands still, it does not fail. */
const pauseWording = "The AI budget refused the next step, so this run is paused";

const sourceUrl = "https://example.com/posts/desk";
const pageTitle = "桌面收纳指南";
const pageMarker = "先清空桌面，再按手感分区。";

/**
 * A page as `fetchArticleText()` reads it: it calls `text()` and hands the HTML to cheerio, so the stub
 * carries a `text()` and the meta tag the scraper reads a title from. `jsonResponse()` from the harness
 * cannot be reused here - it answers `json()`.
 */
const htmlResponse = (html: string, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => html,
  }) as unknown as Response;

const pageHtml = [
  "<html><head>",
  `<meta property="og:title" content="${pageTitle}" />`,
  "</head><body>",
  `<article><p>${pageMarker}</p></article>`,
  "</body></html>",
].join("");

const htmlRoutes = [{ match: (url: string) => url === sourceUrl, respond: () => htmlResponse(pageHtml) }];

/** A second page, for the import that resumes: the URL the pause had *not* reached yet. */
const resumedUrl = "https://example.com/posts/drawer";
const resumedTitle = "抽屉收纳指南";
const resumedPageHtml = pageHtml.replace(pageTitle, resumedTitle);

const resumeRoutes = [
  { match: (url: string) => url === sourceUrl, respond: () => htmlResponse(pageHtml) },
  { match: (url: string) => url === resumedUrl, respond: () => htmlResponse(resumedPageHtml) },
];

async function mustCreateRun(input: Parameters<typeof createRun>[0]) {
  const run = await createRun(input);
  if (!run) throw new Error("run was not created");
  return run;
}

/** How many content items exist right now, so a case can tell "nothing was created" from a number. */
async function contentItemCount() {
  return (await listContentItems({ pageSize: 20 })).total;
}

beforeEach(async () => {
  // The shipped default is `off`; a case that wants a refusal states it itself, and this puts it back.
  await allowEveryAiBudgetCall();
  await resetRuntime();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the CI-P7-03 step gate in the worker", () => {
  it("refuses an AI playbook before its first request, and pauses the run on that checkpoint", async () => {
    await refuseEveryAiBudgetCall();
    const calls = stubFetch([]);
    const itemsBefore = await contentItemCount();

    const run = await mustCreateRun({ playbookId: "topic_article_generator", params: { topic: "换季收纳" } });
    await processRun(run);

    const after = await getRun(run.id);
    // CI-P7-03-B: the refusal is a *pause*. `RunStatus.paused` "is a state, not a failure" - the run is
    // standing still between steps and is going to continue - so `markRunPaused` clears `finished_at`
    // instead of stamping it, and the record carries no finish time.
    expect(after?.status).toBe("paused");
    expect(after?.finishedAt).toBeUndefined();
    // The gate's own arithmetic reaches the run log, so a stopped run says *why* it stopped.
    expect(after?.resultMessage).toContain(pauseWording);
    expect(after?.resultMessage).toContain("over-limit");
    // Nothing was sent and nothing was created: the refusal happened before the prompt existed.
    expect(calls).toHaveLength(0);
    expect(await contentItemCount()).toBe(itemsBefore);

    const events = await listRunEvents(run.id);
    // `pauseRun` writes one `warn` event carrying the record and deliberately no `error` event: the
    // failure wording is the one thing a resume could not retract.
    expect(events.filter((event) => event.level === "error")).toHaveLength(0);
    const pauseEvents = events.filter((event) => event.data && "budgetPause" in event.data);
    expect(pauseEvents).toHaveLength(1);
    expect(pauseEvents[0]?.level).toBe("warn");
    expect(pauseEvents[0]?.message).toContain(pauseWording);

    // The checkpoint is readable from the run's own log - which is what makes this a resumable state and
    // not just a status word. The head gate runs before the playbook's first step, so that step is what a
    // resume re-attempts and nothing of the run was wasted.
    const pause = readBudgetPauseMarker(events).pause;
    if (!pause) throw new Error("the refusal left no budget checkpoint to resume from");
    expect(pause).toMatchObject({
      kind: "budget",
      gate: "node",
      purpose: "run:topic_article_generator",
      reason: "over-limit",
      limit: 0,
      pendingStep: "topic_article_generator",
      completedSteps: 0,
      stepIndex: null,
    });
    expect(after?.resultMessage).toContain(pause.pendingStep);
  });

  it("refuses the rewriting import at the head of its URL step, before the page is fetched", async () => {
    await refuseEveryAiBudgetCall();
    const calls = stubFetch(htmlRoutes);
    const itemsBefore = await contentItemCount();

    const run = await mustCreateRun({
      playbookId: "article_scraper_rewriter",
      params: { urls: sourceUrl, rewrite: true },
    });
    await processRun(run);

    const after = await getRun(run.id);
    expect(after?.status).toBe("paused");
    // A pause is not terminal: `markRunPaused` clears `finished_at`, so the record has no finish time.
    expect(after?.finishedAt).toBeUndefined();
    expect(after?.resultMessage).toContain(pauseWording);
    // The gate runs at the head of the iteration, so even the page read - which spends nothing - did not
    // happen. A refusal that still fetched would be a gate standing behind the thing it is guarding.
    expect(calls).toHaveLength(0);
    expect(await contentItemCount()).toBe(itemsBefore);

    // The checkpoint is the URL that was refused rather than the playbook, so a resume re-attempts *it*
    // and the URLs imported before it are not walked again.
    const pause = readBudgetPauseMarker(await listRunEvents(run.id)).pause;
    if (!pause) throw new Error("the refusal left no budget checkpoint to resume from");
    expect(pause).toMatchObject({
      gate: "node",
      purpose: "run:article_scraper_rewriter:url",
      pendingStep: sourceUrl,
      completedSteps: 0,
      stepIndex: 0,
    });
    expect(after?.resultMessage).toContain(sourceUrl);
  });

  it("lets the same import through when it rewrites nothing, under the very same refusing budget", async () => {
    await refuseEveryAiBudgetCall();
    const calls = stubFetch(htmlRoutes);
    const itemsBefore = await contentItemCount();

    const run = await mustCreateRun({
      playbookId: "article_scraper_rewriter",
      params: { urls: sourceUrl, rewrite: false },
    });
    await processRun(run);

    const after = await getRun(run.id);
    expect(after?.status).toBe("success");
    // Free steps are not gated, so the read really happened - and it is the only call on the wire.
    expect(calls.map((call) => call.url)).toEqual([sourceUrl]);
    expect(await contentItemCount()).toBe(itemsBefore + 1);

    const { items } = await listContentItems({ pageSize: 20 });
    expect(items[0]?.title).toBe(pageTitle);
    expect(items[0]?.sourceUrls).toContain(sourceUrl);
  });

  it("re-enters at the checkpoint a resume wrote instead of walking the list again", async () => {
    // CI-P7-03-B. The two writes the resume route makes: the marker, then the run back where the claimer
    // reads it (`POST /api/runs/[id]/resume`). `processRun` consumes exactly those, so this is the seam a
    // resumed import crosses - and `rewrite: false` keeps the case free of any model call.
    const calls = stubFetch(resumeRoutes);
    const itemsBefore = await contentItemCount();
    const run = await mustCreateRun({
      playbookId: "article_scraper_rewriter",
      params: { urls: [sourceUrl, resumedUrl].join("\n"), rewrite: false },
    });
    // What the pause left behind: one URL imported, and the second as the step that did not run.
    const pause = budgetPauseOf(null, {
      gate: "node",
      purpose: "run:article_scraper_rewriter:url",
      pendingStep: resumedUrl,
      completedSteps: 1,
      stepIndex: 1,
    });
    await appendRunEvent(run.id, budgetPauseMessage(pause), "warn", budgetPauseEventData(pause));
    await markRunPaused(run.id, budgetPauseMessage(pause));
    await appendRunEvent(run.id, budgetResumeMessage(pause), "info", budgetResumeEventData(pause, Date.now()));
    const resumed = await updateRunStatus(run.id, "queued", budgetResumeMessage(pause));
    if (!resumed) throw new Error("the resumed run was not written");
    // The runner reads the *newest* marker off the run's log, so the resume has to be the newest event.
    if (!readBudgetPauseMarker(await listRunEvents(run.id)).resume) {
      throw new Error("the resume marker is not the newest event on the run");
    }

    await processRun(resumed);

    const after = await getRun(run.id);
    expect(after?.status).toBe("success");
    expect(after?.resultMessage).toContain("resumed after 1");
    // The URL the pause had already finished is neither fetched nor imported twice.
    expect(calls.map((call) => call.url)).toEqual([resumedUrl]);
    expect(await contentItemCount()).toBe(itemsBefore + 1);
    const { items } = await listContentItems({ pageSize: 20 });
    expect(items[0]?.title).toBe(resumedTitle);
    expect(items[0]?.sourceUrls).toContain(resumedUrl);
  });

  it("still fails a run when the error is not a budget refusal", async () => {
    // The other half of the same boundary. The budget is off - the shipped default `beforeEach` restores -
    // so the step gate passes and the playbook's own missing parameter is what stops the run. A pause that
    // swallowed this would hide a real bug behind "waiting for the budget".
    const calls = stubFetch([]);
    const itemsBefore = await contentItemCount();

    const run = await mustCreateRun({ playbookId: "topic_article_generator", params: {} });
    await processRun(run);

    const after = await getRun(run.id);
    expect(after?.status).toBe("failed");
    expect(after?.finishedAt).toBeDefined();
    expect(after?.resultMessage).toBe("Missing topic");
    expect(calls).toHaveLength(0);
    expect(await contentItemCount()).toBe(itemsBefore);

    const events = await listRunEvents(run.id);
    expect(events.filter((event) => event.level === "error").map((event) => event.message)).toEqual(["Missing topic"]);
    // A failure is not a pause: there is nothing here a resume could continue from.
    expect(readBudgetPauseMarker(events)).toEqual({ pause: null, resume: null });
  });
});
