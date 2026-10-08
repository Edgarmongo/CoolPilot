import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `api/content/import-url` on `aiRuntime` (batch P3-C of `docs/generate-migration-p3.md`).
 *
 * This route has two halves: reading the page (`lib/scraper.ts`'s `fetchArticleText()`) and the AI rewrite
 * behind it (`rewriteArticle()`). Batch A1 migrated the rewrite's *call* into the runtime but not this
 * route's error answer, because the route never had one - an exception left the handler and `apiClient` could
 * only report `Request failed with 500` from a body that was not this API's envelope. **P3-C (M2) adds it**,
 * and that is what these cases pin: the 201 contracts the route already had (with and without a rewrite), the
 * failure that used to escape, and the two shapes of AI failure that genuinely differ - the runtime's own
 * `AppError` (D-P3-3 passes its code and status on) and the scraper's `AI rewrite failed: …` wrapper for
 * everything else (D2-a keeps that wrapper, so a provider 5xx is still a flat 500 on this path).
 *
 * The chain under test is the real one - route handler, scraper, runtime, registry, router, key pool, adapter -
 * and only the *transport* is stubbed: the page, the catalog and the completion all arrive through `fetch`.
 *
 * P4 deleted the three legacy modules this file used to mock with a throwing factory (`@/lib/ai`,
 * `@/lib/ai/generate`, `@/lib/ai/compat`). The guard is structural now: reviving one of them fails
 * `tsc` and module resolution instead of a single test file (`docs/generate-migration-p3.md`, P4).
 */

/**
 * The harness pins the temp database and the keyless env before anything that reads them loads
 * (`src/test/route-harness.ts`), so it has to be the first `await` here.
 */
const {
  chatCalls,
  credentials,
  jsonReply,
  jsonRequest,
  prepareChatModel,
  qwenCatalog,
  resetRuntime,
  stubFetch,
  unavailable,
} = await import("@/test/route-harness");
const { POST } = await import("./route");
const { listContentItems, listUsageRecords } = await import("@/db/repository");
const { countTextCharacters } = await import("@/lib/usage");

const importUrl = "http://localhost/api/content/import-url";
const sourceUrl = "https://example.com/posts/desk";

const post = (body: unknown) => POST(jsonRequest(importUrl, body));

/**
 * A page as `fetchArticleText()` reads it: it calls `text()` and hands the HTML to cheerio, so the stub
 * carries a `text()` and the meta tags the scraper looks for. `jsonResponse()` from the harness cannot be
 * reused here - it answers `json()`.
 */
const htmlResponse = (html: string, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => html,
  }) as unknown as Response;

const pageTitle = "桌面收纳指南";
const pageMarker = "先清空桌面，再按手感分区。";
const pageImage = "https://cdn.example.test/cover.png";
const pageHtml = [
  "<html><head>",
  `<meta property="og:title" content="${pageTitle}" />`,
  `<meta property="og:image" content="${pageImage}" />`,
  "</head><body>",
  `<article><p>${pageMarker}</p><p>常用的放在手边。</p></article>`,
  "</body></html>",
].join("");

/** What the model answers on the structured channel this route asks for. */
const draftTitle = "桌面收纳三步走";
const draftBody = "清空桌面、按手感分区、常用的放手边。";

/**
 * The three routes one successful import needs: the page, the provider's catalog (read while the model is
 * prepared) and the completion. `stubFetch` answers an unplanned call with a loud 404, so a case that expects
 * no model call proves it by asserting on `chatCalls` - and on the recorded call count - not on silence.
 */
const successfulRoutes = () => [
  { match: (target: string) => target.startsWith("https://example.com"), respond: () => htmlResponse(pageHtml) },
  { match: (target: string) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
  {
    match: (target: string) => target.includes("/chat/completions"),
    respond: () => jsonReply({ title: draftTitle, body: draftBody }),
  },
];

/** How many content items the database holds - a failure must not leave a half-imported one behind. */
async function itemCount() {
  return (await listContentItems({ pageSize: 1 })).total;
}

describe("POST /api/content/import-url on aiRuntime", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetRuntime();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("imports the page and answers 201 with the rewritten draft, its usage row and the runtime's provider", async () => {
    const calls = stubFetch(successfulRoutes());
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");

    const response = await post({ url: sourceUrl });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.data.item).toMatchObject({
      title: draftTitle,
      status: "ready",
      sourceUrls: [sourceUrl],
      // The page's own image is kept as the draft's image, which is what the article editor renders.
      imagePath: pageImage,
    });
    expect(payload.data.item.body).toContain(draftBody);
    expect(payload.data.item.postReadyText).toContain(draftTitle);
    expect(payload.data.item.postReadyText).toContain(draftBody);
    expect(payload.data.item.metadata).toMatchObject({
      provider: "qwen",
      model: "qwen3-max",
      generationType: "url_rewrite",
      sourceTitle: pageTitle,
    });

    // One completion, and it was given the flattened page (no markup) rather than the raw HTML.
    expect(chatCalls(calls)).toHaveLength(1);
    expect(JSON.stringify(chatCalls(calls)[0].init?.body)).toContain(pageMarker);
    expect(JSON.stringify(chatCalls(calls)[0].init?.body)).not.toContain("<p>");
    expect(calls.filter((call) => call.url === sourceUrl)).toHaveLength(1);

    // One usage row for the rewrite, filed under the item and quoting the runtime's tokens.
    const usage = (await listUsageRecords({ limit: 10 })).find((row) => row.contentItemId === payload.data.item.id);
    expect(usage).toMatchObject({
      provider: "qwen",
      model: "qwen3-max",
      kind: "article",
      status: "success",
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      wordCount: countTextCharacters(payload.data.item.postReadyText),
    });
  });

  it("skips the model entirely when the request asks for no rewrite, and books no usage", async () => {
    const calls = stubFetch(successfulRoutes());

    const response = await post({ url: sourceUrl, rewrite: false });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.item.title).toBe(pageTitle);
    expect(payload.data.item.body).toContain(pageMarker);
    expect(payload.data.item.metadata).toMatchObject({
      provider: "local",
      model: "none",
      generationType: "url_import",
    });
    // No model was prepared and none was asked for: the page is the only request this case makes.
    expect(chatCalls(calls)).toHaveLength(0);
    expect(calls).toHaveLength(1);
    const usage = (await listUsageRecords({ limit: 10 })).find((row) => row.contentItemId === payload.data.item.id);
    expect(usage).toBeUndefined();
  });

  it("answers 500 UNKNOWN_ERROR when the page cannot be read, instead of escaping with no envelope", async () => {
    const calls = stubFetch([
      { match: (target: string) => target.startsWith("https://example.com"), respond: () => htmlResponse("", 404) },
    ]);
    const before = await itemCount();

    const response = await post({ url: sourceUrl });
    const payload = await response.json();

    // Before P3-C this exception left the handler: the client's `apiPost` could not parse the body and
    // reported `Request failed with 500`, losing the one fact that explains the failure.
    expect(response.status).toBe(500);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("UNKNOWN_ERROR");
    expect(payload.message).toBe("HTTP 404");
    expect(payload.error).toBe(payload.message);
    // A page that would not load is not an `AppError`, so there is nothing for `details` to carry.
    expect(payload.details).toBeUndefined();
    expect(chatCalls(calls)).toHaveLength(0);
    expect(await itemCount()).toBe(before);
  });

  it("answers the runtime's own 400 MODEL_CREDENTIAL_MISSING when the rewrite has no usable key", async () => {
    const calls = stubFetch(successfulRoutes());
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    // The user removed the key after the model had been discovered.
    await credentials.clearCredential(credentials.credentialRefFor("qwen"));
    const before = await itemCount();

    const response = await post({ url: sourceUrl });
    const payload = await response.json();

    // `rewriteArticle()` lets the credential family through unwrapped (A1) *and* this route passes its status
    // on (P3-C), so the UI can tell the user to fix the key instead of retrying the import.
    expect(response.status).toBe(400);
    expect(payload.code).toBe("MODEL_CREDENTIAL_MISSING");
    expect(payload.details.reason).toBe("credential-missing");
    expect(payload.message).not.toContain("sk-");
    expect(chatCalls(calls)).toHaveLength(0);
    // The page was read, but a rewrite that never happened must not produce an item.
    expect(await itemCount()).toBe(before);
  });

  it("answers 500 UNKNOWN_ERROR for a provider failure, keeping the scraper's own wrapper (D2-a)", async () => {
    const calls = stubFetch([
      { match: (target: string) => target.startsWith("https://example.com"), respond: () => htmlResponse(pageHtml) },
      { match: (target: string) => target.includes("dashscope") && target.endsWith("/models"), respond: qwenCatalog },
      { match: (target: string) => target.includes("/chat/completions"), respond: unavailable },
    ]);
    await prepareChatModel("qwen", "qwen3-max", "sk-stub-qwen");
    const before = await itemCount();

    const response = await post({ url: sourceUrl });
    const payload = await response.json();

    // The runtime's `MODEL_UPSTREAM_FAILED` is a 502, but `lib/scraper.ts` converts every non-credential
    // failure into `new Error("AI rewrite failed: <the runtime's message>")`, and P3-C deliberately leaves that
    // alone (D2-a: the scraper's error contract is its own follow-up, not this batch). What P3-C changed is
    // that the message arrives in an envelope at all - and that the choice is pinned, so a later D2-b has a
    // failing test to update rather than a silent behaviour change.
    expect(response.status).toBe(500);
    expect(payload.code).toBe("UNKNOWN_ERROR");
    expect(payload.message).toContain("AI rewrite failed");
    expect(payload.message).toContain("HTTP 503");
    expect(payload.details).toBeUndefined();
    expect(chatCalls(calls)).toHaveLength(1);
    expect(await itemCount()).toBe(before);
  });

  it("keeps its own message-only 400 for a payload it cannot use, and reads no page", async () => {
    const calls = stubFetch(successfulRoutes());

    const missing = await post({});
    const notAUrl = await post({ url: "not a url" });
    const missingPayload = await missing.json();

    expect([missing.status, notAUrl.status]).toEqual([400, 400]);
    // `fail("Invalid URL import payload", 400, …)` words a message, not an `AppErrorCode`, so the code stays
    // `UNKNOWN_ERROR` - the long-standing wart this route shares with `rewrite`'s `EMPTY_CONTENT`, pinned so a
    // later cleanup is a conscious change.
    expect(missingPayload.code).toBe("UNKNOWN_ERROR");
    expect(missingPayload.message).toBe("Invalid URL import payload");
    expect(missingPayload.details).toBeDefined();
    // Validation happens before the page is read: the stub would have answered a fetch loudly.
    expect(calls).toHaveLength(0);
  });
});

