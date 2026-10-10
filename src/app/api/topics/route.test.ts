import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `GET /api/topics` and `POST /api/topics` (CI-P2-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The workspace's list is exactly what `GET` answers, and `POST` is the one write both the "New topic"
 * dialog and the hot-topic import use - so what it defaults matters: a topic created from a headline
 * arrives with a title, a source and a link and nothing else, and has to be usable (and archivable)
 * right away.
 *
 * The temp database is pinned before the route is imported; the imports below are therefore `await`s
 * (same three lines as `src/app/api/content/[id]/route.test.ts`).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-topics-route-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "topics.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { GET, POST } = await import("./route");
const { createTopic, listTopics } = await import("@/db/repositories/topics");

const listUrl = "http://localhost/api/topics";

function createRequest(body: unknown) {
  return new Request(listUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/topics", () => {
  it("answers every topic, so the screen can filter and search what it has", async () => {
    const empty = await GET();
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({ ok: true, data: [] });

    const created = await createTopic({ title: "桌面收纳指南" });

    const response = await GET();
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.map((row: { id: string }) => row.id)).toEqual([created!.id]);
  });
});

describe("POST /api/topics", () => {
  it("creates the topic the import sends and answers it with a 201", async () => {
    const response = await POST(
      createRequest({
        title: "夏季美食趋势",
        source: "微博",
        sourceUrl: "https://example.com/hot/summer",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({
      title: "夏季美食趋势",
      source: "微博",
      sourceUrl: "https://example.com/hot/summer",
      description: "",
      keywords: [],
      status: "active",
      contentItemId: null,
    });
    expect((await listTopics()).some((row) => row.id === payload.data.id)).toBe(true);
  });

  it("refuses a topic without a title, and writes nothing", async () => {
    const before = (await listTopics()).length;

    const blank = await POST(createRequest({ title: "   ", source: "微博" }));
    expect(blank.status).toBe(400);
    await expect(blank.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });

    const missing = await POST(createRequest({ source: "微博" }));
    expect(missing.status).toBe(400);

    // A status the archive action cannot write is not a status this route accepts.
    const unknownStatus = await POST(createRequest({ title: "标题", status: "deleted" }));
    expect(unknownStatus.status).toBe(400);

    expect((await listTopics()).length).toBe(before);
  });

  it("answers a body that is not JSON with the payload guard, not a 500", async () => {
    const response = await POST(
      new Request(listUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "not json" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });
});
