import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `worker/runner.ts` at the *step* boundary (CI-P7-03), where the per-call gate cannot reach.
 *
 * A playbook's request does not exist when the run starts - `topic_article_generator` builds its prompt
 * inside `generateTopicPost()`, an import builds one per URL - so there is nothing to estimate and
 * nothing to hold. The question this gate answers is the only one that is true at that moment: does this
 * period still have budget at all. The cases below pin what that boundary promises:
 *
 *  1. an AI playbook is refused **before** its first request is built, and the refusal is recorded as
 *     the run's own failure with the runner's own wording - not as a provider error for a call that was
 *     never sent. Zero transport calls is the proof, and it is why the assertion is on the wire rather
 *     than on a mock.
 *  2. the gate is per *step*, not per *run*: `article_scraper_rewriter` with `rewrite: true` is refused
 *     at the head of its URL iteration (before the page is even fetched), while `rewrite: false` - an
 *     import that spends nothing - completes under the very same refusing budget. A run refused for a
 *     budget it never touches would be this gate inventing a rule.
 *
 * The chain under test is the worker's own - `createRun` -> `processRun` -> `beginAiBudgetNode` -> the
 * playbook - so no route is involved and this file imports no `Request` helper. Only the transport is
 * stubbed. Nothing here asserts that a mock was called.
 */
const { allowEveryAiBudgetCall, refuseEveryAiBudgetCall, resetRuntime, stubFetch } = await import("@/test/route-harness");
const { processRun } = await import("./runner");
const { createRun, getRun, listContentItems, listRunEvents } = await import("@/db/repository");

/** The one sentence that says a call was refused *instead of* being sent - the runner's failure text. */
const refusalWording = "The AI budget refused this call before it was sent";

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
  it("refuses an AI playbook before its first request, and records that as the run's own failure", async () => {
    await refuseEveryAiBudgetCall();
    const calls = stubFetch([]);
    const itemsBefore = await contentItemCount();

    const run = await mustCreateRun({ playbookId: "topic_article_generator", params: { topic: "换季收纳" } });
    await processRun(run);

    const after = await getRun(run.id);
    expect(after?.status).toBe("failed");
    // The gate's own arithmetic reaches the run log, so a stopped run says *why* it stopped.
    expect(after?.resultMessage).toContain(refusalWording);
    expect(after?.resultMessage).toContain("over-limit");
    // Nothing was sent and nothing was created: the refusal happened before the prompt existed.
    expect(calls).toHaveLength(0);
    expect(await contentItemCount()).toBe(itemsBefore);

    const errors = (await listRunEvents(run.id)).filter((event) => event.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain(refusalWording);
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
    expect(after?.status).toBe("failed");
    expect(after?.resultMessage).toContain(refusalWording);
    // The gate runs at the head of the iteration, so even the page read - which spends nothing - did not
    // happen. A refusal that still fetched would be a gate standing behind the thing it is guarding.
    expect(calls).toHaveLength(0);
    expect(await contentItemCount()).toBe(itemsBefore);
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
});
