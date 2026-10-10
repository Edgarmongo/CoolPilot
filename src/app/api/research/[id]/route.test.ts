import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `GET` / `PATCH` / `DELETE /api/research/[id]` (CI-P3-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Three contracts are pinned here, because three screens depend on each:
 *
 * - `GET` is how a generation entry reads the material it was handed (`researchMaterialId`), and a material
 *   that is gone has to answer 404 so the caller can say so instead of writing about nothing.
 * - `PATCH` is the edit dialog. It writes what the user owns and *nothing* about the read - a payload cannot
 *   claim a successful read, and the one case that has to move the read state (re-pointing the source url)
 *   drops that claim rather than leaving it attached to a different page.
 * - `DELETE` removes the material and only the material: an article generated from it recorded the material
 *   and its version in its own `metadata`, so deleting the library row does not rewrite history.
 *
 * The temp database is pinned before the route is imported; the imports below are therefore `await`s.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-research-item-route-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "research.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { DELETE, GET, PATCH } = await import("./route");
const { createResearchMaterial, recordResearchFetch } = await import("@/db/repositories/research");

/** The route as Next.js calls it: the `[id]` segment arrives as a promise the handler awaits. */
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const get = (id: string) => GET(new Request(`http://localhost/api/research/${encodeURIComponent(id)}`), params(id));

function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/research/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params(id),
  );
}

const remove = (id: string) =>
  DELETE(new Request(`http://localhost/api/research/${encodeURIComponent(id)}`, { method: "DELETE" }), params(id));

describe("GET /api/research/[id]", () => {
  it("answers the material a generation entry asked for, in the shape it renders", async () => {
    const created = await createResearchMaterial({
      title: "夏季冰饮趋势",
      kind: "text",
      content: "冰饮最好卖的时候是七点以后。",
      tags: ["夜市"],
    });

    const response = await get(created!.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { id: created!.id, title: "夏季冰饮趋势", content: "冰饮最好卖的时候是七点以后。", tags: ["夜市"] },
    });
  });

  it("answers 404 for a material that is gone, which the caller words instead of writing about nothing", async () => {
    const response = await get("no-such-material");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("PATCH /api/research/[id]", () => {
  it("edits the fields the form sent and leaves the rest of the row alone", async () => {
    const created = await createResearchMaterial({
      title: "原标题",
      kind: "text",
      content: "原正文",
      tags: ["保留"],
    });

    const response = await patch(created!.id, { title: "新标题", content: "新正文" });

    await expect(response.json()).resolves.toMatchObject({
      data: { title: "新标题", content: "新正文", tags: ["保留"], kind: "text", sourceUrl: "" },
    });
  });

  it("cannot write any read fact from a browser payload", async () => {
    const created = await createResearchMaterial({ title: "没有读过", kind: "url", sourceUrl: "https://example.com/a" });

    const response = await patch(created!.id, {
      status: "ready",
      statusMessage: "读取成功",
      fetchedAt: 1234,
      imageUrl: "https://example.com/fake.png",
    });

    await expect(response.json()).resolves.toMatchObject({
      data: { status: "draft", statusMessage: "", fetchedAt: null, imageUrl: "" },
    });
  });

  it("re-pointing the source drops the read claim but keeps the text the row already had", async () => {
    const created = await createResearchMaterial({
      title: "换一个来源",
      kind: "url",
      sourceUrl: "https://example.com/old",
    });
    // A real read, through the write the fetch entry uses: the row now carries the page's text and the time
    // it was read, which is the claim the next edit has to give up.
    await recordResearchFetch(created!.id, { status: "ready", content: "旧页面读到的正文", fetchedAt: 1700 });

    const response = await patch(created!.id, { sourceUrl: "https://example.com/new" });

    await expect(response.json()).resolves.toMatchObject({
      data: {
        sourceUrl: "https://example.com/new",
        // 已读取 no longer describes this record - the text is not known to come from the new page - so the
        // read time is cleared and the row says 正文就绪-without-a-read. The text itself stays: it is the
        // record's own material, and reading the new source is what replaces it.
        status: "ready",
        content: "旧页面读到的正文",
        fetchedAt: null,
      },
    });
  });

  it("re-pointing a source on a row with no text leaves it in 待读取", async () => {
    const created = await createResearchMaterial({
      title: "没有正文",
      kind: "url",
      sourceUrl: "https://example.com/old",
    });

    const response = await patch(created!.id, { sourceUrl: "https://example.com/new" });

    await expect(response.json()).resolves.toMatchObject({ data: { status: "draft", fetchedAt: null } });
  });

  it("refuses a title that empties the row, and 404s for a material that is not there", async () => {
    const created = await createResearchMaterial({ title: "标题不能空" });

    const blank = await patch(created!.id, { title: "   " });
    expect(blank.status).toBe(400);
    await expect(blank.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });

    const missing = await patch("no-such-material", { title: "无所谓" });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("DELETE /api/research/[id]", () => {
  it("deletes the material, answers that it did, and 404s on the second try", async () => {
    const created = await createResearchMaterial({ title: "待删除" });

    const response = await remove(created!.id);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { deleted: true } });
    expect((await get(created!.id)).status).toBe(404);

    const again = await remove(created!.id);
    expect(again.status).toBe(404);
    await expect(again.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
