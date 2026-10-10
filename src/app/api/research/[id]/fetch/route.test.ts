import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/research/[id]/fetch` (CI-P3-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * This is the only route that may say what reading a source produced, so every case here is about the three
 * outcomes being *earned* rather than assumed:
 *
 * - a page that answered with text → `ready`, that text stored, the read stamped;
 * - a page that answered without usable text → `empty`, the row's own text untouched (reading a page that
 *   says nothing is not evidence that the material has no text);
 * - a page that did not answer (HTTP 404, or a transport that threw) → `failed` with the reader's own
 *   reason, and neither the text nor the read time moved.
 *
 * The response is 200 in all three: the *attempt* succeeded and its outcome is on the record, which is what
 * "不得伪造抓取成功" asks for. The transport is stubbed through the shared harness, so the page really goes
 * through `fetchArticleText()` - the same reader the URL-import path uses.
 */
const { stubFetch, resetRuntime } = await import("@/test/route-harness");
const { POST } = await import("./route");
const { createResearchMaterial, getResearchMaterial, recordResearchFetch } =
  await import("@/db/repositories/research");

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const readSource = (id: string) =>
  POST(new Request(`http://localhost/api/research/${encodeURIComponent(id)}/fetch`, { method: "POST" }), params(id));

/**
 * A page the way the reader sees it: a title, an optional `og:image` and an `<article>` body. `text()` is
 * what `fetchArticleText()` calls, which is why this is not the harness's `jsonResponse`.
 */
function htmlResponse(html: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => html,
  } as unknown as Response;
}

const page = (title: string, body: string, image = "") =>
  `<!doctype html><html><head><title>${title}</title><meta property="og:image" content="${image}"></head>` +
  `<body><article>${body}</article></body></html>`;

const sourceUrl = "https://example.com/summer";

const matching = (respond: () => Response) => [{ match: (url: string) => url.startsWith(sourceUrl), respond }];

beforeEach(async () => {
  await resetRuntime();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/research/[id]/fetch", () => {
  it("records a successful read: the page's own text, its cover, and when it was read", async () => {
    stubFetch(matching(() => htmlResponse(page("夏季冰饮趋势", "冰饮最好卖的时候是七点以后。", "https://example.com/cover.png"))));
    const created = await createResearchMaterial({ title: "待读的网页", kind: "url", sourceUrl });

    const response = await readSource(created!.id);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({
      status: "ready",
      statusMessage: "",
      content: "冰饮最好卖的时候是七点以后。",
      imageUrl: "https://example.com/cover.png",
    });
    expect(typeof payload.data.fetchedAt).toBe("number");
    expect((await getResearchMaterial(created!.id))!.content).toContain("七点以后");
  });

  it("records a page that answered without usable text as empty, and keeps the row's own text", async () => {
    stubFetch(matching(() => htmlResponse(page("空页面", "   "))));
    const created = await createResearchMaterial({
      title: "手写过正文的来源",
      kind: "url",
      sourceUrl,
      content: "用户自己写的正文",
    });

    const response = await readSource(created!.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "empty", content: "用户自己写的正文", statusMessage: "" },
    });
  });

  it("records a page that did not answer as failed, with the reason and nothing else changed", async () => {
    stubFetch(matching(() => htmlResponse("not found", 404)));
    const created = await createResearchMaterial({ title: "读不到", kind: "url", sourceUrl });
    await recordResearchFetch(created!.id, { status: "ready", content: "上次读到的正文", fetchedAt: 1000 });
    const readAt = (await getResearchMaterial(created!.id))!.fetchedAt;

    const response = await readSource(created!.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "failed", statusMessage: "HTTP 404", content: "上次读到的正文", fetchedAt: readAt },
    });
  });

  it("records a transport that threw as failed too, instead of letting it escape as a 500", async () => {
    stubFetch(
      matching(() => {
        throw new Error("socket hang up");
      }),
    );
    const created = await createResearchMaterial({ title: "网络不通", kind: "url", sourceUrl });

    const response = await readSource(created!.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { status: "failed", statusMessage: "socket hang up" } });
  });

  it("refuses to read a material that has no readable source, without calling the page", async () => {
    const calls = stubFetch(matching(() => htmlResponse(page("不该被读到", "正文"))));
    const created = await createResearchMaterial({ title: "只有正文", kind: "text", content: "手写资料" });

    const response = await readSource(created!.id);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    expect(calls).toHaveLength(0);
    expect((await getResearchMaterial(created!.id))!.status).toBe("ready");
  });

  it("answers 404 for a material that is gone instead of reading on its behalf", async () => {
    const response = await readSource("no-such-material");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
