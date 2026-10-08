import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `GET /api/content/[id]` (P5-C1 of `docs/creator-workflow-audit.md`).
 *
 * The editor deep link (`?edit=<id>`, `src/lib/editor-link.ts`) opens exactly one item by id, and what
 * the workspace does with the answer is decided entirely by this contract: the stored item for an id
 * that exists, and a 404 - which the workspace words as "无法打开该文章" - for one that does not (a
 * stale link, a deleted item, a typo).
 *
 * The temp database is pinned before anything that reads it is imported, which is why the imports below
 * are `await`s (same three lines as `src/lib/metrics-repository.test.ts`).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-content-item-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "content.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { GET } = await import("./route");
const { createContentItem, deleteContentItem } = await import("@/db/repository");

/** The route as Next.js calls it: the `[id]` segment arrives as a promise the handler awaits. */
const get = (id: string) =>
  GET(new Request(`http://localhost/api/content/${encodeURIComponent(id)}`), { params: Promise.resolve({ id }) });

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
