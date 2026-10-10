import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The brand table (CI-P2-02 of `docs/coolpilot-capability-integration-plan.md`).
 *
 * The rows this file pins are the ones the card needs: what a brand created from the UI holds by
 * default, that both list fields survive a round trip, that an edit touches only what it was given,
 * and that `updatedAt` - the version an article records as `metadata.brandVersion` (P2-02-04) - moves
 * with every edit while the row keeps its identity.
 *
 * The temp database is pinned before the repository is imported, because `@/db/client` resolves its URL
 * once per process (same three lines as `src/app/api/content/[id]/route.test.ts`).
 */
const dataDir = mkdtempSync(path.join(tmpdir(), "coolpilot-brands-repo-"));
process.env.SOCIAL_AUTO_POST_DB_URL = `file:${path.join(dataDir, "brands.db").replace(/\\/g, "/")}`;
process.env.SOCIAL_AUTO_POST_DATA_DIR = dataDir;

const { createBrand, deleteBrand, getBrand, listBrands, updateBrand } = await import("./brands");

/** `updatedAt` has millisecond resolution, so two writes in one tick would tie. */
function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

describe("brands repository", () => {
  it("stores what the console's minimal create sends, with the rest defaulted", async () => {
    const created = await createBrand({ name: "绿源海鲜" });

    expect(created).toMatchObject({
      name: "绿源海鲜",
      description: "",
      targetAudience: "",
      tone: "",
      keywords: [],
      bannedWords: [],
    });
    expect(created!.createdAt).toBe(created!.updatedAt);
    expect(await getBrand(created!.id)).toMatchObject({ id: created!.id });
  });

  it("keeps both list fields the card asks for: what to say and what not to", async () => {
    const created = await createBrand({
      name: "Clipversity",
      description: "跨境内容工作室",
      targetAudience: "做外贸的中小团队",
      tone: "专业但不生硬",
      keywords: ["选品", "跨境"],
      bannedWords: ["最好用", "绝对"],
    });

    expect(created).toMatchObject({
      description: "跨境内容工作室",
      targetAudience: "做外贸的中小团队",
      tone: "专业但不生硬",
      keywords: ["选品", "跨境"],
      bannedWords: ["最好用", "绝对"],
    });
  });

  it("lists the most recently edited brand first", async () => {
    const older = await createBrand({ name: "A" });
    await nextTick();
    const newer = await createBrand({ name: "B" });

    const afterCreate = (await listBrands()).map((row) => row.id);
    expect(afterCreate.slice(0, 2)).toEqual([newer!.id, older!.id]);

    await nextTick();
    await updateBrand(older!.id, { tone: "改过语气" });

    const afterEdit = await listBrands();
    expect(afterEdit[0].id).toBe(older!.id);
    expect(afterEdit[0].tone).toBe("改过语气");
  });

  it("edits only the fields it was given, and moves the version with the edit", async () => {
    const created = await createBrand({
      name: "保留名称",
      keywords: ["保留"],
      bannedWords: ["保留禁用"],
    });
    await nextTick();

    const edited = await updateBrand(created!.id, { tone: "轻松" });

    expect(edited).toMatchObject({
      id: created!.id,
      name: "保留名称",
      keywords: ["保留"],
      bannedWords: ["保留禁用"],
      tone: "轻松",
    });
    // The version is what an article records, so it has to change when the brand does.
    expect(edited!.updatedAt).toBeGreaterThan(created!.updatedAt);
    expect(edited!.createdAt).toBe(created!.createdAt);

    // An emptied list is an edit too, not an absent one: `[]` is written, the untouched list stays.
    const cleared = await updateBrand(created!.id, { keywords: [] });
    expect(cleared!.keywords).toEqual([]);
    expect(cleared!.bannedWords).toEqual(["保留禁用"]);
  });

  it("answers null for a brand that is gone instead of creating one", async () => {
    expect(await getBrand("no-such-brand")).toBeNull();
    expect(await updateBrand("no-such-brand", { tone: "无用" })).toBeNull();
    // Deleting something that is not there is not an error either.
    await expect(deleteBrand("no-such-brand")).resolves.toBeUndefined();
  });

  it("deletes a brand without rewriting the articles that were written as it", async () => {
    const created = await createBrand({ name: "待删除" });

    await deleteBrand(created!.id);

    expect(await getBrand(created!.id)).toBeNull();
    expect((await listBrands()).some((row) => row.id === created!.id)).toBe(false);
  });
});
