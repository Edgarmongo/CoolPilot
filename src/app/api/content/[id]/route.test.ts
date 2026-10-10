import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `GET /api/content/[id]` (P5-C1 of `docs/creator-workflow-audit.md`) and `PATCH /api/content/[id]`,
 * which is what the article editor saves through.
 *
 * The editor deep link (`?edit=<id>`, `src/lib/editor-link.ts`) opens exactly one item by id, and what
 * the workspace does with the answer is decided entirely by this contract: the stored item for an id
 * that exists, and a 404 - which the workspace words as "无法打开该文章" - for one that does not (a
 * stale link, a deleted item, a typo).
 *
 * The PATCH cases are CI-P2-03's "保存草稿 / 重新打开" half: what a save changes, and what a save must
 * leave alone. An article that was generated with a topic and a brand carries them in `metadata`, and
 * `metadata` is not a field the editor owns - the save writes `themeId`, so the merge is the difference
 * between "the article still knows where it came from" and "editing it erased its provenance".
 *
 * The temp database is pinned before anything that reads it is imported, which is why the imports below
 * are `await`s (same three lines as `src/lib/metrics-repository.test.ts`).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-content-item-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "content.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { GET, PATCH } = await import("./route");
const { createContentItem, deleteContentItem, getContentItem } = await import("@/db/repository");

/** The route as Next.js calls it: the `[id]` segment arrives as a promise the handler awaits. */
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const get = (id: string) =>
  GET(new Request(`http://localhost/api/content/${encodeURIComponent(id)}`), params(id));

const patch = (id: string, payload: Record<string, unknown>) =>
  PATCH(
    new Request(`http://localhost/api/content/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
    params(id),
  );

const article = (title: string) =>
  createContentItem({
    title,
    body: `<p>${title} 的正文。</p>`,
    postReadyText: `${title} 的正文。`,
    sourceUrls: ["https://example.com/source"],
    imagePath: "cover.png",
    metadata: { type: "article", images: ["cover.png"] },
    status: "ready",
  });

describe("GET /api/content/[id]", () => {
  it("answers the stored item the id names, in the shape the editor opens", async () => {
    const created = await article("桌面收纳指南");

    const response = await get(created.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        id: created.id,
        title: "桌面收纳指南",
        body: "<p>桌面收纳指南 的正文。</p>",
        postReadyText: "桌面收纳指南 的正文。",
        imagePath: "cover.png",
        status: "ready",
        metadata: { type: "article", images: ["cover.png"] },
      },
    });
  });

  it("answers 404 for an id that is not there, which is the workspace's unopenable link", async () => {
    const response = await get("no-such-item");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("stops answering an item that has been deleted since the link was made", async () => {
    const created = await article("待删除文章");
    await deleteContentItem(created.id);

    const response = await get(created.id);

    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/content/[id] (the editor's save, CI-P2-03)", () => {
  /** An article as generation leaves it: written from a topic and as a brand, with one image. */
  const generated = () =>
    createContentItem({
      title: "生成的文章",
      body: "<p>初稿</p>",
      postReadyText: "初稿",
      sourceUrls: ["https://example.com/hot/desk-storage"],
      imagePath: "generated.png",
      metadata: {
        type: "article",
        generationType: "topic",
        topicId: "topic-1",
        brandId: "brand-1",
        brandVersion: 1_700_000_000_000,
        aiWriting: { brandId: "brand-1", articleStyle: "science" },
        images: ["generated.png"],
      },
      status: "ready",
    });

  it("saves what the editor changed and keeps what the article was generated from", async () => {
    const created = await generated();
    const editedBody = '<p>改写后的正文</p><img src="/api/agent/artifacts?file=picked.png">';

    const response = await patch(created.id, {
      title: "改过的标题",
      body: editedBody,
      postReadyText: "改写后的正文",
      // The editor's image list: the picked one becomes the cover, the generated one stays in the body.
      images: ["picked.png", "generated.png"],
      themeId: "lapis",
      status: "draft",
    });
    const saved = await response.json();

    expect(response.status).toBe(200);
    expect(saved.data).toMatchObject({
      title: "改过的标题",
      body: editedBody,
      status: "draft",
      // Clearing or reordering the list also moves the cover the publish pipeline reads.
      imagePath: "picked.png",
    });

    // Reopened through the route the deep link uses: what the editor reloads is what it saved.
    const reopened = await get(created.id);
    const item = (await reopened.json()).data;

    expect(reopened.status).toBe(200);
    expect(item).toMatchObject({
      title: "改过的标题",
      body: editedBody,
      postReadyText: "改写后的正文",
      imagePath: "picked.png",
      status: "draft",
      metadata: {
        // This save's own field...
        themeId: "lapis",
        images: ["picked.png", "generated.png"],
        // ...and the provenance it must not touch: the topic and brand the article was generated from,
        // the version of the brand at that moment, and the entry's own writing summary (CI-P2-03-03).
        type: "article",
        generationType: "topic",
        topicId: "topic-1",
        brandId: "brand-1",
        brandVersion: 1_700_000_000_000,
        aiWriting: { brandId: "brand-1", articleStyle: "science" },
      },
    });
    // The pages the images were resolved against survive the save as well.
    expect(item.sourceUrls).toEqual(["https://example.com/hot/desk-storage"]);
    expect((await getContentItem(created.id))?.metadata.topicId).toBe("topic-1");
  });

  it("answers 404 for an id that is not there instead of creating one", async () => {
    const response = await patch("no-such-item", { title: "无主标题" });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
