import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `GET /api/research` and `POST /api/research` (CI-P3-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Two contracts are the point of this file. The *list* is exactly what the workspace filters, so `GET` is
 * one table read. And the *create* decides only what a payload can honestly decide - the effective kind and
 * whether there is text to write from - which is why the last case matters most: a body that claims a read
 * (`status: "ready"`, a `fetchedAt`, a reason) gets none of it, because reading a source is not something a
 * browser may assert.
 *
 * The temp database is pinned before the route is imported; the imports below are therefore `await`s.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-research-route-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "research.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { GET, POST } = await import("./route");
const { createResearchMaterial, listResearchMaterials } = await import("@/db/repositories/research");

const listUrl = "http://localhost/api/research";

function createRequest(body: unknown) {
  return new Request(listUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/research", () => {
  it("answers every material, newest edit first, so the screen can filter and search what it has", async () => {
    const empty = await GET();
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({ ok: true, data: [] });

    const created = await createResearchMaterial({ title: "桌面收纳研究报告" });

    const response = await GET();
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.map((row: { id: string }) => row.id)).toEqual([created!.id]);
  });
});

describe("POST /api/research", () => {
  it("creates the note the dialog sends, as text that is ready to write from", async () => {
    const response = await POST(
      createRequest({
        title: "夏季冰饮趋势",
        kind: "text",
        content: "冰饮最好卖的时候是七点以后。",
        tags: ["夜市"],
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({
      title: "夏季冰饮趋势",
      kind: "text",
      content: "冰饮最好卖的时候是七点以后。",
      sourceUrl: "",
      status: "ready",
      statusMessage: "",
      tags: ["夜市"],
      fetchedAt: null,
    });
    expect((await listResearchMaterials()).some((row) => row.id === payload.data.id)).toBe(true);
  });

  it("saves a link nobody has read as draft, which the screen words as 待读取", async () => {
    const response = await POST(
      createRequest({ title: "一篇待读的文章", kind: "url", sourceUrl: "https://example.com/summer" }),
    );

    await expect(response.json()).resolves.toMatchObject({
      data: { kind: "url", sourceUrl: "https://example.com/summer", status: "draft", content: "" },
    });
  });

  it("reads an omitted kind off the payload: a link is a link, and a payload without one is a note", async () => {
    const linked = await POST(createRequest({ title: "只有链接", sourceUrl: "https://example.com/a" }));
    await expect(linked.json()).resolves.toMatchObject({ data: { kind: "url", status: "draft" } });

    const noted = await POST(createRequest({ title: "只有正文", content: "一段资料" }));
    await expect(noted.json()).resolves.toMatchObject({ data: { kind: "text", status: "ready" } });
  });

  it("refuses a link material with no readable link, and writes nothing", async () => {
    const before = (await listResearchMaterials()).length;

    const missing = await POST(createRequest({ title: "没有链接的网页素材", kind: "url" }));
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });

    const unreadable = await POST(
      createRequest({ title: "本地路径不是来源", kind: "url", sourceUrl: "file:///tmp/a.html" }),
    );
    expect(unreadable.status).toBe(400);

    expect((await listResearchMaterials()).length).toBe(before);
  });

  it("refuses a title-less or unknown-kind payload instead of storing a half-material", async () => {
    const before = (await listResearchMaterials()).length;

    expect((await POST(createRequest({ title: "   " }))).status).toBe(400);
    // The kind vocabulary grew in CI-P3-02 — `audio` / `video` are what a transcription writes — so the
    // "unknown kind" case is a literal that is in no list at all. The create form still offers 文本 / 网页.
    expect((await POST(createRequest({ kind: "podcast", title: "标题" }))).status).toBe(400);

    expect((await listResearchMaterials()).length).toBe(before);
  });

  it("accepts the kinds a transcription writes, because they are stored kinds of this table now", async () => {
    const response = await POST(createRequest({ kind: "video", title: "一段视频素材" }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { kind: "video" } });
  });

  it("ignores a body that claims a read: 抓取成功 is not something a payload can state", async () => {
    const response = await POST(
      createRequest({
        title: "伪造一次抓取",
        kind: "url",
        sourceUrl: "https://example.com/a",
        status: "ready",
        statusMessage: "读取成功",
        fetchedAt: 1234,
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "draft", statusMessage: "", fetchedAt: null },
    });
  });

  it("answers a body that is not JSON with the payload guard, not a 500", async () => {
    const response = await POST(
      new Request(listUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "not json" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });
});
