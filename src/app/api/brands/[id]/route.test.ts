import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `GET` / `PATCH` / `DELETE /api/brands/[id]` (CI-P2-02 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * Three contracts are pinned here because the two screens depend on each of them:
 *
 * - `GET` is how the wizard reads a brand back when a saved config carries its id, and a brand that is
 *   gone has to answer 404 so the run says "no brand" instead of writing as somebody else's.
 * - `PATCH` is the editor's save: one edit, and nothing the payload did not mention moves with it - so
 *   saving a tone never silently clears the banned list that reaches the model.
 * - `DELETE` removes the brand and only the brand: articles keep the id and version they recorded
 *   (P2-02-04), so a deletion does not rewrite history.
 *
 * The temp database is pinned before the route is imported; the imports below are therefore `await`s
 * (same three lines as `src/app/api/content/[id]/route.test.ts`).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-brand-route-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "brand.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { DELETE, GET, PATCH } = await import("./route");
const { createBrand, getBrand } = await import("@/db/repositories/brands");

/** The route as Next.js calls it: the `[id]` segment arrives as a promise the handler awaits. */
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const get = (id: string) => GET(new Request(`http://localhost/api/brands/${encodeURIComponent(id)}`), params(id));

function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/brands/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params(id),
  );
}

const remove = (id: string) =>
  DELETE(new Request(`http://localhost/api/brands/${encodeURIComponent(id)}`, { method: "DELETE" }), params(id));

describe("GET /api/brands/[id]", () => {
  it("answers the brand the wizard asked for, in the shape it renders", async () => {
    const created = await createBrand({
      name: "绿源海鲜",
      description: "深海捕捞，急冻锁鲜",
      targetAudience: "注重食材的年轻家庭",
      tone: "亲切具体",
      keywords: ["冷链"],
      bannedWords: ["最便宜"],
    });

    const response = await get(created!.id);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        id: created!.id,
        name: "绿源海鲜",
        description: "深海捕捞，急冻锁鲜",
        targetAudience: "注重食材的年轻家庭",
        tone: "亲切具体",
        keywords: ["冷链"],
        bannedWords: ["最便宜"],
      },
    });
  });

  it("answers 404 for a brand that is gone, which the run words as \"no brand\"", async () => {
    const response = await get("no-such-brand");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("PATCH /api/brands/[id]", () => {
  it("edits the fields the form sent and leaves the rest of the row alone", async () => {
    const created = await createBrand({
      name: "原标题",
      description: "保留简介",
      targetAudience: "保留受众",
      keywords: ["保留"],
      bannedWords: ["保留禁用"],
    });

    const response = await patch(created!.id, { name: "新名称", tone: "轻松口语" });

    await expect(response.json()).resolves.toMatchObject({
      data: {
        name: "新名称",
        description: "保留简介",
        targetAudience: "保留受众",
        tone: "轻松口语",
        keywords: ["保留"],
        bannedWords: ["保留禁用"],
      },
    });
  });

  it("clears a list the form emptied, because an empty list is an edit and not an omission", async () => {
    const created = await createBrand({ name: "要清空", keywords: ["清掉"], bannedWords: ["留下"] });

    const response = await patch(created!.id, { keywords: [] });

    await expect(response.json()).resolves.toMatchObject({ data: { keywords: [], bannedWords: ["留下"] } });
  });

  it("refuses a name that empties the row, and 404s for a brand that is not there", async () => {
    const created = await createBrand({ name: "名称不能空" });

    const blank = await patch(created!.id, { name: "   " });
    expect(blank.status).toBe(400);
    await expect(blank.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
    // The row is untouched by a refused edit.
    expect((await getBrand(created!.id))!.name).toBe("名称不能空");

    const missing = await patch("no-such-brand", { tone: "无用" });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("DELETE /api/brands/[id]", () => {
  it("deletes the brand, answers that it did, and 404s on the second try", async () => {
    const created = await createBrand({ name: "待删除" });

    const response = await remove(created!.id);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { deleted: true } });
    expect((await get(created!.id)).status).toBe(404);

    const again = await remove(created!.id);
    expect(again.status).toBe(404);
    await expect(again.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
