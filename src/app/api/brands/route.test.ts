import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `GET /api/brands` and `POST /api/brands` (CI-P2-02 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * `GET` is the one list both screens read - the workspace's table and the wizard's brand selector - so
 * what it answers is the whole of 选择. `POST` is the create behind the "New brand" dialog, and what it
 * defaults matters: a brand created from just a name has to be usable (and selectable) right away,
 * while the two list fields have to survive the round trip because they are what reaches the model.
 *
 * The temp database is pinned before the route is imported; the imports below are therefore `await`s
 * (same three lines as `src/app/api/content/[id]/route.test.ts`).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-brands-route-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "brands.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { GET, POST } = await import("./route");
const { createBrand, listBrands } = await import("@/db/repositories/brands");

const listUrl = "http://localhost/api/brands";

function createRequest(body: unknown) {
  return new Request(listUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/brands", () => {
  it("answers every brand, so the screen and the wizard can select from what they have", async () => {
    const empty = await GET();
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({ ok: true, data: [] });

    const created = await createBrand({ name: "绿源海鲜" });

    const response = await GET();
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.map((row: { id: string }) => row.id)).toEqual([created!.id]);
  });
});

describe("POST /api/brands", () => {
  it("creates the brand the dialog sends, with a 201 and every field it was given", async () => {
    const response = await POST(
      createRequest({
        name: "Clipversity",
        description: "跨境内容工作室",
        targetAudience: "做外贸的中小团队",
        tone: "专业但不生硬",
        keywords: ["选品", "跨境"],
        bannedWords: ["绝对"],
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.data).toMatchObject({
      name: "Clipversity",
      description: "跨境内容工作室",
      targetAudience: "做外贸的中小团队",
      tone: "专业但不生硬",
      keywords: ["选品", "跨境"],
      bannedWords: ["绝对"],
    });
    expect((await listBrands()).some((row) => row.id === payload.data.id)).toBe(true);
  });

  it("creates a usable brand from a name alone, so a half-filled form is not a dead end", async () => {
    const response = await POST(createRequest({ name: "只想先记个名字" }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { name: "只想先记个名字", description: "", targetAudience: "", tone: "", keywords: [], bannedWords: [] },
    });
  });

  it("refuses a brand without a name, and writes nothing", async () => {
    const before = (await listBrands()).length;

    const blank = await POST(createRequest({ name: "   " }));
    expect(blank.status).toBe(400);
    await expect(blank.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });

    const missing = await POST(createRequest({ description: "没有名字" }));
    expect(missing.status).toBe(400);

    expect((await listBrands()).length).toBe(before);
  });

  it("answers a body that is not JSON with the payload guard, not a 500", async () => {
    const response = await POST(
      new Request(listUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "not json" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });
});
