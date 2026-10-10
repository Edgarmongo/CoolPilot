import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The topic table (CI-P2-01 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The rows this file pins are the ones the card needs: what a topic created from the UI or imported
 * from a hot-topic feed holds by default, that an edit touches only what it was given (archive is one
 * of those edits), and that the link between a topic and the article it produced is written by the
 * generation entry alone - including when the topic has been deleted in the meantime, which must not
 * resurrect it.
 *
 * The temp database is pinned before the repository is imported, because `@/db/client` resolves its URL
 * once per process (same three lines as `src/app/api/content/[id]/route.test.ts`).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-topics-repo-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "topics.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { createTopic, deleteTopic, getTopic, linkTopicContentItem, listTopics, updateTopic } = await import("./topics");

/** `updatedAt` has millisecond resolution, so two writes in one tick would tie. */
function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

describe("topics repository", () => {
  it("stores what the console's minimal create sends, with the rest defaulted", async () => {
    const created = await createTopic({ title: "桌面收纳指南" });

    expect(created).toMatchObject({
      title: "桌面收纳指南",
      description: "",
      keywords: [],
      source: "manual",
      sourceUrl: "",
      status: "active",
      contentItemId: null,
    });
    expect(created!.createdAt).toBe(created!.updatedAt);
    expect(await getTopic(created!.id)).toMatchObject({ id: created!.id });
  });

  it("keeps the fields an imported or hand-written topic carries", async () => {
    const created = await createTopic({
      title: "夏季美食趋势",
      description: "从冰饮讲起",
      keywords: ["冰饮", "夜市"],
      source: "微博",
      sourceUrl: "https://example.com/hot/summer",
      status: "archived",
    });

    expect(created).toMatchObject({
      description: "从冰饮讲起",
      keywords: ["冰饮", "夜市"],
      source: "微博",
      sourceUrl: "https://example.com/hot/summer",
      status: "archived",
    });
  });

  it("lists the most recently edited topic first", async () => {
    const older = await createTopic({ title: "A" });
    await nextTick();
    const newer = await createTopic({ title: "B" });

    // The file's earlier cases already wrote topics, so the order is read as "these two lead".
    const afterCreate = (await listTopics()).map((row) => row.id);
    expect(afterCreate.slice(0, 2)).toEqual([newer!.id, older!.id]);

    await nextTick();
    await updateTopic(older!.id, { title: "A（改）" });

    const afterEdit = await listTopics();
    expect(afterEdit[0].id).toBe(older!.id);
    expect(afterEdit[0].title).toBe("A（改）");
  });

  it("edits only the fields it was given, so an archive is not a rewrite", async () => {
    const created = await createTopic({ title: "保留标题", keywords: ["保留"], source: "微博" });
    await nextTick();

    const archived = await updateTopic(created!.id, { status: "archived" });

    expect(archived).toMatchObject({
      id: created!.id,
      title: "保留标题",
      keywords: ["保留"],
      source: "微博",
      status: "archived",
    });
    expect(archived!.updatedAt).toBeGreaterThan(created!.updatedAt);
    // The same edit un-archives, which is what the list's restore button sends.
    expect((await updateTopic(created!.id, { status: "active" }))!.status).toBe("active");
  });

  it("records the article a topic produced, and names the newest one on a regeneration", async () => {
    const created = await createTopic({ title: "写一篇" });

    expect((await linkTopicContentItem(created!.id, "item-1"))!.contentItemId).toBe("item-1");
    expect((await linkTopicContentItem(created!.id, "item-2"))!.contentItemId).toBe("item-2");
    expect((await getTopic(created!.id))!.contentItemId).toBe("item-2");
  });

  it("answers null for a topic that is gone instead of creating one", async () => {
    expect(await getTopic("no-such-topic")).toBeNull();
    expect(await linkTopicContentItem("no-such-topic", "item-1")).toBeNull();
    // Deleting something that is not there is not an error either.
    await expect(deleteTopic("no-such-topic")).resolves.toBeUndefined();
  });

  it("deletes a topic without touching the article it produced", async () => {
    const created = await createTopic({ title: "待删除" });
    await linkTopicContentItem(created!.id, "item-keep");

    await deleteTopic(created!.id);

    expect(await getTopic(created!.id)).toBeNull();
    expect((await listTopics()).some((row) => row.id === created!.id)).toBe(false);
  });
});
