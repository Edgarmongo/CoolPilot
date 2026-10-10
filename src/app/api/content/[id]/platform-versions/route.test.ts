import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { accountPlatforms } from "@/lib/types";

/**
 * `/api/content/[id]/platform-versions` (CI-P2-05) over HTTP: the one place the model layer above it
 * (`src/lib/platform-content.ts`) is reachable from, and where its two separations have to hold:
 *
 *  - **base vs product** (A1): `derive` writes a rendition of the item and leaves the item itself
 *    alone - same title, same text, same status;
 *  - **content vs history** (A2, P2-05-05): deriving, saving, editing and dropping a version must
 *    publish nothing. The observable proof is `publish_records` staying empty while a version appears,
 *    which is what "derives a version ... and publishes nothing while doing it" pins.
 *
 * The other cases are the route's refusals, because a route that answers 200 to everything cannot be
 * told apart from one that guessed: a platform CoolPilot has no account for, a save with neither title
 * nor body, a deep link to an id that is not there, and an edit to a version that was never taken.
 *
 * The temp database is pinned before anything that reads it is imported, which is why the imports below
 * are `await`s (same three lines as `src/app/api/content/[id]/route.test.ts`).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-platform-versions-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "content.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { GET, POST, PATCH, DELETE } = await import("./route");
const { createContentItem, getContentItem, listPublishRecords } = await import("@/db/repository");

/** The route as Next.js calls it: the `[id]` segment arrives as a promise the handler awaits. */
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const url = (id: string, query = "") =>
  `http://localhost/api/content/${encodeURIComponent(id)}/platform-versions${query}`;

const get = (id: string) => GET(new Request(url(id)), params(id));

const post = (id: string, payload: Record<string, unknown>) =>
  POST(new Request(url(id), { method: "POST", body: JSON.stringify(payload) }), params(id));

const patch = (id: string, payload: Record<string, unknown>) =>
  PATCH(new Request(url(id), { method: "PATCH", body: JSON.stringify(payload) }), params(id));

const drop = (id: string, platform: string) =>
  DELETE(new Request(url(id, `?platform=${encodeURIComponent(platform)}`), { method: "DELETE" }), params(id));

const article = (overrides: Partial<Parameters<typeof createContentItem>[0]> = {}) =>
  createContentItem({
    title: "桌面收纳指南",
    body: "<p>正文</p>",
    postReadyText: "正文",
    sourceUrls: [],
    imagePath: "cover.png",
    metadata: { type: "article", images: ["cover.png"] },
    status: "ready",
    ...overrides,
  });

/** A successful answer's payload; every case below reads the same envelope. */
async function payload(response: Response) {
  return (await response.json()).data;
}

describe("GET /api/content/[id]/platform-versions", () => {
  it("answers the base, every adapter on offer and the versions saved so far", async () => {
    const created = await article();

    const response = await get(created.id);
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      contentItemId: created.id,
      base: {
        title: "桌面收纳指南",
        body: "<p>正文</p>",
        postReadyText: "正文",
        imagePath: "cover.png",
        images: ["cover.png"],
        videoPath: "",
      },
      versions: [],
      unreadable: 0,
    });
    expect(body.base.fingerprint).not.toBe("");
    // One adapter per platform CoolPilot has accounts for - the list the account dialog uses.
    expect(body.profiles.map((profile: { platform: string }) => profile.platform)).toEqual([...accountPlatforms]);
    // ...and the Threads entry carries the only budget CoolPilot's own formatter enforces.
    expect(body.profiles.find((profile: { platform: string }) => profile.platform === "Threads")).toMatchObject({
      titleField: false,
      textLimit: 449,
    });
  });

  it("answers 404 for an id that is not there", async () => {
    const response = await get("no-such-item");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});


describe("POST /api/content/[id]/platform-versions", () => {
  it("derives a version from the base and publishes nothing while doing it (P2-05-05)", async () => {
    const created = await article();

    const response = await post(created.id, { platform: "知乎" });
    const body = await payload(response);

    expect(response.status).toBe(200);
    expect(body.versions).toEqual([
      expect.objectContaining({
        platform: "知乎",
        title: "桌面收纳指南",
        body: "正文",
        imagePath: "cover.png",
        videoPath: "",
        source: "derived",
        adaptations: [],
      }),
    ]);

    // A1: the base item is not rewritten by taking a rendition of it...
    expect(await getContentItem(created.id)).toMatchObject({
      title: "桌面收纳指南",
      body: "<p>正文</p>",
      postReadyText: "正文",
      status: "ready",
    });
    // ...the version lives beside it, in the item's own metadata...
    const stored = await getContentItem(created.id);
    expect(stored?.metadata.platformVersions).toMatchObject({ "知乎": { platform: "知乎" } });
    // ...and A2: nothing published, so there is no history entry claiming anything did.
    expect(await listPublishRecords()).toEqual([]);
  });

  it("carries the video only where the platform's own profile has an input for it", async () => {
    const video = await article({
      metadata: { type: "video", images: ["cover.png"], videoPath: "clip.mp4" },
    });

    const body = await payload(await post(video.id, { platform: "抖音" }));

    expect(body.versions[0]).toMatchObject({
      platform: "抖音",
      videoPath: "clip.mp4",
      imagePath: "cover.png",
    });
  });

  it("drops the title on the one platform that is offered none, and says so", async () => {
    const threads = await article({ postReadyText: "很短的推文" });

    const body = await payload(await post(threads.id, { platform: "Threads" }));

    expect(body.versions[0]).toMatchObject({
      platform: "Threads",
      title: "",
      body: "很短的推文",
      adaptations: [{ code: "title-not-offered" }],
    });
  });

  it("saves what the author wrote as an edited version, priced from the base's own fingerprint", async () => {
    const created = await article();

    const body = await payload(
      await post(created.id, { platform: "小红书", mode: "save", title: "手写标题", body: "手写正文" }),
    );

    expect(body.versions[0]).toMatchObject({
      platform: "小红书",
      title: "手写标题",
      body: "手写正文",
      source: "edited",
      adaptations: [],
    });
    // A hand-written rendition carries no media of its own: this build has no field for that yet, and
    // claiming the base's cover here would be a claim the publish path does not honour.
    expect(body.versions[0].imagePath).toBe("");
    expect(body.versions[0].videoPath).toBe("");
    expect(body.versions[0].baseFingerprint).not.toBe("");
  });

  it("keeps an entry this build cannot read, and counts it", async () => {
    const created = await article({
      metadata: { type: "article", images: ["cover.png"], platformVersions: { "抖音": "手写的垃圾" } },
    });

    const body = await payload(await post(created.id, { platform: "知乎" }));

    expect(body.unreadable).toBe(1);
    expect(body.versions.map((version: { platform: string }) => version.platform)).toEqual(["知乎"]);
    expect((await getContentItem(created.id))?.metadata.platformVersions).toMatchObject({ "抖音": "手写的垃圾" });
  });

  it("refuses a platform CoolPilot has no account for, instead of inventing one", async () => {
    const created = await article();

    const response = await post(created.id, { platform: "微博客" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("refuses a save that carries neither a title nor a body", async () => {
    const created = await article();

    const response = await post(created.id, { platform: "知乎", mode: "save" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("answers 404 for an id that is not there instead of creating one", async () => {
    const response = await post("no-such-item", { platform: "知乎" });

    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/content/[id]/platform-versions", () => {
  it("edits the text of a version that exists and keeps its media and provenance", async () => {
    const created = await article();
    const derived = (await payload(await post(created.id, { platform: "知乎" }))).versions[0];

    const body = await payload(await patch(created.id, { platform: "知乎", body: "改过的正文" }));

    expect(body.versions[0]).toMatchObject({
      platform: "知乎",
      title: "桌面收纳指南",
      body: "改过的正文",
      imagePath: "cover.png",
      source: "edited",
      // The base it was derived from has not moved: an edit is not a re-derivation (P2-05-04).
      baseFingerprint: derived.baseFingerprint,
    });
    expect(body.versions[0].updatedAt).toBeGreaterThanOrEqual(derived.updatedAt);
  });

  it("answers 404 for a version that was never taken", async () => {
    const created = await article();
    await post(created.id, { platform: "知乎" });

    const response = await patch(created.id, { platform: "抖音", body: "无主的正文" });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("DELETE /api/content/[id]/platform-versions", () => {
  it("drops one platform's version and leaves the rest of the item alone", async () => {
    const created = await article();
    await post(created.id, { platform: "知乎" });
    const both = await payload(await post(created.id, { platform: "抖音" }));
    expect(both.versions).toHaveLength(2);

    const body = await payload(await drop(created.id, "抖音"));

    expect(body.versions.map((version: { platform: string }) => version.platform)).toEqual(["知乎"]);
    // Dropping a version is neither a publish nor a change to the item's own state.
    expect(await listPublishRecords()).toEqual([]);
    expect((await getContentItem(created.id))?.status).toBe("ready");
  });

  it("treats dropping a version that is not there as a no-op, not an error", async () => {
    const created = await article();

    const response = await drop(created.id, "知乎");

    expect(response.status).toBe(200);
    await expect(payload(response)).resolves.toMatchObject({ versions: [] });
  });

  it("answers 400 when no platform is named", async () => {
    const created = await article();

    const response = await DELETE(new Request(url(created.id), { method: "DELETE" }), params(created.id));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });
});
