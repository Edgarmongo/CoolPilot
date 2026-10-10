import { describe, expect, it } from "vitest";

/**
 * The whiteboard's 匯出到內容庫 (CI-SC-01).
 *
 * The Drawnix dialog posts a title, a body and now a kind; the route stores the item. What this file
 * pins is the one thing the route got wrong before: `metadata.type` is the *only* key the console lists
 * filter on (`listContentItems()`, `?type=article` in 文章创作), and the route left it unset - so an
 * export appeared in 内容库 and in no list, which is how it also had no entry into the editor. The cases
 * below therefore assert reachability (`listContentItems({ type: "article" })` really returns it) and
 * not just the stored field, plus the two guard behaviours the fix introduced: an unusable kind falls
 * back to `article`, and a usable one is stored as sent (`post` must stay out of the article list).
 *
 * The database is the harness's temp one and the env is pinned before the route loads, which is why the
 * imports below are `await`s (`src/test/route-harness.ts`).
 */
const { jsonRequest } = await import("@/test/route-harness");
const { POST } = await import("./route");
const { PATCH } = await import("../[id]/route");
const { listContentItems } = await import("@/db/repository");

const whiteboardUrl = "http://localhost/api/content/whiteboard";
const save = (body: unknown) => POST(jsonRequest(whiteboardUrl, body));

/** The route as Next.js calls it: the `[id]` segment arrives as a promise the handler awaits. */
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** What the article editor sends when the user saves: the text it owns, nothing else. */
const editorSave = (id: string, body: unknown) =>
  PATCH(
    new Request(`http://localhost/api/content/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params(id),
  );

describe("whiteboard export into the content library", () => {
  it("stores an article the 文章创作 list can find and keeps the whiteboard as its origin", async () => {
    const response = await save({ title: "白板导出", body: "# 白板\n- 要点" });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.data.item.metadata).toEqual({ type: "article", source: "whiteboard" });
    expect(payload.data.item.status).toBe("draft");

    // The point of the card: the item is reachable through the same filter the article workspace uses.
    const listed = await listContentItems({ type: "article", pageSize: 20 });
    expect(listed.items.map((item) => item.id)).toContain(payload.data.item.id);
  });

  it("keeps the body as the publish text, so an export can go on to a draft unchanged", async () => {
    const response = await save({ title: "白板正文", body: "第一行\n第二行" });
    const payload = await response.json();

    expect(payload.data.item.body).toBe("第一行\n第二行");
    expect(payload.data.item.postReadyText).toBe("第一行\n第二行");
  });

  it("falls back to article for a kind no list could filter back out", async () => {
    const response = await save({ title: "非法类型", type: "White Board!" });
    const payload = await response.json();

    expect(payload.data.item.metadata).toEqual({ type: "article", source: "whiteboard" });
  });

  it("stores a usable kind as sent, which also means it stays out of the article list", async () => {
    const response = await save({ title: "动态", type: "post" });
    const payload = await response.json();

    expect(payload.data.item.metadata).toEqual({ type: "post", source: "whiteboard" });
    const listed = await listContentItems({ type: "article", pageSize: 20 });
    expect(listed.items.map((item) => item.id)).not.toContain(payload.data.item.id);
  });

  it("still answers the 201 envelope the Drawnix dialog reads, with its own default title", async () => {
    const response = await save({});
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.item.title).toBe("白板内容");
    expect(payload.data.item.metadata.source).toBe("whiteboard");
  });

  it("keeps type and source across an editor save, so an edited export stays in the article list", async () => {
    const created = await save({ title: "白板导出（待编辑）", body: "# 白板\n- 要点" });
    const createdPayload = await created.json();
    const id = createdPayload.data.item.id as string;

    // The editor's own save (PATCH /api/content/[id]) carries no type and no metadata at all - the
    // repository merges, so the provenance the export recorded has to survive it.
    const saved = await editorSave(id, { title: "白板导出（已编辑）", body: "<h1>白板</h1><p>要点</p>" });
    const savedPayload = await saved.json();

    expect(saved.status).toBe(200);
    expect(savedPayload.data.title).toBe("白板导出（已编辑）");
    expect(savedPayload.data.metadata).toEqual({ type: "article", source: "whiteboard" });

    const listed = await listContentItems({ type: "article", pageSize: 20 });
    expect(listed.items.map((item) => item.id)).toContain(id);
  });
});
