import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `GET` / `PATCH` / `DELETE /api/topics/[id]` (CI-P2-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Three contracts are pinned here because the screen depends on each of them:
 *
 * - `GET` is how the wizard reads the topic it was opened with (`/creation/ai-writing?topicId=...`), and
 *   a topic that is gone has to answer 404 so the wizard can say so instead of writing about nothing.
 * - `PATCH` is both the editor's save and the list's archive/restore button - one edit, and nothing the
 *   payload did not mention moves with it. `contentItemId` is deliberately not writable from here: the
 *   article a topic produced is recorded by the generation entry, not by whatever the browser sends.
 * - `DELETE` removes the topic and only the topic: the article it produced is a content item in its own
 *   right and stays where it is.
 *
 * The temp database is pinned before the route is imported; the imports below are therefore `await`s
 * (same three lines as `src/app/api/content/[id]/route.test.ts`).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-topic-route-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "topic.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { DELETE, GET, PATCH } = await import("./route");
const { createTopic } = await import("@/db/repositories/topics");

/** The route as Next.js calls it: the `[id]` segment arrives as a promise the handler awaits. */
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const get = (id: string) => GET(new Request(`http://localhost/api/topics/${encodeURIComponent(id)}`), params(id));

function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/topics/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params(id),
  );
}

const remove = (id: string) =>
  DELETE(new Request(`http://localhost/api/topics/${encodeURIComponent(id)}`, { method: "DELETE" }), params(id));

describe("GET /api/topics/[id]", () => {
  it("answers the topic the wizard asked for, in the shape it renders", async () => {
    const created = await createTopic({
      title: "夏季厨房降油烟",
      description: "从换锅开始讲",
      keywords: ["不粘锅"],
      source: "微博",
      sourceUrl: "https://example.com/hot/summer",
    });

    const response = await get(created!.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        id: created!.id,
        title: "夏季厨房降油烟",
        description: "从换锅开始讲",
        keywords: ["不粘锅"],
        source: "微博",
        sourceUrl: "https://example.com/hot/summer",
        status: "active",
        contentItemId: null,
      },
    });
  });

  it("answers 404 for a topic that is gone, which the wizard words as an empty start", async () => {
    const response = await get("no-such-topic");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("PATCH /api/topics/[id]", () => {
  it("archives and restores through the one field the list's button sends", async () => {
    const created = await createTopic({ title: "可以归档", keywords: ["保留"] });

    const archived = await patch(created!.id, { status: "archived" });
    expect(archived.status).toBe(200);
    await expect(archived.json()).resolves.toMatchObject({
      ok: true,
      data: { id: created!.id, status: "archived", title: "可以归档", keywords: ["保留"] },
    });

    const restored = await patch(created!.id, { status: "active" });
    await expect(restored.json()).resolves.toMatchObject({ data: { status: "active" } });
  });

  it("edits the fields the form sent and leaves the rest of the row alone", async () => {
    const created = await createTopic({ title: "原标题", source: "微博", keywords: ["保留"] });

    const response = await patch(created!.id, { title: "新标题", description: "补一段说明" });

    await expect(response.json()).resolves.toMatchObject({
      data: { title: "新标题", description: "补一段说明", source: "微博", keywords: ["保留"] },
    });
  });

  it("refuses a title that empties the row, and 404s for a topic that is not there", async () => {
    const created = await createTopic({ title: "标题不能空" });

    const blank = await patch(created!.id, { title: "   " });
    expect(blank.status).toBe(400);
    await expect(blank.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });

    const missing = await patch("no-such-topic", { status: "archived" });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("cannot write the article link from a browser payload", async () => {
    const created = await createTopic({ title: "关联只由生成入口写" });

    // The field is not in the PATCH schema, so it is stripped rather than honoured.
    const response = await patch(created!.id, { contentItemId: "item-forged" });

    await expect(response.json()).resolves.toMatchObject({ data: { contentItemId: null } });
  });
});

describe("DELETE /api/topics/[id]", () => {
  it("deletes the topic, answers that it did, and 404s on the second try", async () => {
    const created = await createTopic({ title: "待删除" });

    const response = await remove(created!.id);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { deleted: true } });
    expect((await get(created!.id)).status).toBe(404);

    const again = await remove(created!.id);
    expect(again.status).toBe(404);
    await expect(again.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
