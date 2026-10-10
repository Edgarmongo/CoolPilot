import { describe, expect, it } from "vitest";

/**
 * `POST /api/content` and the provenance key (CI-SC-01).
 *
 * The mind map's 存入内容库 goes through this route - the same one the article generators use - so the
 * canvas origin has to survive the schema. `contentCreateSchema` is a plain (non-strict) `z.object`, so a
 * key it does not know is dropped silently: before this card `source` would have vanished between the
 * canvas and the database, and the 来源 column would have read 手动录入 for a map nobody typed. One case
 * per direction of that contract: the default writes *no* key (so the metadata of every existing caller
 * - the article wizard, 动态创作, 影片创作, the manual form - stays byte-identical), and a named origin
 * is stored as sent.
 *
 * Temp database and env come from the harness, hence the `await` imports.
 */
const { jsonRequest } = await import("@/test/route-harness");
const { POST } = await import("./route");

const contentUrl = "http://localhost/api/content";
const create = (body: unknown) => POST(jsonRequest(contentUrl, body));

describe("POST /api/content provenance", () => {
  it("writes no source key when the caller records none", async () => {
    const response = await create({ title: "文章", type: "article" });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.metadata).toEqual({ type: "article", images: [] });
  });

  it("stores the origin when the caller names one, so the 来源 column can read it", async () => {
    const response = await create({ title: "导图", type: "article", source: "mindmap" });
    const payload = await response.json();

    expect(payload.data.metadata).toEqual({ type: "article", images: [], source: "mindmap" });
  });
});
