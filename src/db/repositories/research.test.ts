import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The research-material table (CI-P3-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * What this file pins is the state model, not the columns: a record with text is `ready` and one without is
 * `draft`, `empty` / `failed` are only ever written by a read, and reading is the one write that may move
 * `content`, `fetchedAt` and the reason without destroying what was there before. `updateResearchMaterial`
 * keeps its hands off the read facts entirely - that is what makes "抓取失败" impossible to fake from an edit.
 *
 * The temp database is pinned before the repository is imported, because `@/db/client` resolves its URL once
 * per process (same three lines as `src/db/repositories/topics.test.ts`).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-research-repo-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "research.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const {
  createResearchMaterial,
  deleteResearchMaterial,
  getResearchMaterial,
  listResearchMaterials,
  recordResearchFetch,
  updateResearchMaterial,
} = await import("./research");

/** `updatedAt` has millisecond resolution, so two writes in one tick would tie. */
function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

describe("research materials repository", () => {
  it("stores a hand-written note as ready text, with no read behind it", async () => {
    const created = await createResearchMaterial({
      title: "夏季冰饮趋势",
      kind: "text",
      content: "冰饮最好卖的时候是七点以后。",
      tags: ["夜市"],
    });

    expect(created).toMatchObject({
      title: "夏季冰饮趋势",
      kind: "text",
      content: "冰饮最好卖的时候是七点以后。",
      sourceUrl: "",
      status: "ready",
      statusMessage: "",
      imageUrl: "",
      fileName: "",
      tags: ["夜市"],
      fetchedAt: null,
    });
    expect(created!.createdAt).toBe(created!.updatedAt);
    expect(await getResearchMaterial(created!.id)).toMatchObject({ id: created!.id });
  });

  it("stores a link nobody has read as draft, which is the state the screen calls 待读取", async () => {
    const created = await createResearchMaterial({
      title: "一篇待读的文章",
      kind: "url",
      sourceUrl: "https://example.com/summer",
    });

    expect(created).toMatchObject({ status: "draft", content: "", fetchedAt: null });
  });

  it("answers the newest edit first, the way the list reads", async () => {
    const first = await createResearchMaterial({ title: "先写的" });
    await nextTick();
    const second = await createResearchMaterial({ title: "后写的" });

    const ids = (await listResearchMaterials()).map((row) => row.id);
    expect(ids.indexOf(second!.id)).toBeLessThan(ids.indexOf(first!.id));
  });

  it("edits only what it was given, and never the read facts", async () => {
    const created = await createResearchMaterial({
      title: "原标题",
      kind: "url",
      sourceUrl: "https://example.com/a",
      content: "读到的正文",
      status: "ready",
      fetchedAt: 100,
    });

    const edited = await updateResearchMaterial(created!.id, { title: "新标题" });

    expect(edited).toMatchObject({
      title: "新标题",
      sourceUrl: "https://example.com/a",
      content: "读到的正文",
      status: "ready",
      fetchedAt: 100,
    });
  });

  it("records a successful read: the page's text replaces the row's, and the read is stamped", async () => {
    const created = await createResearchMaterial({ title: "待读", kind: "url", sourceUrl: "https://example.com/a" });

    const read = await recordResearchFetch(created!.id, {
      status: "ready",
      content: "页面正文",
      imageUrl: "https://example.com/cover.png",
      fetchedAt: 1700,
    });

    expect(read).toMatchObject({
      status: "ready",
      content: "页面正文",
      imageUrl: "https://example.com/cover.png",
      fetchedAt: 1700,
      statusMessage: "",
    });
  });

  it("records an empty read without inventing a 正文 and without discarding the row's own text", async () => {
    const created = await createResearchMaterial({
      title: "有手写正文的来源",
      kind: "url",
      sourceUrl: "https://example.com/a",
      content: "用户自己写的正文",
    });

    const read = await recordResearchFetch(created!.id, { status: "empty", fetchedAt: 1700 });

    expect(read).toMatchObject({ status: "empty", content: "用户自己写的正文", fetchedAt: 1700 });
  });

  it("records a failed read as a failure: no new text, no new read time, and the reason kept", async () => {
    const created = await createResearchMaterial({
      title: "读得动的",
      kind: "url",
      sourceUrl: "https://example.com/a",
      content: "上次读到的正文",
    });
    await recordResearchFetch(created!.id, { status: "ready", content: "上次读到的正文", fetchedAt: 1000 });

    const read = await recordResearchFetch(created!.id, { status: "failed", statusMessage: "HTTP 404" });

    expect(read).toMatchObject({
      status: "failed",
      statusMessage: "HTTP 404",
      content: "上次读到的正文",
      // The earlier successful read is still the last successful read, so the time it happened stays.
      fetchedAt: 1000,
    });
  });

  it("answers null for a read that outlived its row instead of resurrecting it", async () => {
    const created = await createResearchMaterial({ title: "会被删掉" });

    expect(await recordResearchFetch("no-such-material", { status: "ready", content: "x", fetchedAt: 1 })).toBeNull();

    await deleteResearchMaterial(created!.id);
    expect(await getResearchMaterial(created!.id)).toBeNull();
    expect(await recordResearchFetch(created!.id, { status: "ready", content: "x", fetchedAt: 1 })).toBeNull();
  });
});
